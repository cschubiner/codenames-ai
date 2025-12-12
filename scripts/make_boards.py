#!/usr/bin/env python3
from __future__ import annotations

import argparse

from codenames_bench.boards import write_boards_jsonl


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wordlist", required=True, help="Path to a wordlist (one word per line).")
    ap.add_argument("--num-boards", type=int, default=50)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", required=True, help="Output JSONL file.")
    ap.add_argument("--id-prefix", default="board")
    args = ap.parse_args()

    write_boards_jsonl(
        out_path=args.out,
        wordlist_path=args.wordlist,
        num_boards=args.num_boards,
        seed=args.seed,
        id_prefix=args.id_prefix,
    )
    print(f"Wrote {args.num_boards} boards to {args.out}")


if __name__ == "__main__":
    main()
