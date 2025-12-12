"""Board representation for Codenames."""

from dataclasses import dataclass
from typing import Optional

from .state import Card, CardType, Team, GameState


@dataclass
class Board:
    """
    A 5x5 Codenames board.

    The board is represented as a flat list of 25 cards in row-major order.
    Position (row, col) maps to index: row * 5 + col
    """
    cards: list[Card]

    def __post_init__(self):
        if len(self.cards) != 25:
            raise ValueError(f"Board must have exactly 25 cards, got {len(self.cards)}")

    @classmethod
    def from_game_state(cls, state: GameState) -> "Board":
        """Create a board from a game state."""
        cards = [
            Card(word=w, card_type=t, revealed=r)
            for w, t, r in zip(state.words, state.key, state.revealed)
        ]
        return cls(cards=cards)

    def get_card(self, row: int, col: int) -> Card:
        """Get the card at position (row, col)."""
        if not (0 <= row < 5 and 0 <= col < 5):
            raise ValueError(f"Invalid position: ({row}, {col})")
        return self.cards[row * 5 + col]

    def get_card_by_word(self, word: str) -> Optional[Card]:
        """Get a card by its word (case-insensitive)."""
        word_upper = word.upper()
        for card in self.cards:
            if card.word.upper() == word_upper:
                return card
        return None

    def get_index_by_word(self, word: str) -> Optional[int]:
        """Get the index of a card by its word (case-insensitive)."""
        word_upper = word.upper()
        for i, card in enumerate(self.cards):
            if card.word.upper() == word_upper:
                return i
        return None

    @property
    def all_words(self) -> list[str]:
        """Get all words on the board."""
        return [card.word for card in self.cards]

    @property
    def unrevealed_words(self) -> list[str]:
        """Get words that haven't been revealed."""
        return [card.word for card in self.cards if not card.revealed]

    @property
    def revealed_words(self) -> list[str]:
        """Get words that have been revealed."""
        return [card.word for card in self.cards if card.revealed]

    def get_words_by_type(self, card_type: CardType) -> list[str]:
        """Get all words of a specific type."""
        return [card.word for card in self.cards if card.card_type == card_type]

    def get_unrevealed_by_type(self, card_type: CardType) -> list[str]:
        """Get unrevealed words of a specific type."""
        return [
            card.word for card in self.cards
            if card.card_type == card_type and not card.revealed
        ]

    def get_team_words(self, team: Team) -> list[str]:
        """Get all words belonging to a team."""
        card_type = CardType.for_team(team)
        return self.get_words_by_type(card_type)

    def get_remaining_team_words(self, team: Team) -> list[str]:
        """Get unrevealed words belonging to a team."""
        card_type = CardType.for_team(team)
        return self.get_unrevealed_by_type(card_type)

    @property
    def assassin_word(self) -> str:
        """Get the assassin word."""
        for card in self.cards:
            if card.card_type == CardType.ASSASSIN:
                return card.word
        raise ValueError("No assassin card found on board")

    def render_for_spymaster(self) -> str:
        """Render the board as a string showing all card types (spymaster view)."""
        lines = []
        type_symbols = {
            CardType.RED: "R",
            CardType.BLUE: "B",
            CardType.NEUTRAL: ".",
            CardType.ASSASSIN: "X",
        }
        for row in range(5):
            row_words = []
            row_types = []
            for col in range(5):
                card = self.get_card(row, col)
                symbol = type_symbols[card.card_type]
                if card.revealed:
                    symbol = symbol.lower()
                row_words.append(f"{card.word:12}")
                row_types.append(f"{symbol:^12}")
            lines.append(" ".join(row_words))
            lines.append(" ".join(row_types))
            lines.append("")
        return "\n".join(lines)

    def render_for_guesser(self) -> str:
        """Render the board as a string (guesser view - only revealed types shown)."""
        lines = []
        for row in range(5):
            row_words = []
            for col in range(5):
                card = self.get_card(row, col)
                if card.revealed:
                    symbol = {
                        CardType.RED: "[RED]",
                        CardType.BLUE: "[BLU]",
                        CardType.NEUTRAL: "[---]",
                        CardType.ASSASSIN: "[XXX]",
                    }[card.card_type]
                    row_words.append(f"{symbol:^12}")
                else:
                    row_words.append(f"{card.word:12}")
            lines.append(" ".join(row_words))
        return "\n".join(lines)
