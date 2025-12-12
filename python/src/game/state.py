"""Game state types and data structures for Codenames."""

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional


class Team(Enum):
    """The two teams in Codenames."""
    RED = "red"
    BLUE = "blue"

    @property
    def opponent(self) -> "Team":
        """Get the opposing team."""
        return Team.BLUE if self == Team.RED else Team.RED


class CardType(Enum):
    """Types of cards on the Codenames board."""
    RED = "red"
    BLUE = "blue"
    NEUTRAL = "neutral"
    ASSASSIN = "assassin"

    @classmethod
    def for_team(cls, team: Team) -> "CardType":
        """Get the card type for a team."""
        return cls.RED if team == Team.RED else cls.BLUE


@dataclass
class Card:
    """A single card on the board."""
    word: str
    card_type: CardType
    revealed: bool = False

    def reveal(self) -> "Card":
        """Return a new card with revealed=True."""
        return Card(word=self.word, card_type=self.card_type, revealed=True)


@dataclass
class Clue:
    """A clue given by a spymaster."""
    word: str
    number: int
    team: Team
    intended_targets: list[str] = field(default_factory=list)


@dataclass
class GuessResult:
    """Result of a single guess."""
    word: str
    card_type: CardType
    correct: bool  # Was it the current team's word?
    turn_ended: bool  # Did this guess end the turn?
    game_over: bool  # Did this guess end the game?
    winner: Optional[Team] = None  # If game_over, who won


@dataclass
class GameState:
    """Complete state of a Codenames game."""
    # Board configuration
    words: list[str]  # 25 words in order (5x5 grid, row-major)
    key: list[CardType]  # Card types for each position

    # Game progress
    revealed: list[bool]  # Which cards have been revealed
    current_team: Team
    current_clue: Optional[Clue] = None
    guesses_remaining: int = 0

    # Scores (remaining words for each team)
    red_remaining: int = 9
    blue_remaining: int = 8

    # Game status
    game_over: bool = False
    winner: Optional[Team] = None

    # History
    clue_history: list[Clue] = field(default_factory=list)
    guess_history: list[tuple[str, CardType]] = field(default_factory=list)

    @property
    def starting_team(self) -> Team:
        """The team that goes first (has 9 words)."""
        return Team.RED if self.red_remaining >= self.blue_remaining else Team.BLUE

    def get_card(self, index: int) -> Card:
        """Get the card at a given index."""
        return Card(
            word=self.words[index],
            card_type=self.key[index],
            revealed=self.revealed[index]
        )

    def get_card_by_word(self, word: str) -> Optional[Card]:
        """Get a card by its word."""
        word_upper = word.upper()
        for i, w in enumerate(self.words):
            if w.upper() == word_upper:
                return self.get_card(i)
        return None

    def get_unrevealed_words(self) -> list[str]:
        """Get list of words that haven't been revealed yet."""
        return [w for w, r in zip(self.words, self.revealed) if not r]

    def get_team_words(self, team: Team, revealed_only: bool = False) -> list[str]:
        """Get words belonging to a team."""
        card_type = CardType.for_team(team)
        return [
            w for w, t, r in zip(self.words, self.key, self.revealed)
            if t == card_type and (not revealed_only or r)
        ]

    def get_remaining_words(self, team: Team) -> list[str]:
        """Get unrevealed words belonging to a team."""
        card_type = CardType.for_team(team)
        return [
            w for w, t, r in zip(self.words, self.key, self.revealed)
            if t == card_type and not r
        ]

    def copy(self) -> "GameState":
        """Create a deep copy of the game state."""
        return GameState(
            words=self.words.copy(),
            key=self.key.copy(),
            revealed=self.revealed.copy(),
            current_team=self.current_team,
            current_clue=self.current_clue,
            guesses_remaining=self.guesses_remaining,
            red_remaining=self.red_remaining,
            blue_remaining=self.blue_remaining,
            game_over=self.game_over,
            winner=self.winner,
            clue_history=self.clue_history.copy(),
            guess_history=self.guess_history.copy(),
        )
