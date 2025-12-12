# Codenames LLM Benchmark Harness (Spymaster + Guesser, no critic)

This repo is a **fully runnable** benchmarking harness for Codenames where:

- The **guesser** is **only an LLM** (no training).
- The **spymaster** is an LLM that **samples K candidate clues** per turn.
- Each candidate clue is **evaluated by running the guesser LLM**, and we pick the clue that performs best in simulation.
- You can benchmark:
  - different **guesser models**
  - different **guesser prompts**
  - different **spymaster models**
  - different **spymaster prompts**
  - **K** (candidates per turn)
  - **G** (guesser rollouts per candidate)
  - selection aggregation (mean, risk-averse mean-std, percentile)

The code uses the OpenAI **Responses API** and **Structured Outputs (JSON Schema)** for robust parsing, as documented in the OpenAI docs.
- Structured outputs via `text.format` with `type: "json_schema"`: https://platform.openai.com/docs/guides/structured-outputs
- Responses API reference: https://platform.openai.com/docs/api-reference/responses

> Note: This harness is for **AI benchmarking**. It “cheats” relative to human play because the spymaster can evaluate multiple candidate clues by simulating the guesser.

---

## Quickstart

### 1) Install

```bash
python -m venv .venv
source .venv/bin/activate  # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
```

### 2) Set your API key

```bash
export OPENAI_API_KEY="..."
```

### 3) Generate a board dataset

```bash
python scripts/make_boards.py \
  --wordlist data/words_small.txt \
  --num-boards 50 \
  --seed 123 \
  --out data/boards_dev.jsonl
```

### 4) Run a match (A vs B), with mirror matches

```bash
python scripts/run_match.py \
  --boards data/boards_dev.jsonl \
  --red configs/agent_a.json \
  --blue configs/agent_b.json \
  --mirror \
  --replicates 2 \
  --out results/run1.jsonl
```

### 5) Analyze results

```bash
python scripts/analyze_results.py --results results/run1.jsonl
```

---

## Project layout

- `codenames_bench/`
  - `boards.py` board dataset creation/loading
  - `env.py` game rules + simulator
  - `prompts.py` spymaster/guesser prompts (edit here!)
  - `schemas.py` JSON schemas (Structured Outputs)
  - `openai_responses.py` OpenAI Responses API wrapper (requests-based)
  - `agent.py` the “sample K → evaluate with guesser → pick best” logic
  - `runner.py` match runner
- `configs/` example agent configs
- `data/` word list and board datasets
- `scripts/` CLIs

---

## Config knobs (what you’ll sweep)

Each team uses an `AgentConfig` JSON file:

- `spymaster`:
  - `model`
  - `prompt_id` (from `codenames_bench/prompts.py`)
  - `candidates_per_turn` (**K**)
  - `temperature`
- `guesser`:
  - `model`
  - `prompt_id`
  - `temperature` (used for the *actual* turn)
- `selection`:
  - `eval_samples_per_candidate` (**G**)
  - `eval_temperature` (used during evaluation rollouts)
  - `aggregate` (`mean`, `mean_minus_lambda_std`, `p10`)
  - `lambda_std` (for mean-std)

---

## Tips

- Start with small datasets and small K/G (e.g., K=4, G=1) to validate everything end-to-end.
- Then scale up boards and K/G.
- Turn on `--mirror` to control for first-move advantage.
- Use `store: false` in OpenAI requests (default in this repo) if you don’t want responses stored.

---

## License

MIT (for the code you find here).
