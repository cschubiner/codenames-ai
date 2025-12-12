"""Benchmark runner for full game simulations."""

import asyncio
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Callable

from openai import AsyncOpenAI

from ..game import GameState, Team, GameRules, BoardGenerator, CardType
from ..guesser import Guesser, GuesserConfig
from ..spymaster import Spymaster, SpymasterConfig
from ..evaluation import ClueSelector, SelectionConfig, AgentConfig
from .metrics import GameMetrics, TurnMetrics, BenchmarkMetrics


@dataclass
class RunnerConfig:
    """Configuration for the benchmark runner."""
    max_turns: int = 50  # Safety limit
    verbose: bool = True


class GameRunner:
    """
    Runs a complete Codenames game between two AI agents.

    The runner orchestrates:
    1. Spymaster generates and selects clue
    2. Guesser responds to clue
    3. Game state updates
    4. Repeat until win/loss
    """

    def __init__(
        self,
        red_agent: AgentConfig,
        blue_agent: AgentConfig,
        client: Optional[AsyncOpenAI] = None,
        config: Optional[RunnerConfig] = None,
    ):
        """
        Initialize the game runner.

        Args:
            red_agent: Configuration for the RED team agent
            blue_agent: Configuration for the BLUE team agent
            client: Shared OpenAI client
            config: Runner configuration
        """
        self.client = client or AsyncOpenAI()
        self.config = config or RunnerConfig()

        # Initialize RED team components
        self.red_spymaster = Spymaster(red_agent.spymaster, self.client)
        self.red_guesser = Guesser(red_agent.guesser, self.client)
        self.red_selector = ClueSelector(
            self.red_spymaster,
            self.red_guesser,
            red_agent.selection,
        )

        # Initialize BLUE team components
        self.blue_spymaster = Spymaster(blue_agent.spymaster, self.client)
        self.blue_guesser = Guesser(blue_agent.guesser, self.client)
        self.blue_selector = ClueSelector(
            self.blue_spymaster,
            self.blue_guesser,
            blue_agent.selection,
        )

        self.red_agent = red_agent
        self.blue_agent = blue_agent

    def _get_selector(self, team: Team) -> ClueSelector:
        """Get the selector for a team."""
        return self.red_selector if team == Team.RED else self.blue_selector

    def _get_guesser(self, team: Team) -> Guesser:
        """Get the guesser for a team."""
        return self.red_guesser if team == Team.RED else self.blue_guesser

    async def run_game(
        self,
        initial_state: GameState,
        board_id: str = "unknown",
        on_turn: Optional[Callable[[GameState, TurnMetrics], None]] = None,
    ) -> GameMetrics:
        """
        Run a complete game.

        Args:
            initial_state: Starting game state
            board_id: Identifier for the board
            on_turn: Optional callback after each turn

        Returns:
            GameMetrics with full game statistics
        """
        start_time = time.time()
        state = initial_state.copy()
        turns: list[TurnMetrics] = []

        while not state.game_over and len(turns) < self.config.max_turns:
            turn_start = time.time()
            current_team = state.current_team

            # Get selector for current team
            selector = self._get_selector(current_team)

            # Select best clue
            selection_result = await selector.select_clue(state, current_team)
            selected_clue = selection_result.selected_clue
            clue = selected_clue.to_clue(current_team)

            if self.config.verbose:
                print(f"\n{current_team.value.upper()} Spymaster: {clue.word} {clue.number}")
                print(f"  Intended: {', '.join(selected_clue.intended_targets)}")

            # Give the clue
            state = GameRules.give_clue(state, clue)

            # Get guesser to respond
            guesser = self._get_guesser(current_team)
            guesser_output = await guesser.get_guesses(state, clue)
            guesses_to_make = guesser.get_ordered_words(
                guesser_output, limit=clue.number + 1
            )

            if self.config.verbose:
                print(f"{current_team.value.upper()} Guesser guesses: {guesses_to_make}")

            # Execute guesses
            final_state, turn_result = GameRules.simulate_guesses(state, guesses_to_make)

            # Collect turn metrics
            correct = sum(1 for g in turn_result.guesses if g.correct)
            hit_assassin = any(g.card_type == CardType.ASSASSIN for g in turn_result.guesses)
            hit_opponent = any(
                g.card_type == CardType.for_team(current_team.opponent)
                for g in turn_result.guesses
            )

            turn_metrics = TurnMetrics(
                team=current_team,
                clue_word=clue.word,
                clue_number=clue.number,
                intended_targets=selected_clue.intended_targets,
                guesses_made=[g.word for g in turn_result.guesses],
                correct_guesses=correct,
                hit_assassin=hit_assassin,
                hit_opponent=hit_opponent,
                turn_ended_by=turn_result.turn_ended_by,
                latency_ms=(time.time() - turn_start) * 1000,
            )
            turns.append(turn_metrics)

            if on_turn:
                on_turn(final_state, turn_metrics)

            if self.config.verbose:
                print(f"  Result: {correct} correct, ended by {turn_result.turn_ended_by}")
                if final_state.game_over:
                    print(f"  GAME OVER: {final_state.winner.value.upper()} wins!")

            state = final_state

        # Compile game metrics
        return GameMetrics(
            board_id=board_id,
            config_name=self.red_agent.name,
            winner=state.winner,
            total_turns=len(turns),
            red_turns=sum(1 for t in turns if t.team == Team.RED),
            blue_turns=sum(1 for t in turns if t.team == Team.BLUE),
            assassin_loss=any(t.hit_assassin for t in turns),
            red_final_remaining=state.red_remaining,
            blue_final_remaining=state.blue_remaining,
            turns=turns,
            game_duration_s=time.time() - start_time,
        )


