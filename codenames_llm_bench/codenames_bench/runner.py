from __future__ import annotations

import json
import random
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

from .agent import TeamAgent
from .boards import Board
from .env import GameState, init_game_state, other_team
from .openai_responses import OpenAIResponsesClient, SQLiteCache
from .types import AgentConfig, Team


def play_game(
    board: Board,
    *,
    red_cfg: AgentConfig,
    blue_cfg: AgentConfig,
    client: OpenAIResponsesClient,
    max_turns: int = 100,
) -> Dict[str, Any]:
    state = init_game_state(board)

    red_agent = TeamAgent(red_cfg, client)
    blue_agent = TeamAgent(blue_cfg, client)

    turns: List[Dict[str, Any]] = []
    winner: Optional[Team] = None
    loser: Optional[Team] = None
    end_reason: str = "unknown"

    for turn_idx in range(max_turns):
        team = state.current_team
        agent = red_agent if team == "RED" else blue_agent

        clue, number, guesses, tlog = agent.take_turn(state, team)
        # tlog already contains the applied outcome (agent applied it)
        turns.append(_turnlog_to_dict(tlog))

        outcome = tlog.actual_outcome
        if outcome.get("game_over"):
            winner = outcome.get("winner")
            loser = outcome.get("loser")
            if outcome.get("stopped_reason") == "assassin":
                end_reason = "assassin"
            else:
                end_reason = "completed_agents"
            break

        # advance turn
        state.current_team = other_team(team)

    if winner is None:
        end_reason = "max_turns"
    return {
        "board_id": board.board_id,
        "words": board.words,
        "key": board.key,
        "starting_team": board.starting_team,
        "winner": winner,
        "loser": loser,
        "end_reason": end_reason,
        "turns": turns,
    }


def run_match(
    boards: Iterable[Board],
    *,
    red_cfg: AgentConfig,
    blue_cfg: AgentConfig,
    out_path: str | Path,
    replicates: int = 1,
    seed: int = 0,
    mirror: bool = False,
    max_turns: int = 100,
    cache_path: Optional[str] = None,
) -> None:
    """
    Runs games and writes one JSON object per line to out_path.
    If mirror=True, also runs the swapped-color game for each board.
    """
    rng = random.Random(seed)
    outp = Path(out_path)
    outp.parent.mkdir(parents=True, exist_ok=True)

    cache = SQLiteCache(cache_path) if cache_path else None
    client = OpenAIResponsesClient(cache=cache)

    with outp.open("w", encoding="utf-8") as f:
        for b in boards:
            for r in range(replicates):
                # main orientation
                game = play_game(
                    b,
                    red_cfg=red_cfg,
                    blue_cfg=blue_cfg,
                    client=client,
                    max_turns=max_turns,
                )
                game_meta = {
                    "run_id": f"{b.board_id}::rep{r}::Ared",
                    "red_agent": red_cfg.name,
                    "blue_agent": blue_cfg.name,
                    "mirror": False,
                }
                f.write(json.dumps({**game_meta, **game}) + "\n")
                f.flush()

                if mirror:
                    game2 = play_game(
                        b,
                        red_cfg=blue_cfg,   # swapped
                        blue_cfg=red_cfg,
                        client=client,
                        max_turns=max_turns,
                    )
                    game2_meta = {
                        "run_id": f"{b.board_id}::rep{r}::Ablue",
                        "red_agent": blue_cfg.name,
                        "blue_agent": red_cfg.name,
                        "mirror": True,
                    }
                    f.write(json.dumps({**game2_meta, **game2}) + "\n")
                    f.flush()


def _turnlog_to_dict(tlog: Any) -> Dict[str, Any]:
    # tlog is a TurnLog dataclass
    if hasattr(tlog, "__dict__"):
        return {
            "team": tlog.team,
            "generated_candidates": tlog.generated_candidates,
            "legal_candidates": tlog.legal_candidates,
            "rejected_candidates": tlog.rejected_candidates,
            "candidate_evaluations": tlog.candidate_evaluations,
            "chosen": tlog.chosen,
            "actual_guesses": tlog.actual_guesses,
            "actual_outcome": tlog.actual_outcome,
        }
    return dict(tlog)
