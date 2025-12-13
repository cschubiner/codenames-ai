"""Game rules and turn resolution for Codenames."""

from dataclasses import dataclass
from typing import Optional

from .state import GameState, Team, CardType, Clue, GuessResult


@dataclass
class TurnResult:
    """Result of processing a complete turn."""
    guesses: list[GuessResult]
    turn_ended_by: str  # "assassin", "opponent", "neutral", "limit", "pass", "win"
    team_words_found: int
    game_over: bool
    winner: Optional[Team] = None


class GameRules:
    """
    Codenames game rules engine.

    Standard rules:
    - 25 words in a 5x5 grid
    - Starting team has 9 words, other team has 8
    - 7 neutral words, 1 assassin
    - Spymaster gives clue (word + number)
    - Guessers can guess up to number + 1 times
    - Turn ends on: wrong guess, pass, or using all guesses
    - Game ends when: one team finds all words, or assassin is revealed
    """

    @staticmethod
    def give_clue(state: GameState, clue: Clue) -> GameState:
        """
        Process a spymaster giving a clue.

        Args:
            state: Current game state
            clue: The clue being given

        Returns:
            New game state with the clue set
        """
        if state.game_over:
            raise ValueError("Cannot give clue - game is over")
        if state.current_clue is not None:
            raise ValueError("A clue has already been given this turn")
        if clue.team != state.current_team:
            raise ValueError(f"It's {state.current_team.value}'s turn, not {clue.team.value}'s")

        # Validate clue word isn't on the board
        clue_word_upper = clue.word.upper()
        for word in state.words:
            if word.upper() == clue_word_upper:
                raise ValueError(f"Clue word '{clue.word}' is on the board")

        new_state = state.copy()
        new_state.current_clue = clue
        new_state.guesses_remaining = clue.number + 1  # Can guess number + 1 times
        new_state.clue_history.append(clue)
        return new_state

    @staticmethod
    def make_guess(state: GameState, word: str) -> tuple[GameState, GuessResult]:
        """
        Process a single guess.

        Args:
            state: Current game state
            word: The word being guessed

        Returns:
            Tuple of (new game state, result of the guess)
        """
        if state.game_over:
            raise ValueError("Cannot guess - game is over")
        if state.current_clue is None:
            raise ValueError("No clue has been given yet")
        if state.guesses_remaining <= 0:
            raise ValueError("No guesses remaining this turn")

        # Find the word on the board
        word_upper = word.upper()
        word_index = None
        for i, w in enumerate(state.words):
            if w.upper() == word_upper:
                word_index = i
                break

        if word_index is None:
            raise ValueError(f"Word '{word}' not found on board")

        if state.revealed[word_index]:
            raise ValueError(f"Word '{word}' has already been revealed")

        # Reveal the card
        new_state = state.copy()
        new_state.revealed[word_index] = True
        card_type = state.key[word_index]

        # Update remaining counts
        if card_type == CardType.RED:
            new_state.red_remaining -= 1
        elif card_type == CardType.BLUE:
            new_state.blue_remaining -= 1

        # Record guess
        new_state.guess_history.append((word, card_type))

        # Determine result
        current_team_type = CardType.for_team(state.current_team)
        correct = card_type == current_team_type

        # Check for game end conditions
        game_over = False
        winner = None
        turn_ended = False

        if card_type == CardType.ASSASSIN:
            # Assassin - guessing team loses
            game_over = True
            winner = state.current_team.opponent
            turn_ended = True
        elif new_state.red_remaining == 0:
            # Red found all their words
            game_over = True
            winner = Team.RED
            turn_ended = True
        elif new_state.blue_remaining == 0:
            # Blue found all their words
            game_over = True
            winner = Team.BLUE
            turn_ended = True
        elif not correct:
            # Wrong guess - turn ends
            turn_ended = True
        else:
            # Correct guess - use one guess
            new_state.guesses_remaining -= 1
            if new_state.guesses_remaining <= 0:
                turn_ended = True

        if game_over:
            new_state.game_over = True
            new_state.winner = winner

        if turn_ended and not game_over:
            new_state = GameRules.end_turn(new_state)

        return new_state, GuessResult(
            word=word,
            card_type=card_type,
            correct=correct,
            turn_ended=turn_ended,
            game_over=game_over,
            winner=winner,
        )

    @staticmethod
    def end_turn(state: GameState) -> GameState:
        """
        End the current turn and switch to the other team.

        Args:
            state: Current game state

        Returns:
            New game state with turn switched
        """
        if state.game_over:
            return state

        new_state = state.copy()
        new_state.current_team = state.current_team.opponent
        new_state.current_clue = None
        new_state.guesses_remaining = 0
        return new_state

    @staticmethod
    def pass_turn(state: GameState) -> GameState:
        """
        Pass (end turn without guessing).

        Args:
            state: Current game state

        Returns:
            New game state with turn switched
        """
        if state.game_over:
            raise ValueError("Cannot pass - game is over")
        return GameRules.end_turn(state)

    @staticmethod
    def simulate_guesses(
        state: GameState,
        guesses: list[str],
        stop_on_wrong: bool = True
    ) -> tuple[GameState, TurnResult]:
        """
        Simulate a sequence of guesses.

        Args:
            state: Starting game state
            guesses: List of words to guess in order
            stop_on_wrong: If True, stop on first wrong guess (normal rules)

        Returns:
            Tuple of (final game state, turn result)
        """
        results: list[GuessResult] = []
        team_words_found = 0
        turn_ended_by = "limit"
        current_state = state

        for guess in guesses:
            if current_state.game_over or current_state.guesses_remaining <= 0:
                break

            try:
                current_state, result = GameRules.make_guess(current_state, guess)
                results.append(result)

                if result.correct:
                    team_words_found += 1

                if result.game_over:
                    if result.card_type == CardType.ASSASSIN:
                        turn_ended_by = "assassin"
                    else:
                        turn_ended_by = "win"
                    break

                if result.turn_ended:
                    if result.card_type == CardType.NEUTRAL:
                        turn_ended_by = "neutral"
                    else:
                        turn_ended_by = "opponent"
                    break

            except ValueError:
                # Invalid guess - skip
                continue

        # If the turn wasn't already ended (by neutral/opponent/assassin/win),
        # we need to end it now (either used all guesses or ran out of words to guess)
        if not current_state.game_over and current_state.current_clue is not None:
            current_state = GameRules.end_turn(current_state)

        return current_state, TurnResult(
            guesses=results,
            turn_ended_by=turn_ended_by,
            team_words_found=team_words_found,
            game_over=current_state.game_over,
            winner=current_state.winner,
        )
