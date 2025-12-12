from __future__ import annotations

import re
from typing import Iterable, List, Tuple


_BANNED_CLUES = {
    "NONE", "NIL", "ZERO", "STOP", "PASS", "SKIP",
    "LEFT", "RIGHT", "TOP", "BOTTOM", "FIRST", "SECOND", "THIRD",
}


def normalize_token(s: str) -> str:
    # Keep letters only for strict substring checks
    return re.sub(r"[^A-Za-z]", "", s).upper()


def is_single_word(clue: str) -> bool:
    clue = clue.strip()
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z']{0,31}", clue))


def is_legal_clue(clue: str, board_words: Iterable[str]) -> Tuple[bool, str]:
    """
    Basic legality checks (you can make stricter/looser).
    Returns (ok, reason_if_not_ok).
    """
    clue_raw = clue.strip()
    if not clue_raw:
        return False, "empty"

    if not is_single_word(clue_raw):
        return False, "not_single_word"

    clue_norm = normalize_token(clue_raw)
    if not clue_norm:
        return False, "no_letters"

    if clue_norm in _BANNED_CLUES:
        return False, "banned_meta_word"

    board_norm = [normalize_token(w) for w in board_words]

    # Disallow exact match and very strict substring overlap in either direction.
    for w_raw, w_norm in zip(board_words, board_norm):
        if clue_norm == w_norm:
            return False, f"matches_board_word:{w_raw}"
        if clue_norm and w_norm and (clue_norm in w_norm or w_norm in clue_norm):
            return False, f"substring_overlap:{w_raw}"

        # Simple plural/possessive-ish variants
        if clue_norm + "S" == w_norm or w_norm + "S" == clue_norm:
            return False, f"plural_variant:{w_raw}"

    return True, "ok"


def filter_legal_clues(candidates: List[dict], board_words: List[str]) -> Tuple[List[dict], List[dict]]:
    """
    Filters a list of candidate dicts that include at least {'clue': str}.
    Returns (legal_candidates, rejected_with_reason).
    """
    legal = []
    rejected = []
    for c in candidates:
        clue = str(c.get("clue", "")).strip()
        ok, reason = is_legal_clue(clue, board_words)
        if ok:
            legal.append({**c, "clue": clue})
        else:
            rejected.append({**c, "clue": clue, "_reject_reason": reason})
    return legal, rejected
