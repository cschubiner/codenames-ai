from __future__ import annotations

from typing import Dict, List, Literal, Sequence, Tuple

from .types import CardType, Team


def _fmt_words(words: Sequence[str]) -> str:
    return ", ".join(words) if words else "(none)"


def spymaster_messages(
    prompt_id: str,
    board_words: List[str],
    key: List[CardType],
    revealed: List[bool],
    team: Team,
) -> List[Dict[str, str]]:
    """
    Returns input items (role/content) for the spymaster model.
    The spymaster sees the full key.
    """
    if prompt_id not in _SPYMASTER_PROMPTS:
        raise KeyError(f"Unknown spymaster prompt_id: {prompt_id}")

    # Partition unrevealed words by type
    yours, opp, neut, assassin, already = [], [], [], [], []
    for w, t, r in zip(board_words, key, revealed):
        if r:
            already.append(f"{w}({t})")
            continue
        if t == team:
            yours.append(w)
        elif t in ("RED", "BLUE"):
            opp.append(w)
        elif t == "NEUTRAL":
            neut.append(w)
        elif t == "ASSASSIN":
            assassin.append(w)

    remaining_yours = len(yours)
    remaining_opp = len(opp)

    context = {
        "TEAM": team,
        "UNREVEALED_ALL": _fmt_words([w for w, r in zip(board_words, revealed) if not r]),
        "YOUR_WORDS": _fmt_words(yours),
        "OPP_WORDS": _fmt_words(opp),
        "NEUTRAL_WORDS": _fmt_words(neut),
        "ASSASSIN_WORDS": _fmt_words(assassin),
        "REVEALED_WORDS": _fmt_words(already),
        "REMAINING_YOURS": str(remaining_yours),
        "REMAINING_OPP": str(remaining_opp),
    }

    system, user = _SPYMASTER_PROMPTS[prompt_id](context)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def guesser_messages(
    prompt_id: str,
    board_words: List[str],
    revealed: List[bool],
    clue: str,
    number: int,
    max_allowed: int,
) -> List[Dict[str, str]]:
    """
    Returns input items (role/content) for the guesser model.
    The guesser never sees the key.
    """
    if prompt_id not in _GUESSER_PROMPTS:
        raise KeyError(f"Unknown guesser prompt_id: {prompt_id}")

    unrevealed = [w for w, r in zip(board_words, revealed) if not r]
    revealed_words = [w for w, r in zip(board_words, revealed) if r]

    context = {
        "UNREVEALED": _fmt_words(unrevealed),
        "REVEALED": _fmt_words(revealed_words),
        "CLUE": clue,
        "NUMBER": str(number),
        "MAX_ALLOWED": str(max_allowed),
    }

    system, user = _GUESSER_PROMPTS[prompt_id](context)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# -----------------------
# Prompt implementations
# -----------------------

def _spymaster_v1(ctx: Dict[str, str]) -> Tuple[str, str]:
    system = (
        "You are an expert CODENAMES SPYMASTER.\n"
        "You know which unrevealed board words belong to your team, the opponent, neutrals, and the assassin.\n"
        "Your job: output a SINGLE-WORD clue and a number.\n\n"
        "Rules / constraints:\n"
        "- Clue must be ONE word (no spaces).\n"
        "- Do NOT use any board word as the clue.\n"
        "- Avoid clues that could point to the assassin or opponent words.\n"
        "- Prefer clues that link 2-3 of your words safely; be conservative if risk is high.\n\n"
        "Return ONLY the JSON required by the schema."
    )

    user = (
        f"TEAM: {ctx['TEAM']}\n"
        f"Unrevealed words: {ctx['UNREVEALED_ALL']}\n\n"
        f"Your unrevealed words ({ctx['REMAINING_YOURS']}): {ctx['YOUR_WORDS']}\n"
        f"Opponent unrevealed words ({ctx['REMAINING_OPP']}): {ctx['OPP_WORDS']}\n"
        f"Neutral unrevealed words: {ctx['NEUTRAL_WORDS']}\n"
        f"ASSASSIN unrevealed words: {ctx['ASSASSIN_WORDS']}\n\n"
        f"Already revealed: {ctx['REVEALED_WORDS']}\n\n"
        "Pick the best safe clue and number for this turn."
    )
    return system, user


