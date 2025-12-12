#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Allow running this script directly without installing the package.
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from codenames_bench.boards import read_boards_jsonl
from codenames_bench.runner import run_match
from codenames_bench.types import load_agent_config


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boards", required=True, help="Boards JSONL file.")
    ap.add_argument("--red", required=True, help="Agent config JSON for the RED team.")
    ap.add_argument("--blue", required=True, help="Agent config JSON for the BLUE team.")
    ap.add_argument("--out", required=True, help="Output JSONL results file.")
    ap.add_argument("--replicates", type=int, default=1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--mirror", action="store_true", help="Also play a swapped-color mirror game per board.")
    ap.add_argument("--max-turns", type=int, default=100)
    ap.add_argument("--cache", default=None, help="Optional sqlite cache path (use only for deterministic calls).")
    args = ap.parse_args()

    boards = list(read_boards_jsonl(args.boards))
    red_cfg = load_agent_config(args.red)
    blue_cfg = load_agent_config(args.blue)

    run_match(
        boards,
        red_cfg=red_cfg,
        blue_cfg=blue_cfg,
        out_path=args.out,
        replicates=args.replicates,
        seed=args.seed,
        mirror=args.mirror,
        max_turns=args.max_turns,
        cache_path=args.cache,
    )
    print(f"Done. Results written to {args.out}")


if __name__ == "__main__":
    main()
