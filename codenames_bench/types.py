from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional
import json
from pathlib import Path


Team = Literal["RED", "BLUE"]
CardType = Literal["RED", "BLUE", "NEUTRAL", "ASSASSIN"]


@dataclass(frozen=True)
class LLMConfig:
    """Configuration for a single model call."""
    provider: str  # currently only "openai_responses" is implemented
    model: str
    prompt_id: str
    temperature: float = 0.7
    top_p: float = 1.0
    max_output_tokens: int = 256
    output_mode: Literal["json_schema", "json_object"] = "json_schema"


@dataclass(frozen=True)
class SelectionConfig:
    """How to evaluate and select among K spymaster candidates (no learned critic)."""
    eval_samples_per_candidate: int = 2  # G
    eval_temperature: float = 0.3        # temperature for evaluation rollouts
    eval_top_p: float = 1.0
    aggregate: Literal["mean", "mean_minus_lambda_std", "p10"] = "mean_minus_lambda_std"
    lambda_std: float = 0.7              # only used for mean_minus_lambda_std
    max_eval_candidates: Optional[int] = None  # if set, only evaluate first N legal candidates


@dataclass(frozen=True)
class SpymasterConfig(LLMConfig):
    candidates_per_turn: int = 8         # K
    generation_mode: Literal["k_calls", "one_call_list"] = "k_calls"


@dataclass(frozen=True)
class GuesserConfig(LLMConfig):
    pass


@dataclass(frozen=True)
class AgentConfig:
    """One team's full configuration."""
    name: str
    spymaster: SpymasterConfig
    guesser: GuesserConfig
    selection: SelectionConfig


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise ValueError(msg)


def load_agent_config(path: str | Path) -> AgentConfig:
    p = Path(path)
    data = json.loads(p.read_text())

    _require("name" in data, "Config missing 'name'")
    _require("spymaster" in data, "Config missing 'spymaster'")
    _require("guesser" in data, "Config missing 'guesser'")
    _require("selection" in data, "Config missing 'selection'")

    sp = data["spymaster"]
    gs = data["guesser"]
    sel = data["selection"]

    sp_cfg = SpymasterConfig(
        provider=sp.get("provider", "openai_responses"),
        model=sp["model"],
        prompt_id=sp["prompt_id"],
        temperature=float(sp.get("temperature", 0.8)),
        top_p=float(sp.get("top_p", 1.0)),
        max_output_tokens=int(sp.get("max_output_tokens", 256)),
        output_mode=sp.get("output_mode", "json_schema"),
        candidates_per_turn=int(sp.get("candidates_per_turn", 8)),
        generation_mode=sp.get("generation_mode", "k_calls"),
    )

    gs_cfg = GuesserConfig(
        provider=gs.get("provider", "openai_responses"),
        model=gs["model"],
        prompt_id=gs["prompt_id"],
        temperature=float(gs.get("temperature", 0.0)),
        top_p=float(gs.get("top_p", 1.0)),
        max_output_tokens=int(gs.get("max_output_tokens", 256)),
        output_mode=gs.get("output_mode", "json_schema"),
    )

    sel_cfg = SelectionConfig(
        eval_samples_per_candidate=int(sel.get("eval_samples_per_candidate", 2)),
        eval_temperature=float(sel.get("eval_temperature", 0.3)),
        eval_top_p=float(sel.get("eval_top_p", 1.0)),
        aggregate=sel.get("aggregate", "mean_minus_lambda_std"),
        lambda_std=float(sel.get("lambda_std", 0.7)),
        max_eval_candidates=sel.get("max_eval_candidates", None),
    )

    return AgentConfig(
        name=data["name"],
        spymaster=sp_cfg,
        guesser=gs_cfg,
        selection=sel_cfg,
    )