def _spymaster_v2(ctx: Dict[str, str]) -> Tuple[str, str]:
    system = (
        "You are CODENAMES SPYMASTER (high precision).\n"
        "You must output a single-word clue and an integer number.\n\n"
        "Goal: maximize correct guesses this turn while minimizing risk.\n"
        "Hard rules:\n"
        "- One word clue (letters only; no spaces, no hyphens if avoidable).\n"
        "- Never output a board word as the clue.\n"
        "- Never intentionally bait the assassin.\n"
        "- Number should usually be <= 4 unless the board is extremely safe.\n\n"
        "Return ONLY JSON per the schema. No extra text."
    )

    user = (
        f"TEAM: {ctx['TEAM']}\n"
        f"YOUR WORDS: {ctx['YOUR_WORDS']}\n"
        f"OPPONENT WORDS: {ctx['OPP_WORDS']}\n"
        f"NEUTRALS: {ctx['NEUTRAL_WORDS']}\n"
        f"ASSASSIN: {ctx['ASSASSIN_WORDS']}\n"
        f"ALREADY REVEALED: {ctx['REVEALED_WORDS']}\n\n"
        "Choose a clue that best connects a subset of YOUR WORDS while being far from the assassin and opponent words."
    )
    return system, user


def _guesser_v1(ctx: Dict[str, str]) -> Tuple[str, str]:
    system = (
        "You are a CODENAMES GUESSER.\n"
        "You only see the board words and the spymaster's clue + number.\n"
        "You must propose an ordered list of guesses (0 to MAX_ALLOWED guesses).\n\n"
        "Guidelines:\n"
        "- Guess only from the unrevealed board words.\n"
        "- You may return fewer than MAX_ALLOWED guesses to stop early.\n"
        "- Be cautious: if uncertain, stop rather than guessing randomly.\n\n"
        "Return ONLY JSON that matches the provided schema."
    )
    user = (
        f"UNREVEALED WORDS: {ctx['UNREVEALED']}\n"
        f"REVEALED WORDS: {ctx['REVEALED']}\n\n"
        f"CLUE: {ctx['CLUE']}\n"
        f"NUMBER: {ctx['NUMBER']}\n"
        f"MAX_ALLOWED_GUESSES_THIS_TURN: {ctx['MAX_ALLOWED']}\n\n"
        "Provide the ordered list of guesses you would attempt now."
    )
    return system, user


def _guesser_v2(ctx: Dict[str, str]) -> Tuple[str, str]:
    system = (
        "You are a CODENAMES GUESSER (conservative stop policy).\n"
        "Return an ordered list of guesses you would attempt now.\n\n"
        "Rules:\n"
        "- Only choose from the unrevealed words.\n"
        "- Stop early unless you are confident.\n"
        "- Prefer 1-2 high-confidence guesses over using the full limit.\n\n"
        "Return ONLY JSON per schema."
    )
    user = (
        f"UNREVEALED: {ctx['UNREVEALED']}\n"
        f"CLUE: {ctx['CLUE']}  NUMBER: {ctx['NUMBER']}  MAX_ALLOWED: {ctx['MAX_ALLOWED']}\n"
        "Output guesses now."
    )
    return system, user


_SPYMASTER_PROMPTS = {
    "spymaster_v1": _spymaster_v1,
    "spymaster_v2": _spymaster_v2,
}

_GUESSER_PROMPTS = {
    "guesser_v1": _guesser_v1,
    "guesser_v2": _guesser_v2,
}
