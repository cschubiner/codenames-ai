"""Candidate clue selection based on simulated evaluation."""

from dataclasses import dataclass
from typing import Optional

from ..game import GameState, Team, Clue
from ..guesser import Guesser, GuesserConfig
from ..spymaster import Spymaster, SpymasterConfig, CandidateClue
from .simulator import BatchSimulator, RolloutResult
from .aggregator import Aggregator, AggregationMethod, AggregatedScore, get_aggregator
from .reward import RewardCalculator, RewardConfig


@dataclass
class SelectionConfig:
    """Configuration for clue selection."""
    eval_samples_per_candidate: int = 3
    eval_temperature: float = 0.3
    aggregation: AggregationMethod = AggregationMethod.MEAN_MINUS_STD


@dataclass
class SelectionResult:
    """Result of the clue selection process."""
    selected_clue: CandidateClue
    selected_score: AggregatedScore
    all_scores: list[AggregatedScore]
    all_rollouts: dict[str, list[RolloutResult]]

    @property
    def summary(self) -> str:
        """Human-readable summary of selection."""
        lines = [f"Selected: {self.selected_clue.clue} {self.selected_clue.number}"]
        lines.append(f"  Targets: {', '.join(self.selected_clue.intended_targets)}")
        lines.append(f"  Score: {self.selected_score.score:.2f}")
        lines.append(f"  (mean={self.selected_score.mean:.2f}, std={self.selected_score.std:.2f})")
        lines.append("")
        lines.append("All candidates (ranked):")
        for score in sorted(self.all_scores, key=lambda s: s.score, reverse=True):
            marker = " *" if score.clue_word == self.selected_clue.clue else ""
            lines.append(f"  {score.clue_word}: {score.score:.2f}{marker}")
        return "\n".join(lines)


class ClueSelector:
    """
    Selects the best clue from candidates using simulated evaluation.

    The selection process:
    1. Spymaster generates K candidate clues
    2. For each candidate, run G guesser rollouts
    3. Aggregate rollout rewards using chosen strategy
    4. Select the candidate with the highest aggregated score

    This is the core intelligence of the system - using the guesser
    LLM as an evaluation function to score clue quality.
    """

    def __init__(
        self,
        spymaster: Spymaster,
        guesser: Guesser,
        config: SelectionConfig,
        reward_config: Optional[RewardConfig] = None,
    ):
        """
        Initialize the selector.

        Args:
            spymaster: Spymaster for generating candidates
            guesser: Guesser for evaluating candidates
            config: Selection configuration
            reward_config: Optional reward configuration
        """
        self.spymaster = spymaster
        self.guesser = guesser
        self.config = config

        reward_calculator = RewardCalculator(reward_config) if reward_config else None
        self.batch_simulator = BatchSimulator(guesser, reward_calculator)
        self.aggregator = get_aggregator(config.aggregation)

    async def select_clue(
        self,
        state: GameState,
        team: Team,
    ) -> SelectionResult:
        """
        Select the best clue for the current game state.

        Args:
            state: Current game state
            team: The team to generate a clue for

        Returns:
            SelectionResult with the selected clue and evaluation details
        """
        # Generate candidate clues
        spymaster_output = await self.spymaster.generate_candidates(state, team)
        candidates = spymaster_output.candidates

        # Convert to Clue objects for simulation
        clues = [c.to_clue(team) for c in candidates]

        # Evaluate all candidates
        batch_result = await self.batch_simulator.evaluate_candidates(
            state,
            clues,
            rollouts_per_candidate=self.config.eval_samples_per_candidate,
            temperature=self.config.eval_temperature,
        )

        # Aggregate scores for each candidate
        all_scores: list[AggregatedScore] = []
        for candidate in candidates:
            rollouts = batch_result.candidate_results[candidate.clue]
            score = self.aggregator.aggregate(rollouts)
            all_scores.append(score)

        # Select the best
        best_score = max(all_scores, key=lambda s: s.score)
        best_candidate = next(c for c in candidates if c.clue == best_score.clue_word)

        return SelectionResult(
            selected_clue=best_candidate,
            selected_score=best_score,
            all_scores=all_scores,
            all_rollouts=batch_result.candidate_results,
        )

    async def select_clue_with_candidates(
        self,
        state: GameState,
        team: Team,
        candidates: list[CandidateClue],
    ) -> SelectionResult:
        """
        Select the best clue from pre-generated candidates.

        Use this when you want to separate clue generation from evaluation,
        or when you want to evaluate custom candidates.

        Args:
            state: Current game state
            team: The team to generate a clue for
            candidates: Pre-generated candidate clues

        Returns:
            SelectionResult with the selected clue and evaluation details
        """
        # Convert to Clue objects for simulation
        clues = [c.to_clue(team) for c in candidates]

        # Evaluate all candidates
        batch_result = await self.batch_simulator.evaluate_candidates(
            state,
            clues,
            rollouts_per_candidate=self.config.eval_samples_per_candidate,
            temperature=self.config.eval_temperature,
        )

        # Aggregate scores for each candidate
        all_scores: list[AggregatedScore] = []
        for candidate in candidates:
            rollouts = batch_result.candidate_results[candidate.clue]
            score = self.aggregator.aggregate(rollouts)
            all_scores.append(score)

        # Select the best
        best_score = max(all_scores, key=lambda s: s.score)
        best_candidate = next(c for c in candidates if c.clue == best_score.clue_word)

        return SelectionResult(
            selected_clue=best_candidate,
            selected_score=best_score,
            all_scores=all_scores,
            all_rollouts=batch_result.candidate_results,
        )


@dataclass
class AgentConfig:
    """Complete configuration for a Codenames AI agent."""
    name: str
    spymaster: SpymasterConfig
    guesser: GuesserConfig
    selection: SelectionConfig

    @classmethod
    def from_dict(cls, data: dict) -> "AgentConfig":
        """Load config from a dictionary (e.g., from JSON)."""
        return cls(
            name=data["name"],
            spymaster=SpymasterConfig(
                model=data["spymaster"]["model"],
                prompt_id=data["spymaster"]["prompt_id"],
                temperature=data["spymaster"]["temperature"],
                candidates_per_turn=data["spymaster"]["candidates_per_turn"],
            ),
            guesser=GuesserConfig(
                model=data["guesser"]["model"],
                prompt_id=data["guesser"]["prompt_id"],
                temperature=data["guesser"]["temperature"],
            ),
            selection=SelectionConfig(
                eval_samples_per_candidate=data["selection"]["eval_samples_per_candidate"],
                eval_temperature=data["selection"]["eval_temperature"],
                aggregation=AggregationMethod(data["selection"]["aggregation"]),
            ),
        )

    @classmethod
    def load_from_file(cls, filepath: str) -> "AgentConfig":
        """Load config from a JSON file."""
        import json
        from pathlib import Path

        with open(Path(filepath)) as f:
            data = json.load(f)
        return cls.from_dict(data)
