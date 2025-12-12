import type { AgentConfig, PresetInfo } from "./types";

// Add more presets by importing additional JSON files from ../../shared/configs/
// and registering them in PRESETS below.

import agent_a from "../../shared/configs/agent_a.json" assert { type: "json" };
import agent_b from "../../shared/configs/agent_b.json" assert { type: "json" };

const PRESETS: Record<string, AgentConfig> = {
  agent_a: agent_a as AgentConfig,
  agent_b: agent_b as AgentConfig,
};

export function getPreset(id: string): AgentConfig {
  const cfg = PRESETS[id];
  if (!cfg) throw new Error(`Unknown preset id: ${id}`);
  return cfg;
}

export function listPresets(): PresetInfo[] {
  return Object.entries(PRESETS).map(([id, cfg]) => ({
    id,
    name: cfg.name,
    spymaster_model: cfg.spymaster.model,
    guesser_model: cfg.guesser.model,
    spymaster_prompt_id: cfg.spymaster.prompt_id,
    guesser_prompt_id: cfg.guesser.prompt_id,
    candidates_per_turn: cfg.spymaster.candidates_per_turn,
    eval_samples_per_candidate: cfg.selection.eval_samples_per_candidate,
  }));
}
