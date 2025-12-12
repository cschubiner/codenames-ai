from __future__ import annotations

import copy
import statistics
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple

from .env import GameState, TurnOutcome, apply_turn
from .legality import filter_legal_clues
from .openai_responses import OpenAIResponsesClient
from .prompts import guesser_messages, spymaster_messages
from .schemas import guesser_schema, spymaster_list_schema, spymaster_single_schema
from .scoring import turn_utility
from .types import AgentConfig, Team


@dataclass
class Candidate:
    clue: str
    number: int
    intended_targets: Optional[List[str]] = None
    danger_words: Optional[List[str]] = None
    raw: Optional[Dict[str, Any]] = None  # full parsed JSON from LLM


@dataclass
class CandidateEvalSample:
    guesses: List[str]
    confidences: List[float]
    outcome: Dict[str, Any]  # TurnOutcome serialized
    utility: float


@dataclass
class CandidateEvaluation:
    candidate: Candidate
    samples: List[CandidateEvalSample]
    mean_utility: float
    std_utility: float
    selection_score: float


@dataclass
class TurnLog:
    team: Team
    # spymaster generation
    generated_candidates: int
    legal_candidates: int
    rejected_candidates: List[Dict[str, Any]]
    candidate_evaluations: List[Dict[str, Any]]
    chosen: Dict[str, Any]
    # actual play
    actual_guesses: List[str]
    actual_outcome: Dict[str, Any]


