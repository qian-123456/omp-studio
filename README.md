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
- [`omp`](https://github.com/can1357/oh-my-pi) — installed automatically on first launch if missing (official installer, macOS/Linux); or install it yourself and keep it on your `PATH` (or set its path in Settings ▸ 高级)
- At least one model provider credential
- To build from source: Node.js 18+, `pnpm`, and a Rust toolchain (1.77.2+)

## Download and Install

Download the latest `.dmg` installer from [GitHub Releases](https://github.com/qian-123456/omp-studio/releases/latest):
- Apple Silicon (M1/M2/M3/M4): `omp-workspace_0.1.1_aarch64.dmg`
- Intel Mac: `omp-workspace_0.1.1_x64.dmg`

> ⚠️ **Important: "omp-workspace is damaged and can't be opened"**
>
> Because open-source community builds are not signed with a paid Apple Developer certificate, macOS Gatekeeper may show:
> `“omp-workspace” is damaged and can’t be opened. You should move it to the Trash.`
>
> Run this one-line command in Terminal to bypass the quarantine flag and open it normally:
> ```bash
> xattr -cr /Applications/omp-workspace.app
> ```
> Alternatively, right-click (Control-click) `omp-workspace.app` in Finder, choose **Open**, or go to **System Settings ▸ Privacy & Security** and click **Open Anyway**.

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

运行要求：macOS，至少一个模型凭据；未安装 `omp` 时应用会在启动时自动安装（官方安装器），也可自行安装。从源码构建还需要 Node.js 18+、`pnpm` 和 Rust 工具链。

### 下载安装与运行

从 [GitHub Releases 页面](https://github.com/qian-123456/omp-studio/releases/latest) 下载对应芯片的最新安装包：
- 苹果 M 系列芯片（M1/M2/M3/M4）：下载 `omp-workspace_0.1.1_aarch64.dmg`
- 老款 Intel 芯片：下载 `omp-workspace_0.1.1_x64.dmg`

> ⚠️ **重要：若提示“已损坏，无法打开。你应该将它移到废纸篓”**：
> 这是由于开源应用未购买苹果每年昂贵的商业开发者证书，macOS Gatekeeper 安全机制会自动给下载的文件打上隔离标记（Quarantine）。**软件并非真的损坏**，只需在「终端（Terminal）」中执行以下命令清除隔离标记即可正常打开：
> ```bash
> xattr -cr /Applications/omp-workspace.app
> ```
> 或者在访达的「应用程序」中按住 Control 键点按应用选择「打开」，或在系统「系统设置 ▸ 隐私与安全性」中点击「仍要打开」。

```bash
pnpm install
pnpm tauri dev
```

完整使用说明见 [`docs/guide/zh`](docs/guide/zh)。许可证：[MIT](LICENSE)。
