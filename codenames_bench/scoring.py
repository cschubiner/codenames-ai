from __future__ import annotations

from typing import Dict

from .env import TurnOutcome
from .types import Team


DEFAULT_WEIGHTS = {
    "correct": 1.0,
    "opponent": -1.0,
    "neutral": -0.3,
    "assassin": -10.0,
}


def turn_utility(outcome: TurnOutcome, *, weights: Dict[str, float] | None = None) -> float:
    """
    Converts a TurnOutcome into a scalar. Used ONLY for selecting among candidate clues.
    This is not a learned critic; it's a fixed scoring rule.
    """
    w = weights or DEFAULT_WEIGHTS
    team: Team = outcome.team

    score = 0.0
    for a in outcome.applied:
        if a.card_type == team:
            score += w["correct"]
        elif a.card_type == "ASSASSIN":
            score += w["assassin"]
        elif a.card_type in ("RED", "BLUE"):
            score += w["opponent"]
        else:
            score += w["neutral"]

    return score
