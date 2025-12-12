"""Metrics collection and analysis for benchmarking."""

from dataclasses import dataclass, field
from typing import Optional
import json
from pathlib import Path
import time

import numpy as np

from ..game import Team


@dataclass
class TurnMetrics:
    """Metrics for a single turn."""
    team: Team
    clue_word: str
    clue_number: int
    intended_targets: list[str]
    guesses_made: list[str]
    correct_guesses: int
    hit_assassin: bool
    hit_opponent: bool
    turn_ended_by: str
    api_calls: int = 0
    tokens_used: int = 0
    latency_ms: float = 0.0


@dataclass
class GameMetrics:
    """Metrics for a complete game."""
    board_id: str
    config_name: str
    winner: Optional[Team]
    total_turns: int
    red_turns: int
    blue_turns: int
    assassin_loss: bool
    red_final_remaining: int
    blue_final_remaining: int
    turns: list[TurnMetrics] = field(default_factory=list)
    total_api_calls: int = 0
    total_tokens: int = 0
    total_latency_ms: float = 0.0
    game_duration_s: float = 0.0

    @property
    def red_won(self) -> bool:
        return self.winner == Team.RED

    @property
    def blue_won(self) -> bool:
        return self.winner == Team.BLUE

    @property
    def correct_per_clue(self) -> float:
        """Average correct guesses per clue."""
        if not self.turns:
            return 0.0
        return sum(t.correct_guesses for t in self.turns) / len(self.turns)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "board_id": self.board_id,
            "config_name": self.config_name,
            "winner": self.winner.value if self.winner else None,
            "total_turns": self.total_turns,
            "red_turns": self.red_turns,
            "blue_turns": self.blue_turns,
            "assassin_loss": self.assassin_loss,
            "red_final_remaining": self.red_final_remaining,
            "blue_final_remaining": self.blue_final_remaining,
            "correct_per_clue": self.correct_per_clue,
            "total_api_calls": self.total_api_calls,
            "total_tokens": self.total_tokens,
            "total_latency_ms": self.total_latency_ms,
            "game_duration_s": self.game_duration_s,
            "turns": [
                {
                    "team": t.team.value,
                    "clue": f"{t.clue_word} {t.clue_number}",
                    "intended_targets": t.intended_targets,
                    "guesses_made": t.guesses_made,
                    "correct_guesses": t.correct_guesses,
                    "hit_assassin": t.hit_assassin,
                    "hit_opponent": t.hit_opponent,
                    "turn_ended_by": t.turn_ended_by,
                }
                for t in self.turns
            ],
        }


@dataclass
class BenchmarkMetrics:
    """Aggregated metrics for a benchmark run."""
    config_name: str
    total_games: int
    games: list[GameMetrics] = field(default_factory=list)

    @property
    def wins(self) -> int:
        """Total wins (assuming we're tracking RED team as the test subject)."""
        return sum(1 for g in self.games if g.red_won)

    @property
    def losses(self) -> int:
        return sum(1 for g in self.games if g.blue_won)

    @property
    def win_rate(self) -> float:
        if not self.games:
            return 0.0
        return self.wins / len(self.games)

    @property
    def assassin_loss_rate(self) -> float:
        """Rate of games lost by hitting the assassin."""
        if not self.games:
            return 0.0
        assassin_losses = sum(1 for g in self.games if g.assassin_loss)
        return assassin_losses / len(self.games)

    @property
    def opponent_flip_rate(self) -> float:
        """Average rate of revealing opponent words per turn."""
        total_turns = sum(len(g.turns) for g in self.games)
        if total_turns == 0:
            return 0.0
        opponent_hits = sum(
            1 for g in self.games for t in g.turns if t.hit_opponent
        )
        return opponent_hits / total_turns

    @property
    def avg_correct_per_clue(self) -> float:
        """Average correct guesses per clue across all games."""
        all_turns = [t for g in self.games for t in g.turns]
        if not all_turns:
            return 0.0
        return sum(t.correct_guesses for t in all_turns) / len(all_turns)

    @property
    def avg_game_length(self) -> float:
        """Average number of turns per game."""
        if not self.games:
            return 0.0
        return sum(g.total_turns for g in self.games) / len(self.games)

    @property
    def total_api_calls(self) -> int:
        return sum(g.total_api_calls for g in self.games)

    @property
    def total_tokens(self) -> int:
        return sum(g.total_tokens for g in self.games)

    def win_rate_ci(self, confidence: float = 0.95) -> tuple[float, float]:
        """
        Calculate confidence interval for win rate using Wilson score.

        Args:
            confidence: Confidence level (default 95%)

        Returns:
            Tuple of (lower bound, upper bound)
        """
        from scipy import stats

        n = len(self.games)
        if n == 0:
            return (0.0, 0.0)

        p = self.win_rate
        z = stats.norm.ppf(1 - (1 - confidence) / 2)

        # Wilson score interval
        denominator = 1 + z**2 / n
        center = (p + z**2 / (2 * n)) / denominator
        spread = z * np.sqrt((p * (1 - p) + z**2 / (4 * n)) / n) / denominator

        return (max(0, center - spread), min(1, center + spread))

    def summary(self) -> str:
        """Human-readable summary of benchmark results."""
        ci_low, ci_high = self.win_rate_ci()
        lines = [
            f"Benchmark Results: {self.config_name}",
            f"=" * 50,
            f"Games played: {len(self.games)}",
            f"Win rate: {self.win_rate:.1%} (95% CI: {ci_low:.1%} - {ci_high:.1%})",
            f"Assassin loss rate: {self.assassin_loss_rate:.1%}",
            f"Opponent flip rate: {self.opponent_flip_rate:.1%}",
            f"Avg correct per clue: {self.avg_correct_per_clue:.2f}",
            f"Avg game length: {self.avg_game_length:.1f} turns",
            f"Total API calls: {self.total_api_calls}",
            f"Total tokens: {self.total_tokens}",
        ]
        return "\n".join(lines)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        ci_low, ci_high = self.win_rate_ci()
        return {
            "config_name": self.config_name,
            "total_games": len(self.games),
            "wins": self.wins,
            "losses": self.losses,
            "win_rate": self.win_rate,
            "win_rate_ci_low": ci_low,
            "win_rate_ci_high": ci_high,
            "assassin_loss_rate": self.assassin_loss_rate,
            "opponent_flip_rate": self.opponent_flip_rate,
            "avg_correct_per_clue": self.avg_correct_per_clue,
            "avg_game_length": self.avg_game_length,
            "total_api_calls": self.total_api_calls,
            "total_tokens": self.total_tokens,
            "games": [g.to_dict() for g in self.games],
        }

    def save(self, filepath: Path) -> None:
        """Save benchmark results to JSON file."""
        filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, filepath: Path) -> "BenchmarkMetrics":
        """Load benchmark results from JSON file."""
        with open(filepath) as f:
            data = json.load(f)

        metrics = cls(
            config_name=data["config_name"],
            total_games=data["total_games"],
        )
        # Note: Full game data reconstruction would require more work
        # For now, just store the summary data
        return metrics
