"""JSON Schema builder for spymaster structured outputs."""

from typing import Any


def build_spymaster_schema(team_words: list[str], num_candidates: int) -> dict[str, Any]:
    """
    Build a JSON Schema for spymaster output with dynamic enum of team words.

    Args:
        team_words: List of unrevealed words belonging to the spymaster's team
        num_candidates: Number of candidate clues to generate

    Returns:
        JSON Schema dict suitable for OpenAI's response_format
    """
    return {
        "name": "spymaster_output",
        "strict": True,
        "schema": {
            "type": "object",
            "required": ["candidates"],
            "additionalProperties": False,
            "properties": {
                "candidates": {
                    "type": "array",
                    "description": f"Generate exactly {num_candidates} diverse candidate clues",
                    "items": {
                        "type": "object",
                        "required": ["reasoning", "clue", "risk_assessment", "intended_targets", "number"],
                        "additionalProperties": False,
                        "properties": {
                            "reasoning": {
                                "type": "string",
                                "description": "Why this clue connects the target words"
                            },
                            "clue": {
                                "type": "string",
                                "description": "A single word clue (no spaces, no board words)"
                            },
                            "risk_assessment": {
                                "type": "string",
                                "description": "Potential confusion with opponent/neutral/assassin words"
                            },
                            "intended_targets": {
                                "type": "array",
                                "items": {
                                    "type": "string",
                                    "enum": team_words
                                },
                                "description": "The specific team words this clue hints at"
                            },
                            "number": {
                                "type": "integer",
                                "description": "Number of words this clue relates to (1-9)"
                            }
                        }
                    }
                }
            }
        }
    }


def build_simple_spymaster_schema(num_candidates: int) -> dict[str, Any]:
    """
    Build a simpler schema without enum constraint on targets.

    Use this when you want more flexibility in the output.

    Args:
        num_candidates: Number of candidate clues to generate

    Returns:
        JSON Schema dict suitable for OpenAI's response_format
    """
    return {
        "name": "spymaster_output",
        "strict": True,
        "schema": {
            "type": "object",
            "required": ["candidates"],
            "additionalProperties": False,
            "properties": {
                "candidates": {
                    "type": "array",
                    "description": f"Generate exactly {num_candidates} diverse candidate clues",
                    "items": {
                        "type": "object",
                        "required": ["reasoning", "clue", "risk_assessment", "intended_targets", "number"],
                        "additionalProperties": False,
                        "properties": {
                            "reasoning": {
                                "type": "string",
                                "description": "Why this clue connects the target words"
                            },
                            "clue": {
                                "type": "string",
                                "description": "A single word clue"
                            },
                            "risk_assessment": {
                                "type": "string",
                                "description": "Potential risks with this clue"
                            },
                            "intended_targets": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "The board words this clue hints at"
                            },
                            "number": {
                                "type": "integer",
                                "description": "Number of words this clue relates to"
                            }
                        }
                    }
                }
            }
        }
    }
