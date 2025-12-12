"""Reward calculation for Codenames clue evaluation."""

from dataclasses import dataclass
from typing import Optional

from ..game import GameState, Team, CardType, TurnResult


@dataclass
class RewardConfig:
    """Configuration for reward calculation."""
    correct_word: float = 1.0      # Reward for guessing own team's word
    opponent_word: float = -1.0    # Penalty for guessing opponent's word
    neutral_word: float = 0.0      # Penalty for guessing neutral
    assassin: float = -10.0        # Penalty for guessing assassin
    win_bonus: float = 5.0         # Bonus for winning the game this turn
    loss_penalty: float = -10.0    # Additional penalty for losing


@dataclass
class RewardBreakdown:
    """Detailed breakdown of reward calculation."""
    correct_words: int
    opponent_words: int
    neutral_words: int
    hit_assassin: bool
    won_game: bool
    lost_game: bool
    total_reward: float

    @property
    def summary(self) -> str:
        """Human-readable summary of the reward."""
        parts = []
        if self.correct_words > 0:
            parts.append(f"+{self.correct_words} correct")
        if self.opponent_words > 0:
            parts.append(f"-{self.opponent_words} opponent")
        if self.neutral_words > 0:
            parts.append(f"{self.neutral_words} neutral")
        if self.hit_assassin:
            parts.append("HIT ASSASSIN")
        if self.won_game:
            parts.append("WON")
        if self.lost_game:
            parts.append("LOST")
        return f"[{', '.join(parts)}] = {self.total_reward:.2f}"


class RewardCalculator:
    """
    Calculates rewards for turn outcomes.

    The reward function is designed to:
    - Encourage finding team words (+1 each)
    - Strongly discourage the assassin (-10)
    - Mildly discourage opponent words (-1, gives them points)
    - Be neutral on neutral words (0, just ends turn)
    """

    def __init__(self, config: Optional[RewardConfig] = None):
        """Initialize with reward configuration."""
        self.config = config or RewardConfig()

    def calculate_turn_reward(
        self,
        turn_result: TurnResult,
        team: Team,
    ) -> RewardBreakdown:
        """
        Calculate reward for a complete turn.

        Args:
            turn_result: Result of the turn's guesses
            team: The team whose perspective we're evaluating from

        Returns:
            RewardBreakdown with detailed scoring
        """
        correct_words = 0
        opponent_words = 0
        neutral_words = 0
        hit_assassin = False

        team_card_type = CardType.for_team(team)
        opponent_card_type = CardType.for_team(team.opponent)

        for guess_result in turn_result.guesses:
            if guess_result.card_type == team_card_type:
                correct_words += 1
            elif guess_result.card_type == opponent_card_type:
                opponent_words += 1
            elif guess_result.card_type == CardType.NEUTRAL:
                neutral_words += 1
            elif guess_result.card_type == CardType.ASSASSIN:
                hit_assassin = True

        # Calculate total reward
        total = 0.0
        total += correct_words * self.config.correct_word
        total += opponent_words * self.config.opponent_word
        total += neutral_words * self.config.neutral_word

        if hit_assassin:
            total += self.config.assassin

        # Win/loss bonuses
        won_game = turn_result.game_over and turn_result.winner == team
        lost_game = turn_result.game_over and turn_result.winner == team.opponent

        if won_game:
            total += self.config.win_bonus
        if lost_game:
            total += self.config.loss_penalty

        return RewardBreakdown(
            correct_words=correct_words,
            opponent_words=opponent_words,
            neutral_words=neutral_words,
            hit_assassin=hit_assassin,
            won_game=won_game,
            lost_game=lost_game,
            total_reward=total,
        )

    def calculate_guess_reward(
        self,
        card_type: CardType,
        team: Team,
    ) -> float:
        """
        Calculate reward for a single guess.

        Args:
            card_type: The type of card that was revealed
            team: The team whose perspective we're evaluating from

        Returns:
            Reward value for this single guess
        """
        team_card_type = CardType.for_team(team)

        if card_type == team_card_type:
            return self.config.correct_word
        elif card_type == CardType.for_team(team.opponent):
            return self.config.opponent_word
        elif card_type == CardType.NEUTRAL:
            return self.config.neutral_word
        elif card_type == CardType.ASSASSIN:
            return self.config.assassin
        else:
            return 0.0
