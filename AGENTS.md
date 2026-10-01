## Repo Working Rules (for coding agents)

- Do **not** delete, restore, reset, or “clean up” unrelated files, including untracked/local-only files created by the user.
- Avoid broad git commands like `git restore .`, `git checkout -- .`, `git reset --hard`, or `git clean -fd`.
- When isolating changes for a commit, prefer **targeted staging** (e.g. `git add <files>` / `git add -p`) and leave other working tree changes untouched.
- Only modify files required to complete the current task, unless explicitly asked otherwise.

## Benchmark history

- Benchmark results must always be additive. Never replace or hide earlier games when adding models or runs.
- The default leaderboard includes every completed historical game. Preserve immutable run snapshots and stable game identities; deduplicate repeated imports.
- Unequal model and matchup sample sizes are allowed. Display percentages together with game counts and uncertainty.
- Exclude failed or unfinished games from scores without deleting their local records.
