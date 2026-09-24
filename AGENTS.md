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

## Style

- UI text: Simplified Chinese. Code, comments, commit messages: English.
- No floating `latest`/`*` dependency versions.
- Module stubs return `Err("not implemented")` / empty values until filled.
- `src-tauri/prompts/*.md` are LLM prompt templates loaded via `include_str!`.