class BenchmarkRunner:
    """
    Runs benchmark games across multiple boards.

    Supports:
    - Running on board sets (dev, holdout)
    - Mirror matches (swap teams to cancel first-move advantage)
    - Multiple replicates per board
    """

    def __init__(
        self,
        agent_config: AgentConfig,
        opponent_config: Optional[AgentConfig] = None,
        client: Optional[AsyncOpenAI] = None,
        runner_config: Optional[RunnerConfig] = None,
    ):
        """
        Initialize the benchmark runner.

        Args:
            agent_config: The agent to benchmark
            opponent_config: The opponent agent (uses same config if not specified)
            client: Shared OpenAI client
            runner_config: Runner configuration
        """
        self.agent_config = agent_config
        self.opponent_config = opponent_config or agent_config
        self.client = client or AsyncOpenAI()
        self.runner_config = runner_config or RunnerConfig()

    async def run_benchmark(
        self,
        boards: list[GameState],
        replicates: int = 1,
        mirror: bool = True,
        on_game: Optional[Callable[[GameMetrics], None]] = None,
    ) -> BenchmarkMetrics:
        """
        Run benchmark on a set of boards.

        Args:
            boards: List of game states to use
            replicates: Number of times to play each board
            mirror: If True, play twice with teams swapped
            on_game: Optional callback after each game

        Returns:
            BenchmarkMetrics with aggregated results
        """
        all_games: list[GameMetrics] = []

        for board_idx, board in enumerate(boards):
            for rep in range(replicates):
                # Play as RED
                runner = GameRunner(
                    self.agent_config,
                    self.opponent_config,
                    self.client,
                    self.runner_config,
                )
                game_id = f"board_{board_idx}_rep_{rep}_red"
                metrics = await runner.run_game(board.copy(), game_id)
                all_games.append(metrics)

                if on_game:
                    on_game(metrics)

                # Mirror match - play as BLUE
                if mirror:
                    runner = GameRunner(
                        self.opponent_config,  # Opponent now plays RED
                        self.agent_config,      # Agent plays BLUE
                        self.client,
                        self.runner_config,
                    )
                    game_id = f"board_{board_idx}_rep_{rep}_blue"
                    metrics = await runner.run_game(board.copy(), game_id)
                    # Flip perspective - we track BLUE's performance
                    metrics.config_name = self.agent_config.name
                    all_games.append(metrics)

                    if on_game:
                        on_game(metrics)

        return BenchmarkMetrics(
            config_name=self.agent_config.name,
            total_games=len(all_games),
            games=all_games,
        )

    async def run_on_board_set(
        self,
        board_file: Path,
        replicates: int = 1,
        mirror: bool = True,
        max_boards: Optional[int] = None,
    ) -> BenchmarkMetrics:
        """
        Run benchmark on a saved board set.

        Args:
            board_file: Path to board set JSON file
            replicates: Number of times to play each board
            mirror: If True, play twice with teams swapped
            max_boards: Limit number of boards (for testing)

        Returns:
            BenchmarkMetrics with aggregated results
        """
        boards = BoardGenerator.load_boards(board_file)

        if max_boards:
            boards = boards[:max_boards]

        return await self.run_benchmark(boards, replicates, mirror)
