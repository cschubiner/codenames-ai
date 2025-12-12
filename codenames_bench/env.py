from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Literal, Optional, Tuple

from .types import CardType, Team
from .boards import Board


@dataclass
class GameState:
    board: Board
    revealed: List[bool]
    current_team: Team

    def copy(self) -> "GameState":
        return GameState(board=self.board, revealed=list(self.revealed), current_team=self.current_team)

    @property
    def words(self) -> List[str]:
        return self.board.words

    @property
    def key(self) -> List[CardType]:
        return self.board.key

    def unrevealed_indices(self) -> List[int]:
        return [i for i, r in enumerate(self.revealed) if not r]

    def unrevealed_words(self) -> List[str]:
        return [w for w, r in zip(self.board.words, self.revealed) if not r]

    def remaining(self, team: Team) -> int:
        return sum(1 for t, r in zip(self.key, self.revealed) if (not r) and t == team)

    def remaining_by_type(self) -> Dict[CardType, int]:
        out: Dict[CardType, int] = {"RED": 0, "BLUE": 0, "NEUTRAL": 0, "ASSASSIN": 0}
        for t, r in zip(self.key, self.revealed):
            if not r:
                out[t] += 1
        return out


@dataclass
class AppliedGuess:
    word: str
    index: int
    card_type: CardType


@dataclass
class TurnOutcome:
    team: Team
    clue: str
    number: int
    max_allowed: int
    guesses: List[str]
    applied: List[AppliedGuess]
    stopped_reason: Literal["stop", "limit", "wrong", "assassin", "invalid_or_repeat"]
    # game status
    game_over: bool
    winner: Optional[Team]
    loser: Optional[Team]


def other_team(team: Team) -> Team:
    return "BLUE" if team == "RED" else "RED"


def apply_turn(
    state: GameState,
    team: Team,
    clue: str,
    number: int,
    guesses: List[str],
    *,
    enforce_max_allowed: bool = True,
) -> TurnOutcome:
    """
    Applies guesses to the game state (mutates state.revealed).
    Turn ends when:
      - guess list ends (stop),
      - a wrong (opponent/neutral) is revealed,
      - assassin is revealed,
      - max allowed reached.
    """
    max_allowed = max(0, number + 1)
    applied: List[AppliedGuess] = []
    game_over = False
    winner: Optional[Team] = None
    loser: Optional[Team] = None

    # Track repeats/invalids
    seen = set()
    stopped_reason: TurnOutcome.stopped_reason = "stop"  # type: ignore

    for j, guess in enumerate(guesses):
        if enforce_max_allowed and j >= max_allowed:
            stopped_reason = "limit"
            break

        g = guess.strip().upper()
        if not g:
            stopped_reason = "invalid_or_repeat"
            break
        if g in seen:
            stopped_reason = "invalid_or_repeat"
            break
        seen.add(g)

        if g not in state.words:
            stopped_reason = "invalid_or_repeat"
            break

        idx = state.words.index(g)
        if state.revealed[idx]:
            stopped_reason = "invalid_or_repeat"
            break

        # reveal
        state.revealed[idx] = True
        ctype = state.key[idx]
        applied.append(AppliedGuess(word=g, index=idx, card_type=ctype))

        if ctype == "ASSASSIN":
            game_over = True
            winner = other_team(team)
            loser = team
            stopped_reason = "assassin"
            break

        if ctype != team:
            # opponent or neutral => turn ends
            stopped_reason = "wrong"
            # if that reveal completed opponent's set, opponent wins immediately
            if state.remaining(other_team(team)) == 0:
                game_over = True
                winner = other_team(team)
                loser = team
            break

        # ctype == team => continue

        # check if team just won
        if state.remaining(team) == 0:
            game_over = True
            winner = team
            loser = other_team(team)
            break

    # If loop ended naturally (no break) and we used up guesses, that's stop (already default).
    # If we ended due to reaching the max allowed, stopped_reason already set.
    return TurnOutcome(
        team=team,
        clue=clue,
        number=number,
        max_allowed=max_allowed,
        guesses=guesses,
        applied=applied,
        stopped_reason=stopped_reason,
        game_over=game_over,
        winner=winner,
        loser=loser,
    )


def init_game_state(board: Board) -> GameState:
    return GameState(
        board=board,
        revealed=[False] * 25,
        current_team=board.starting_team,
    )
