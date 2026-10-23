## Auto-commit on accepted work (omp-workspace)
- After this task's acceptance checks pass, commit it — never mid-task, never before verification.
- Stage only files this task changed (`git add <paths>`), never `git add -A`: other sessions may share this worktree.
- Use an English Conventional Commit message (e.g. `fix(git): handle empty repo`). Never push without explicit approval.
- The desktop app snapshots every turn so the user can undo it; do not make your own backup copies.
