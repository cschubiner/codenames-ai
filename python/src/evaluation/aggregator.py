"""Aggregation strategies for rollout results."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Optional

import numpy as np

from .simulator import RolloutResult


class AggregationMethod(Enum):
    """Available aggregation methods."""
    MEAN = "mean"
    MEAN_MINUS_STD = "mean_minus_std"
    PERCENTILE_25 = "percentile_25"
    CVAR_25 = "cvar_25"
    MIN = "min"
    MAX = "max"


@dataclass
class AggregatedScore:
    """Aggregated score for a candidate clue."""
    clue_word: str
    score: float
    mean: float
    std: float
    min: float
    max: float
    n_rollouts: int
    raw_rewards: list[float]

    @property
    def summary(self) -> str:
        """Human-readable summary."""
        return (
            f"{self.clue_word}: score={self.score:.2f} "
            f"(mean={self.mean:.2f}, std={self.std:.2f}, "
            f"min={self.min:.2f}, max={self.max:.2f}, n={self.n_rollouts})"
        )


class Aggregator(ABC):
    """Base class for aggregation strategies."""

    @abstractmethod
    def aggregate(self, rollouts: list[RolloutResult]) -> AggregatedScore:
        """
        Aggregate multiple rollout results into a single score.

        Args:
            rollouts: List of rollout results for a single clue

        Returns:
            AggregatedScore with the final score and statistics
        """
        pass

    def _compute_stats(self, rollouts: list[RolloutResult]) -> tuple[list[float], float, float, float, float]:
        """Compute basic statistics for rollouts."""
        rewards = [r.reward.total_reward for r in rollouts]
        rewards_array = np.array(rewards)
        return (
            rewards,
            float(np.mean(rewards_array)),
            float(np.std(rewards_array)),
            float(np.min(rewards_array)),
            float(np.max(rewards_array)),
        )


class MeanAggregator(Aggregator):
    """Simple mean aggregation - optimistic/risk-neutral."""

    def aggregate(self, rollouts: list[RolloutResult]) -> AggregatedScore:
        rewards, mean, std, min_val, max_val = self._compute_stats(rollouts)
        return AggregatedScore(
            clue_word=rollouts[0].clue.word,
            score=mean,
            mean=mean,
            std=std,
            min=min_val,
            max=max_val,
            n_rollouts=len(rollouts),
            raw_rewards=rewards,
        )


class MeanMinusStdAggregator(Aggregator):
    """
    Mean minus standard deviation - risk-averse.

    This penalizes high-variance clues, preferring consistent performance.
    A clue that sometimes gets 3 correct but sometimes hits the assassin
    will score lower than a clue that reliably gets 2 correct.
    """

    def __init__(self, std_multiplier: float = 1.0):
        """
        Args:
            std_multiplier: How much to weight the standard deviation penalty
        """
        self.std_multiplier = std_multiplier

    def aggregate(self, rollouts: list[RolloutResult]) -> AggregatedScore:
        rewards, mean, std, min_val, max_val = self._compute_stats(rollouts)
        score = mean - (self.std_multiplier * std)
        return AggregatedScore(
            clue_word=rollouts[0].clue.word,
            score=score,
            mean=mean,
            std=std,
            min=min_val,
            max=max_val,
            n_rollouts=len(rollouts),
            raw_rewards=rewards,
        )


class PercentileAggregator(Aggregator):
    """
    Percentile aggregation - pessimistic bound.

    Uses a low percentile (e.g., 25th) as the score, focusing on
    avoiding bad outcomes rather than chasing good ones.
    """

    def __init__(self, percentile: float = 25):
        """
        Args:
            percentile: Which percentile to use (0-100)
        """
        self.percentile = percentile

    def aggregate(self, rollouts: list[RolloutResult]) -> AggregatedScore:
        rewards, mean, std, min_val, max_val = self._compute_stats(rollouts)
        score = float(np.percentile(rewards, self.percentile))
        return AggregatedScore(
            clue_word=rollouts[0].clue.word,
            score=score,
            mean=mean,
            std=std,
            min=min_val,
            max=max_val,
            n_rollouts=len(rollouts),
            raw_rewards=rewards,
        )


class CVaRAggregator(Aggregator):
    """
    Conditional Value at Risk (CVaR) aggregation.

    Also known as Expected Shortfall. Averages the worst α% of outcomes.
    This is useful for avoiding catastrophic failures (like assassin hits).
    """

    def __init__(self, alpha: float = 25):
        """
        Args:
            alpha: Percentage of worst outcomes to average (0-100)
        """
        self.alpha = alpha

    def aggregate(self, rollouts: list[RolloutResult]) -> AggregatedScore:
        rewards, mean, std, min_val, max_val = self._compute_stats(rollouts)

        # Sort rewards and take worst alpha%
        sorted_rewards = sorted(rewards)
        cutoff_idx = max(1, int(len(sorted_rewards) * self.alpha / 100))
        worst_rewards = sorted_rewards[:cutoff_idx]
        score = float(np.mean(worst_rewards))

        return AggregatedScore(
            clue_word=rollouts[0].clue.word,
            score=score,
            mean=mean,
            std=std,
            min=min_val,
            max=max_val,
            n_rollouts=len(rollouts),
            raw_rewards=rewards,
        )


class MinAggregator(Aggregator):
    """Minimum aggregation - most pessimistic."""

    def aggregate(self, rollouts: list[RolloutResult]) -> AggregatedScore:
        rewards, mean, std, min_val, max_val = self._compute_stats(rollouts)
        return AggregatedScore(
            clue_word=rollouts[0].clue.word,
            score=min_val,
            mean=mean,
            std=std,
            min=min_val,
            max=max_val,
            n_rollouts=len(rollouts),
            raw_rewards=rewards,
        )


class MaxAggregator(Aggregator):
    """Maximum aggregation - most optimistic."""

    def aggregate(self, rollouts: list[RolloutResult]) -> AggregatedScore:
        rewards, mean, std, min_val, max_val = self._compute_stats(rollouts)
        return AggregatedScore(
            clue_word=rollouts[0].clue.word,
            score=max_val,
            mean=mean,
            std=std,
            min=min_val,
            max=max_val,
            n_rollouts=len(rollouts),
            raw_rewards=rewards,
        )


def get_aggregator(method: AggregationMethod) -> Aggregator:
    """
    Factory function to get an aggregator by method name.

    Args:
        method: The aggregation method to use

    Returns:
        An Aggregator instance
    """
    aggregators = {
        AggregationMethod.MEAN: MeanAggregator(),
        AggregationMethod.MEAN_MINUS_STD: MeanMinusStdAggregator(),
        AggregationMethod.PERCENTILE_25: PercentileAggregator(25),
        AggregationMethod.CVAR_25: CVaRAggregator(25),
        AggregationMethod.MIN: MinAggregator(),
        AggregationMethod.MAX: MaxAggregator(),
    }
    return aggregators[method]
