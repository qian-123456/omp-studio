# Workspace: Files, Git, and Terminal

> Browse repository files, view and edit Markdown documents, run parallel Git worktrees, inspect code diffs, and work in multi-tab terminals without leaving the app.

In this chapter, you will learn how to:

- [Use the right panel tab system](#the-right-panel-tab-system)
- [Explore and search workspace files](#file-explorer)
- [Preview, edit, and annotate documents](#document-views-and-split-editing)
- [Review Git diffs and commit changes](#git-diffs-and-commits)
- [Work with Git worktrees in parallel](#parallel-git-worktrees)
- [Use Time Machine to preview past revisions](#time-machine-snapshots)
- [Work in multi-tab persistent terminals](#integrated-terminals)

## The Right Panel Tab System

The right panel consolidates engineering tools into a flexible tab bar. Press `⌘J` to toggle.

Click `+` at the end of the tab bar to add tabs:
- **Explorer**: File tree with live search.
- **Git**: Diffs, staging, worktrees, branches, and commit history.
- **Terminal**: Interactive command line supporting multiple tabs.
- **File Preview**: Code viewer and Markdown renderer.
- **Side Chat**: Secondary conversation threads.
- **Services**: Active port scanner with orphan process cleanup.
- **Token Heatmap**: Context breakdown and session health check.

## File Explorer

Open the **Explorer** tab to inspect the workspace tree:
- **Quick Filter (`⌘F`)**: Filter files instantly by typing keywords.
- **Context Menu**: Right-click any file to **Show in Finder**, **Copy Relative Path**, or **Refresh**. Single-clicking any file opens the full document view in the center area.

## Document Views and Split Editing

The center area provides three viewing modes:
- **Preview**: Rendered Markdown with clickable links.
- **Split**: Source code editor (CodeMirror) on the left, live preview on the right.
- **Edit**: Dedicated code editor. Press `⌘S` to save to disk.

Highlighting text in preview or editor mode exposes an **Add Annotation** bar (`⌘Enter`) to send code snippets directly to the composer.

## Git Diffs and Commits

Under the **Git** tab, the **Changes** view lists all modified, added, deleted, and untracked files:
- **All Diffs**: Open a full-screen diff inspector supporting **Unified** and **Split** views.
- **Inline Diff Annotations**: Click the comment icon next to any changed line to annotate and instruct the agent on specific code diffs.
- **AI Commit Generation**: Click **Archive: commit all N files** to automatically generate a Conventional Commit message and commit locally.

## Parallel Git Worktrees

Git worktrees allow multiple agents to modify different branches in the same repository simultaneously without file collisions.

Under **Git ▸ Worktrees**:
1. Click **New parallel worktree** to check out a new branch into `.worktrees/<name>`.
2. Launch distinct agent sessions in separate worktrees to handle bugs and features concurrently.
3. Sync from `main` or merge branches with automated conflict pre-checks. If a conflict occurs, launch an AI session to resolve conflicts automatically.
4. Set delivery mode in **Settings ▸ General ▸ Git ▸ Delivery mode**: Create a Pull Request or Merge & Push directly.
5. Clean up idle worktrees in one click.

## Time Machine Snapshots

Under **Git ▸ History**:
1. **Inspect Diffs**: View changes introduced in any past commit.
2. **Snapshot Sandbox Preview**: Run historical revisions in an isolated sandbox (`.worktrees/tm-xxxx`) with custom commands (e.g., `pnpm dev --port 5180`) without altering your active worktree.
3. **Safe Rollback**: Revert commits while keeping subsequent changes as uncommitted working tree modifications.

## Integrated Terminals

Press `` ⌘` `` to toggle the built-in terminal:
- Supports up to 10 persistent shell tabs.
- Highlight any error log or terminal text and click **Quote** (`⌘⇧A`) to send it to the composer, or click **Send to side chat**.
- Fold long-running terminals into the background **Services** panel to free up UI space.
- Running `omp` directly in this terminal automatically detects and attaches to the active session.
