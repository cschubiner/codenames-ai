from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Literal, Optional, Sequence, Tuple

from .types import CardType, Team


@dataclass(frozen=True)
class Board:
    board_id: str
    words: List[str]            # length 25
    key: List[CardType]         # length 25
    starting_team: Team         # "RED" or "BLUE"


def load_wordlist(path: str | Path) -> List[str]:
    p = Path(path)
    words: List[str] = []
    for line in p.read_text().splitlines():
        w = line.strip()
        if not w or w.startswith("#"):
            continue
        w = w.upper()
        # Keep single tokens only (no spaces)
        if " " in w or "\t" in w:
            continue
        words.append(w)
    # de-dup preserving order
    dedup = list(dict.fromkeys(words))
    if len(dedup) < 50:
        raise ValueError(f"Wordlist too small after filtering: {len(dedup)} words. Provide a larger list.")
    return dedup


def generate_board(rng: random.Random, wordlist: Sequence[str], board_id: str) -> Board:
    if len(wordlist) < 25:
        raise ValueError("Wordlist must contain at least 25 unique words.")

    words = rng.sample(list(wordlist), k=25)

    # Starting team randomly chosen
    starting_team: Team = rng.choice(["RED", "BLUE"])  # type: ignore

    # Standard Codenames key distribution:
    # starting team: 9, other team: 8, neutral: 7, assassin: 1
    if starting_team == "RED":
        counts = {"RED": 9, "BLUE": 8, "NEUTRAL": 7, "ASSASSIN": 1}
    else:
        counts = {"BLUE": 9, "RED": 8, "NEUTRAL": 7, "ASSASSIN": 1}

    key: List[CardType] = []
    for t, n in counts.items():
        key.extend([t] * n)  # type: ignore
    rng.shuffle(key)
    assert len(key) == 25

    return Board(board_id=board_id, words=words, key=key, starting_team=starting_team)


def write_boards_jsonl(
    out_path: str | Path,
    wordlist_path: str | Path,
    num_boards: int,
    seed: int = 0,
    id_prefix: str = "board",
) -> None:
    rng = random.Random(seed)
    wordlist = load_wordlist(wordlist_path)
    outp = Path(out_path)
    outp.parent.mkdir(parents=True, exist_ok=True)

    with outp.open("w", encoding="utf-8") as f:
        for i in range(num_boards):
            board = generate_board(rng=rng, wordlist=wordlist, board_id=f"{id_prefix}-{i:06d}")
            f.write(json.dumps({
                "board_id": board.board_id,
                "words": board.words,
                "key": board.key,
                "starting_team": board.starting_team,
                "seed": seed,
            }) + "\n")


def read_boards_jsonl(path: str | Path) -> Iterator[Board]:
    p = Path(path)
    for line in p.read_text().splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        yield Board(
            board_id=obj["board_id"],
            words=list(obj["words"]),
            key=list(obj["key"]),
            starting_team=obj["starting_team"],
        )
