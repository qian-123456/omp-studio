# Getting Started

> omp-workspace is the official desktop workbench for OMP AI agents: start, view, debug, and manage all your agent sessions and workspace code in a modern native window. This chapter covers the architecture, prerequisites, window layout, and starting your first session.

In this chapter, you will learn how to:

- [Understand the role of omp-workspace](#understand-omp-workspace)
- [Check prerequisites and launch the app](#prerequisites)
- [Navigate the primary window layout](#window-layout)
- [Start your first agent session](#start-your-first-session)
- [Configure model providers and credentials](#configure-model-providers)

## Understand omp-workspace

omp-workspace is a native desktop shell (built with Tauri 2 + React 19) for the OMP command-line agent. It works seamlessly alongside the CLI rather than replacing it:

- **Bidirectional Session Sync**: When the app launches, it automatically scans `~/.omp/agent/sessions/`. Sessions started in your terminal via `omp` appear in the sidebar; sessions created in the desktop app can be resumed in the terminal.
- **Git Worktree Isolation**: Native support for Git worktrees. Multiple agents can work on separate branches of the same repository simultaneously without file collisions.
- **Visual Chat & Execution Tracing**: Real-time streaming of model reasoning, code diffs, tool call cards, and human-in-the-loop approvals, complete with IME-safe type-to-focus and rich inline annotations.
- **Integrated Workspace Tools**: Built-in file explorer, Markdown split-pane editor, multi-tab persistent terminal, Time Machine version snapshots, port monitor, and token heatmap diagnostics.
- **Automation & Remote Access**: Scheduled background tasks, an action-oriented Inbox, a global ideas backlog, and mobile remote pairing via local Wi-Fi, Cloudflare Tunnels, or direct IPv6.

## Prerequisites

| Requirement | Details |
| --- | --- |
| Operating System | macOS (uses macOS Keychain for secure credential encryption and supports Finder integrations) |
| OMP CLI | `omp` should be installed and accessible in your shell |
| Model Credentials | At least one valid provider (API key or OAuth subscription account), see [Configure model providers](#configure-model-providers) |
| Building from Source | Node.js (>=18), `pnpm`, and Rust (Cargo) toolchain |

The app starts sessions using the command defined under **Settings ▸ Advanced ▸ omp program path**, which defaults to `omp`.

> [!NOTE]
> If `omp` is located in a custom path or specific virtual environment, set its absolute path in **Settings ▸ Advanced ▸ omp program path**. Check **Settings ▸ Version and updates** to verify detection.

## Installation & Launch

To run from source or build the release bundle:

```bash
pnpm install        # Install frontend and workspace dependencies
pnpm tauri dev      # Start dev mode (builds Rust core and launches Vite)
pnpm build:app      # Typecheck, build frontend, and package native app (.app / .dmg)
```

> [!TIP]
> To run a completely isolated instance without touching existing data, use `pnpm dev:preview`. It uses a dedicated port and stores data in `~/.omp-workspace-dev`. See [Data locations](./07-shortcuts-and-troubleshooting.md#data-locations).

On initial launch, the app will:
1. Initialize local configuration and SQLite storage under `~/.omp-workspace/`.
2. Scan and index historical sessions from `~/.omp/agent/sessions/`.
3. Restore your last active session, or present the space onboarding view.

## Window Layout

The window is structured into four functional areas:

![Layout overview: sidebar, central chat, right panel, and bottom status bar](../images/getting-started-layout.png)

### 1. Left Sidebar
Manage sessions and spaces; press `⌘B` to toggle.
- **Space Switcher**: Displays the active space (Code, Work, Study, Research, or Universal). Each space maintains its own isolated projects and sessions.
- **Quick Links**: Access **Inbox** (aggregating approvals, questions, and errors), **Search** (`⌘F`), **New Session** (`⌘N`), **Schedules**, and **Skills**.
- **Projects & Worktrees**: Local repositories with collapsible session trees, optionally grouped by Git worktree or branch.
- **Settings**: Open preferences with the gear icon at the bottom (`⌘,`).

### 2. Center Area (Workbench)
The primary workspace:
- **Conversation Stream**: Shows session title, status badge, model chip, message history, tool execution cards, approval forms, and composer.
- **Full-page Views**: Opening Inbox, Schedules, Skills management, document editors, or Settings expands over the center area. Press `Esc` or `⌘[` to return.

### 3. Right Panel (Utility Drawer)
Multi-tab inspector; press `⌘J` to toggle. Click `+` to open tabs:
- **Side Chat**: Lightweight secondary chats inheriting context without polluting the main thread.
- **Explorer**: File tree navigation and fast file filtering.
- **Git**: File diffs, stage & commit, worktree management, and Time Machine snapshots.
- **Terminal**: Multi-tab login shell with one-click quote-to-composer actions.
- **File Preview**: Syntax-highlighted code viewer and Markdown renderer.
- **Services**: Active port scanner with orphaned process cleanup.
- **Token Heatmap**: Context breakdown and deep session diagnostics.

### 4. Bottom Status Bar
Global operational metrics:
- Real-time turn and step counts, plus context cache hit rate.
- **Performance**: Physical resident memory (footprint) of the app and helper processes.
- **OMP Version**: Version check and hot update trigger.
- **Git Branch & Zoom**: Active branch name and UI scaling buttons.

## Start Your First Session

1. **Select a Space**: Choose **Code** for programming repositories, or **Universal** for general unattached inquiries.
2. **Choose a Directory**: Click **Choose project folder** to link your local codebase.
3. **Type Your Goal**: Click into the composer or use **Type-to-focus** (start typing when no dialog or text field is focused).
4. **Press `Enter`**: The agent will start streaming reasoning steps, generating diffs, and running tools.

Press `⌘N` at any time to open a new session in the current project. Empty drafts are automatically cleaned up if left blank.

## Configure Model Providers

To configure AI model access:

- Open **Settings ▸ Models and providers**, click **Add provider** (presets for Anthropic, OpenAI, DeepSeek, Gemini, OpenRouter, Ollama, etc.), or use **OAuth login**.
- Click **Import / Export ▸ Import OMP providers** to migrate credentials from your CLI setup in one click.
- Type `/login` in the composer and press Enter to jump directly to the provider page.

> [!TIP]
> API keys are encrypted using the macOS Keychain master key (AES-256-GCM) and saved to `~/.omp-workspace/env/keys.env`. Plaintext keys reside only in memory during requests.

## Next Steps

- Explore advanced composer strategies and commands: [Sessions and chat](./02-sessions-and-chat.md)
- Work with parallel Git worktrees and the terminal: [Workspace: files, Git, and terminal](./03-workspace.md)
- Review keyboard shortcuts and troubleshoot issues: [Shortcuts and troubleshooting](./07-shortcuts-and-troubleshooting.md)
