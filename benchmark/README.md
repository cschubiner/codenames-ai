# Local Codenames benchmark

Games run on your computer. GitHub Pages only reads `docs/benchmark-results.json`, so leaderboard visitors make no paid AI calls.

## Run

Install the existing Worker dependencies (`npm ci --prefix worker`). Use Node 20+.

Provide a dedicated OpenRouter key through `OPENROUTER_API_KEY`, or a mode-600 `.benchmark-key.local` file in the repository root. The runner verifies that the key has a **nonrenewing total limit no greater than $45**. Never use the website's monthly key for this benchmark. Local key files, logs, generated modules, and checkpoints are ignored by Git.

```sh
# Inspect the schedule without any API calls (5 boards = 240 games).
node benchmark/run.mjs --boards 5 --budget 20 --dry-run

# Run or resume that exact experiment. Default concurrency is 4.
node benchmark/run.mjs --boards 5 --budget 20 --concurrency 4

# Resume provider-error games as well; completed games are never replayed.
node benchmark/run.mjs --boards 5 --budget 20 --retry-errors

# Re-export checkpoints without API calls.
node benchmark/run.mjs --export

# A separate larger experiment; the same key's lifetime cap still applies.
node benchmark/run.mjs --boards 50 --budget 45 --out benchmark/runs.local/larger
```

The public JSON updates after each recorded game. Commit `docs/benchmark-results.json` and push main to publish the snapshot. The site never executes the benchmark. For the local preview, serve `docs/` and open `/#leaderboard`.

The initial published run tests GPT-6 Luna, Gemini 3.8 Flash, Claude Sonnet 5.5 and GPT-6 Sol. GPT-6.1 Sol was unavailable due to persistent upstream rate limits during cost checks; those interrupted checks are not ranked.

## Experimental design

There are separate spymaster and guesser leagues. Every pair of contenders plays with two other partner models, excluding both contenders. A four-game block uses one saved board, swaps the partner assignments, then swaps the contenders between Red (starts with nine words) and Blue (eight words). With four models, each board produces six blocks per role, or 48 games total. This tests cross-model communication rather than same-model coordination.

- Simulations off: exactly one clue is requested per turn.
- Actual Worker prompts and game handlers execute locally; no public rooms or cloud database writes.
- Fixed low reasoning, turn history enabled, standard instant-loss assassin rules, 4,096 output-token cap, 40-turn safety limit.
- Illegal actions lose the turn. Checks include the Worker's board-word/number checks and one-word clue syntax. Morphological variants and semantic clue legality are not automatically adjudicated.
- Turn-limit draws score 0.5; wins score 1. Provider failures are excluded rather than scored as losses.
- Only complete four-game blocks enter results. Interrupted blocks remain in local checkpoints. Coverage and failed-game counts are visible.
- Matchup cells average results over boards. Overall scores give each observed opponent equal weight; check opponent coverage before comparing unfinished runs.
- 95% bootstrap intervals resample whole boards, keeping correlated replays together. Fewer than two boards produces [0, 1]. The website widens these ranges with a Wilson-style guard using the independent board count, to avoid misleading zero-width bootstrap intervals at the extremes. Displayed intervals are approximate; the raw JSON retains bootstrap ranges. Small board sets remain provisional, even with many games.
- Partner breakdowns are descriptive: opponents' partner assignments also change. Different contender pairs have different eligible partner pools.
- Seeds reproduce boards and schedules, not stochastic model responses. Engine, runner, settings, prices, boards and responses are frozen in the manifest/checkpoints. Code or settings changes require a new output directory.

This measures teamwork with AI partners, not human partners. Published boards become development material; use fresh unseen seeds for a future evaluation after tuning prompts.

## Spending controls and recovery

The nonrenewing provider key cap is the experiment-wide backstop across directories, pilots, and retries. The runner also reserves a conservative maximum per request before sending it, restricts provider prices, bounds output tokens, and records actual `usage.cost` (including reasoning) when available. Unknown or interrupted requests retain their reservation. An explicit upstream 429 with no generation is recorded as a rejected, zero-cost request. Separate per-model queues limit request rates and retries are bounded. Flex endpoints are excluded to reduce upstream contention.

`Ctrl-C` stops new calls, lets in-flight calls settle, and preserves checkpoints. Resume uses the same manifest and settings. A crash may leave `run.lock`; check its PID is no longer running before removing **that specific lock**. An interrupted turn may need to be regenerated, and its earlier requests remain in the spending ledger. The runner never tops up credits or raises limits.

The old Python harness remains for historical experiments. Its output is not used by this leaderboard.

## Tests

```sh
node --test benchmark/tests.mjs
npm --prefix worker run typecheck
npm --prefix worker run lint
npm --prefix worker test
```
