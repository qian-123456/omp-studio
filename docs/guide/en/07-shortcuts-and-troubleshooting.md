# Shortcuts & Troubleshooting

> Keyboard shortcut cheat sheet, troubleshooting tips for common issues, and a reference for local data storage locations.

In this chapter, you will learn how to:

- [Look up all keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshoot common issues](#troubleshooting)
- [Understand the local data directory structure](#data-locations)

## Keyboard Shortcuts

> Note: `⌘` refers to Command on macOS; use `Ctrl` on Windows and Linux.

### 1. Global Shortcuts

| Shortcut | Description | Context |
| --- | --- | --- |
| `⌘B` | Toggle left sidebar | Global |
| `⌘J` | Toggle right utility panel | Global (except full-page views) |
| `⌘N` | New session | Global |
| `⌘F` | Focus search (sessions or settings) | Global (except code editors) |
| `⌘,` | Open / close Settings | Global |
| `⌘[` | Back / return to previous view | Global |
| `` ⌘` `` | Toggle built-in terminal | Global |
| `⌘W` | Smart close: top overlay → active tab → hide window | Global |
| `⌘+` / `⌘-` / `⌘0` | Zoom in / out / reset zoom (80%–140%) | Global |
| `Esc` | Dismiss popover / stop running turn / return | Global |
| `⌘⇧I` | Global Idea/Bug capture popover | System-wide (from any desktop app) |

### 2. Composer Shortcuts

| Shortcut | Description |
| --- | --- |
| **Any character** | **Type-to-focus**: Automatically routes typing to the composer |
| `Enter` | Send message (default) |
| `Shift+Enter` | Insert newline (default) |
| `⌘Enter` | Send message (when configured in **Settings ▸ Sessions**) |
| `⌥Enter` | Invert dispatch strategy (e.g. Steer ↔ Queue) |
| `↑` / `↓` | Cycle through prompt history |
| `@` | Trigger file reference menu |
| `/` | Trigger slash command palette |

### 3. Approvals and Questions

| Shortcut | Description |
| --- | --- |
| `y` | Approve tool call for this turn only |
| `n` | Reject tool call |
| `1`–`9` | Select question option by number |
| `←` / `→` | Navigate between multiple questions |
| `Enter` | Submit selected answer |

## Troubleshooting

### 1. "omp not found" or session fails to start
- Verify `omp` runs in your shell (`which omp`).
- Set the absolute executable path under **Settings ▸ Advanced ▸ omp program path**.
- Check **Settings ▸ Version and updates** to confirm detection.

### 2. Terminal sessions do not appear in the sidebar
- Open **Settings ▸ Advanced ▸ External terminal integration** and click **Install extension**.
- Sessions run directly in your terminal will now appear in the sidebar with an **External** badge. Right-click to take over.

### 3. Session status shows "Interrupted"
- Occurs when the background process exits unexpectedly.
- Right-click the session and choose **Resume session**, or click **Resume interrupted turn** in the chat view.

### 4. Keystrokes do not route to the composer
- Type-to-focus intentionally yields focus when another input field, code editor, modal dialog, or terminal has focus.
- Press `Esc` or click the chat background, then start typing again.

### 5. Window turns blank in development mode (`pnpm tauri dev`)
- Run `touch index.html` in the repository root to force Vite to trigger a clean full reload.

### 6. "Cannot read master key" error
- Ensure `~/.omp-workspace/env/.master.key` exists and has `600` permissions.

## Data Locations

All local workspace data is transparently stored under:

| Path | Contents |
| --- | --- |
| `~/.omp-workspace/app.db` | Local SQLite database (metadata, backlog, schedules, settings) |
| `~/.omp-workspace/env/keys.env` | Keychain-encrypted API key ciphertext |
| `~/.omp-workspace/env/.master.key` | Local master key file |
| `~/.omp-workspace/global/` | Working directory for Universal space sessions |
| `~/.omp-workspace/images/` | Cached session images (cleaned automatically after 30 days) |
| `~/.omp-workspace/privacy/` | Local privacy library definitions |
| `~/.omp/agent/sessions/` | Native OMP session records |
| `~/.omp/agent/agents/` | Custom sub-agent markdown definitions |
| `<project>/.worktrees/` | Independent Git worktree directories |

> [!TIP]
> Use **Settings ▸ Advanced ▸ Data & backup ▸ Export settings** to back up and migrate your preferences to a new machine.
