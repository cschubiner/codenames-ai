#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from codenames_bench.analyze import analyze_results, print_summary
from codenames_bench.boards import read_boards_jsonl
from codenames_bench.runner import run_match
from codenames_bench.types import load_agent_config


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boards", required=True)
    ap.add_argument("--baseline", required=True, help="Baseline agent config JSON (will play as RED).")
    ap.add_argument("--variants", nargs="*", default=[], help="Variant agent config JSON files to test as BLUE.")
    ap.add_argument("--variants-dir", default=None, help="Directory containing variant JSON configs.")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--replicates", type=int, default=1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--mirror", action="store_true")
    ap.add_argument("--max-turns", type=int, default=100)
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    variant_paths = [Path(p) for p in args.variants]
    if args.variants_dir:
        variant_paths.extend(sorted(Path(args.variants_dir).glob("*.json")))

    if not variant_paths:
        raise SystemExit("No variants provided. Use --variants or --variants-dir.")

    boards = list(read_boards_jsonl(args.boards))
    baseline = load_agent_config(args.baseline)

    for vp in variant_paths:
        variant = load_agent_config(vp)
        out_file = out_dir / f"{baseline.name}__vs__{variant.name}.jsonl"

        print(f"\n=== Running {baseline.name} (RED) vs {variant.name} (BLUE) ===")
        run_match(
            boards,
            red_cfg=baseline,
            blue_cfg=variant,
            out_path=out_file,
            replicates=args.replicates,
            seed=args.seed,
            mirror=args.mirror,
            max_turns=args.max_turns,
            cache_path=args.cache,
        )
        summary = analyze_results(out_file)
        print_summary(summary)


if __name__ == "__main__":
    main()
