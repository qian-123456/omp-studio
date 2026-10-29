# omp-workspace — Agent Rules

Tauri 2 + React 19 + TS + Vite + Tailwind v4 desktop workbench for OMP agent sessions.

## The contract

**`docs/ARCHITECTURE.md` is the contract.** Types (§4), commands (§7), events (§5),
DB schema (§6), file layout (§2), and cross-module APIs (§9) are pinned there.
Do not change a contract silently — report any needed diff under "Contract changes".

## Upstream reference

OMP upstream repository (`https://github.com/can1357/oh-my-pi`) is the canonical truth.
Always inspect GitHub source directly (via `gh api`, web fetch, or repo search); never reverse-engineer local binaries.

## Ownership (§2)

Each module only edits files it owns (`[A]`/`[B]`/`[C]`/`[D]`/`[E]`/`[LEAD]` tags in §2 layout).
`[LEAD]` files are frozen after scaffold, except appending deps or fixing command wrappers in `src/lib/ipc.ts`.
Cross-module Rust calls go only through §9 `pub` functions; frontend cross-feature interaction goes only through `src/stores/*` and `src/lib/ipc.ts`.

## Build / verify

```bash
source ~/.cargo/env          # Rust toolchain (rustup minimal profile)

pnpm install                 # frontend deps
pnpm tsc --noEmit            # typecheck
pnpm vitest run              # unit tests
pnpm tauri dev               # dev run (builds Rust + Vite)

cd src-tauri
cargo check                  # fast typecheck
cargo clippy                 # lint (must be clean)
cargo fmt                    # format (CI expects fmt-clean)
```

`sccache` is installed; export `RUSTC_WRAPPER=sccache` in your shell for cross-worktree compile cache.

**Live dev app check.** Frontend changes require visually checking the live window (no white screen). If blank, run `touch index.html` to force Vite full-reload or use skill `omp-workspace-native-ui-acceptance`. Avoid concurrent edits to mutually-imported files while live app is watching.

## Git worktrees

- **Naming**: Use clear, task-specific path and branch names (e.g. `.worktrees/<slug>` on `omp/<slug>`), never generic names.
- **Port & window isolation**: Run dev instances on distinct ports (e.g. `pnpm dev:preview`), and confirm the inspected window matches target worktree.
- **Stage isolation & cleanup**: Stage only modified files for current task (`git add <paths>`, never `git add -A`). Remove finished worktrees promptly.

## Style

- No floating `latest`/`*` dependency versions.
- Module stubs return `Err("not implemented")` / empty values until filled.
- `src-tauri/prompts/*.md` are LLM prompt templates loaded via `include_str!`.

## UI rules (check every UI change against these)

- **Model picker**: Use app's grouped two-pane picker (`ModelMenuContent` / `ModelSelect`), never a flat linear list.
- **No text truncation**: Important text (model names, locations, diffs, errors) must be fully readable (wrap or expandable 「全部 N 处」 control); errors shown in full.
- **Button labels**: No trailing ellipsis (use 「替换」, not 「替换…」); use plain labels (「换成别的模型」, not jargon).
- **Action appearance**: Buttons and status must have visible shape (tinted/filled primary, bordered/pill secondary, chips for counts), never plain text blending into rows.
- **Wizard navigation**: Multi-step flows must allow going back (「上一步」) and keep previous choices.
- **Capabilities from data**: Choices like thinking levels must be derived from model capabilities (`resolveThinkingLevels` in `src/lib/models.ts`).
- **Floating UI layers**: Popovers, modals, drawers, toasts must use `FloatingLayer` / `Z_LAYER` (`docs/LAYERS.md`), never raw `z-*` classes (enforced by `zLayerGuard.test.ts`).
