"""Board and game state generator for Codenames."""

import json
import random
from pathlib import Path
from typing import Optional

from .state import GameState, Team, CardType
from ..paths import WORDLIST_PATH


class BoardGenerator:
    """
    Generates random Codenames boards.

    Uses the official Codenames word list to create randomized boards
    with proper key card distribution.
    """

    # Standard card distribution
    STARTING_TEAM_WORDS = 9
    OTHER_TEAM_WORDS = 8
    NEUTRAL_WORDS = 7
    ASSASSIN_WORDS = 1
    TOTAL_CARDS = 25

    def __init__(self, word_list: Optional[list[str]] = None):
        """
        Initialize the generator.

        Args:
            word_list: List of words to use. If None, loads the default word list.
        """
        if word_list is None:
            word_list = self._load_default_wordlist()
        self.word_list = [w.upper() for w in word_list]

    @staticmethod
    def _load_default_wordlist() -> list[str]:
        """Load the default word list from shared/wordlist.json."""
        if not WORDLIST_PATH.exists():
            raise FileNotFoundError(
                f"Could not find wordlist.json at {WORDLIST_PATH}. "
                "Please ensure shared/wordlist.json exists."
            )

        with open(WORDLIST_PATH) as f:
            data = json.load(f)
            return data["words"]

    def generate_board(
        self,
        starting_team: Team = Team.RED,
        seed: Optional[int] = None
    ) -> GameState:
        """
        Generate a random Codenames board.

        Args:
            starting_team: Which team goes first (and has 9 words)
            seed: Random seed for reproducibility

        Returns:
            A new GameState with randomized board and key
        """
        if seed is not None:
            random.seed(seed)

        # Select 25 random words
        words = random.sample(self.word_list, self.TOTAL_CARDS)

        # Generate key card
        key = self._generate_key(starting_team)

        # Shuffle the key to randomize positions
        combined = list(zip(words, key))
        random.shuffle(combined)
        words, key = zip(*combined)
        words = list(words)
        key = list(key)

        # Initial game state
        return GameState(
            words=words,
            key=key,
            revealed=[False] * self.TOTAL_CARDS,
            current_team=starting_team,
            red_remaining=self.STARTING_TEAM_WORDS if starting_team == Team.RED else self.OTHER_TEAM_WORDS,
            blue_remaining=self.STARTING_TEAM_WORDS if starting_team == Team.BLUE else self.OTHER_TEAM_WORDS,
        )

    def _generate_key(self, starting_team: Team) -> list[CardType]:
        """
        Generate the key card (list of card types).

        Args:
            starting_team: Which team goes first (gets 9 words)

        Returns:
            List of CardTypes in order (to be shuffled with words)
        """
        key: list[CardType] = []

        # Starting team gets 9 words
        starting_type = CardType.for_team(starting_team)
        key.extend([starting_type] * self.STARTING_TEAM_WORDS)

        # Other team gets 8 words
        other_type = CardType.for_team(starting_team.opponent)
        key.extend([other_type] * self.OTHER_TEAM_WORDS)

        # Neutral words
        key.extend([CardType.NEUTRAL] * self.NEUTRAL_WORDS)

        # Assassin
        key.extend([CardType.ASSASSIN] * self.ASSASSIN_WORDS)

        return key

    def generate_board_set(
        self,
        count: int,
        starting_team: Optional[Team] = None,
        base_seed: Optional[int] = None
    ) -> list[GameState]:
        """
        Generate a set of boards for benchmarking.

        Args:
            count: Number of boards to generate
            starting_team: If specified, all boards start with this team.
                          If None, alternates between RED and BLUE.
            base_seed: If specified, uses deterministic seeds for reproducibility

        Returns:
            List of GameState objects
        """
        boards = []
        for i in range(count):
            seed = base_seed + i if base_seed is not None else None

            if starting_team is not None:
                team = starting_team
            else:
                # Alternate starting teams
                team = Team.RED if i % 2 == 0 else Team.BLUE

            board = self.generate_board(starting_team=team, seed=seed)
            boards.append(board)

        return boards

    @staticmethod
    def save_boards(boards: list[GameState], filepath: Path) -> None:
        """
        Save a list of boards to a JSON file.

        Args:
            boards: List of GameState objects to save
            filepath: Path to save the JSON file
        """
        data = {
            "count": len(boards),
            "boards": [
                {
                    "words": board.words,
                    "key": [ct.value for ct in board.key],
                    "starting_team": board.current_team.value,
                    "red_remaining": board.red_remaining,
                    "blue_remaining": board.blue_remaining,
                }
                for board in boards
            ]
        }

        filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

    @staticmethod
    def load_boards(filepath: Path) -> list[GameState]:
        """
        Load boards from a JSON file.

        Args:
            filepath: Path to the JSON file

        Returns:
            List of GameState objects
        """
        with open(filepath) as f:
            data = json.load(f)

        boards = []
        for board_data in data["boards"]:
            state = GameState(
                words=board_data["words"],
                key=[CardType(ct) for ct in board_data["key"]],
                revealed=[False] * 25,
                current_team=Team(board_data["starting_team"]),
                red_remaining=board_data["red_remaining"],
                blue_remaining=board_data["blue_remaining"],
            )
            boards.append(state)

        return boards
