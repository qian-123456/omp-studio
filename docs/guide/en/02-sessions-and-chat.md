# Sessions and Chat

> Manage the session lifecycle, master composer concurrency and slash commands, and use side chats, inline annotations, and Git checkpoints to stay in control.

In this chapter, you will learn how to:

- [Organize spaces and sessions](#spaces-and-sessions): spaces, grouping, states, search, and archiving
- [Start sessions in parallel worktrees](#start-new-sessions)
- [Use the smart composer](#the-smart-composer): sending strategies, attachments, `@` file references, and `/` commands
- [Create inline annotations from code and messages](#inline-annotations)
- [Run parallel side chats without context pollution](#side-chats)
- [Track tool execution and handle approval requests](#tool-execution-and-approvals)
- [Monitor context usage and compress on demand](#context-window-and-compression)
- [Share and export conversations](#sharing-and-export)

## Spaces and Sessions

### Spaces

The active space name is shown at the top of the left sidebar. Click to switch:

| Space | Focus and Purpose |
| --- | --- |
| **Code** | Coding projects, structured by Git worktrees and branches |
| **Work** | General business tasks, draft writing, and project tracking |
| **Study** | Research papers, learning notes, and tutorials |
| **Research** | Long-form deep research and analytical tasks |
| **Universal** | Ad-hoc chats unattached to any local project directory |

Each space keeps completely isolated projects and sessions. An active indicator appears next to spaces with ongoing agent tasks.

### Session Lifecycle and Status

| Status | Icon / Badge | Meaning and Actions |
| --- | --- | --- |
| **Running** | Spinning icon | The agent is actively generating or running tools |
| **Waiting** | Blue "Waiting" badge | Awaiting your approval for a tool or answer to a question |
| **Unreviewed** | Blue unread dot | Turn completed and awaiting your review; right-click to accept & archive |
| **Idle** | None | Waiting for new input |
| **Error** | Red solid dot | Stopped due to an error; right-click to run diagnostics |
| **Interrupted** | Orange warning badge | Process stopped unexpectedly; right-click "Resume" to continue |
| **Suspended** | Grey sleep badge | Suspended after being idle to save RAM; resumes instantly on input |
| **External** | Terminal icon | Running in CLI; right-click to "Take over session" |

### Session Navigation and Shortcuts

- **Search (`⌘F`)**: Search across session titles, branches, worktree paths, models, and recent reply snippets.
- **Keyboard Navigation**: In the list, press `↑` / `↓` to switch sessions, `←` / `→` to collapse or expand groups, `Delete` to archive, and `Shift+Delete` to permanently delete.

## Start New Sessions

- **Standard Project Session**: Click **New Session** or press `⌘N`. If left blank without sending, the draft is automatically discarded.
- **Parallel Worktree Session**: Click `+` on a project header and choose **Create in independent worktree**. Specify the base branch (e.g., `main`) and a folder name. A dedicated Git worktree is provisioned under `<project>/.worktrees/<name>`, allowing multiple agents to code in parallel without branch conflicts.
- **Draft project and branch controls**: The project and Git branch are visible above a new draft's composer. Displaying them does not start a background session; switching or creating a branch prepares the session needed for that operation. A draft's group label is display-only.

## The Smart Composer

### Type-to-focus & IME Safety
Start typing anywhere on your keyboard, and keystrokes automatically route directly to the composer without requiring a mouse click, provided no dialog or editor has focus. IME composition is strictly respected.
With the default Enter-to-send setting, Enter used to confirm an IME candidate does not send the message. Press Enter again after confirmation to send.

### Editing a sent message

Click edit below the message and wait while the conversation returns to that point. A loading indicator appears and input and sending are temporarily disabled. Once ready, edit and send from the composer; the previous answer remains available as another version.

### Concurrency and Dispatch Strategies
When the agent is already running a turn, you can configure how new messages are dispatched (configured in **Settings ▸ Sessions ▸ Sending method**):

1. **Steer (Default)**: Injects your message into the active turn immediately, steering the agent mid-flight.
2. **Queue**: Holds the message in a queue and sends it sequentially once the current turn completes.
3. **Interrupt**: Stops the active turn immediately and starts a new one with your message.

> [!TIP]
> Hold `⌥` when sending (e.g. `⌥Enter`) to invert the dispatch mode for that single message (e.g. switch Steer to Queue).

### Composer Add Menu & Modes
Click `+` in the composer:
- **Plan Mode (`/plan`)**: Requires the agent to produce a structured roadmap before executing changes. Enabling the mode does not open an empty panel; a newly completed plan opens the **Plan** panel for review and approval. Reopening a session with an existing plan does not force the panel open. The `/plan` command only enables plan mode and never turns it off; to disable it, click the plan tag (X) above the input or the Plan item in the `+` menu. Switching from the app is silent (no message appears in the thread). The plan command chip clears after submission.
- **Goal Mode (`/goal <desc>`)**: Keeps a persistent objective pinned above the composer throughout the session.
- **Sketchpad**: Vector drawing board for quick UI wireframes or architecture diagrams.
- **Attachments**: Drag and drop images, logs, or select Finder items.

### `@` Mentions & `/` Slash Commands
- Type `@` followed by filename characters to search and insert file references.
- Type `/` to open the command palette: `/model`, `/compact`, `/shake`, `/btw`, `/plan`, `/goal`, `/stats`, `/login`, etc.

## Inline Annotations

Highlight any text in messages, code blocks, diffs, or terminal output to display the floating toolbar:
- Write an annotation and press `Enter`. Choose **Main Chat** or **Side Chat** as the target.
- Annotations dock as structured chips above the composer, ensuring the agent receives precise line references.
- **Table selections**: Text selected across cells remains anchored to that table, even when a later paragraph contains the same words.

## Side Chats

Side chats act as disposable branches of the main conversation:
- Click `+` ▸ **New side chat** in the right panel, or type `/btw your question`.
- Fully inherits existing context without adding clutter to the main timeline.
- Supports nested side chats (up to 3 levels). Click **Hand back to parent session** to summarize findings and insert them into the main composer.
- **First message**: During session creation, text, quotations, and images keep the same position and appearance as after sending, with a creation indicator. Session actions such as resend and edit become available only after creation.
- **History**: Internal session records do not interrupt the connection between earlier questions and replies. They stay hidden from the conversation, and loading history never rewrites the original transcript.

## Tool Execution and Approvals

- **Step Cards**: Tool executions display as dynamic cards (Reading → Read, Writing → Saved). Multi-step sequences fold neatly.
- **Approvals**: Press `y` to approve for this turn only, or `n` to reject. Click "Always allow in this session" or "Permanently allow" for trusted tools.
- When reading history, opening, closing, or resizing a sidebar preserves the text near the viewport midpoint. Live-tail following continues to follow new output.
- Replies and request errors already committed to history do not repeat in the live area. Successful automatic retry or fallback recovery immediately folds its status into an expandable historical entry; new failures remain visible.
- When reopening a session, cached messages without timing metadata are retained conservatively, so a shared opening cannot discard the current unfinished response.
- **Git Checkpoints & One-Click Undo**: When enabled in **Settings ▸ Sessions ▸ Checkpoints**, Git snapshots are taken before each turn. If code is modified incorrectly, click **Undo this turn** to restore files instantly.

## Context Window and Compression

Click the context ring next to the composer to view token breakdown:
- View usage by System Prompt, Tool Specs, MCP, Skills, AGENTS rules, and Chat History.
- **Compress (`/compact`)**: Invokes a model to summarize past turns.
- **Shake (`/shake`)**: Drops large tool outputs instantly without incurring model token costs.

## Sharing and Export

From the top toolbar **Share & Export**:
- **Export Image**: Select message turns and export a polished PNG screenshot.
- **Encrypted Link**: Upload an end-to-end sanitized read-only link.
- **Markdown / HTML**: Copy raw Markdown or export a standalone HTML file.
- **Scan QR Code**: Connect your phone to view and reply on the local network.
