## Repo Working Rules (for coding agents)

- Do **not** delete, restore, reset, or “clean up” unrelated files, including untracked/local-only files created by the user.
- Avoid broad git commands like `git restore .`, `git checkout -- .`, `git reset --hard`, or `git clean -fd`.
- When isolating changes for a commit, prefer **targeted staging** (e.g. `git add <files>` / `git add -p`) and leave other working tree changes untouched.
- Only modify files required to complete the current task, unless explicitly asked otherwise.
