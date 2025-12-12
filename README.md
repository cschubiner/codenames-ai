# Codenames AI (Jackbox‑style)

Play Codenames on a “TV” (spectator view) while people join on phones/laptops as **guessers**, **spymasters**, or a **controller**. Benchmark agent configs in Python and use the same configs in the web game.

## Quickstart (local web play)

1) Put your key in ignored local files (never commit):
- `./.env` (Python bench):
  - `OPENAI_API_KEY=...`
- `worker/.dev.vars` (Wrangler dev):
  - `OPENAI_API_KEY=...`

2) Run:
```bash
python scripts/dev_local.py
```

This starts:
- the Worker on a free port (default starts at 8787)
- the frontend on a free port (default starts at 8000; **never uses 3000**)

It prints a URL like:
`http://localhost:8000/?api=http%3A%2F%2Flocalhost%3A8787`

## Roles

- `GUESSER`: clicks cards for their team.
- `SPYMASTER`: **1 per team max**. If present for the active team, the AI will *not* generate clues; the spymaster submits clues in the UI and can view the key.
- `CONTROLLER`: can click guesses/stop for either team (useful for AI vs AI or one‑team‑only).
- `SPECTATOR`: read‑only view (“TV”).

## Benchmarking (Python)

```bash
source .venv/bin/activate
python scripts/make_boards.py --wordlist data/words_small.txt --num-boards 10 --seed 123 --out data/boards_dev.jsonl
python scripts/run_match.py --boards data/boards_dev.jsonl --red configs/agent_a_smoke.json --blue configs/agent_b_smoke.json --replicates 1 --out results/smoke.jsonl
python scripts/analyze_results.py --results results/smoke.jsonl
```

Use the smoke configs first; the full configs are more expensive.

## Repo layout

- `docs/`: static frontend (GitHub Pages)
- `worker/`: Cloudflare Worker + Durable Object backend (Wrangler)
- `codenames_bench/`: Python benchmark library
- `scripts/`: CLIs (bench + local dev runner)
- `configs/`: example bench configs
- `shared/configs/`: web presets (same JSON format as `configs/`)

## Deploy

### 1) Deploy the Worker (Cloudflare)

From `worker/`:
```bash
npm install
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
# optional: restrict CORS
npx wrangler secret put ALLOWED_ORIGINS
npx wrangler deploy
```

Wrangler prints a Worker URL (use it below).

### 2) Deploy the frontend (GitHub Pages)

Option A (recommended): GitHub Actions workflow
- Commit/push this repo
- In GitHub: Settings → Pages → Source: **GitHub Actions**
- The workflow in `.github/workflows/pages.yml` publishes `docs/`

Option B: “Deploy from a branch”
- Settings → Pages → Source: “Deploy from a branch”
- Select branch + folder `/docs`

Then set the backend URL:
- edit `docs/config.js` and set `window.CODENAMES_API_BASE` to your deployed Worker URL (no trailing slash)

## Notes for contributors/agents

- See `AGENTS.md` for local/dev/deploy rules (especially secrets).
- See `CLAUDE.md` for a work log and tested flows.

