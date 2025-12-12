import type { AgentConfig, CardType, Team } from "./types";
import type { Env } from "./cors";
import { aggregate, scoreReveal } from "./scoring";
import { guesserMessages, spymasterMessages } from "./prompts";
import { guesserSchema, spymasterListSchema, spymasterSingleSchema } from "./schemas";
import { callOpenAIJsonSchema } from "./openai";
import { checkClueLegality } from "./legality";
import { safeUpper, clamp, uniq } from "./utils";
import { simulateTurn } from "./game";

export interface SpymasterCandidate {
  clue: string;
  number: number;
  intended_targets?: string[];
  danger_words?: string[];
}

export interface PickedClue {
  clue: string;
  number: number;
  picked_index: number;
  candidates_considered: number;
  debug?: any;
}

export async function pickBestClueForTeam(
  env: Env,
  agent: AgentConfig,
  boardWords: string[],
  key: CardType[],
  revealed: boolean[],
  team: Team,
): Promise<PickedClue> {
  const candidates = await generateCandidates(env, agent, boardWords, key, revealed, team);

  const unrevealed = boardWords.filter((_, i) => !revealed[i]);
  const maxCandidates = Math.max(1, candidates.length);

  const scoresByCandidate: number[] = [];
  const meanByCandidate: number[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const clueUpper = safeUpper(cand.clue);
    const legality = checkClueLegality(clueUpper, boardWords);
    if (!legality.ok) {
      scoresByCandidate.push(-9999);
      meanByCandidate.push(-9999);
      continue;
    }

    // Clamp number to reasonable bounds and remaining team words.
    const n = clamp(Math.floor(cand.number || 1), 1, 9);
    const maxAllowed = clamp(n + 1, 0, 10);

    const sampleScores: number[] = [];
    for (let s = 0; s < Math.max(1, agent.selection.eval_samples_per_candidate); s++) {
      const guesses = await runGuesserOnce(
        env,
        agent,
        unrevealed,
        boardWords,
        revealed,
        clueUpper,
        n,
        maxAllowed,
      );
      const sim = simulateTurn(boardWords, key, revealed, team, guesses, maxAllowed);
      const score = sim.applied.reduce((acc, g) => acc + scoreReveal(g.card_type, team), 0);
      sampleScores.push(score);
    }

    const mean = sampleScores.reduce((a, b) => a + b, 0) / sampleScores.length;
    const agg = aggregate(sampleScores, agent.selection.aggregate, agent.selection.lambda_std ?? 0.7);

    scoresByCandidate.push(agg);
    meanByCandidate.push(mean);
  }

  // Pick best
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < scoresByCandidate.length; i++) {
    const sc = scoresByCandidate[i];
    if (sc > bestScore) {
      bestScore = sc;
      bestIdx = i;
    }
  }

  const chosen = candidates[bestIdx] ?? { clue: "SKIP", number: 1 };

  return {
    clue: safeUpper(chosen.clue || "SKIP"),
    number: clamp(Math.floor(chosen.number || 1), 1, 9),
    picked_index: bestIdx,
    candidates_considered: maxCandidates,
    debug: {
      scores: scoresByCandidate,
      means: meanByCandidate,
    },
  };
}

async function generateCandidates(
  env: Env,
  agent: AgentConfig,
  boardWords: string[],
  key: CardType[],
  revealed: boolean[],
  team: Team,
): Promise<SpymasterCandidate[]> {
  const K = clamp(Math.floor(agent.spymaster.candidates_per_turn || 1), 1, 20);

  if (agent.spymaster.generation_mode === "single_call_array") {
    const msgs = spymasterMessages(agent.spymaster.prompt_id, boardWords, key, revealed, team);

    // Add an extra nudge for diversity
    const msgs2 = [...msgs];
    msgs2[msgs2.length - 1] = {
      role: "user",
      content:
        msgs[msgs.length - 1].content +
        `\n\nReturn a JSON object with up to ${K} *diverse* candidate clues. Do not repeat the same clue.`,
    };

    const out = await callOpenAIJsonSchema<{ candidates: SpymasterCandidate[] }>(env, {
      model: agent.spymaster.model,
      input: msgs2,
      temperature: agent.spymaster.temperature,
      top_p: agent.spymaster.top_p,
      max_output_tokens: agent.spymaster.max_output_tokens,
      schema_name: "spymaster_candidates",
      schema: spymasterListSchema(K),
      store: false,
    });

    const cands = (out?.candidates ?? []).slice(0, K);
    return dedupeCandidates(cands);
  }

  // k_calls
  const cands: SpymasterCandidate[] = [];
  for (let i = 0; i < K; i++) {
    const msgs = spymasterMessages(agent.spymaster.prompt_id, boardWords, key, revealed, team);
    const out = await callOpenAIJsonSchema<SpymasterCandidate>(env, {
      model: agent.spymaster.model,
      input: msgs,
      temperature: agent.spymaster.temperature,
      top_p: agent.spymaster.top_p,
      max_output_tokens: agent.spymaster.max_output_tokens,
      schema_name: "spymaster_clue",
      schema: spymasterSingleSchema(),
      store: false,
    });
    cands.push(out);
  }
  return dedupeCandidates(cands);
}

function dedupeCandidates(cands: SpymasterCandidate[]): SpymasterCandidate[] {
  const seen = new Set<string>();
  const out: SpymasterCandidate[] = [];
  for (const c of cands) {
    const clue = safeUpper(c?.clue ?? "");
    const key = `${clue}:${Math.floor(c?.number ?? 0)}`;
    if (!clue) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, clue });
  }
  return out.length ? out : [{ clue: "SKIP", number: 1 }];
}

async function runGuesserOnce(
  env: Env,
  agent: AgentConfig,
  unrevealedWords: string[],
  boardWords: string[],
  revealed: boolean[],
  clue: string,
  number: number,
  maxAllowed: number,
): Promise<string[]> {
  const msgs = guesserMessages(
    agent.guesser.prompt_id,
    boardWords,
    revealed,
    clue,
    number,
    maxAllowed,
  );

  const schema = guesserSchema(unrevealedWords, maxAllowed);

  const out = await callOpenAIJsonSchema<{ guesses: Array<{ word: string; confidence: number }>; stop_reason?: string }>(
    env,
    {
      model: agent.guesser.model,
      input: msgs,
      temperature: agent.selection.eval_temperature ?? agent.guesser.temperature,
      top_p: agent.selection.eval_top_p ?? agent.guesser.top_p,
      max_output_tokens: agent.guesser.max_output_tokens,
      schema_name: "guesser_output",
      schema,
      store: false,
    },
  );

  const guesses = (out?.guesses ?? []).map(g => safeUpper(g.word));
  // ensure uniqueness and valid order
  return uniq(guesses).filter(w => unrevealedWords.includes(w));
}