class TeamAgent:
    def __init__(
        self,
        cfg: AgentConfig,
        client: OpenAIResponsesClient,
        *,
        selection_weights: Optional[Dict[str, float]] = None,
    ) -> None:
        self.cfg = cfg
        self.client = client
        self.selection_weights = selection_weights  # for utility shaping

    def take_turn(self, state: GameState, team: Team) -> Tuple[str, int, List[str], TurnLog]:
        """
        Picks a clue by sampling + evaluation rollouts, then runs the actual guesser once
        to decide guesses for the real turn.
        Returns (clue, number, guesses, turn_log)
        """
        # 1) Generate candidate clues
        candidates_raw, rejected_generation = self._generate_candidates(state, team)

        # Turn them into list[dict] for legality filter
        cand_dicts = []
        for c in candidates_raw:
            cand_dicts.append({
                "clue": c.get("clue", ""),
                "number": c.get("number", 1),
                "intended_targets": c.get("intended_targets", None),
                "danger_words": c.get("danger_words", None),
                "_raw": c,
            })

        # 2) Legality filter
        legal, rejected_legality = filter_legal_clues(cand_dicts, state.words)

        # Filter number ranges based on remaining
        rem = state.remaining(team)
        final_legal: List[Dict[str, Any]] = []
        rejected_number: List[Dict[str, Any]] = []
        for c in legal:
            try:
                n = int(c.get("number", 1))
            except Exception:
                rejected_number.append({**c, "_reject_reason": "bad_number"})
                continue
            if n < 1:
                rejected_number.append({**c, "_reject_reason": "number_lt_1"})
                continue
            if n > min(9, rem):
                rejected_number.append({**c, "_reject_reason": f"number_gt_remaining({rem})"})
                continue
            final_legal.append(c)

        rejected_all = rejected_generation + rejected_legality + rejected_number

        # If none survive, fall back to "safe" single candidate generation with lower temperature.
        if not final_legal:
            fallback = self._fallback_candidate(state, team)
            final_legal = [fallback]
            rejected_all.append({"_reject_reason": "no_legal_candidates_fallback_used", "fallback": fallback})

        # 3) Evaluate candidates via guesser rollouts
        max_eval = self.cfg.selection.max_eval_candidates or len(final_legal)
        eval_candidates = final_legal[:max_eval]

        evals: List[CandidateEvaluation] = []
        for c in eval_candidates:
            cand = Candidate(
                clue=str(c["clue"]).strip(),
                number=int(c["number"]),
                intended_targets=c.get("intended_targets", None),
                danger_words=c.get("danger_words", None),
                raw=c.get("_raw", None),
            )
            ev = self._evaluate_candidate(state, team, cand)
            evals.append(ev)

        # 4) Pick best by selection score
        best = max(
            evals,
            key=lambda e: (e.selection_score, e.mean_utility, -e.std_utility),
        )

        chosen = best.candidate

        # 5) Run actual guesser (often temp=0) to produce actual guesses
        max_allowed = min(chosen.number + 1, len(state.unrevealed_words()))
        max_schema_guesses = min(max_allowed, 10)
        schema = guesser_schema(state.unrevealed_words(), max_guesses=max_schema_guesses)
        msgs = guesser_messages(
            prompt_id=self.cfg.guesser.prompt_id,
            board_words=state.words,
            revealed=state.revealed,
            clue=chosen.clue,
            number=chosen.number,
            max_allowed=max_allowed,
        )
        resp = self.client.create_json(
            model=self.cfg.guesser.model,
            input_items=msgs,
            schema_name="guesser_output",
            schema=schema,
            temperature=self.cfg.guesser.temperature,
            top_p=self.cfg.guesser.top_p,
            max_output_tokens=self.cfg.guesser.max_output_tokens,
            store=False,
            mode=self.cfg.guesser.output_mode,
        )

        guesses, confidences = _parse_guesser_output(resp.parsed)
        guesses = _sanitize_guesses(guesses, max_allowed=max_allowed)

        # 6) Apply to real game state
        outcome = apply_turn(state, team, chosen.clue, chosen.number, guesses)

        # 7) Build log
        log = TurnLog(
            team=team,
            generated_candidates=len(candidates_raw),
            legal_candidates=len(final_legal),
            rejected_candidates=rejected_all,
            candidate_evaluations=[_eval_to_dict(e) for e in evals],
            chosen={
                "clue": chosen.clue,
                "number": chosen.number,
                "mean_utility": best.mean_utility,
                "std_utility": best.std_utility,
                "selection_score": best.selection_score,
            },
            actual_guesses=guesses,
            actual_outcome=_outcome_to_dict(outcome),
        )
        return chosen.clue, chosen.number, guesses, log

    # -------------------------
    # Internals
    # -------------------------

    def _generate_candidates(self, state: GameState, team: Team) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Returns (candidates, rejected_generation_records).
        candidates are parsed JSON objects with keys like clue/number.
        """
        K = max(1, int(self.cfg.spymaster.candidates_per_turn))
        rejected: List[Dict[str, Any]] = []
        results: List[Dict[str, Any]] = []

        if self.cfg.spymaster.generation_mode == "one_call_list":
            schema = spymaster_list_schema(max_candidates=K)
            msgs = spymaster_messages(
                prompt_id=self.cfg.spymaster.prompt_id,
                board_words=state.words,
                key=state.key,
                revealed=state.revealed,
                team=team,
            )
            resp = self.client.create_json(
                model=self.cfg.spymaster.model,
                input_items=msgs,
                schema_name="spymaster_candidates",
                schema=schema,
                temperature=self.cfg.spymaster.temperature,
                top_p=self.cfg.spymaster.top_p,
                max_output_tokens=self.cfg.spymaster.max_output_tokens,
                store=False,
                mode=self.cfg.spymaster.output_mode,
            )
            parsed = resp.parsed
            cands = parsed.get("candidates", []) if isinstance(parsed, dict) else []
            for c in cands:
                if isinstance(c, dict):
                    results.append(c)
                else:
                    rejected.append({"_reject_reason": "non_dict_candidate", "_raw": c})
            return results, rejected

        # Default: K separate calls (more diverse)
        schema = spymaster_single_schema()
        for i in range(K):
            msgs = spymaster_messages(
                prompt_id=self.cfg.spymaster.prompt_id,
                board_words=state.words,
                key=state.key,
                revealed=state.revealed,
                team=team,
            )
            try:
                resp = self.client.create_json(
                    model=self.cfg.spymaster.model,
                    input_items=msgs,
                    schema_name="spymaster_clue",
                    schema=schema,
                    temperature=self.cfg.spymaster.temperature,
                    top_p=self.cfg.spymaster.top_p,
                    max_output_tokens=self.cfg.spymaster.max_output_tokens,
                    store=False,
                    mode=self.cfg.spymaster.output_mode,
                )
                if isinstance(resp.parsed, dict):
                    results.append(resp.parsed)
                else:
                    rejected.append({"_reject_reason": "spymaster_non_dict", "_raw": resp.parsed})
            except Exception as e:
                rejected.append({"_reject_reason": "spymaster_call_failed", "error": str(e)})
        return results, rejected

    def _fallback_candidate(self, state: GameState, team: Team) -> Dict[str, Any]:
        """Best-effort fallback: generate 1 candidate at temp=0.2, else use a safe hardcoded clue."""
        schema = spymaster_single_schema()
        msgs = spymaster_messages(
            prompt_id=self.cfg.spymaster.prompt_id,
            board_words=state.words,
            key=state.key,
            revealed=state.revealed,
            team=team,
        )
        try:
            resp = self.client.create_json(
                model=self.cfg.spymaster.model,
                input_items=msgs,
                schema_name="spymaster_clue",
                schema=schema,
                temperature=min(self.cfg.spymaster.temperature, 0.2),
                top_p=1.0,
                max_output_tokens=self.cfg.spymaster.max_output_tokens,
                store=False,
                mode=self.cfg.spymaster.output_mode,
            )
            parsed = resp.parsed if isinstance(resp.parsed, dict) else {}
            clue = str(parsed.get("clue", "MYSTERY")).strip()
            number = int(parsed.get("number", 1))
            return {"clue": clue, "number": number, "_raw": parsed}
        except Exception:
            # Hardcoded fallback; legality will be checked by caller.
            return {"clue": "MYSTERY", "number": 1, "_raw": {"fallback": True}}

    def _evaluate_candidate(self, state: GameState, team: Team, cand: Candidate) -> CandidateEvaluation:
        G = max(1, int(self.cfg.selection.eval_samples_per_candidate))
        max_allowed = min(cand.number + 1, len(state.unrevealed_words()))
        max_schema_guesses = min(max_allowed, 10)

        samples: List[CandidateEvalSample] = []

        for g in range(G):
            # Call guesser at eval temperature (stochastic), but same prompt/model.
            schema = guesser_schema(state.unrevealed_words(), max_guesses=max_schema_guesses)
            msgs = guesser_messages(
                prompt_id=self.cfg.guesser.prompt_id,
                board_words=state.words,
                revealed=state.revealed,
                clue=cand.clue,
                number=cand.number,
                max_allowed=max_allowed,
            )
            resp = self.client.create_json(
                model=self.cfg.guesser.model,
                input_items=msgs,
                schema_name="guesser_output",
                schema=schema,
                temperature=self.cfg.selection.eval_temperature,
                top_p=self.cfg.selection.eval_top_p,
                max_output_tokens=self.cfg.guesser.max_output_tokens,
                store=False,
                mode=self.cfg.guesser.output_mode,
                cache_deterministic_only=True,
            )
            guesses, confidences = _parse_guesser_output(resp.parsed)
            guesses = _sanitize_guesses(guesses, max_allowed=max_allowed)

            # Simulate on copy
            sim_state = state.copy()
            outcome = apply_turn(sim_state, team, cand.clue, cand.number, guesses)
            util = turn_utility(outcome, weights=self.selection_weights)

            samples.append(CandidateEvalSample(
                guesses=guesses,
                confidences=confidences,
                outcome=_outcome_to_dict(outcome),
                utility=util,
            ))

        utilities = [s.utility for s in samples] or [0.0]
        mean_u = statistics.mean(utilities)
        std_u = statistics.pstdev(utilities) if len(utilities) > 1 else 0.0
        score = _aggregate_score(
            mean_u, std_u, utilities,
            aggregate=self.cfg.selection.aggregate,
            lambda_std=self.cfg.selection.lambda_std,
        )

        return CandidateEvaluation(
            candidate=cand,
            samples=samples,
            mean_utility=mean_u,
            std_utility=std_u,
            selection_score=score,
        )


# -------------------------
# Helpers
# -------------------------

def _parse_guesser_output(obj: Any) -> Tuple[List[str], List[float]]:
    guesses: List[str] = []
    confidences: List[float] = []
    if isinstance(obj, dict):
        g = obj.get("guesses", [])
        if isinstance(g, list):
            for item in g:
                if not isinstance(item, dict):
                    continue
                w = str(item.get("word", "")).strip().upper()
                try:
                    c = float(item.get("confidence", 0.5))
                except Exception:
                    c = 0.5
                if w:
                    guesses.append(w)
                    confidences.append(max(0.0, min(1.0, c)))
    return guesses, confidences


def _sanitize_guesses(guesses: List[str], *, max_allowed: int) -> List[str]:
    out: List[str] = []
    seen = set()
    for g in guesses:
        gg = g.strip().upper()
        if not gg or gg in seen:
            continue
        seen.add(gg)
        out.append(gg)
        if len(out) >= max_allowed:
            break
    return out


def _outcome_to_dict(o: TurnOutcome) -> Dict[str, Any]:
    return {
        "team": o.team,
        "clue": o.clue,
        "number": o.number,
        "max_allowed": o.max_allowed,
        "guesses": o.guesses,
        "applied": [
            {"word": a.word, "index": a.index, "card_type": a.card_type}
            for a in o.applied
        ],
        "stopped_reason": o.stopped_reason,
        "game_over": o.game_over,
        "winner": o.winner,
        "loser": o.loser,
    }


def _aggregate_score(
    mean_u: float,
    std_u: float,
    utilities: List[float],
    *,
    aggregate: str,
    lambda_std: float,
) -> float:
    if aggregate == "mean":
        return mean_u
    if aggregate == "mean_minus_lambda_std":
        return mean_u - lambda_std * std_u
    if aggregate == "p10":
        if not utilities:
            return mean_u
        utilities_sorted = sorted(utilities)
        # 10th percentile index
        idx = int(0.1 * (len(utilities_sorted) - 1))
        return utilities_sorted[idx]
    # default
    return mean_u - lambda_std * std_u


def _eval_to_dict(e: CandidateEvaluation) -> Dict[str, Any]:
    return {
        "clue": e.candidate.clue,
        "number": e.candidate.number,
        "mean_utility": e.mean_utility,
        "std_utility": e.std_utility,
        "selection_score": e.selection_score,
        "samples": [
            {
                "guesses": s.guesses,
                "confidences": s.confidences,
                "utility": s.utility,
                "outcome": s.outcome,
            }
            for s in e.samples
        ],
        "intended_targets": e.candidate.intended_targets,
        "danger_words": e.candidate.danger_words,
    }
