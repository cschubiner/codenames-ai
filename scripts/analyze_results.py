#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys

# Allow running this script directly without installing the package.
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from codenames_bench.analyze import analyze_results, print_summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True, help="Results JSONL from scripts/run_match.py")
    args = ap.parse_args()

    summary = analyze_results(args.results)
    print_summary(summary)


if __name__ == "__main__":
    main()
