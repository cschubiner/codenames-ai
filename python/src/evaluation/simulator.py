"""Rollout simulator for evaluating candidate clues."""

from dataclasses import dataclass
from typing import Optional

from ..game import GameState, Team, Clue, GameRules, TurnResult
from ..guesser import Guesser, GuesserConfig, GuesserOutput
from .reward import RewardCalculator, RewardBreakdown, RewardConfig


@dataclass
class RolloutResult:
    """Result of a single rollout simulation."""
    clue: Clue
    guesser_output: GuesserOutput
    guesses_made: list[str]
    turn_result: TurnResult
    reward: RewardBreakdown


@dataclass
class SimulatorConfig:
    """Configuration for the rollout simulator."""
    max_guesses: Optional[int] = None  # None means use clue.number + 1
    use_stop_recommendation: bool = True  # Honor guesser's stop_after


class RolloutSimulator:
    """
    Simulates guesser behavior to evaluate candidate clues.

    Given a clue and game state, the simulator:
    1. Runs the guesser LLM to get ordered guesses
    2. Applies the guesses to the game state following rules
    3. Calculates the reward for the turn outcome

    This is the core of the evaluation - the guesser LLM behavior
    is the "ground truth" for how good a clue is.
    """

    def __init__(
        self,
        guesser: Guesser,
        reward_calculator: Optional[RewardCalculator] = None,
        config: Optional[SimulatorConfig] = None,
    ):
        """
        Initialize the simulator.

        Args:
            guesser: The guesser LLM to use for simulations
            reward_calculator: Reward calculator (uses default if not provided)
            config: Simulator configuration
        """
        self.guesser = guesser
        self.reward_calculator = reward_calculator or RewardCalculator()
        self.config = config or SimulatorConfig()

    async def simulate_turn(
        self,
        state: GameState,
        clue: Clue,
        temperature: Optional[float] = None,
    ) -> RolloutResult:
        """
        Simulate a complete turn with the given clue.

        Args:
            state: Starting game state (before clue is given)
            clue: The clue to evaluate
            temperature: Override guesser temperature

        Returns:
            RolloutResult with full simulation details
        """
        # Give the clue
        state_with_clue = GameRules.give_clue(state, clue)

        # Get guesser's response
        guesser_output = await self.guesser.get_guesses(
            state_with_clue, clue, temperature=temperature
        )

        # Determine how many guesses to make
        max_guesses = self.config.max_guesses or (clue.number + 1)

        # Honor guesser's stop recommendation if configured
        if self.config.use_stop_recommendation and guesser_output.stop_after > 0:
            max_guesses = min(max_guesses, guesser_output.stop_after)

        # Get ordered guess words
        guesses_to_make = self.guesser.get_ordered_words(
            guesser_output, limit=max_guesses
        )

        # Simulate the guesses
        final_state, turn_result = GameRules.simulate_guesses(
            state_with_clue, guesses_to_make
        )

        # Calculate reward
        reward = self.reward_calculator.calculate_turn_reward(
            turn_result, clue.team
        )

        return RolloutResult(
            clue=clue,
            guesser_output=guesser_output,
            guesses_made=guesses_to_make[:len(turn_result.guesses)],
            turn_result=turn_result,
            reward=reward,
        )

    async def simulate_multiple(
        self,
        state: GameState,
        clue: Clue,
        n: int,
        temperature: Optional[float] = None,
    ) -> list[RolloutResult]:
        """
        Run multiple rollouts for the same clue.

        Args:
            state: Starting game state
            clue: The clue to evaluate
            n: Number of rollouts to run
            temperature: Override guesser temperature (higher = more variance)

        Returns:
            List of RolloutResults
        """
        import asyncio

        tasks = [
            self.simulate_turn(state, clue, temperature)
            for _ in range(n)
        ]
        return await asyncio.gather(*tasks)


@dataclass
class BatchSimulationResult:
    """Result of simulating multiple candidates."""
    candidate_results: dict[str, list[RolloutResult]]  # clue word -> rollouts


class BatchSimulator:
    """
    Simulates multiple candidate clues in parallel.
    """

    def __init__(
        self,
        guesser: Guesser,
        reward_calculator: Optional[RewardCalculator] = None,
        config: Optional[SimulatorConfig] = None,
    ):
        """Initialize the batch simulator."""
        self.simulator = RolloutSimulator(guesser, reward_calculator, config)

    async def evaluate_candidates(
        self,
        state: GameState,
        candidates: list[Clue],
        rollouts_per_candidate: int = 3,
        temperature: Optional[float] = None,
    ) -> BatchSimulationResult:
        """
        Evaluate multiple candidate clues with multiple rollouts each.

        Args:
            state: Starting game state
            candidates: List of candidate clues to evaluate
            rollouts_per_candidate: Number of rollouts per candidate
            temperature: Override guesser temperature

        Returns:
            BatchSimulationResult with all rollout results
        """
        import asyncio

        # Create all simulation tasks
        all_tasks = []
        task_to_clue = {}

        for clue in candidates:
            tasks = [
                self.simulator.simulate_turn(state, clue, temperature)
                for _ in range(rollouts_per_candidate)
            ]
            for task in tasks:
                task_to_clue[id(task)] = clue.word
            all_tasks.extend(tasks)

        # Run all simulations in parallel
        results = await asyncio.gather(*all_tasks)

        # Organize results by clue
        candidate_results: dict[str, list[RolloutResult]] = {
            clue.word: [] for clue in candidates
        }

        for i, result in enumerate(results):
            candidate_results[result.clue.word].append(result)

        return BatchSimulationResult(candidate_results=candidate_results)
