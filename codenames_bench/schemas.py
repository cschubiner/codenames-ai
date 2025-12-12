from __future__ import annotations

from typing import Any, Dict, List


def spymaster_single_schema(name: str = "spymaster_clue") -> Dict[str, Any]:
    """Schema for one spymaster clue proposal."""
    return {
        "type": "object",
        "properties": {
            "clue": {
                "type": "string",
                "description": "A single-word clue (no spaces).",
            },
            "number": {
                "type": "integer",
                "description": "How many words the clue is intended to connect (1-9).",
            },
            "intended_targets": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Which board words you intended the team to guess (for analysis only).",
            },
            "danger_words": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Board words you fear the guesser might confuse with the clue.",
            },
        },
        "required": ["clue", "number", "intended_targets", "danger_words"],
        "additionalProperties": False,
    }


def spymaster_list_schema(max_candidates: int, name: str = "spymaster_candidates") -> Dict[str, Any]:
    """Schema for one response containing up to max_candidates candidates."""
    return {
        "type": "object",
        "properties": {
            "candidates": {
                "type": "array",
                "items": spymaster_single_schema(),
                "minItems": 1,
                "maxItems": max_candidates,
                "description": "List of candidate clues. Prefer unique clues.",
            }
        },
        "required": ["candidates"],
        "additionalProperties": False,
    }


def guesser_schema(unrevealed_words: List[str], max_guesses: int, name: str = "guesser_output") -> Dict[str, Any]:
    """Schema for guesser output constrained to currently unrevealed board words."""
    # Ensure stable ordering in enum to reduce token churn
    enum_words = list(dict.fromkeys(unrevealed_words))

    return {
        "type": "object",
        "properties": {
            "guesses": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "word": {
                            "type": "string",
                            "enum": enum_words,
                            "description": "One of the unrevealed board words.",
                        },
                        "confidence": {
                            "type": "number",
                            "description": "Your confidence in this guess (0.0 to 1.0).",
                        },
                    },
                    "required": ["word", "confidence"],
                    "additionalProperties": False,
                },
                "description": "Ordered list of guesses you would attempt this turn. Return fewer to stop early.",
            },
            "stop_reason": {
                "type": "string",
                "description": "Explanation for why you stopped early (analysis only).",
            },
        },
        "required": ["guesses", "stop_reason"],
        "additionalProperties": False,
    }
