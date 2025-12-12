"""Dynamic JSON Schema builder for guesser structured outputs."""

from typing import Any


def build_guesser_schema(unrevealed_words: list[str]) -> dict[str, Any]:
    """
    Build a JSON Schema for guesser output with dynamic enum of unrevealed words.

    This schema is used with OpenAI's Structured Outputs feature to ensure
    the guesser can only output valid, unrevealed board words.

    Args:
        unrevealed_words: List of words currently unrevealed on the board

    Returns:
        JSON Schema dict suitable for OpenAI's response_format
    """
    return {
        "name": "guesser_output",
        "strict": True,
        "schema": {
            "type": "object",
            "required": ["guesses", "reasoning"],
            "additionalProperties": False,
            "properties": {
                "guesses": {
                    "type": "array",
                    "description": "Ordered list of guesses from most to least confident",
                    "items": {
                        "type": "object",
                        "required": ["word", "confidence"],
                        "additionalProperties": False,
                        "properties": {
                            "word": {
                                "type": "string",
                                "enum": unrevealed_words,
                                "description": "The word being guessed"
                            },
                            "confidence": {
                                "type": "number",
                                "description": "Confidence score between 0 and 1"
                            }
                        }
                    }
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation of the guessing strategy"
                },
                "stop_after": {
                    "type": "integer",
                    "description": "Recommended number of guesses before stopping (0 means use all)"
                }
            }
        }
    }


def build_simple_guesser_schema() -> dict[str, Any]:
    """
    Build a simpler schema without enum constraint.

    Use this when you want to allow any word (e.g., for testing or
    when the enum constraint causes issues).

    Returns:
        JSON Schema dict suitable for OpenAI's response_format
    """
    return {
        "name": "guesser_output",
        "strict": True,
        "schema": {
            "type": "object",
            "required": ["guesses", "reasoning"],
            "additionalProperties": False,
            "properties": {
                "guesses": {
                    "type": "array",
                    "description": "Ordered list of guesses from most to least confident",
                    "items": {
                        "type": "object",
                        "required": ["word", "confidence"],
                        "additionalProperties": False,
                        "properties": {
                            "word": {
                                "type": "string",
                                "description": "The word being guessed (must be on the board)"
                            },
                            "confidence": {
                                "type": "number",
                                "description": "Confidence score between 0 and 1"
                            }
                        }
                    }
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation of the guessing strategy"
                },
                "stop_after": {
                    "type": "integer",
                    "description": "Recommended number of guesses before stopping (0 means use all)"
                }
            }
        }
    }
