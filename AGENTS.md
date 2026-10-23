# omp-workspace — Agent Rules

Tauri 2 + React 19 + TS + Vite + Tailwind v4 desktop workbench for OMP agent sessions.

## The contract

**`docs/ARCHITECTURE.md` is the contract.** Types (§4), commands (§7), events (§5),
DB schema (§6), file layout (§2), and cross-module APIs (§9) are pinned there.
Do not change a contract silently — if a module truly needs one, note it in your
final report under "Contract changes" with the exact diff.

## Ownership (§2)

Each module only edits files it owns (`[A]`/`[B]`/`[C]`/`[D]`/`[E]`/`[LEAD]` tags
in the §2 layout). `[LEAD]` files are frozen after scaffold, except: a module MAY
append its own deps to `Cargo.toml` / `package.json`, and MAY fix the body of its
own command wrapper in `src/lib/ipc.ts` if a signature was wrong (report it).
Cross-module Rust calls go only through the §9 `pub` functions; frontend
cross-feature interaction goes only through `src/stores/*` and `src/lib/ipc.ts`.

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

`sccache` is installed; export `RUSTC_WRAPPER=sccache` in your own shell to share
the compile cache across worktrees (do not hardcode it in repo config).

**Live dev app check (recurring mistake).** When a `pnpm tauri dev` instance is
running from this worktree, every frontend change must end with a look at that
window (bring it to front, screenshot it). A blank/white window is a failure,
never "the window is off-screen": the webview did a full reload while files were
half-edited (e.g. one file importing an export another edit had not added yet)
and stays white even after the code is fixed. `touch index.html` makes Vite
full-reload it; then confirm the app renders. Do not let several agents edit
files that import each other while the live app is watching — land the shared
module first.

## Style

- UI text: Simplified Chinese. Code, comments, commit messages: English.
- No floating `latest`/`*` dependency versions.
- Module stubs return `Err("not implemented")` / empty values until filled.
- `src-tauri/prompts/*.md` are LLM prompt templates loaded via `include_str!`.

## UI rules (recurring mistakes — check every UI change against these)

- **Never stack long model/provider lists linearly.** Any model picker uses the
  app's grouped two-pane picker (`ModelMenuContent` / `ModelSelect` in
  `src/components/ModelSelect.tsx`: providers left, that provider's models right,
  search flattens). Do not hand-roll a flat scrolling list of hundreds of models.
- **No content-hiding ellipsis.** Text that matters (model names, locations,
  before→after values, error messages) must be fully readable: wrap it, or give a
  visible expand/「全部 N 处」 control. `truncate` alone, with no way to see the
  rest, is a bug; probe/command errors are always shown in full (selectable).
- **No "…" in button labels.** Write 「替换」, not 「替换…」 — users read the
  trailing ellipsis as cut-off text.
- **Actions must look like actions.** Buttons and status get visible shape:
  filled/tinted buttons for primary actions, bordered or pill (capsule) buttons for
  secondary ones, chips for counts/status. Never render a clickable action as plain
  text that blends into the row.
- **Multi-step flows can go back.** Every wizard step after the first has 「上一步」
  and keeps the user's choices when going back.
- **Options come from real data.** Choices such as thinking levels are read from
  the selected model's catalog capabilities (`thinking`, via `resolveThinkingLevels`
  in `src/lib/models.ts`) — never a hard-coded superset the model may not support.
- **Plain labels.** Buttons and badges say what happens in everyday words
  (「换成别的模型」), not jargon like 「覆盖目标」.
- **Never use a raw z-index for floating UI.** Popovers, menus, modals, drawers,
  hover cards, lightboxes and toasts use `FloatingLayer` / `Z_LAYER`
  (`src/components/FloatingLayer.tsx`), or `z-(--z-modal)`-style classes in
  `className`; only `z-0/10/20/30/40` for purely local stacking. Enforced by
  `src/lib/zLayerGuard.test.ts`. See `docs/LAYERS.md`.
