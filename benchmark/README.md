# Local Codenames benchmark

Games run on your computer. GitHub Pages only reads `docs/benchmark-results.json`, so leaderboard visitors make no paid AI calls.

## Run

Install the existing Worker dependencies (`npm ci --prefix worker`). Use Node 20+.

Provide a dedicated OpenRouter key through `OPENROUTER_API_KEY`, or a mode-600 `.benchmark-key.local` file in the repository root. The runner verifies that the key has a **nonrenewing total limit no greater than $45**. Never use the website's monthly key for this benchmark. Local key files, logs, generated modules, and checkpoints are ignored by Git.

```sh
# Inspect the schedule without any API calls (5 boards = 240 games).
node benchmark/run.mjs --boards 5 --budget 20 --dry-run

# Run or resume that exact experiment. Default concurrency is 4.
node benchmark/run.mjs --boards 5 --budget 20 --concurrency 4 --publish docs/benchmark-results-run.json

# Resume provider-error games as well; completed games are never replayed.
node benchmark/run.mjs --boards 5 --budget 20 --retry-errors --publish docs/benchmark-results-run.json

# Re-export checkpoints without API calls.
node benchmark/run.mjs --export --publish docs/benchmark-results-run.json

# A separate larger experiment; the same key's lifetime cap still applies.
node benchmark/run.mjs --boards 50 --budget 45 --out benchmark/runs.local/larger
```

The selected run snapshot updates after each recorded game. Use the additive publisher described below, then commit the public result files and push main. The site never executes the benchmark. For the local preview, serve `docs/` and open `/#leaderboard`.

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

### Leaderboard views

Spymaster and guesser views compare contenders in the same role. Both combined gives each role equal weight within every opponent matchup. The separate partner matrix fixes the roles: rows are spymasters, columns are guessers. It includes team appearances from both leagues, counting each game once for each team. Select a cell to filter game replays. Partner win rates depend on the opposing teams in this schedule and are descriptive, not an isolated measure of compatibility. These views reuse published games without additional API calls.

### Expanded model comparison

The expanded roster adds Claude Opus 5.5, GPT-6 Astra, GPT-6.1 Sol, and Gemini 3.1 Pro Preview. Claude Fable 5.1 is listed as unavailable because the account's existing zero-data-retention guardrail blocks its providers. The original four-model results remain selectable on the site.

The expanded run uses one fresh board (seed 20261020), one seeded partner pair per contender matchup, and the original four models as the eligible reference partner panel. Every contender meets every other contender in both roles, with teammates and sides swapped. This produces 224 games for eight models. The panel excludes both contenders; it limits cost while testing cross-model communication. Partner coverage is sparse, and untested partnerships stay blank. This single-board run is exploratory and should not be compared as if it had the original run's five-board coverage.

```sh
node benchmark/run.mjs --boards 1 --seed 20261020 --budget 33 \
  --models openai/gpt-6-luna,google/gemini-3.8-flash,anthropic/claude-sonnet-5.5,openai/gpt-6-sol,anthropic/claude-opus-5.5,openai/gpt-6-astra,openai/gpt-6.1-sol,google/gemini-3.1-pro-preview \
  --partner-panel openai/gpt-6-luna,google/gemini-3.8-flash,anthropic/claude-sonnet-5.5,openai/gpt-6-sol \
  --partner-pairs 1 --out benchmark/runs.local/expanded-october-2026-v2 \
  --publish docs/benchmark-results-expanded.json --concurrency 8
```

Provide unavailable-model notes with `--unavailable-file <json-path>` when starting a run. Resume requires the same roster, partner panel, board settings, budget, and code. The existing key's $45 lifetime cap covers both runs and all probes; the expanded runner ceiling is $33 for recovery (initially $30).

### Additive publishing

The default leaderboard is **All games**: every completed historical game stays in the dataset when models or runs are added. Original and expanded snapshots remain selectable. Percentages are shown alongside sample counts; equal game counts are not required. Completed games from partially finished blocks are included in this cumulative view, with failed/unfinished games excluded from scoring and preserved locally.

```sh
node benchmark/publish-history.mjs --run benchmark/runs.local/expanded-october-2026-v2
```

The publisher namespaces game and board identities by run, deduplicates repeated imports, preserves previously completed games even if a later import is partial, and refuses decreasing game counts. The first publish saves the original result file as `docs/benchmark-results-original.json`. Always use this additive publisher for the default `docs/benchmark-results.json`; direct runner exports should target a separate run snapshot.

Model refusals and malformed JSON are invalid actions and end the current turn. Genuine provider errors remain excluded. The runner refuses to overwrite the cumulative public file, including during exports, before making paid calls.


### Haiku 5.5 versus Luna 6

The October 7 run uses the `last_chance_v1` prompts and records that strategy ID on every game and run. Historical runs retain their original engine fingerprints; they are not relabeled or rerun. Comparing the new model scores to older runs also changes the prompt strategy, so use the dedicated run for the controlled Haiku/Luna comparison.

Focused contenders play each other in both roles and each reference model (Gemini 3.8 Flash and GPT-6 Sol). Partner and starting-side swaps test both direct competition and Haiku/Luna partnerships in both role orders. Reference-only matchups are omitted. All teams use distinct models. Twenty fresh boards are scheduled; the spending ceiling may stop the run before all 800 games finish. The run snapshot ranks complete four-game blocks, while additive publication preserves every completed game.

```sh
node benchmark/run.mjs --boards 20 --seed 20261070 --budget 9.80 \
  --models anthropic/claude-haiku-5.5,openai/gpt-6-luna,google/gemini-3.8-flash,openai/gpt-6-sol \
  --contenders anthropic/claude-haiku-5.5,openai/gpt-6-luna \
  --out benchmark/runs.local/haiku-luna-october-2026 \
  --publish docs/benchmark-results-haiku-luna.json --concurrency 8
node benchmark/publish-history.mjs --run benchmark/runs.local/haiku-luna-october-2026
```

The $9.80 runner cap reserves room for the availability probe under a $10 total allowance. The existing $45 nonrenewing provider-key cap remains unchanged. No simulations or paid calls run on the public site.


Final October 7 result: 240 games in complete four-game blocks across six fresh boards; one additional completed game is retained in cumulative history. Eight games from the next board were stopped at the planned checkpoint and remain local. Provider-confirmed incremental spend including the availability check: **$7.731170575**. The $45 key cap was unchanged.

Luna won 15/24 direct spymaster contests and 17/24 direct guesser contests against Haiku (32/48 combined). Haiku-spymaster/Luna-guesser teams won 11/48; reversing those roles won 15/48 against the reference teams. These are provisional AI-partner results with six independent boards, not evidence about human teammates or a controlled comparison against the old prompt strategy.
