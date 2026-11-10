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

Use official Cargo from `~/.cargo/bin` with Kache selected by the user's Cargo configuration (`~/.cargo/config.toml`, `[build].rustc-wrapper` pointing to the installed Kache executable). This Mac uses pinned Kache 2.0.0 and a shared local-only cache across worktrees. Do not export compiler-wrapper overrides; for direct `cargo` commands, first run `unset RUSTC_WRAPPER RUSTC_WORKSPACE_WRAPPER CARGO_BUILD_RUSTC_WRAPPER CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER`. The project Tauri launcher clears those inherited overrides and puts the official rustup proxy first on `PATH`; `pnpm tauri`, `pnpm dev:preview`, `pnpm build:app`, and `open-worktree.mjs` all use it. No alternate Cargo installation or opt-in wrapper is needed.

**Live dev app check.** Frontend changes require visually checking the live window (no white screen). If blank, run `touch index.html` to force Vite full-reload or use skill `omp-workspace-native-ui-acceptance`. Avoid concurrent edits to mutually-imported files while live app is watching.

## Git worktrees

- **「打开 X 工作树」/「打开 Main」/「打开 XX 分支」= 启动该工作树的开发版窗口**（不是应用内会话/面板，也不是 Finder/VS Code）：
  `node scripts/open-worktree.mjs <main|分支名|目录名|绝对路径>`。同一个工作树只保留一个实例，
  再次调用只报告已有端口/窗口；`--close` 停止，`--dry-run` 只看解析结果。
  端口从 1425 起（main 固定 1425，工作树按目录名散列），数据目录隔离（main → `~/.omp-workspace-dev`，
  工作树 → `~/.omp-workspace-dev-<目录名>`）；脚本会等到窗口真的出现再回报窗口标题。
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

## Agent diagnostics

- Start investigation with `node scripts/diagnostics.mjs summary --instance main`
  (or the exact worktree slug / `--data-dir <isolated-directory>`). Use
  `node scripts/diagnostics.mjs instances` when selection is unclear.
- Follow returned operation filters with `node scripts/diagnostics.mjs trace
  --instance <slug> --operation <UUID>`; narrow by run/session rather than reading
  full log files or chat transcripts first. Default output is at most 8 KiB.
- Preserve observed/unknown and `contextOnly` distinctions. Missing completion
  does not prove a crash; missing logs do not prove health. Legacy lifecycle files
  are not the new writer. Never upload diagnostics automatically or touch another
  instance; native acceptance and process-isolation rules above still apply.
- Release and development users can disable new capture in General →
  Troubleshooting → Local diagnostic records. Respect that persisted choice;
  existing files remain historical evidence, not proof recording is enabled.
