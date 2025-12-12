"""Tests for the game logic module."""

import pytest
from src.game import (
    GameState, Team, CardType, Card, Clue, Board,
    GameRules, BoardGenerator
)


class TestTeam:
    def test_opponent(self):
        assert Team.RED.opponent == Team.BLUE
        assert Team.BLUE.opponent == Team.RED


class TestCardType:
    def test_for_team(self):
        assert CardType.for_team(Team.RED) == CardType.RED
        assert CardType.for_team(Team.BLUE) == CardType.BLUE


class TestBoardGenerator:
    def test_generate_board_has_25_words(self):
        gen = BoardGenerator()
        state = gen.generate_board()
        assert len(state.words) == 25
        assert len(state.key) == 25
        assert len(state.revealed) == 25

    def test_generate_board_correct_distribution(self):
        gen = BoardGenerator()
        state = gen.generate_board(starting_team=Team.RED)

        # Count card types
        red_count = sum(1 for ct in state.key if ct == CardType.RED)
        blue_count = sum(1 for ct in state.key if ct == CardType.BLUE)
        neutral_count = sum(1 for ct in state.key if ct == CardType.NEUTRAL)
        assassin_count = sum(1 for ct in state.key if ct == CardType.ASSASSIN)

        # Starting team (RED) has 9, other team has 8
        assert red_count == 9
        assert blue_count == 8
        assert neutral_count == 7
        assert assassin_count == 1

    def test_generate_board_blue_starts(self):
        gen = BoardGenerator()
        state = gen.generate_board(starting_team=Team.BLUE)

        red_count = sum(1 for ct in state.key if ct == CardType.RED)
        blue_count = sum(1 for ct in state.key if ct == CardType.BLUE)

        # Starting team (BLUE) has 9, other team has 8
        assert blue_count == 9
        assert red_count == 8

    def test_generate_board_reproducible(self):
        gen = BoardGenerator()
        state1 = gen.generate_board(seed=42)
        state2 = gen.generate_board(seed=42)
        assert state1.words == state2.words
        assert state1.key == state2.key

    def test_generate_board_different_seeds(self):
        gen = BoardGenerator()
        state1 = gen.generate_board(seed=42)
        state2 = gen.generate_board(seed=43)
        # Very unlikely to be the same
        assert state1.words != state2.words

    def test_all_words_unique(self):
        gen = BoardGenerator()
        state = gen.generate_board()
        assert len(set(state.words)) == 25


class TestGameState:
    @pytest.fixture
    def game_state(self):
        gen = BoardGenerator()
        return gen.generate_board(starting_team=Team.RED, seed=42)

    def test_get_unrevealed_words(self, game_state):
        assert len(game_state.get_unrevealed_words()) == 25
        game_state.revealed[0] = True
        assert len(game_state.get_unrevealed_words()) == 24

    def test_get_card_by_word(self, game_state):
        word = game_state.words[0]
        card = game_state.get_card_by_word(word)
        assert card is not None
        assert card.word == word
        assert card.card_type == game_state.key[0]

    def test_get_card_by_word_case_insensitive(self, game_state):
        word = game_state.words[0]
        card_lower = game_state.get_card_by_word(word.lower())
        card_upper = game_state.get_card_by_word(word.upper())
        assert card_lower is not None
        assert card_upper is not None
        assert card_lower.word == card_upper.word

    def test_copy_is_independent(self, game_state):
        copy = game_state.copy()
        copy.revealed[0] = True
        assert game_state.revealed[0] is False


class TestBoard:
    @pytest.fixture
    def board(self):
        gen = BoardGenerator()
        state = gen.generate_board(starting_team=Team.RED, seed=42)
        return Board.from_game_state(state)

    def test_get_card(self, board):
        card = board.get_card(0, 0)
        assert isinstance(card, Card)
        assert card.word == board.cards[0].word

    def test_get_card_invalid(self, board):
        with pytest.raises(ValueError):
            board.get_card(5, 0)
        with pytest.raises(ValueError):
            board.get_card(0, 5)

    def test_unrevealed_words(self, board):
        assert len(board.unrevealed_words) == 25

    def test_assassin_word(self, board):
        assassin = board.assassin_word
        card = board.get_card_by_word(assassin)
        assert card.card_type == CardType.ASSASSIN


