# omp-workspace

A desktop workbench for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) agent sessions, built with Tauri 2, Rust, React 19 and TypeScript.

[中文说明](#中文说明)

It works alongside the `omp` CLI rather than replacing it: sessions you start in a terminal show up in the sidebar, and sessions started in the app can be resumed in a terminal.

## Features

- **Sessions in one window**: indexes `~/.omp/agent/sessions/`, with live status, native notifications and a dock badge.
- **Chat with full execution trace**: thinking, diffs, tool-call cards and results; a side chat for quick questions that does not disturb the main session.
- **Projects and git worktrees**: run several agents on one repository in separate worktrees.
- **Workspace tools**: file explorer, Markdown document view, multi-tab terminal, time-machine snapshots, local port monitor, token usage.
- **Automation**: scheduled tasks, a todo inbox and an idea backlog that can be handed to an agent.
- **Models and settings**: providers (API key or OAuth), model roles, MCP servers, plugins and sub-agent definitions.
- **Mobile access**: open your sessions from a phone over the LAN or a tunnel.

The UI is in Simplified Chinese.

## Requirements

- macOS (the primary target; other platforms are not regularly tested)
- [`omp`](https://github.com/can1357/oh-my-pi) installed and on your `PATH` (or set its path in Settings ▸ 高级)
- At least one model provider credential
- To build from source: Node.js 18+, `pnpm`, and a Rust toolchain (1.77.2+)

## Build and run

```bash
pnpm install
pnpm tauri dev      # dev run (builds Rust + Vite)
pnpm build:app      # build the macOS app bundle
```

`pnpm dev:preview` starts an isolated dev instance on another port with its data in `~/.omp-workspace-dev`.

## Development

```bash
pnpm tsc --noEmit   # typecheck
pnpm vitest run     # frontend tests

cd src-tauri
cargo clippy        # lint
cargo test          # backend tests
cargo fmt           # format
```

- Architecture and module contracts: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Floating UI layers: [`docs/LAYERS.md`](docs/LAYERS.md)
- User guide: [`docs/guide/zh`](docs/guide/zh) (Chinese), [`docs/guide/en`](docs/guide/en) (English)
- Contributor and agent rules: [`AGENTS.md`](AGENTS.md)

## Security notes

- The app runs the `omp` agent with your user permissions; the agent can read and modify files the way `omp` does in a terminal.
- The mobile server listens on all network interfaces while enabled and requires pairing. Only enable it on networks you trust.
- The app does not set a Content Security Policy, because rendered widgets, local images and file links need it off. Avoid opening untrusted session content.

## License

[MIT](LICENSE)

---

## 中文说明

omp-workspace 是 [oh-my-pi](https://github.com/can1357/oh-my-pi)（`omp` 命令行智能体）的桌面工作台：一个窗口里查看、管理和并行运行所有 `omp` 会话。它和命令行 `omp` 互通，在终端里开的会话会出现在左侧栏，应用里开的会话也能在终端里接着用。

主要功能：会话列表与实时状态、带完整执行过程的对话、侧聊、Git 工作树隔离、文件浏览器、终端、时光机快照、定时任务、待办收件箱、想法收集箱、模型与供应商设置、手机远程访问。

运行要求：macOS，已安装 `omp`，至少一个模型凭据。从源码构建还需要 Node.js 18+、`pnpm` 和 Rust 工具链。

```bash
pnpm install
pnpm tauri dev
```

完整使用说明见 [`docs/guide/zh`](docs/guide/zh)。许可证：[MIT](LICENSE)。
