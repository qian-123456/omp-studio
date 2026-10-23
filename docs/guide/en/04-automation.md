# Task Automation: Schedules, Inbox & Backlog

> Schedule automated routine tasks, triage items requiring human intervention in a centralized Inbox, and capture spontaneous ideas and bugs into a global backlog.

In this chapter, you will learn how to:

- [Create and manage recurring schedules](#recurring-schedules)
- [Triage items in the smart Inbox](#the-smart-inbox)
- [Capture ideas and bugs into the backlog](#the-ideas-backlog)
- [Overview of skills and extensions](#skills-and-extensions-overview)

## Recurring Schedules

Schedules automatically dispatch prompts to agents on preset time intervals (e.g., daily morning commit summaries, weekly dependency security audits, or periodic dead-code scanning).

Click **Schedules** in the left sidebar to manage tasks.

### Quick Start with Templates
- **Morning Standup Prep**: Summarize previous day commits and flag priorities every weekday at 09:00.
- **Dependency Audit**: Scan for updates and known CVEs every weekday at 10:00.
- **Friday Cleanup**: Triage open TODOs and unfinished items every Friday at 17:00.

### Configuration Guide
Click **New schedule**:
- **Cadence**: Hourly, daily, weekdays, weekly, monthly, custom intervals, or one-time runs.
- **Prompt**: Instructions for the agent, with image attachment support.
- **Approval Mode**: Full Access (unattended), Write Approval Required, or Ask Every Time.
- **Git Worktree Isolation**: Under Advanced Options, run schedules in an independent Git worktree to prevent background runs from touching active code branches.

## The Smart Inbox

The Inbox aggregates all items needing human intervention. Click the bell icon in the sidebar header to open.

### Automatic Triage Categories
- **Approvals**: Agent requests permission for risky tools (file modifications, shell commands).
- **Questions**: Agent asks for user clarification or design decisions.
- **Errors**: Sessions encountering unhandled exceptions or connection errors.
- **Interrupted**: Sessions halted unexpectedly, ready to resume.
- **Unread**: Sessions completed and waiting for your review.

### Keyboard-First Processing
- Press `j` / `k` (or `↓` / `↑`) to cycle through entries, then press `Enter` to open the session.
- Click **Mark all as read** to dismiss completed notifications. Non-blocking items auto-expire after an idle window configured in **Settings ▸ Sessions ▸ Inbox**.

## The Ideas Backlog

Click the lightbulb icon in the center header to open the backlog.

- **Dual Classification**: Tag items as **Idea** or **Bug**.
- **Context Attachment**: Link the current session context and attach screenshots directly.
- **Global Shortcut**: Press the system-wide shortcut (default `⌘⇧I`) from any app to pop up the capture box. Press `⌘Enter` to submit.
- **Dispatch to Agent**: Select items and click **Dispatch** to append them to an existing session or start a new session.

## Skills and Extensions Overview

Click **Skills** in the left sidebar to view native agent capabilities discovered in `~/.omp/agent/skills/` and local `.omp/skills/`:
- Track trigger counts and health status (flagging missing descriptions or truncated prompts).
- Click **Use in current session** to inject the skill command into the composer.

> For advanced agent definitions, model roles, and system prompt tuning, see [Settings: Models & Agent Capabilities](./05-settings-and-models.md).