class TestGameRules:
    @pytest.fixture
    def game_state(self):
        gen = BoardGenerator()
        return gen.generate_board(starting_team=Team.RED, seed=42)

    def test_give_clue(self, game_state):
        clue = Clue(word="FRUIT", number=2, team=Team.RED)
        new_state = GameRules.give_clue(game_state, clue)

        assert new_state.current_clue == clue
        assert new_state.guesses_remaining == 3  # number + 1
        assert len(new_state.clue_history) == 1

    def test_give_clue_wrong_team(self, game_state):
        clue = Clue(word="FRUIT", number=2, team=Team.BLUE)
        with pytest.raises(ValueError, match="RED's turn"):
            GameRules.give_clue(game_state, clue)

    def test_give_clue_word_on_board(self, game_state):
        # Try to give a clue that's actually on the board
        word_on_board = game_state.words[0]
        clue = Clue(word=word_on_board, number=2, team=Team.RED)
        with pytest.raises(ValueError, match="on the board"):
            GameRules.give_clue(game_state, clue)

    def test_make_guess_correct(self, game_state):
        # Give a clue first
        clue = Clue(word="TEST", number=2, team=Team.RED)
        state = GameRules.give_clue(game_state, clue)

        # Find a red word to guess
        red_word = None
        for word, ct in zip(state.words, state.key):
            if ct == CardType.RED:
                red_word = word
                break

        new_state, result = GameRules.make_guess(state, red_word)

        assert result.correct is True
        assert result.card_type == CardType.RED
        assert new_state.red_remaining == 8  # One less
        assert new_state.revealed[state.words.index(red_word)] is True

    def test_make_guess_wrong_ends_turn(self, game_state):
        clue = Clue(word="TEST", number=2, team=Team.RED)
        state = GameRules.give_clue(game_state, clue)

        # Find a neutral word
        neutral_word = None
        for word, ct in zip(state.words, state.key):
            if ct == CardType.NEUTRAL:
                neutral_word = word
                break

        new_state, result = GameRules.make_guess(state, neutral_word)

        assert result.correct is False
        assert result.turn_ended is True
        assert new_state.current_team == Team.BLUE

    def test_assassin_ends_game(self, game_state):
        clue = Clue(word="TEST", number=2, team=Team.RED)
        state = GameRules.give_clue(game_state, clue)

        # Find the assassin
        assassin_word = None
        for word, ct in zip(state.words, state.key):
            if ct == CardType.ASSASSIN:
                assassin_word = word
                break

        new_state, result = GameRules.make_guess(state, assassin_word)

        assert result.game_over is True
        assert result.winner == Team.BLUE  # RED guessed assassin, BLUE wins
        assert new_state.game_over is True

    def test_find_all_words_wins(self, game_state):
        # This is a more complex test - we need to find all red words
        clue = Clue(word="TEST", number=9, team=Team.RED)
        state = GameRules.give_clue(game_state, clue)

        # Find and guess all red words
        red_words = [w for w, ct in zip(state.words, state.key) if ct == CardType.RED]

        for word in red_words[:-1]:
            state, result = GameRules.make_guess(state, word)
            assert not result.game_over

        # Last word should win
        state, result = GameRules.make_guess(state, red_words[-1])
        assert result.game_over is True
        assert result.winner == Team.RED

    def test_pass_turn(self, game_state):
        new_state = GameRules.pass_turn(game_state)
        assert new_state.current_team == Team.BLUE

    def test_simulate_guesses(self, game_state):
        clue = Clue(word="TEST", number=3, team=Team.RED)
        state = GameRules.give_clue(game_state, clue)

        # Find some red words
        red_words = [w for w, ct in zip(state.words, state.key) if ct == CardType.RED][:3]

        new_state, turn_result = GameRules.simulate_guesses(state, red_words)

        assert turn_result.team_words_found == 3
        assert len(turn_result.guesses) == 3
