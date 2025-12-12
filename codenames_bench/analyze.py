from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


def analyze_results(path: str | Path) -> Dict[str, Any]:
    p = Path(path)
    rows = [json.loads(line) for line in p.read_text().splitlines() if line.strip()]

    total = len(rows)
    winners = Counter()
    wins_by_agent = Counter()
    wins_by_color_agent = Counter()
    end_reasons = Counter()
    draws = 0

    # Mirror handling: who is "agent A"? We'll just report wins for each agent name.
    for r in rows:
        end_reasons[r.get("end_reason", "unknown")] += 1
        winner = r.get("winner")
        if not winner:
            draws += 1
            continue
        winners[winner] += 1

        # Which agent won?
        if winner == "RED":
            wins_by_agent[r.get("red_agent", "red?")] += 1
            wins_by_color_agent[(r.get("red_agent", "red?"), "RED")] += 1
        elif winner == "BLUE":
            wins_by_agent[r.get("blue_agent", "blue?")] += 1
            wins_by_color_agent[(r.get("blue_agent", "blue?"), "BLUE")] += 1

    return {
        "total_games": total,
        "draws": draws,
        "winners_by_color": dict(winners),
        "wins_by_agent": dict(wins_by_agent),
        "wins_by_agent_color": {f"{k[0]}::{k[1]}": v for k, v in wins_by_color_agent.items()},
        "end_reasons": dict(end_reasons),
    }


def print_summary(summary: Dict[str, Any]) -> None:
    print("=== Results summary ===")
    print(f"Games: {summary['total_games']}  Draws: {summary['draws']}")
    print("\nWinners by color:")
    for k, v in sorted(summary["winners_by_color"].items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")

    print("\nWins by agent name:")
    for k, v in sorted(summary["wins_by_agent"].items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")

    print("\nEnd reasons:")
    for k, v in sorted(summary["end_reasons"].items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")
