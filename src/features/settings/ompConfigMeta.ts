/** [D] Curated OMP settings metadata (label / group / description / enum values /
 * dropdown options) extracted from the installed omp binary's embedded settings schema
 * (the same data omp's /settings TUI uses). Regenerate after an omp upgrade by
 * re-extracting `label:` entries from the binary (strings ~/.local/bin/omp — entries
 * shaped `"key.path": { type, default, ui: { tab, group, label, description, options } }`).
 * `values` is the strict candidate list for enum fields; `options` carries the
 * per-choice label/description pairs (rendered as a dropdown in the settings UI).
 * Keys missing here (settings without UI metadata) fall back to a derived title.
 */

export interface OmpConfigOption {
	value: string;
	label?: string;
	description?: string;
}

export interface OmpConfigMeta {
	label?: string;
	group?: string;
	description?: string;
	type?: string;
	/** Strictly allowed values (enum fields); rendering falls back to options. */
	values?: string[];
	/** Dropdown choices with readable labels (all enum options; number presets). */
	options?: OmpConfigOption[];
}

export const OMP_CONFIG_META: Record<string, OmpConfigMeta> = {
	"advisor.enabled": {
		label: "Enable Advisor",
		group: "Advisor",
		description: "Pair a second model (assigned to the 'advisor' role) that passively reviews each turn and injects notes.",
		type: "boolean"
	},
	"advisor.immuneTurns": {
		label: "Advisor Immune Turns",
		group: "Advisor",
		description: "After an advisor concern or blocker interrupts, route further concerns/blockers non-interruptingly for this many primary turns.",
		type: "number",
		options: [{ value: "0", label: "0 turns", description: "Allow every concern/blocker to interrupt." }, { value: "1", label: "1 turn" }, { value: "2", label: "2 turns" }, { value: "3", label: "3 turns", description: "Default." }, { value: "4", label: "4 turns" }, { value: "5", label: "5 turns" }]
	},
	"advisor.maxNotesPerUpdate": {
		label: "Advisor Max Notes Per Update",
		group: "Advisor",
		description: "Maximum non-blocker advice notes accepted per advisor prompt update (1\\u201332; UI offers 1\\u20135 quick picks). Blockers are exempt.",
		type: "number",
		options: [{ value: "1", label: "1 note", description: "Anti-flood (strict)." }, { value: "2", label: "2 notes" }, { value: "3", label: "3 notes" }, { value: "4", label: "4 notes", description: "Default." }, { value: "5", label: "5 notes" }]
	},
	"advisor.syncBacklog": {
		label: "Advisor Sync Backlog",
		group: "Advisor",
		description: "Pause the main agent for up to 30 seconds if the advisor falls behind by this many turns. Off disables catch-up delays.",
		type: "enum",
		values: ["off", "1", "3", "5"]
	},
	"ask.enabled": {
		label: "Ask",
		group: "Available Tools",
		description: "Enable the ask tool for interactive user questions",
		type: "boolean"
	},
	"ask.notify": {
		label: "Ask Notification",
		group: "Notifications",
		description: "Notify when the ask tool is waiting for input",
		type: "enum",
		values: ["on", "off"]
	},
	"ask.timeout": {
		label: "Ask Timeout",
		group: "Notifications",
		description: "Auto-select the recommended ask option after this many seconds (0 disables)",
		type: "number",
		options: [{ value: "0", label: "Disabled" }, { value: "15", label: "15 seconds" }, { value: "30", label: "30 seconds" }, { value: "60", label: "60 seconds" }, { value: "120", label: "120 seconds" }]
	},
	"astEdit.enabled": {
		label: "AST Edit",
		group: "Available Tools",
		description: "Enable the ast_edit tool for structural AST rewrites",
		type: "boolean"
	},
	"astGrep.enabled": {
		label: "AST Grep",
		group: "Available Tools",
		description: "Enable the ast_grep tool for structural AST search",
		type: "boolean"
	},
	"async.enabled": {
		label: "Async Execution",
		group: "Execution",
		description: "Enable async bash commands and background task execution",
		type: "boolean"
	},
	"autoResume": {
		label: "Auto Resume",
		group: "Startup & Updates",
		description: "Automatically resume the most recent session in the current directory",
		type: "boolean"
	},
	"autocompleteMaxVisible": {
		label: "Autocomplete Items",
		group: "Input",
		description: "Max visible items in autocomplete dropdown (3-20)",
		type: "number",
		options: [{ value: "3", label: "3 items" }, { value: "5", label: "5 items" }, { value: "7", label: "7 items" }, { value: "10", label: "10 items" }, { value: "15", label: "15 items" }, { value: "20", label: "20 items" }]
	},
	"autolearn.autoContinue": {
		label: "Auto-run capture at stop",
		group: "Auto-Learn",
		description: "When on, auto-run one private capture turn at stop (uses extra tokens). When off, only standing auto-learn guidance remains.",
		type: "boolean"
	},
	"autolearn.enabled": {
		label: "Auto-Learn (experimental)",
		group: "Auto-Learn",
		description: "After the agent stops, nudge it to capture lessons to memory and create/enhance isolated managed skills",
		type: "boolean"
	},
	"bash.allowCompoundCommands": {
		label: "Allow Compound Commands",
		group: "Bash",
		description: "Evaluate literal && chains per command; unmatched commands use normal bash approval policy and mode",
		type: "boolean"
	},
	"bash.autoBackground.enabled": {
		label: "Bash Auto-Background",
		group: "Bash",
		description: "Automatically background long-running bash commands and deliver the result later",
		type: "boolean"
	},
	"bash.direnv": {
		label: "direnv Auto-Load",
		group: "Bash",
		description: "Auto-load a repo's direnv/devenv `.envrc` into the bash session so devenv tools and env vars are present without manual `direnv exec`. Honors direnv's allow list: an `.envrc` you haven't `direnv allow`ed is never executed",
		type: "enum",
		values: ["auto", "off"]
	},
	"bash.direnvLoadTimeoutMs": {
		label: "direnv Load Timeout (ms)",
		group: "Bash",
		description: "Max wait for the first `direnv export` (a cold devenv shell can be slow); on timeout the session runs without the direnv env",
		type: "number"
	},
	"bash.enabled": {
		label: "Bash",
		group: "Bash",
		description: "Enable the bash tool for shell command execution",
		type: "boolean"
	},
	"bash.patterns": {
		label: "Bash Approval Patterns",
		group: "Bash",
		description: "Ordered bash command approval rules. Each item has match and approval fields; only '*' wildcards are supported.",
		type: "array"
	},
	"bashInterceptor.enabled": {
		label: "Bash Interceptor",
		group: "Bash",
		description: "Block shell commands that have dedicated tools",
		type: "boolean"
	},
	"branchSummary.enabled": {
		label: "Branch Summaries",
		group: "General",
		description: "Prompt to summarize when leaving a branch",
		type: "boolean"
	},
	"browser.cdpUrl": {
		label: "Browser CDP URL",
		group: "Grep & Browser",
		description: "Default HTTP CDP discovery endpoint (for example http://127.0.0.1:9222) to attach to instead of launching a browser. Explicit app.cdp_url or app.path on the tool call take precedence.",
		type: "string"
	},
	"browser.cmux": {
		label: "cmux Browser",
		group: "Grep & Browser",
		description: "Use cmux WKWebView surfaces for browser automation when a cmux socket is available. Set PI_BROWSER_CMUX=0 or PI_BROWSER_CMUX=1 to override.",
		type: "boolean"
	},
	"browser.enabled": {
		label: "Browser",
		group: "Available Tools",
		description: "Enable the browser eval prelude for scripted Chromium automation (Puppeteer)",
		type: "boolean"
	},
	"browser.freezeOnTurnEnd": {
		label: "Freeze Browser Tabs On Turn End",
		group: "Grep & Browser",
		description: "Freeze OMP-owned headless browser tabs when a turn settles so animated pages stop burning CPU/GPU while idle. Tabs unfreeze automatically on next use; pass persist:true on open to opt a tab out.",
		type: "boolean"
	},
	"browser.headless": {
		label: "Headless Browser",
		group: "Grep & Browser",
		description: "Launch browser in headless mode (disable to show browser UI)",
		type: "boolean"
	},
	"browser.idleCloseSec": {
		label: "Browser Idle Close Timeout",
		group: "Grep & Browser",
		description: "Close OMP-owned headless browser tabs idle longer than this many seconds (0 = never; session dispose still reaps). Applies only to OMP-launched headless tabs, never relay/CDP/spawned browsers or other sessions' tabs.",
		type: "number",
		options: [{ value: "0", label: "Never" }, { value: "900", label: "15 minutes" }, { value: "1800", label: "30 minutes" }, { value: "3600", label: "1 hour" }]
	},
	"browser.relay": {
		label: "Browser Relay",
		group: "Grep & Browser",
		description: "Drive your own Chrome tabs through the omp browser relay. Install the extension once (`omp browser-relay install`); the relay server auto-starts when the browser prelude needs it. Takes precedence over Browser CDP URL; set PI_BROWSER_RELAY=0 or PI_BROWSER_RELAY=1 to override.",
		type: "boolean"
	},
	"browser.relayUrl": {
		label: "Browser Relay URL",
		group: "Grep & Browser",
		description: "omp browser relay endpoint (default http://127.0.0.1:9224).",
		type: "string"
	},
	"browser.screenshotDir": {
		label: "Screenshot Directory",
		group: "Grep & Browser",
		description: "Directory to save screenshots. If unset, screenshots go to a temp file. Supports ~. Examples: ~/Downloads, ~/Desktop, /sdcard/Download (Android)",
		type: "string"
	},
	"checkpoint.enabled": {
		label: "Checkpoint/Rewind",
		group: "Available Tools",
		description: "Enable the checkpoint and rewind tools for context checkpointing",
		type: "boolean"
	},
	"codexResets.autoRedeem": {
		label: "Codex Auto-Redeem Saved Resets",
		group: "Services",
		description: "Spend saved Codex rate-limit resets automatically: restore an account blocked by an exhausted 5h or weekly window when a turn is stuck and no other account can take over, and salvage credits that are about to expire. unset asks before the first spend, yes spends without prompting, and no disables both checks.",
		type: "enum",
		values: ["unset", "yes", "no"],
		options: [{ value: "unset", label: "Unset", description: "Check eligibility, then ask before spending the first saved reset." }, { value: "yes", label: "Yes", description: "Spend eligible saved resets without prompting." }, { value: "no", label: "No", description: "Do not run the saved-reset auto-redeem check." }]
	},
	"codexResets.keepCredits": {
		label: "Codex Auto-Redeem Reserve",
		group: "Services",
		description: "Never auto-spend below this many saved resets (0 = the last credit may be spent automatically). Credits about to expire are exempt \\u2014 a reserved credit that expires preserves nothing.",
		type: "number"
	},
	"codexResets.minBlockedMinutes": {
		label: "Codex Auto-Redeem Min Block",
		group: "Services",
		description: "Only auto-redeem when the natural unblock \\u2014 the latest reset among the exhausted 5h/weekly windows \\u2014 is at least this many minutes away (don't spend a scarce credit to save a short wait). Raise it (e.g. 360) to ignore 5h-only blocks.",
		type: "number"
	},
	"codexResets.salvageHorizonHours": {
		label: "Codex Reset Salvage Horizon",
		group: "Services",
		description: "Spend a saved Codex reset automatically when it would otherwise expire within this many hours and either chat window (5h or weekly) has meaningful usage to restore (0 disables expiry salvage).",
		type: "number"
	},
	"collab.autoStart": {
		label: "Auto Start",
		group: "Collab",
		description: "Host every interactive session via collab.relayUrl as it starts and publish it to the local registry (omp collab list); rooms rotate on session switch",
		type: "enum",
		values: ["off", "view", "control"],
		options: [{ value: "off", label: "Off", description: "Share only when /collab is run" }, { value: "view", label: "View", description: "Auto-host; the registry hands out view-only links (omp collab link --view)" }, { value: "control", label: "Control", description: "Auto-host; the registry hands out control links that can prompt the session" }]
	},
	"collab.displayName": {
		label: "Display Name",
		group: "Collab",
		description: "Name shown to other collab participants (default: OS username)",
		type: "string"
	},
	"collab.relayUrl": {
		label: "Relay URL",
		group: "Collab",
		description: "Relay used by /collab (wss://host[:port])",
		type: "string"
	},
	"collab.webUrl": {
		label: "Web UI URL",
		group: "Collab",
		description: "Browser UI used by /collab links; empty derives from collab.relayUrl; explicit http:// is localhost-only",
		type: "string"
	},
	"colorBlindMode": {
		label: "Color-Blind Mode",
		group: "Theme",
		description: "Use blue instead of green for diff additions",
		type: "boolean"
	},
	"commands.enableClaudeProject": {
		label: "Claude Project Commands",
		group: "Commands & Skills",
		description: "Load commands from .claude/commands/",
		type: "boolean"
	},
	"commands.enableClaudeUser": {
		label: "Claude User Commands",
		group: "Commands & Skills",
		description: "Load commands from ~/.claude/commands/",
		type: "boolean"
	},
	"commands.enableOpencodeProject": {
		label: "OpenCode Project Commands",
		group: "Commands & Skills",
		description: "Load commands from .opencode/commands/",
		type: "boolean"
	},
	"commands.enableOpencodeUser": {
		label: "OpenCode User Commands",
		group: "Commands & Skills",
		description: "Load commands from ~/.config/opencode/commands/",
		type: "boolean"
	},
	"compaction.asyncEnabled": {
		label: "Async Compaction",
		group: "Compaction",
		description: "Speculatively summarize in the background as context nears the compaction threshold, then splice the ready result in when the threshold is crossed",
		type: "boolean"
	},
	"compaction.dropUseless": {
		label: "Elide Uneventful Results",
		group: "Compaction",
		description: "Prune tool results flagged contextually useless (no matches, timed-out waits) once consumed (cache-aware)",
		type: "boolean"
	},
	"compaction.enabled": {
		label: "Auto-Compact",
		group: "Compaction",
		description: "Automatically compact context when it gets too large",
		type: "boolean"
	},
	"compaction.experimentalContextManagement": {
		label: "Notes-backed context windows (experimental)",
		group: "Compaction",
		description: "Keep persistent notes and searchable raw history across context windows. Restart to update available tools.",
		type: "boolean"
	},
	"compaction.handoffSaveToDisk": {
		label: "Save Handoff Docs",
		group: "Compaction",
		description: "Save generated handoff documents to markdown files for the auto-handoff flow",
		type: "boolean"
	},
	"compaction.idleEnabled": {
		label: "Idle Compaction",
		group: "Compaction",
		description: "Compact context while idle when token count exceeds threshold",
		type: "boolean"
	},
	"compaction.idleThresholdTokens": {
		label: "Idle Compaction Threshold",
		group: "Compaction",
		description: "Token count above which idle compaction triggers",
		type: "number",
		options: [{ value: "100000", label: "100K tokens" }, { value: "200000", label: "200K tokens" }, { value: "300000", label: "300K tokens" }, { value: "400000", label: "400K tokens" }, { value: "500000", label: "500K tokens" }, { value: "600000", label: "600K tokens" }, { value: "700000", label: "700K tokens" }, { value: "800000", label: "800K tokens" }, { value: "900000", label: "900K tokens" }]
	},
	"compaction.idleTimeoutSeconds": {
		label: "Idle Compaction Delay",
		group: "Compaction",
		description: "Seconds to wait while idle before compacting",
		type: "number",
		options: [{ value: "60", label: "1 minute" }, { value: "120", label: "2 minutes" }, { value: "300", label: "5 minutes" }, { value: "600", label: "10 minutes" }, { value: "1800", label: "30 minutes" }, { value: "3600", label: "1 hour" }]
	},
	"compaction.methodOrder": {
		label: "Compaction Method Order",
		group: "Compaction",
		description: "Preferred fallback order for automatic context maintenance; unavailable or failed methods advance to the next choice",
		type: "array",
		options: [{ value: "remote", label: "Server compaction", description: "Use provider-native server compaction (OpenAI Responses compact, Anthropic compaction beta) when the active route supports it" }, { value: "snapcompact", label: "Snapcompact", description: "Archive history onto dense bitmap images the active vision model reads back; no LLM call" }, { value: "handoff", label: "Handoff", description: "Generate a handoff document and continue from it as the compaction summary" }, { value: "soft", label: "Soft compaction", description: "Summarize in place with a compaction model without using server compaction" }, { value: "shake", label: "Shake", description: "Drop recoverable heavy content in place without an LLM call" }]
	},
	"compaction.midTurnEnabled": {
		label: "Mid-Turn Compaction",
		group: "Compaction",
		description: "Check thresholds at safe mid-turn tool-loop boundaries before the next provider request",
		type: "boolean"
	},
	"compaction.remoteStreamingV2Enabled": {
		label: "Remote Compaction V2",
		group: "Compaction",
		description: "Use Responses streaming compaction for compatible remote compaction models",
		type: "boolean"
	},
	"compaction.supersedeReads": {
		label: "Supersede Stale Reads",
		group: "Compaction",
		description: "Prune older read results when the same file is read again (cache-aware, runs every turn)",
		type: "boolean"
	},
	"compaction.thresholdPercent": {
		label: "Compaction Threshold",
		group: "Compaction",
		description: "Percent threshold for context maintenance; set to Default to use legacy reserve-based behavior",
		type: "number",
		options: [{ value: "default", label: "Default", description: "Legacy reserve-based threshold" }, { value: "10", label: "10%", description: "Extremely early maintenance" }, { value: "20", label: "20%", description: "Very early maintenance" }, { value: "30", label: "30%", description: "Early maintenance" }, { value: "40", label: "40%", description: "Moderately early maintenance" }, { value: "50", label: "50%", description: "Halfway point" }, { value: "60", label: "60%", description: "Moderate context usage" }, { value: "70", label: "70%", description: "Balanced" }, { value: "75", label: "75%", description: "Slightly aggressive" }, { value: "80", label: "80%", description: "Typical threshold" }, { value: "85", label: "85%", description: "Aggressive context usage" }, { value: "90", label: "90%", description: "Very aggressive" }, { value: "95", label: "95%", description: "Near context limit" }]
	},
	"compaction.thresholdTokens": {
		label: "Compaction Token Limit",
		group: "Compaction",
		description: "Fixed token limit for context maintenance; overrides percentage if set",
		type: "number",
		options: [{ value: "default", label: "Default", description: "Use percentage-based threshold" }, { value: "25000", label: "25K tokens", description: "1/8 of a 200K window" }, { value: "50000", label: "50K tokens", description: "1/4 of a 200K window" }, { value: "100000", label: "100K tokens", description: "1/2 of a 200K window" }, { value: "150000", label: "150K tokens", description: "3/4 of a 200K window" }, { value: "200000", label: "200K tokens", description: "Full standard context window" }, { value: "300000", label: "300K tokens", description: "Large context window" }, { value: "500000", label: "500K tokens", description: "Very large context window" }]
	},
	"completion.notify": {
		label: "Completion Notification",
		group: "Notifications",
		description: "Notify when the agent finishes a turn",
		type: "enum",
		values: ["on", "off"]
	},
	"composer.recallClearedDrafts": {
		label: "Recall Cleared Drafts",
		group: "Input",
		description: "Keep drafts cleared with Ctrl+C in local Up/Down history until exit; disabling affects future clears",
		type: "boolean"
	},
	"composer.shape": {
		label: "Composer Shape",
		group: "Composer",
		description: "Visual layout of the input editor and status line",
		type: "string"
	},
	"composer.tokenRate": {
		label: "Generation Rate",
		group: "Composer",
		description: "Show a live generation tok/s readout on the working row, docked right next to the session title. Estimated from streamed deltas and corrected by the provider's billed output count as each message completes.",
		type: "boolean"
	},
	"computer.display": {
		label: "Computer Display",
		group: "Computer",
		type: "string",
		values: ["all"],
		options: [{ value: "all", label: "All Displays", description: "Composite all displays into one screenshot" }]
	},
	"computer.enabled": {
		label: "Computer",
		group: "Available Tools",
		description: "Enable the scriptable host-desktop eval prelude (screenshots, input, accessibility)",
		type: "boolean"
	},
	"computer.maxHeight": {
		label: "Computer Screenshot Height",
		group: "Computer",
		description: "Maximum composite screenshot height in pixels",
		type: "number"
	},
	"computer.maxWidth": {
		label: "Computer Screenshot Width",
		group: "Computer",
		description: "Maximum composite screenshot width in pixels",
		type: "number"
	},
	"contextPromotion.enabled": {
		label: "Auto-Promote Context",
		group: "General",
		description: "Promote to a larger-context model on context overflow instead of compacting",
		type: "boolean"
	},
	"debug.enabled": {
		label: "Debug",
		group: "Available Tools",
		description: "Enable the debug tool for DAP-based debugging",
		type: "boolean"
	},
	"defaultThinkingLevel": {
		label: "Thinking Level",
		group: "Thinking",
		description: "Reasoning depth for thinking-capable models",
		type: "enum"
	},
	"dev.autoqa": {
		label: "Auto QA",
		group: "Developer",
		description: "Automated tool issue reporting (xd://report_issue). On by default; the first report asks for consent, and denying it disables reporting until re-enabled explicitly",
		type: "boolean"
	},
	"dev.autoqaConsent": {
		type: "enum",
		values: ["unset", "granted", "denied"]
	},
	"dev.autoqaPush.endpoint": {
		label: "Auto QA Push Endpoint",
		group: "Developer",
		description: "Full URL receiving Auto QA JSON reports (default https://qa.omp.sh/v1/grievances)",
		type: "string"
	},
	"display.cacheMissMarker": {
		label: "Cache Miss Marker",
		group: "Display",
		description: "Show a divider after an assistant turn whose request lost (missed) the prompt cache",
		type: "boolean"
	},
	"display.collapseCompacted": {
		label: "Collapse Compacted History",
		group: "Display",
		description: "Collapse pre-compaction history behind the summary divider on the live transcript; disable to keep the full transcript inline with dividers at each compaction point",
		type: "boolean"
	},
	"display.hideToolActivity": {
		label: "Hide Tool Activity",
		group: "Display",
		description: "Hide model-initiated tool calls and results from the transcript",
		type: "boolean"
	},
	"display.pinnedAgents": {
		label: "Pinned Agents",
		group: "Display",
		description: "Pinned live-agent jump list above the editor (off hides it; collapsed shows a few rows with an expander; full lists all)",
		type: "enum",
		values: ["off", "collapsed", "full"],
		options: [{ value: "off", label: "Off", description: "Hide the pinned jump list" }, { value: "collapsed", label: "Collapsed", description: "Show a few rows with an expander" }, { value: "full", label: "Full", description: "Always list every live agent" }]
	},
	"display.shimmer": {
		label: "Shimmer",
		group: "Display",
		description: "Animation style for working/loading messages",
		type: "enum",
		values: ["classic", "kitt", "disabled"],
		options: [{ value: "classic", label: "Classic", description: "Soft cosine wave sweeping across the text" }, { value: "kitt", label: "KITT Scanner", description: "Knight Rider 1982 red light bouncing left-right" }, { value: "disabled", label: "Disabled", description: "No animation; static muted text" }]
	},
	"display.showTokenUsage": {
		label: "Show Token Usage",
		group: "Display",
		description: "Show per-turn token usage on assistant messages",
		type: "boolean"
	},
	"display.showTurnTime": {
		label: "Show Turn Time",
		group: "Display",
		description: "Show the total prompt-to-yield time (including tool calls) on assistant message usage rows",
		type: "boolean"
	},
	"display.smoothStreaming": {
		label: "Smooth Streaming",
		group: "Display",
		description: "Reveal assistant text and streamed tool input smoothly while chunks arrive",
		type: "boolean"
	},
	"doubleEscapeAction": {
		label: "Double-Escape Action",
		group: "Input",
		description: "What pressing Escape twice with an empty editor does: open the transcript rewind selector, open the session tree, or nothing",
		type: "enum",
		values: ["rewind", "tree", "none"]
	},
	"edit.autoRepair.enabled": {
		label: "Auto-Repair Parse Regressions",
		group: "Editing",
		description: "When an edit breaks a file's AST parse, ask the smol model to fix the broken region (validated by re-parse; falls back to a warning)",
		type: "boolean"
	},
	"edit.blackbox.enabled": {
		label: "Record Parse Regressions",
		group: "Editing",
		description: "Append full before/after source when an edit introduces an AST parse failure",
		type: "boolean"
	},
	"edit.blockAutoGenerated": {
		label: "Block Auto-Generated Files",
		group: "Editing",
		description: "Prevent editing of files that appear to be auto-generated (protoc, sqlc, swagger, etc.)",
		type: "boolean"
	},
	"edit.enforceSeenLines": {
		label: "Enforce Seen-Line Guard",
		group: "Editing",
		description: "Reject edits anchored on lines a prior read/search never displayed in full",
		type: "boolean"
	},
	"edit.fuzzyMatch": {
		label: "Fuzzy Match",
		group: "Editing",
		description: "Accept high-confidence fuzzy matches for whitespace differences",
		type: "boolean"
	},
	"edit.fuzzyThreshold": {
		label: "Fuzzy Match Threshold",
		group: "Editing",
		description: "Similarity threshold (0-1) for accepting fuzzy matches",
		type: "number",
		options: [{ value: "0.85", label: "0.85", description: "Lenient" }, { value: "0.90", label: "0.90", description: "Moderate" }, { value: "0.95", label: "0.95", description: "Default" }, { value: "0.98", label: "0.98", description: "Strict" }]
	},
	"edit.mode": {
		label: "Edit Mode",
		group: "Editing",
		description: "Select the edit tool variant (replace, patch, hashline, or apply_patch)",
		type: "enum",
		values: ["apply_patch", "hashline", "patch", "replace", "sloppy"]
	},
	"edit.recoverInlineEdits": {
		label: "Recover Inline Edit Payloads",
		group: "Editing",
		description: "Execute edit payloads the model emits as plain text by converting them into edit tool calls",
		type: "boolean"
	},
	"edit.streamingAbort": {
		label: "Abort on Failed Preview",
		group: "Editing",
		description: "Abort streaming edit tool calls when patch preview fails",
		type: "boolean"
	},
	"emojiAutocomplete": {
		label: "Emoji Autocomplete",
		group: "Input",
		description: "Suggest emojis from `:name:` shortcodes and expand text emoticons like `:D` or `:-)`",
		type: "boolean"
	},
	"error.notify": {
		label: "Error Notification",
		group: "Notifications",
		description: "Notify when the agent stops with an error",
		type: "enum",
		values: ["on", "off"]
	},
	"eval.autoBackground.enabled": {
		label: "Eval Auto-Background",
		group: "Eval & Runtimes",
		description: "Automatically background long-running eval cells and deliver the result later",
		type: "boolean"
	},
	"eval.js": {
		label: "JavaScript Eval Backend",
		group: "Eval & Runtimes",
		description: "Allow the eval tool to dispatch JavaScript cells to the in-process runtime",
		type: "boolean"
	},
	"eval.py": {
		label: "Python Eval Backend",
		group: "Eval & Runtimes",
		description: "Allow the eval tool to dispatch Python cells to the IPython kernel",
		type: "boolean"
	},
	"eval.tools.enabled": {
		label: "Eval-Defined Tools",
		group: "Eval & Runtimes",
		description: "Let eval cells define tools (@tool in Python, tool(fn) in JS) that task, agent(), and workpool() subagents can call",
		type: "boolean"
	},
	"eval.workpool.freshAgents": {
		label: "Fresh Workpool Agents",
		group: "Eval & Runtimes",
		description: "Spawn a new subagent for every workpool item instead of reusing workers or batching queued items",
		type: "boolean"
	},
	"exa.enabled": {
		label: "Exa",
		group: "Services",
		description: "Enable the Exa web search provider",
		type: "boolean"
	},
	"exa.searchDelayMs": {
		label: "Exa Search Delay",
		group: "Services",
		description: "Minimum delay between Exa web search requests in milliseconds; set 0 to disable pacing",
		type: "number"
	},
	"extendedContext": {
		label: "Extended Context",
		group: "General",
		description: "Use larger context windows where supported; may incur premium pricing. Off keeps default or standard-pricing windows",
		type: "boolean"
	},
	"extensionHandlers.toolCallTimeoutMs": {
		label: "Tool Call Handler Timeout (ms)",
		group: "Extensions",
		description: "Positive finite active-work timeout for extension tool_call handlers; invalid values use 30000ms, and time awaiting OMP-owned dialogs does not count",
		type: "number"
	},
	"externalThinking": {
		label: "External Thinking",
		group: "Thinking",
		description: "Private scratchpad; not shown to user. Disables supported GPT, Claude, and Gemini reasoning",
		type: "boolean"
	},
	"features.unexpectedStopDetection": {
		label: "Unexpected Stops",
		group: "Agent",
		description: "Automatically recover when the assistant stops without a visible message. Smart also classifies text-only stops with a small model.",
		type: "enum",
		values: ["none", "mechanical", "smart"],
		options: [{ value: "none", label: "None", description: "Disabled" }, { value: "mechanical", label: "Mechanical", description: "Retry stops with no visible assistant message; tool calls are excluded (default)" }, { value: "smart", label: "Smart", description: "Mechanical + small-model classification of text-only stops" }]
	},
	"fetch.enabled": {
		label: "Read URLs",
		group: "Available Tools",
		description: "Allow the read tool to fetch and process URLs",
		type: "boolean"
	},
	"find.enabled": {
		label: "Find (semantic grep)",
		group: "Available Tools",
		description: "Enable the find tool: natural-language search for files and line ranges, judged by the judge model role",
		type: "boolean"
	},
	"followUpMode": {
		label: "Follow-Up Mode",
		group: "Input",
		description: "How to drain follow-up messages after a turn completes",
		type: "enum",
		values: ["all", "one-at-a-time"]
	},
	"generate_image.enabled": {
		label: "Generate Image",
		group: "Available Tools",
		description: "Enable the generate_image tool (text-to-image generation and editing). Exposed as an xd:// device when tools.xdev is on.",
		type: "boolean"
	},
	"git.enabled": {
		label: "Enable Git Integration",
		group: "Git",
		description: "Show git branch, status, and PR information in the TUI and watch repository metadata.",
		type: "boolean"
	},
	"github.cache.enabled": {
		label: "GitHub View Cache",
		group: "GitHub",
		description: "Cache rendered issue/PR view output in ~/.omp/cache/github-cache.db so repeated reads are free",
		type: "boolean"
	},
	"github.cache.hardTtlSec": {
		label: "GitHub Cache Hard TTL",
		group: "GitHub",
		description: "Past the soft TTL the cached row is returned and refreshed in the background; past the hard TTL it is dropped (seconds; default 7 days)",
		type: "number"
	},
	"github.cache.softTtlSec": {
		label: "GitHub Cache Soft TTL",
		group: "GitHub",
		description: "Within this window, cached issue/PR view rows are returned directly (seconds; default 5 minutes)",
		type: "number"
	},
	"github.enabled": {
		label: "GitHub CLI",
		group: "Available Tools",
		description: "Enable the github tool (op-based dispatch for repository, issue, pull request, diff, search, checkout, push, and Actions watch workflows)",
		type: "boolean"
	},
	"glob.enabled": {
		label: "Glob",
		group: "Available Tools",
		description: "Enable the glob tool for glob-based file lookup",
		type: "boolean"
	},
	"goal.continuationModes": {
		label: "Goal Continuation Modes",
		group: "Modes",
		description: "Run modes where active goals may auto-continue between turns",
		type: "array"
	},
	"goal.enabled": {
		label: "Goal Mode",
		group: "Modes",
		description: "Enable per-session goal mode and the hidden goal tool",
		type: "boolean"
	},
	"goal.statusInFooter": {
		label: "Goal Status in Footer",
		group: "Modes",
		description: "Show token budget alongside the goal indicator in the status line",
		type: "boolean"
	},
	"grep.contextAfter": {
		label: "Grep Context After",
		group: "Grep & Browser",
		description: "Lines of context after each grep match",
		type: "number",
		options: [{ value: "0", label: "0 lines" }, { value: "1", label: "1 line" }, { value: "2", label: "2 lines" }, { value: "3", label: "3 lines" }, { value: "5", label: "5 lines" }, { value: "10", label: "10 lines" }]
	},
	"grep.contextBefore": {
		label: "Grep Context Before",
		group: "Grep & Browser",
		description: "Lines of context before each grep match",
		type: "number",
		options: [{ value: "0", label: "0 lines" }, { value: "1", label: "1 line" }, { value: "2", label: "2 lines" }, { value: "3", label: "3 lines" }, { value: "5", label: "5 lines" }]
	},
	"grep.enabled": {
		label: "Grep",
		group: "Available Tools",
		description: "Enable the grep tool for regex content search",
		type: "boolean"
	},
	"hideThinkingBlock": {
		label: "Hide Thinking Blocks",
		group: "Thinking",
		description: "Hide thinking blocks in assistant responses",
		type: "boolean"
	},
	"hindsight.apiToken": {
		label: "Hindsight API Token",
		group: "Hindsight",
		description: "Bearer token for authenticated Hindsight servers",
		type: "string"
	},
	"hindsight.apiUrl": {
		label: "Hindsight API URL",
		group: "Hindsight",
		description: "Hindsight server URL (Cloud or self-hosted)",
		type: "string"
	},
	"hindsight.autoRecall": {
		label: "Hindsight Auto Recall",
		group: "Hindsight",
		description: "Recall memories on the first turn of each session",
		type: "boolean"
	},
	"hindsight.autoRetain": {
		label: "Hindsight Auto Retain",
		group: "Hindsight",
		description: "Retain transcript every N turns and at session boundaries",
		type: "boolean"
	},
	"hindsight.bankId": {
		label: "Hindsight Bank ID",
		group: "Hindsight",
		description: "Memory bank identifier (default: project name)",
		type: "string"
	},
	"hindsight.mentalModelAutoSeed": {
		label: "Hindsight Mental Model Auto-Seed",
		group: "Hindsight",
		description: "At session start, create any built-in mental models (project-conventions, project-decisions, user-preferences) that do not yet exist on the bank.",
		type: "boolean"
	},
	"hindsight.mentalModelsEnabled": {
		label: "Hindsight Mental Models",
		group: "Hindsight",
		description: "Read curated reflect summaries (mental models) into developer instructions at boot. Loads existing models on the bank \\u2014 does not write. Pair with hindsight.mentalModelAutoSeed to also auto-create the built-in seed set.",
		type: "boolean"
	},
	"hindsight.recallBudget": {
		type: "enum",
		values: ["low", "mid", "high"]
	},
	"hindsight.retainMode": {
		label: "Hindsight Retain Mode",
		group: "Hindsight",
		description: "full-session = upsert one document per session, last-turn = chunked",
		type: "enum",
		values: ["full-session", "last-turn"],
		options: [{ value: "full-session", label: "Full session", description: "Upsert one document per session (recommended)" }, { value: "last-turn", label: "Last turn", description: "Chunked retention sliced by turn boundaries" }]
	},
	"hindsight.scoping": {
		label: "Hindsight Scoping",
		group: "Hindsight",
		description: "global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = shared bank with project tags so global + project memories merge on recall",
		type: "enum",
		values: ["global", "per-project", "per-project-tagged"],
		options: [{ value: "global", label: "Global", description: "One shared bank \\u2014 every project sees the same memories" }, { value: "per-project", label: "Per project", description: "Isolated bank per cwd basename \\u2014 projects cannot see each other's memories" }, { value: "per-project-tagged", label: "Per project (tagged)", description: "Shared bank, retains tagged with project:<cwd>. Recall surfaces project + untagged global memories together" }]
	},
	"images.autoResize": {
		label: "Auto-Resize Images",
		group: "Images",
		description: "Resize large images to 2000x2000 max for better model compatibility",
		type: "boolean"
	},
	"images.blockImages": {
		label: "Block Images",
		group: "Images",
		description: "Prevent images from being sent to LLM providers",
		type: "boolean"
	},
	"images.describeForTextModels": {
		label: "Describe Images for Text Models",
		group: "Vision",
		description: "When an image is attached to a model without vision support, save it under local:// and inject a description from a vision-capable model instead of dropping it",
		type: "boolean"
	},
	"images.questionTimeoutMs": {
		label: "Image Question Timeout",
		group: "Execution",
		description: "Per-request timeout for the vision-model call behind read's ?q= image questions, in milliseconds. A stalled provider fails fast with a timeout error instead of blocking until manual abort. Set to 0 to disable the timeout.",
		type: "number",
		options: [{ value: "0", label: "Disabled" }, { value: "60000", label: "1 minute" }, { value: "120000", label: "2 minutes" }, { value: "180000", label: "3 minutes" }, { value: "300000", label: "5 minutes" }]
	},
	"images.urls.backends": {
		label: "Image URL Backends",
		group: "Vision",
		description: "Ordered destinations tried when publishing images for provider access",
		type: "array"
	},
	"images.urls.bindHost": {
		label: "Image URL Bind Host",
		group: "Vision",
		description: "Host the blob server binds to; loopback for tunnels, 0.0.0.0 for direct serving",
		type: "string"
	},
	"images.urls.command": {
		label: "Image Upload Command",
		group: "Vision",
		description: "Argv template for the command backend; {file} is the image path, {mime}/{ext} optional. The last URL printed on stdout is used (e.g. pasta -b -f {file})",
		type: "string"
	},
	"images.urls.enabled": {
		label: "Serve Images as URLs",
		group: "Vision",
		description: "Publish outgoing images through the configured backend chain and send URL-fetching providers short URLs instead of inline base64. Falls back to inline automatically when every backend or a provider fetch fails",
		type: "boolean"
	},
	"images.urls.publicBaseUrl": {
		label: "Image URL Public Base",
		group: "Vision",
		description: "Externally reachable base URL fronting the blob server (required for ssh, optional for direct)",
		type: "string"
	},
	"images.urls.sshRemotePort": {
		label: "Image URL SSH Remote Port",
		group: "Vision",
		description: "Remote listen port of the ssh reverse forward that your web server proxies to",
		type: "number"
	},
	"images.urls.sshTarget": {
		label: "Image URL SSH Target",
		group: "Vision",
		description: "user@host destination for the ssh reverse forward",
		type: "string"
	},
	"images.urls.ttlHours": {
		label: "Image URL Lifetime (hours)",
		group: "Vision",
		description: "Serving window for locally hosted image URLs, measured from the last time a conversation sent them; resuming a conversation re-arms the window at the same link. 0 keeps links alive while the broker runs",
		type: "number"
	},
	"includeModelInPrompt": {
		label: "Include Model in Prompt",
		group: "Prompt",
		description: "Surface the active model identifier in the system prompt so the agent knows which model it is",
		type: "boolean"
	},
	"includeWorkspaceTree": {
		label: "Include Workspace Tree",
		group: "Prompt",
		description: "Render the workspace directory tree in the system prompt. WARNING: This can bust prompt caching across sessions when files are modified.",
		type: "boolean"
	},
	"inlineToolDescriptors": {
		label: "Inline Tool Descriptors",
		group: "Prompt",
		description: "Render full tool descriptors in the system prompt and strip top-level/nested descriptions from provider tool schemas so descriptor text is sent once. Auto enables this for Gemini models and disables it otherwise",
		type: "enum",
		values: ["auto", "on", "off"],
		options: [{ value: "auto", label: "Auto", description: "Inline descriptors for Gemini models; keep them in tool schemas otherwise" }, { value: "on", label: "On", description: "Always inline descriptors in the system prompt" }, { value: "off", label: "Off", description: "Keep descriptors in provider tool schemas only" }]
	},
	"interruptMode": {
		label: "Interrupt Mode",
		group: "Input",
		description: "When steering messages interrupt tool execution",
		type: "enum",
		values: ["immediate", "wait"]
	},
	"irc.timeoutMs": {
		label: "IRC Timeout",
		group: "Execution",
		description: "Timeout for hub send await:true in milliseconds; 0 disables the timeout",
		type: "number",
		options: [{ value: "0", label: "Disabled" }, { value: "30000", label: "30 seconds" }, { value: "60000", label: "1 minute" }, { value: "120000", label: "2 minutes" }, { value: "300000", label: "5 minutes" }]
	},
	"isolation.backend": {
		label: "Isolation Backend",
		group: "Isolation",
		description: "Backend used for subagent isolation and worktree cloning",
		type: "enum",
		values: ["auto", "apfs", "btrfs", "zfs", "reflink", "overlayfs", "projfs", "block-clone", "rcopy"],
		options: [{ value: "auto", label: "Auto", description: "Let the PAL pick the best available backend" }, { value: "apfs", label: "APFS", description: "macOS clonefile reflink (APFS)" }, { value: "btrfs", label: "btrfs", description: "btrfs subvolume snapshot" }, { value: "zfs", label: "ZFS", description: "ZFS snapshot + clone" }, { value: "reflink", label: "Reflink", description: "Linux FICLONE per-file reflink" }, { value: "overlayfs", label: "Overlayfs", description: "Linux kernel overlay (or fuse-overlayfs fallback)" }, { value: "projfs", label: "ProjFS", description: "Windows Projected File System" }, { value: "block-clone", label: "Block clone", description: "Windows FSCTL_DUPLICATE_EXTENTS_TO_FILE (NTFS/ReFS)" }, { value: "rcopy", label: "Recursive copy", description: "git worktree if available, otherwise recursive copy" }]
	},
	"launch.enabled": {
		label: "Launch",
		group: "Available Tools",
		description: "Enable the launch tool for supervising shared long-running project processes",
		type: "boolean"
	},
	"live.voice": {
		label: "Live Voice",
		group: "Services",
		description: "Voice used by Codex-backed realtime voice sessions",
		type: "enum",
		values: ["arbor", "breeze", "cove", "ember", "juniper", "maple", "sol", "spruce", "vale"],
		options: [{ value: "arbor", label: "Arbor" }, { value: "breeze", label: "Breeze" }, { value: "cove", label: "Cove" }, { value: "ember", label: "Ember" }, { value: "juniper", label: "Juniper" }, { value: "maple", label: "Maple" }, { value: "sol", label: "Sol" }, { value: "spruce", label: "Spruce" }, { value: "vale", label: "Vale" }]
	},
	"loop.conditionTimeoutMs": {
		label: "Loop Condition Timeout (ms)",
		group: "Input",
		description: "Max wait for a `/loop --while` / `--until` condition command before treating it as broken and stopping the loop. Set to 0 to wait indefinitely",
		type: "number",
		options: [{ value: "0", label: "Unlimited" }, { value: "10000", label: "10 seconds" }, { value: "30000", label: "30 seconds" }, { value: "120000", label: "2 minutes" }]
	},
	"loop.mode": {
		label: "Loop Mode",
		group: "Input",
		description: "What happens between /loop iterations before re-submitting the prompt",
		type: "enum",
		values: ["prompt", "compact", "reset"],
		options: [{ value: "prompt", label: "Prompt", description: "Re-submit the prompt as a follow-up message (current behavior)" }, { value: "compact", label: "Compact", description: "Compact the session context, then re-submit the prompt" }, { value: "reset", label: "Reset", description: "Start a new session, then re-submit the prompt" }]
	},
	"lsp.diagnosticsDeduplicate": {
		label: "Deduplicate Diagnostics",
		group: "LSP",
		description: "Suppress post-edit LSP diagnostics already shown for a file; only surface new or changed ones",
		type: "boolean"
	},
	"lsp.diagnosticsOnEdit": {
		label: "Diagnostics on Edit",
		group: "LSP",
		description: "Return LSP diagnostics after editing code files",
		type: "boolean"
	},
	"lsp.diagnosticsOnWrite": {
		label: "Diagnostics on Write",
		group: "LSP",
		description: "Return LSP diagnostics after writing code files",
		type: "boolean"
	},
	"lsp.enabled": {
		label: "LSP",
		group: "LSP",
		description: "Enable the lsp tool for code intelligence (definitions, references, diagnostics, rename)",
		type: "boolean"
	},
	"lsp.formatOnWrite": {
		label: "Format on Write",
		group: "LSP",
		description: "Automatically format code files using LSP after writing",
		type: "boolean"
	},
	"lsp.lazy": {
		label: "Lazy LSP Startup",
		group: "LSP",
		description: "Start language servers on first use (lsp tool or editing a matching file type) instead of at session startup",
		type: "boolean"
	},
	"lsp.shared": {
		label: "Shared Language Servers",
		group: "LSP",
		description: "Share one language server per project across omp instances via the daemon broker (falls back to private servers when unavailable)",
		type: "boolean"
	},
	"magicKeywords.enabled": {
		label: "Magic Keywords",
		group: "Magic Keywords",
		type: "boolean"
	},
	"marketplace.autoUpdate": {
		label: "Marketplace Auto-Update",
		group: "Startup & Updates",
		description: "Check for plugin updates on startup",
		type: "enum",
		values: ["off", "notify", "auto"],
		options: [{ value: "off", label: "Off", description: "Don't check for plugin updates" }, { value: "notify", label: "Notify", description: "Check on startup and notify when updates are available" }, { value: "auto", label: "Auto", description: "Check on startup and auto-install updates" }]
	},
	"mcp.enableProjectConfig": {
		label: "MCP Project Config",
		group: "Discovery & MCP",
		description: "Load .mcp.json/mcp.json from project root",
		type: "boolean"
	},
	"mcp.notificationDebounceMs": {
		label: "MCP Notification Debounce",
		group: "Discovery & MCP",
		description: "Debounce window in milliseconds for MCP resource updates before injecting them into the conversation",
		type: "number"
	},
	"mcp.notifications": {
		label: "MCP Update Injection",
		group: "Discovery & MCP",
		description: "Inject MCP resource updates into the agent conversation",
		type: "boolean"
	},
	"mcp.renderMarkdownResults": {
		label: "MCP Markdown Results",
		group: "Discovery & MCP",
		description: "Render non-JSON MCP text results as Markdown in the transcript",
		type: "boolean"
	},
	"memory.backend": {
		label: "Memory Backend",
		group: "General",
		description: "Off, local summary pipeline, Mnemopi SQLite, Hindsight remote memory, or Sharpshooter",
		type: "enum",
		values: ["off", "local", "hindsight", "mnemopi", "sharpshooter"],
		options: [{ value: "off", label: "Off", description: "No memory subsystem runs" }, { value: "local", label: "Local", description: "Local rollout summarisation pipeline (memory_summary.md)" }, { value: "hindsight", label: "Hindsight", description: "Vectorize Hindsight remote memory service" }, { value: "mnemopi", label: "Mnemopi", description: "Local SQLite recall/retain backend with optional embeddings" }, { value: "sharpshooter", label: "Sharpshooter", description: "Friction-gated project decision files (architecture/product/style), consolidated in the background" }]
	},
	"minP": {
		label: "Min P",
		group: "Sampling",
		description: "Minimum probability threshold (0-1, -1 = provider default)",
		type: "number",
		options: [{ value: "-1", label: "Default", description: "Use provider default" }, { value: "0.01", label: "0.01", description: "Very permissive" }, { value: "0.05", label: "0.05", description: "Balanced" }, { value: "0.1", label: "0.1", description: "Strict" }]
	},
	"mnemopi.autoRecall": {
		label: "Mnemopi Auto Recall",
		group: "Mnemopi",
		description: "Recall local memories into the first turn of each session",
		type: "boolean"
	},
	"mnemopi.autoRetain": {
		label: "Mnemopi Auto Retain",
		group: "Mnemopi",
		description: "Retain completed conversation turns into local Mnemopi memory",
		type: "boolean"
	},
	"mnemopi.bank": {
		label: "Mnemopi Bank",
		group: "Mnemopi",
		description: "Optional shared bank base name. Per-project modes derive project-local banks from it.",
		type: "string"
	},
	"mnemopi.dbPath": {
		label: "Mnemopi DB Path",
		group: "Mnemopi",
		description: "Optional SQLite DB path. Defaults to the agent memories directory.",
		type: "string"
	},
	"mnemopi.embeddingApiKey": {
		label: "Mnemopi Embedding API Key",
		group: "Mnemopi",
		description: "Optional embedding API key passed to Mnemopi",
		type: "string"
	},
	"mnemopi.embeddingApiUrl": {
		label: "Mnemopi Embedding API URL",
		group: "Mnemopi",
		description: "Optional OpenAI-compatible embedding endpoint passed to Mnemopi",
		type: "string"
	},
	"mnemopi.embeddingModel": {
		label: "Mnemopi Embedding Model",
		group: "Mnemopi",
		description: "Advanced: explicit embedding model id that overrides the variant. Leave empty to use mnemopi.embeddingVariant.",
		type: "string"
	},
	"mnemopi.embeddingVariant": {
		label: "Embedding variant",
		group: "Mnemopi",
		description: "Local embedding model family. en = stronger English model; multilingual = cross-language model. Changing this rebuilds existing memory embeddings on next start.",
		type: "enum",
		values: ["en", "multilingual"],
		options: [{ value: "en", label: "English (bge-base-en-v1.5)", description: "BAAI/bge-base-en-v1.5 (768d), English-only" }, { value: "multilingual", label: "Multilingual (multilingual-e5-large)", description: "intfloat/multilingual-e5-large (1024d), cross-language recall" }]
	},
	"mnemopi.enhancedRecall": {
		label: "Mnemopi Enhanced Recall",
		group: "Mnemopi",
		description: "Enable the tiered query result cache for repeated and similar recall queries",
		type: "boolean"
	},
	"mnemopi.llmApiKey": {
		label: "Mnemopi LLM API Key",
		group: "Mnemopi",
		description: "Optional LLM API key for Mnemopi remote mode",
		type: "string"
	},
	"mnemopi.llmBaseUrl": {
		label: "Mnemopi LLM Base URL",
		group: "Mnemopi",
		description: "Optional OpenAI-compatible LLM endpoint for Mnemopi remote mode",
		type: "string"
	},
	"mnemopi.llmMode": {
		label: "Mnemopi LLM Mode",
		group: "Mnemopi",
		description: "Use no LLM, the online tiny model (the TINY role from /models, else @smol), or a remote OpenAI-compatible endpoint",
		type: "enum",
		values: ["none", "smol", "remote"],
		options: [{ value: "none", label: "None", description: "Disable Mnemopi LLM-backed extraction" }, { value: "smol", label: "Online (tiny)", description: "Use the online tiny model (the TINY role from /models, else @smol)" }, { value: "remote", label: "Remote", description: "Use the Mnemopi remote LLM settings below" }]
	},
	"mnemopi.llmModel": {
		label: "Mnemopi LLM Model",
		group: "Mnemopi",
		description: "Optional LLM model name for Mnemopi remote mode",
		type: "string"
	},
	"mnemopi.noEmbeddings": {
		label: "Mnemopi Disable Embeddings",
		group: "Mnemopi",
		description: "Force deterministic FTS-only recall instead of vector embeddings",
		type: "boolean"
	},
	"mnemopi.polyphonicRecall": {
		label: "Mnemopi Polyphonic Recall",
		group: "Mnemopi",
		description: "Enable 4-voice recall (vector, graph, fact, temporal) fused with reciprocal rank fusion",
		type: "boolean"
	},
	"mnemopi.proactiveLinking": {
		label: "Mnemopi Proactive Linking",
		group: "Mnemopi",
		description: "Ingest new memories into the episodic graph as they are stored, linking them to related entities and memories",
		type: "boolean"
	},
	"mnemopi.scoping": {
		label: "Mnemopi Scoping",
		group: "Mnemopi",
		description: "global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = project-local writes plus global recall visibility",
		type: "enum",
		values: ["global", "per-project", "per-project-tagged"],
		options: [{ value: "global", label: "Global", description: "One shared Mnemopi bank for every project" }, { value: "per-project", label: "Per project", description: "Project-local Mnemopi bank per cwd basename" }, { value: "per-project-tagged", label: "Per project (tagged)", description: "Write to a project-local bank but merge project + shared recall results" }]
	},
	"model.loopGuard.checkAssistantContent": {
		label: "Loop Guard Scan Prose",
		group: "Thinking",
		description: "Apply loop guard to assistant prose messages in addition to thinking logs",
		type: "boolean"
	},
	"model.loopGuard.enabled": {
		label: "Loop Guard",
		group: "Thinking",
		description: "Enable automatic stream loop detection for model reasoning and prose",
		type: "boolean"
	},
	"model.loopGuard.toolCallReminder": {
		label: "Loop Guard Tool-Call Reminder",
		group: "Thinking",
		description: "When a Gemini reasoning stream emits many consecutive planning headers without calling a tool, interrupt it and inject a reminder to issue a tool call (requires Loop Guard)",
		type: "boolean"
	},
	"model.toolCallLoopGuard.enabled": {
		label: "Tool-Call Loop Guard",
		group: "Thinking",
		description: "Detect consecutive identical tool calls across turns and inject a corrective steer",
		type: "boolean"
	},
	"model.toolCallLoopGuard.exemptTools": {
		label: "Tool-Call Loop Exempt Tools",
		group: "Thinking",
		description: "Tool names that may repeat consecutively without triggering the cross-turn loop guard",
		type: "array"
	},
	"model.toolCallLoopGuard.threshold": {
		label: "Tool-Call Loop Threshold",
		group: "Thinking",
		description: "Consecutive identical tool calls required before the corrective steer is injected",
		type: "number"
	},
	"modelRoleStorage": {
		label: "Model Role Storage",
		group: "Prompt",
		description: "Where model selector role assignments are saved",
		type: "enum",
		values: ["global", "project"],
		options: [{ value: "global", label: "Global", description: "Save role models in the active profile config (current behavior)" }, { value: "project", label: "Per-project", description: "Save project role models in .omp/config.yml; missing project roles use global defaults" }]
	},
	"omitThinking": {
		label: "Omit Thinking summaries",
		group: "Thinking",
		description: "Instruct upstream providers to completely omit thinking summaries from responses (where supported)",
		type: "boolean"
	},
	"paste.largeMenuThreshold": {
		label: "Large Paste Menu",
		group: "Input",
		description: "When a paste reaches this many lines, offer a menu to wrap it in a code block, wrap it in XML tags, or save it to a file. 0 disables the menu (large pastes still collapse to a [Paste] marker).",
		type: "number",
		options: [{ value: "0", label: "Off" }, { value: "100", label: "100 lines" }, { value: "250", label: "250 lines" }, { value: "500", label: "500 lines" }, { value: "1000", label: "1000 lines" }]
	},
	"personality": {
		label: "Personality",
		group: "Prompt",
		description: "Communication style rendered into the system prompt's personality block",
		type: "enum",
		values: ["default", "friendly", "pragmatic", "none"],
		options: [{ value: "default", label: "Default", description: "Terse, evidence-first engineer; dense, action-oriented replies" }, { value: "friendly", label: "Friendly", description: "Warm, encouraging collaborator focused on momentum and morale" }, { value: "pragmatic", label: "Pragmatic", description: "Direct, efficient engineer focused on clarity and rigor" }, { value: "none", label: "None", description: "Omit the personality block entirely" }]
	},
	"plan.autosave": {
		label: "Autosave Plans",
		group: "Modes",
		description: "Automatically save approved plans to disk when plan mode completes",
		type: "boolean"
	},
	"plan.autosaveDir": {
		label: "Autosave Directory",
		group: "Modes",
		description: "Directory for autosaved plans. Supports ~, absolute, and cwd-relative paths. Empty uses <project>/.omp/plans/.",
		type: "string"
	},
	"plan.defaultOnStartup": {
		label: "Start in Plan Mode",
		group: "Modes",
		description: "Automatically enter plan mode at the start of every new session",
		type: "boolean"
	},
	"plan.enabled": {
		label: "Plan Mode",
		group: "Modes",
		description: "Enable plan mode for read-only exploration and planning before execution",
		type: "boolean"
	},
	"power.sleepPrevention": {
		label: "Sleep Prevention",
		group: "Power",
		description: "Prevent the system sleeping during active sessions. Each level is cumulative \\u2014 it adds the flags of all lower levels.",
		type: "enum",
		values: ["off", "idle", "display", "system"],
		options: [{ value: "off", label: "Off", description: "Do not prevent any sleep" }, { value: "idle", label: "Prevent Idle Sleep", description: "Keep the system awake while a session is open (macOS `caffeinate -i`)" }, { value: "display", label: "Prevent Display Sleep", description: "Also keep the display from idle-sleeping (macOS `caffeinate -i -d`)" }, { value: "system", label: "Prevent System Sleep", description: "Also block all system sleep on AC and declare the user active (macOS `caffeinate -i -d -s -u`)" }]
	},
	"presencePenalty": {
		label: "Presence Penalty",
		group: "Sampling",
		description: "Penalty for introducing already-present tokens (-1 = provider default)",
		type: "number",
		options: [{ value: "-1", label: "Default", description: "Use provider default" }, { value: "0", label: "0", description: "No penalty" }, { value: "0.5", label: "0.5", description: "Mild novelty" }, { value: "1", label: "1", description: "Encourage novelty" }, { value: "2", label: "2", description: "Strong novelty" }]
	},
	"prewalk.enabled": {
		label: "Enable Prewalk",
		group: "Prewalk",
		description: "Start on the active model, then switch to a fast/cheap model (default the 'smol' role) at the first edit/write after the plan nudge's todo list exists \\u2014 the strong model plans, commits the todos, and starts the implementation before handing off. Overridable per session with --prewalk / --no-prewalk.",
		type: "boolean"
	},
	"proseOnlyThinking": {
		label: "Prose Only Thinking",
		group: "Thinking",
		description: "Omit code blocks from thinking summaries and replace them with an ellipsis",
		type: "boolean"
	},
	"provider.appendOnlyContext": {
		label: "Append-Only Context",
		group: "Protocol",
		description: "Cache system prompt + tool specs and keep an append-only message log so provider prefix caches (DeepSeek, Xiaomi/SGLang, Anthropic) hit at maximum rate. Auto enables for known prefix-cache providers.",
		type: "enum",
		values: ["auto", "on", "off"],
		options: [{ value: "auto", label: "Auto", description: "Enable for known prefix-cache providers (recommended)" }, { value: "on", label: "On", description: "Always enable append-only context" }, { value: "off", label: "Off", description: "Disable append-only context" }]
	},
	"providers.anthropic.serverSideFallback": {
		label: "Anthropic Server-Side Fallback (Fable 5)",
		group: "Retry & Fallback",
		description: "When a Claude Fable 5 / Mythos 5 request is blocked by Anthropic's safety classifier, retry it on Claude Opus 4.8 server-side (Anthropic `server-side-fallback-2026-06-01` beta). Opt-in \\u2014 leaving this off preserves the pre-fallback behavior for every request.",
		type: "boolean"
	},
	"providers.antigravityEndpoint": {
		label: "Antigravity Endpoint Mode",
		group: "Services",
		description: "Endpoint routing strategy for google-antigravity providers (chat, search, image, discovery)",
		type: "enum",
		values: ["auto", "production", "sandbox"],
		options: [{ value: "auto", label: "Auto", description: "Try production endpoint, fail over to sandbox on 5xx/429" }, { value: "production", label: "Production Only", description: "Force production endpoint only" }, { value: "sandbox", label: "Sandbox Only", description: "Force sandbox endpoint only" }]
	},
	"providers.autoThinkingMaxEffort": {
		label: "Auto Thinking Ceiling",
		group: "Thinking",
		description: "Highest effort the `auto` classifier may resolve. `xhigh` keeps the classifier one tier below the top, so only an explicit `ultrathink` reaches `max`; `max` lets a turn the classifier judges exceptional bill the top tier on models that expose it.",
		type: "enum",
		values: ["xhigh", "max"],
		options: [{ value: "xhigh", label: "xhigh", description: "Classifier stops at xhigh (default)" }, { value: "max", label: "max", description: "Classifier may resolve max where the model supports it" }]
	},
	"providers.cacheRetention": {
		label: "Prompt Cache Retention",
		group: "Protocol",
		description: "Prompt-cache retention forwarded to providers that support it (Anthropic, Bedrock, OpenRouter, OpenAI)",
		type: "enum",
		values: ["auto", "short", "long", "none"],
		options: [{ value: "auto", label: "Auto", description: "Provider default \\u2014 Anthropic OAuth subscriber sessions default to 1h, API keys use 5m kept warm by idle keep-alive refreshes; PI_CACHE_RETENTION still applies" }, { value: "short", label: "Short (5m)", description: "Cheapest cache writes; Anthropic keeps the entry warm with bounded keep-alive refreshes while idle" }, { value: "long", label: "Long (1h)", description: "1h TTL where the provider supports it; pricier writes, no keep-alive refresh requests" }, { value: "none", label: "Off", description: "Disable prompt caching and cache-affinity routing" }]
	},
	"providers.fetch": {
		label: "Fetch Provider",
		group: "Services",
		description: "Reader backend priority for the fetch/read URL tool",
		type: "enum",
		values: ["auto", "native", "trafilatura", "lynx", "parallel", "firecrawl", "jina"],
		options: [{ value: "auto", label: "Auto", description: "Priority: native > trafilatura > lynx > parallel > firecrawl > jina" }, { value: "native", label: "Native", description: "In-process HTML\\u2192Markdown converter (always available)" }, { value: "trafilatura", label: "Trafilatura", description: "Auto-installs via uv/pip" }, { value: "lynx", label: "Lynx", description: "Requires lynx system package" }, { value: "parallel", label: "Parallel", description: "Requires PARALLEL_API_KEY" }, { value: "firecrawl", label: "Firecrawl", description: "Requires FIRECRAWL_API_KEY" }, { value: "jina", label: "Jina", description: "Uses r.jina.ai reader (JINA_API_KEY optional)" }]
	},
	"providers.fireworksTier": {
		label: "Fireworks Tier",
		group: "Fireworks",
		type: "enum",
		values: ["standard", "priority"],
		options: [{ value: "standard", label: "Standard", description: "Default serving path (no service_tier)" }, { value: "priority", label: "Priority", description: "Priority serving path: higher reliability, premium per-token pricing" }]
	},
	"providers.kimiApiFormat": {
		label: "Kimi API Format",
		group: "Protocol",
		description: "API format for Kimi Code provider (auto follows live model metadata)",
		type: "enum",
		values: ["auto", "openai", "anthropic"],
		options: [{ value: "auto", label: "Auto", description: "Use the model's server-declared protocol" }, { value: "openai", label: "OpenAI", description: "api.kimi.com" }, { value: "anthropic", label: "Anthropic", description: "api.moonshot.ai" }]
	},
	"providers.maxInFlightRequests": {
		label: "Max In-Flight Requests",
		group: "Services",
		type: "record"
	},
	"providers.ollama-cloud.maxConcurrency": {
		label: "Ollama Cloud Max Concurrency",
		group: "Services",
		description: "Maximum concurrent Ollama Cloud subagent runs per process; 0 disables the provider-specific limit",
		type: "number"
	},
	"providers.openai-codex.codeMode": {
		label: "Codex Code Mode",
		group: "Services",
		description: "Route Codex code_mode_only models (GPT-5.6) through eval. The direct tools are eval, ask, todo, yield, think, checkpoint, and rewind. Use eval cells for other session tools. Mirrors codex-rs Code Mode. 'auto' follows the model catalog flag.",
		type: "enum",
		values: ["off", "on", "auto"]
	},
	"providers.openai-codex.codeModeDirectTools": {
		label: "Codex Code Mode Direct Tools",
		group: "Services",
		description: "Extra direct tools for Codex Code Mode. The standard direct tools are eval, ask, todo, yield, think, checkpoint, and rewind.",
		type: "array"
	},
	"providers.openaiWebsockets": {
		label: "OpenAI WebSockets",
		group: "Protocol",
		description: "Websocket policy for OpenAI Codex models (auto uses model defaults, on forces, off disables)",
		type: "enum",
		values: ["auto", "off", "on"],
		options: [{ value: "auto", label: "Auto", description: "Use model/provider default websocket behavior" }, { value: "off", label: "Off", description: "Disable websockets for OpenAI Codex models" }, { value: "on", label: "On", description: "Force websockets for OpenAI Codex models" }]
	},
	"providers.openrouterVariant": {
		label: "OpenRouter Routing",
		group: "Protocol",
		description: "Default routing-variant suffix appended to OpenRouter model IDs (overridden when the selector already names a variant)",
		type: "enum",
		values: ["default", "nitro", "floor", "online", "exacto"],
		options: [{ value: "default", label: "Default", description: "No suffix; use OpenRouter's default routing" }, { value: "nitro", label: ":nitro", description: "Prioritize throughput / lowest latency" }, { value: "floor", label: ":floor", description: "Prioritize cheapest available provider" }, { value: "online", label: ":online", description: "Enable OpenRouter's web-search plugin" }, { value: "exacto", label: ":exacto", description: "Cherry-picked high-quality providers (only defined for select models)" }]
	},
	"providers.streamFirstEventTimeoutSeconds": {
		label: "Stream First Event Timeout",
		group: "Timeouts",
		description: "Seconds to wait for the first model stream event; -1 uses provider/env defaults, 0 disables the watchdog",
		type: "number",
		options: [{ value: "-1", label: "Auto", description: "Use provider defaults and PI_* timeout env vars" }, { value: "0", label: "Off", description: "Disable first-event timeout" }, { value: "300", label: "5 minutes" }, { value: "600", label: "10 minutes" }, { value: "1800", label: "30 minutes" }]
	},
	"providers.streamIdleTimeoutSeconds": {
		label: "Stream Idle Timeout",
		group: "Timeouts",
		description: "Seconds a model stream may stay silent between events; -1 uses provider/env defaults, 0 disables the watchdog",
		type: "number",
		options: [{ value: "-1", label: "Auto", description: "Use provider defaults and PI_* timeout env vars" }, { value: "0", label: "Off", description: "Disable idle timeout" }, { value: "300", label: "5 minutes" }, { value: "600", label: "10 minutes" }, { value: "1800", label: "30 minutes" }]
	},
	"providers.tinyModelDevice": {
		label: "Tiny Model Device",
		group: "Tiny Model",
		description: "Inference backend for local tiny models (titles + memory): an ONNX execution provider, or `mlx` to download MLX weights and run them through mlx-lm on Apple silicon. Default uses CPU-only ONNX. The PI_TINY_DEVICE env var overrides this.",
		type: "enum",
		values: ["default", "gpu", "cpu", "mlx", "metal", "webgpu", "cuda", "dml", "coreml", "auto", "wasm", "webnn", "webnn-gpu", "webnn-cpu", "webnn-npu"],
		options: [{ value: "default", label: "Default", description: "CPU-only inference" }, { value: "gpu", label: "GPU", description: "Accelerated provider (WebGPU/Metal, CUDA, or DirectML)" }, { value: "cpu", label: "CPU", description: "CPU-only inference" }, { value: "mlx", label: "MLX", description: "Apple silicon GPU via mlx-lm (Python subprocess; macOS arm64)" }, { value: "metal", label: "Metal", description: "Alias for MLX" }, { value: "webgpu", label: "WebGPU", description: "WebGPU/Metal backend" }, { value: "cuda", label: "CUDA", description: "NVIDIA CUDA (Linux x64)" }, { value: "dml", label: "DirectML", description: "DirectML backend (Windows)" }, { value: "coreml", label: "CoreML", description: "Apple CoreML (opt-in; can fail to load)" }, { value: "auto", label: "Auto", description: "Let ONNX Runtime choose a provider" }, { value: "wasm", label: "WASM", description: "WebAssembly backend" }, { value: "webnn", label: "WebNN", description: "WebNN backend" }, { value: "webnn-gpu", label: "WebNN GPU", description: "WebNN GPU device" }, { value: "webnn-cpu", label: "WebNN CPU", description: "WebNN CPU device" }, { value: "webnn-npu", label: "WebNN NPU", description: "WebNN NPU device" }]
	},
	"providers.tinyModelDtype": {
		label: "Tiny Model Precision",
		group: "Tiny Model",
		description: "ONNX quantization/precision for local tiny models. Default uses each model's shipped dtype (q4); lower precision is faster, higher is more faithful. Ignored by the MLX backend (its repos are pre-quantized 4-bit). The PI_TINY_DTYPE env var overrides this.",
		type: "enum",
		values: ["default", "q4", "q4f16", "q8", "fp16", "fp32", "int8", "uint8", "bnb4", "q2", "q2f16", "q1", "q1f16", "auto"],
		options: [{ value: "default", label: "Default", description: "Each model's shipped dtype (currently q4)" }, { value: "q4", label: "q4", description: "4-bit weights; smallest and fastest" }, { value: "q4f16", label: "q4f16", description: "4-bit weights with fp16 activations" }, { value: "q8", label: "q8", description: "8-bit quantization" }, { value: "fp16", label: "fp16", description: "16-bit float; higher fidelity, larger" }, { value: "fp32", label: "fp32", description: "Full precision; largest and slowest" }, { value: "int8", label: "int8", description: "Signed 8-bit integer" }, { value: "uint8", label: "uint8", description: "Unsigned 8-bit integer" }, { value: "bnb4", label: "bnb4", description: "bitsandbytes 4-bit" }, { value: "q2", label: "q2", description: "2-bit weights" }, { value: "q2f16", label: "q2f16", description: "2-bit weights with fp16 activations" }, { value: "q1", label: "q1", description: "1-bit weights" }, { value: "q1f16", label: "q1f16", description: "1-bit weights with fp16 activations" }, { value: "auto", label: "Auto", description: "Let transformers.js choose per device" }]
	},
	"providers.webSearchTimeoutSeconds": {
		label: "Web Search Timeout",
		group: "Services",
		type: "number",
		options: [{ value: "30", label: "30 seconds" }, { value: "60", label: "1 minute" }, { value: "120", label: "2 minutes" }, { value: "180", label: "3 minutes" }, { value: "300", label: "5 minutes" }]
	},
	"python.interpreter": {
		label: "Python Interpreter",
		group: "Eval & Runtimes",
		description: "Optional path to an exact Python executable. When set, automatic Python runtime discovery is skipped.",
		type: "string"
	},
	"python.kernelMode": {
		label: "Python Kernel Mode",
		group: "Eval & Runtimes",
		description: "Keep the IPython kernel alive across eval calls or start fresh each time",
		type: "enum",
		values: ["session", "per-call"]
	},
	"read.defaultLimit": {
		label: "Default Read Limit",
		group: "Reading",
		description: "Default number of lines returned when agent calls read without a limit",
		type: "number",
		options: [{ value: "200", label: "200 lines" }, { value: "300", label: "300 lines" }, { value: "500", label: "500 lines" }, { value: "1000", label: "1000 lines" }, { value: "5000", label: "5000 lines" }]
	},
	"read.renderMarkdown": {
		label: "Markdown Previews",
		group: "Reading",
		description: "Render Markdown read results as formatted terminal Markdown previews instead of raw source",
		type: "boolean"
	},
	"read.summarize.enabled": {
		label: "Read Summaries",
		group: "Read Summaries",
		description: "Return structural code summaries when read is called without an explicit selector",
		type: "boolean"
	},
	"read.summarize.minBodyLines": {
		label: "Read Summary Body Lines",
		group: "Read Summaries",
		description: "Minimum multiline body or literal length before read summaries collapse it",
		type: "number"
	},
	"read.summarize.minCommentLines": {
		label: "Read Summary Comment Lines",
		group: "Read Summaries",
		description: "Minimum multiline block comment length before read summaries collapse it",
		type: "number"
	},
	"read.summarize.minTotalLines": {
		label: "Read Summary Minimum File Length",
		group: "Read Summaries",
		description: "Files with fewer total lines are read verbatim instead of structurally summarized",
		type: "number"
	},
	"read.summarize.prose": {
		label: "Prose Summaries",
		group: "Read Summaries",
		description: "Return structural summaries for Markdown and plain text reads",
		type: "boolean"
	},
	"read.summarize.unfoldLimit": {
		label: "Read Summary Unfold Ceiling",
		group: "Read Summaries",
		description: "Hard ceiling on summary size while BFS-unfolding. An unfold whose revealed lines would exceed this is skipped (that span stays folded) and unfolding continues with the remaining spans.",
		type: "number"
	},
	"read.summarize.unfoldUntil": {
		label: "Read Summary Unfold Target",
		group: "Read Summaries",
		description: "BFS-unfold elidable spans until the summary is at least this many visible lines. 0 keeps only the outermost elisions.",
		type: "number"
	},
	"read.toolResultPreview": {
		label: "Inline Read Previews",
		group: "Reading",
		description: "Render read tool results inline in the transcript instead of summary rows",
		type: "boolean"
	},
	"readLineNumbers": {
		label: "Line Numbers",
		group: "Reading",
		description: "Prepend line numbers to read tool output by default",
		type: "boolean"
	},
	"recap.enabled": {
		label: "Idle Recap",
		group: "Notifications",
		description: "Generate a brief LLM recap of where things stand after the terminal has been idle",
		type: "boolean"
	},
	"recap.idleSeconds": {
		label: "Idle Recap Delay",
		group: "Notifications",
		description: "Seconds to wait while idle before showing the recap",
		type: "number",
		options: [{ value: "60", label: "1 minute" }, { value: "120", label: "2 minutes" }, { value: "240", label: "4 minutes" }, { value: "300", label: "5 minutes" }, { value: "600", label: "10 minutes" }]
	},
	"repetitionPenalty": {
		label: "Repetition Penalty",
		group: "Sampling",
		description: "Penalty for repeated tokens (-1 = provider default)",
		type: "number",
		options: [{ value: "-1", label: "Default", description: "Use provider default" }, { value: "0.8", label: "0.8", description: "Allow repetition" }, { value: "1", label: "1", description: "No penalty" }, { value: "1.1", label: "1.1", description: "Mild penalty" }, { value: "1.2", label: "1.2", description: "Balanced" }, { value: "1.5", label: "1.5", description: "Strong penalty" }]
	},
	"retry.fallbackChains": {
		label: "Retry Fallback Chains",
		group: "Retry & Fallback",
		type: "record"
	},
	"retry.fallbackOn": {
		label: "Fallback Trigger",
		group: "Retry & Fallback",
		description: "Which failures may trigger a model fallback",
		type: "enum",
		values: ["any", "usage-limit", "except-usage-limit"],
		options: [{ value: "any", label: "Any error", description: "Fall back on any retryable failure" }, { value: "usage-limit", label: "Usage limit only", description: "Fall back only when usage or quota is exhausted" }, { value: "except-usage-limit", label: "Except usage limit", description: "Fall back on every failure except usage or quota exhaustion" }]
	},
	"retry.fallbackRevertPolicy": {
		label: "Fallback Revert Policy",
		group: "Retry & Fallback",
		description: "When to return to the primary model after a fallback",
		type: "enum",
		values: ["cooldown-expiry", "never"],
		options: [{ value: "cooldown-expiry", label: "Cooldown expiry", description: "Return to the primary model after its suppression window ends" }, { value: "never", label: "Never", description: "Stay on the fallback model until manually changed" }]
	},
	"retry.maxDelayMs": {
		label: "Max Retry Delay",
		group: "Retry & Fallback",
		description: "Maximum wait between retries, in ms. When the provider asks us to wait longer than this and no credential or model fallback succeeds, the request fails fast instead of sleeping (e.g. 3-hour Anthropic rate-limit windows). 0 disables the ceiling \\u2014 to let the session auto-resume through provider-stated quota resets.",
		type: "number"
	},
	"retry.maxRetries": {
		label: "Retry Attempts",
		group: "Retry & Fallback",
		description: "Maximum retry attempts on API errors",
		type: "number",
		options: [{ value: "1", label: "1 retry" }, { value: "2", label: "2 retries" }, { value: "3", label: "3 retries" }, { value: "5", label: "5 retries" }, { value: "10", label: "10 retries" }]
	},
	"retry.modelFallback": {
		label: "Retry Model Fallback",
		group: "Retry & Fallback",
		description: "Allow retry recovery to switch to configured fallback models",
		type: "boolean"
	},
	"retry.usageAwareFallback": {
		label: "Usage-Aware Fallback",
		group: "Retry & Fallback",
		description: "Use reliable coding-plan quota reports to prefer same-provider accounts, then configured fallback models, before a hard usage limit. Ordinary configured API keys are excluded.",
		type: "boolean"
	},
	"retry.usageReservePct": {
		label: "Reserve Margin",
		group: "Retry & Fallback",
		description: "Treat a coding-plan model as near its limit below this remaining percentage. Unknown or unmapped usage keeps the primary model.",
		type: "number",
		options: [{ value: "5", label: "5%", description: "Act only when nearly exhausted" }, { value: "10", label: "10%", description: "Balanced safety margin" }, { value: "15", label: "15%", description: "Conservative" }, { value: "20", label: "20%", description: "Early protection" }, { value: "25", label: "25%", description: "Very conservative" }]
	},
	"retry.usageReservePolicy": {
		label: "Reserve Policy",
		group: "Retry & Fallback",
		description: "What to do when every same-provider coding-plan account is inside the reserve margin.",
		type: "enum",
		values: ["confirm", "auto", "fail-closed"],
		options: [{ value: "confirm", label: "Confirm interactively", description: "Keep interactive sessions on the primary until confirmed; background agents auto-fallback" }, { value: "auto", label: "Auto-fallback", description: "Always select the next eligible configured fallback" }, { value: "fail-closed", label: "Fail closed", description: "Do not spend reserve quota or select a fallback" }]
	},
	"retry.waitForUsageReset": {
		label: "Wait For Usage Reset",
		group: "Retry & Fallback",
		description: "When a provider reports usage-limit exhaustion with a reset time (5-hour or weekly quota windows on any provider), sleep until the reset instead of failing fast past retry.maxDelayMs. Waits are abortable (Esc) but also hold subagents, so leave off for unattended runs.",
		type: "boolean"
	},
	"searxng.endpoint": {
		label: "SearXNG Endpoint",
		group: "Services",
		description: "Base URL of a self-hosted SearXNG instance used for web search",
		type: "string"
	},
	"secrets.enabled": {
		label: "Hide Secrets",
		group: "Privacy",
		description: "Obfuscate configured secrets and redact credential-shaped tokens before sending to AI providers",
		type: "boolean"
	},
	"security.enabled": {
		label: "Security",
		group: "Available Tools",
		description: "Enable OMP-native security scan planning, execution, and the read-only security:// resource namespace",
		type: "boolean"
	},
	"share.redactSecrets": {
		label: "Share Secret Redaction",
		group: "Collab",
		description: "Run the secret obfuscator over /share snapshots before upload (uses the secrets.* config)",
		type: "boolean"
	},
	"share.serverUrl": {
		label: "Share Server",
		group: "Collab",
		description: "Share viewer/upload base used by /share (encrypted blob upload + viewer; links are <base>/<id>#<key>)",
		type: "string"
	},
	"share.store": {
		label: "Share Store",
		group: "Collab",
		description: "Where /share uploads the encrypted session blob",
		type: "enum",
		values: ["blob", "gist"],
		options: [{ value: "blob", label: "Encrypted Blob", description: "Upload to the share server (no GitHub account needed; avoids gist API rate limits)" }, { value: "gist", label: "GitHub Gist", description: "Push to a secret gist (needs authenticated gh), falling back to the share server" }]
	},
	"sharpshooter.model": {
		label: "Sharpshooter Model",
		group: "Sharpshooter",
		description: "Model selector for extraction/consolidation, empty = smol role",
		type: "string"
	},
	"shellMinimizer.enabled": {
		label: "Shell Minimizer",
		group: "Bash",
		description: "Compress verbose shell output (git, npm, cargo, etc.) before returning it to the agent",
		type: "boolean"
	},
	"shellMinimizer.sourceOutlineLevel": {
		label: "Shell Minimizer Source Outline",
		group: "Bash",
		description: "Source outline mode for cat/read of source files: default or aggressive",
		type: "enum",
		values: ["default", "aggressive"]
	},
	"showHardwareCursor": {
		label: "Show Hardware Cursor",
		group: "Display",
		description: "Show terminal cursor for IME support",
		type: "boolean"
	},
	"skillful": {
		label: "List Skills in Prompt",
		group: "Prompt",
		description: "List available skills in the system prompt; disable to save context and toggle per-session with /skillful",
		type: "boolean"
	},
	"skills.enableSkillCommands": {
		label: "Skill Commands",
		group: "Commands & Skills",
		description: "Register skills as /skill:name commands",
		type: "boolean"
	},
	"snapcompact.shape": {
		label: "Snapcompact Shape",
		group: "Experimental",
		description: "Frame shape snapcompact prints text with (compaction archive and inline imaging). Auto picks a shape tuned for the current model.",
		type: "enum",
		values: ["auto", "8x8r-bw", "8x8r-sent", "8x8u-bw", "8x8u-sent", "6x6u-bw", "6x6u-sent", "5x8-bw", "5x8-sent", "6x12-dim", "8x13-bw", "8on16-bw", "8on22-bw", "11on16-bw", "silver16-bw", "doc-8on16-bw", "doc-8on16-sent", "doc-8on16-sent-dim"],
		options: [{ value: "auto", label: "Auto", description: "Picks a shape tuned for the current model, falling back to its provider family." }, { value: "8x8r-bw", label: "8x8 repeated, black", description: "unscii square cell, black ink, every line printed twice with the copy on a pale highlight band." }, { value: "8x8r-sent", label: "8x8 repeated, sentence hues", description: "Repeated grid with ink cycling six hues at sentence boundaries." }, { value: "8x8u-bw", label: "8x8, black", description: "Plain unscii square cell, single-printed lines, black ink." }, { value: "8x8u-sent", label: "8x8, sentence hues", description: "Plain unscii square cell with sentence-hue ink." }, { value: "6x6u-bw", label: "6x6 dense, black", description: "unscii squeezed to 6x6 \\u2014 densest readable cell, fewest frames \\u2014 in black ink." }, { value: "6x6u-sent", label: "6x6 dense, sentence hues", description: "Densest cell with sentence-hue ink." }, { value: "5x8-bw", label: "5x8 legacy, black", description: "Original X.org 5x8 glyphs on the 2576px frame, black ink." }, { value: "5x8-sent", label: "5x8 legacy, sentence hues", description: "The original snapcompact shape (pre-shape-table sessions rendered this)." }, { value: "6x12-dim", label: "6x12, dimmed stopwords", description: "X.org 6x12 glyphs, black ink, function words dimmed gray." }, { value: "8x13-bw", label: "8x13, black", description: "X.org 8x13 glyphs, black ink." }, { value: "8on16-bw", label: "8x13 on 16px pitch, black", description: "8x13 glyphs on an 8x16 cell (extra leading), black ink." }, { value: "8on22-bw", label: "8x13 on 22px pitch (leading), black", description: "8x13 glyphs on an 8x22 cell \\u2014 extra line spacing so rows don't crowd. Default for OpenAI/Google." }, { value: "11on16-bw", label: "8x13 on 11px advance (tracking), black", description: "8x13 glyphs on an 11x16 cell \\u2014 extra letter spacing so characters don't merge. Default for Anthropic." }, { value: "silver16-bw", label: "Silver 16, CJK", description: "Embedded Silver TrueType font on a 16px grid for CJK and other non-Latin text." }, { value: "doc-8on16-bw", label: "Doc 8on16, black", description: "Two word-wrapped newspaper columns of 8x13 glyphs on a 16px pitch, black ink." }, { value: "doc-8on16-sent", label: "Doc 8on16, sentence hues", description: "Two-column doc layout with sentence-hue ink." }, { value: "doc-8on16-sent-dim", label: "Doc 8on16, sentence hues + dimmed stopwords", description: "Two-column doc layout, sentence-hue ink, function words dimmed gray." }]
	},
	"snapcompact.systemPrompt": {
		label: "Snapcompact System Prompt",
		group: "Experimental",
		description: "Experimental: render selected system prompt text as dense PNG image(s) and attach to the first user message (vision models only). Saves tokens; loses prompt caching for imaged text.",
		type: "enum",
		values: ["none", "agents-md", "all"],
		options: [{ value: "none", label: "None", description: "Keep the system prompt as text." }, { value: "agents-md", label: "AGENTS.md", description: "Only move loaded context-file instructions to images, when that saves tokens." }, { value: "all", label: "All", description: "Move the full system prompt to images, when that saves tokens." }]
	},
	"snapcompact.toolResults": {
		label: "Snapcompact Tool Results",
		group: "Experimental",
		description: "Experimental: render large historical tool results as dense PNG image(s) instead of text (vision models only). Saves tokens on accumulated read/search output.",
		type: "boolean"
	},
	"speech.enabled": {
		label: "Speech Vocalization",
		group: "Services",
		description: "Speak the assistant's output aloud through the speakers as it streams",
		type: "boolean"
	},
	"speech.enhanced": {
		label: "Enhanced Speech Rewriting",
		group: "Services",
		description: "Rewrite assistant output into natural spoken prose with the tiny/smol model before synthesis (describes code, drops links and markdown). Falls back to mechanical cleanup on failure",
		type: "boolean"
	},
	"speech.mode": {
		label: "Speech Vocalization Mode",
		group: "Services",
		description: "What to speak: all = assistant messages + thinking; assistant = messages only; yield = only the final message at turn end",
		type: "enum",
		values: ["all", "assistant", "yield"],
		options: [{ value: "all", label: "All (messages + thinking)" }, { value: "assistant", label: "Assistant messages" }, { value: "yield", label: "Final message only" }]
	},
	"speech.voice": {
		label: "Speech Vocalization Voice",
		group: "Services",
		description: "Kokoro voice used when speaking the assistant's output aloud",
		type: "enum",
		values: ["af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george", "bm_fable"],
		options: [{ value: "af_heart" }, { value: "af_bella" }, { value: "af_nicole" }, { value: "af_aoede" }, { value: "af_kore" }, { value: "af_sarah" }, { value: "am_michael" }, { value: "am_fenrir" }, { value: "am_puck" }, { value: "bf_emma" }, { value: "bm_george" }, { value: "bm_fable" }]
	},
	"speechgen.enabled": {
		label: "Speech Generation",
		group: "Available Tools",
		description: "Enable the tts tool for on-device (Kokoro) or xAI Grok Voice speech-file synthesis",
		type: "boolean"
	},
	"spelling.autocomplete": {
		label: "Word Autocomplete (macOS)",
		group: "Input",
		description: "Show macOS dictionary word completions as inline hints accepted with Tab",
		type: "boolean"
	},
	"spelling.autocorrect": {
		label: "Autocorrect (macOS)",
		group: "Input",
		description: "Apply confident macOS spelling corrections after completed words",
		type: "boolean"
	},
	"spelling.typoDetection": {
		label: "Typo Detection (macOS)",
		group: "Input",
		description: "Mark misspelled prompt words with the active macOS dictionaries",
		type: "boolean"
	},
	"startup.changelogMode": {
		label: "Startup Changelog",
		group: "Startup & Updates",
		description: "Choose whether update notes start as a summary, full details, or stay hidden",
		type: "enum",
		values: ["summary", "expanded", "hidden"],
		options: [{ value: "summary", label: "Summary", description: "Show release and change counts with a /changelog hint" }, { value: "expanded", label: "Expanded", description: "Show the recent release notes in full" }, { value: "hidden", label: "Hidden", description: "Do not show release notes on startup" }]
	},
	"startup.checkUpdate": {
		label: "Check for Updates",
		group: "Startup & Updates",
		description: "Check for omp updates on startup",
		type: "boolean"
	},
	"startup.quiet": {
		label: "Quiet Startup",
		group: "Startup & Updates",
		description: "Skip welcome screen and startup status messages",
		type: "boolean"
	},
	"startup.setupWizard": {
		label: "Setup Wizard",
		group: "Startup & Updates",
		description: "Show newly added onboarding steps once per setup version",
		type: "boolean"
	},
	"startup.showSplash": {
		label: "Show Startup Splash",
		group: "Startup & Updates",
		description: "Show the full animated setup splash on normal interactive startup without rerunning setup. Quiet Startup still suppresses it.",
		type: "boolean"
	},
	"statusLine.compactThinkingLevel": {
		label: "Compact Thinking Level",
		group: "Status Line",
		description: "Show the thinking level as a single icon on the model name instead of a separate ` \\xB7 <level>` suffix.",
		type: "boolean"
	},
	"statusLine.contextLine": {
		label: "Context-Reactive Line",
		group: "Status Line",
		description: "How the line between the left and right segments reflects context usage (box composer only)",
		type: "enum",
		values: ["off", "percentage", "annotated", "embedded"],
		options: [{ value: "off", label: "Off", description: "Solid accent line, no context feedback" }, { value: "percentage", label: "Percentage", description: "Used portion in accent color, remainder dimmed" }, { value: "annotated", label: "Annotated", description: "Percentage plus ticks at the speculative and auto-compaction boundaries" }, { value: "embedded", label: "Embedded", description: "Annotated line with the context percentage and window embedded in the gauge" }]
	},
	"statusLine.preset": {
		label: "Status Line Preset",
		group: "Status Line",
		description: "Pre-built status line configurations",
		type: "enum",
		values: ["default", "minimal", "compact", "full", "nerd", "ascii", "custom"],
		options: [{ value: "default", label: "Default", description: "Model, path, git, context, tokens, cost" }, { value: "minimal", label: "Minimal", description: "Path and git only" }, { value: "compact", label: "Compact", description: "Model, git, cost, context" }, { value: "full", label: "Full", description: "All segments including time" }, { value: "nerd", label: "Nerd", description: "Maximum info with Nerd Font icons" }, { value: "ascii", label: "ASCII", description: "No special characters" }, { value: "custom", label: "Custom", description: "User-defined segments" }]
	},
	"statusLine.separator": {
		label: "Status Line Separator",
		group: "Status Line",
		description: "Style of separators between segments",
		type: "enum",
		values: ["powerline", "powerline-thin", "slash", "pipe", "block", "none", "ascii"],
		options: [{ value: "powerline", label: "Powerline", description: "Solid arrows (Nerd Font)" }, { value: "powerline-thin", label: "Thin chevron", description: "Thin arrows (Nerd Font)" }, { value: "slash", label: "Slash", description: "Forward slashes" }, { value: "pipe", label: "Pipe", description: "Vertical pipes" }, { value: "block", label: "Block", description: "Solid blocks" }, { value: "none", label: "None", description: "Space only" }, { value: "ascii", label: "ASCII", description: "Greater-than signs" }]
	},
	"statusLine.sessionAccent": {
		label: "Session Accent",
		group: "Status Line",
		description: "Use the session name color for the editor border and status line gap",
		type: "boolean"
	},
	"statusLine.showHookStatus": {
		label: "Show Hook Status",
		group: "Status Line",
		description: "Display hook status messages below the status line",
		type: "boolean"
	},
	"statusLine.transparent": {
		label: "Transparent Status Line",
		group: "Status Line",
		description: "Use the terminal's default background for the status line instead of the theme's `statusLineBg`. Powerline end caps are dropped because they need a contrasting fill to bridge into the surrounding terminal.",
		type: "boolean"
	},
	"steeringMode": {
		label: "Steering Mode",
		group: "Input",
		description: "How to process queued messages while agent is working",
		type: "enum",
		values: ["all", "one-at-a-time"]
	},
	"stream.redactPatterns": {
		label: "Extra Redaction Patterns",
		group: "Stream",
		description: "Additional regular expressions redacted from every streamed row, on top of env/secrets.yml values and built-in credential shapes",
		type: "array"
	},
	"stream.serverUrl": {
		label: "Stream Server",
		group: "Stream",
		description: "Live stream server used by `omp stream` (https://host[:port]); viewers watch at <base>/<your Stencil username>",
		type: "string"
	},
	"stt.enabled": {
		label: "Speech-to-Text",
		group: "Speech",
		description: "Enable speech-to-text input via microphone",
		type: "boolean"
	},
	"stt.submitTrigger": {
		label: "Speech-to-Text Submit Trigger",
		group: "Speech",
		description: "Choose when speech dictation automatically submits: Never, Release (2+ words), Release with complete sentence, or When I Say Submit.",
		type: "enum",
		values: ["never", "release", "release-complete", "say-submit"],
		options: [{ value: "never", label: "Never", description: "Never automatically submit; insert dictation and remain in editor." }, { value: "release", label: "Release", description: "Submit on release if the utterance has 2+ words to avoid accidental sends." }, { value: "release-complete", label: "Release with complete sentence", description: "Submit on release if the utterance ends with sentence-terminal punctuation (. ? ! etc.)." }, { value: "say-submit", label: "When I Say Submit", description: "Submit if the utterance ends with a word containing 'submit' (strips that word before submitting)." }]
	},
	"symbolPreset": {
		label: "Symbol Preset",
		group: "Theme",
		description: "Glyph set for icons and symbols (Unicode, Nerd Font, or ASCII)",
		type: "enum",
		values: ["unicode", "nerd", "ascii"],
		options: [{ value: "unicode", label: "Unicode", description: "Standard symbols (default)" }, { value: "nerd", label: "Nerd Font", description: "Requires a Nerd Font, or a Glyph Protocol terminal (icons ship in-band)" }, { value: "ascii", label: "ASCII", description: "Maximum compatibility" }]
	},
	"task.agentIdleTtlMs": {
		label: "Agent Idle TTL",
		group: "Subagents",
		description: "How long an idle subagent stays live in memory before being parked to disk (ms). Parked agents are revived automatically when messaged or resumed. 0 keeps idle agents live until exit.",
		type: "number"
	},
	"task.batch": {
		label: "Batch Task Calls",
		group: "Subagents",
		description: "Switch the task tool to its batch shape: one call carries { context, tasks[] } \\u2014 one subagent per item, with an optional per-item agent (defaulting to the session spawn-policy agent), per-item isolation, and a required shared context prepended to every assignment. With async.enabled=true, each spawn runs as an independent background agent with the normal idle/parked lifecycle; otherwise the call blocks for merged results. Disable to restore the flat single-spawn schema.",
		type: "boolean"
	},
	"task.eager": {
		label: "Prefer Task Delegation",
		group: "Subagents",
		description: "How strongly to push delegating work to subagents",
		type: "enum",
		values: ["default", "preferred", "always"],
		options: [{ value: "default", label: "Default", description: "Uses the selected model's policy; some models require an explicit delegation request" }, { value: "preferred", label: "Preferred", description: "Adds delegation guidance to the system prompt" }, { value: "always", label: "Always", description: "Prompt guidance plus a first-turn delegation reminder" }]
	},
	"task.enableEffort": {
		label: "Per-Task Effort",
		group: "Subagents",
		description: "Expose the optional effort parameter on task spawns, allowing callers to override each subagent's thinking level",
		type: "boolean"
	},
	"task.enableLsp": {
		label: "LSP in Subagents",
		group: "Subagents",
		description: "Allow subagents spawned via the task tool to use the lsp tool. Off by default to keep subagents cheap; enable when LSP-aware delegation is worth the extra tokens.",
		type: "boolean"
	},
	"task.isolation.apply": {
		label: "Apply Isolated Changes",
		group: "Isolation",
		description: "Automatically apply successful isolated task changes to the parent checkout; disable to retain patch or branch artifacts",
		type: "boolean"
	},
	"task.isolation.commits": {
		label: "Isolation Commit Style",
		group: "Isolation",
		description: "Commit message style for nested repo changes (generic or AI-generated)",
		type: "enum",
		values: ["generic", "ai"],
		options: [{ value: "generic", label: "Generic", description: "Static commit message" }, { value: "ai", label: "AI", description: "AI-generated commit message from diff" }]
	},
	"task.isolation.enabled": {
		label: "Isolate Subagents",
		group: "Isolation",
		description: "Run subagents in an isolated copy of the checkout and integrate their changes afterwards",
		type: "boolean"
	},
	"task.isolation.merge": {
		label: "Isolation Merge Strategy",
		group: "Isolation",
		description: "How isolated task changes are integrated (patch apply or branch merge)",
		type: "enum",
		values: ["patch", "branch"],
		options: [{ value: "patch", label: "Patch", description: "Combine diffs and git apply" }, { value: "branch", label: "Branch", description: "Commit per task, merge with --no-ff" }]
	},
	"task.maxConcurrency": {
		label: "Max Concurrent Tasks",
		group: "Subagents",
		description: "Maximum number of subagents running concurrently",
		type: "number",
		options: [{ value: "0", label: "Unlimited" }, { value: "1", label: "1 task" }, { value: "2", label: "2 tasks" }, { value: "4", label: "4 tasks" }, { value: "8", label: "8 tasks" }, { value: "16", label: "16 tasks" }, { value: "32", label: "32 tasks" }, { value: "64", label: "64 tasks" }]
	},
	"task.maxEffort": {
		label: "Maximum Per-Spawn Effort",
		group: "Subagents",
		description: "Maximum reasoning effort allowed for the task tool's per-spawn effort hint. Lower values prevent callers from escalating subagents above this ceiling; the default preserves the model's full range.",
		type: "enum",
		values: ["minimal", "low", "medium", "high", "xhigh", "max"]
	},
	"task.maxRecursionDepth": {
		label: "Max Task Recursion",
		group: "Subagents",
		description: "How many levels deep subagents can spawn their own subagents",
		type: "number",
		options: [{ value: "-1", label: "Unlimited" }, { value: "0", label: "None" }, { value: "1", label: "Single" }, { value: "2", label: "Double" }, { value: "3", label: "Triple" }]
	},
	"task.maxRuntimeMs": {
		label: "Max Subagent Runtime",
		group: "Subagents",
		description: "Hard wall-clock limit per subagent (ms). 0 disables it. Defense-in-depth against provider-side stream hangs that escape the inference-layer watchdog; triggers a normal subagent abort with a 'timed out' reason.",
		type: "number",
		options: [{ value: "0", label: "Unlimited", description: "Default" }, { value: "300000", label: "5 minutes" }, { value: "900000", label: "15 minutes" }, { value: "1800000", label: "30 minutes" }, { value: "3600000", label: "1 hour" }]
	},
	"task.prewalk": {
		label: "Generic Task Prewalk",
		group: "Subagents",
		description: "Arm prewalk for the bundled generic `task` subagent: it starts on its resolved model, plans and begins the implementation, then hands off to the 'smol' role at its first edit/write. Per-agent overrides (task.agentPrewalk, configured from the /agents hub) and user agent `prewalk` frontmatter apply regardless of this toggle.",
		type: "boolean"
	},
	"task.showResolvedModelBadge": {
		label: "Show Resolved Model Badge",
		group: "Display",
		description: "Display the actual model ID used by each subagent in the task widget status line",
		type: "boolean"
	},
	"task.softRequestBudget": {
		label: "Soft Subagent Request Budget",
		group: "Subagents",
		description: "Soft per-subagent request budget (assistant requests per run). Crossing it injects a wrap-up steering notice (see task.softRequestBudgetNotice); at 1.5x the budget the run is force-stopped and the agent must yield its partial findings. 0 disables the guard. Bundled scout/sonic agents cap out at a lower built-in budget, so a value below that cap still applies to them.",
		type: "number",
		options: [{ value: "0", label: "Disabled" }, { value: "90", label: "90 requests" }, { value: "150", label: "150 requests" }, { value: "200", label: "200 requests", description: "Default" }]
	},
	"task.softRequestBudgetNotice": {
		label: "Soft Request Budget Notice",
		group: "Subagents",
		description: "Inject one steering notice when a subagent crosses its soft request budget, asking it to wrap up before the 1.5x forced-yield stop.",
		type: "boolean"
	},
	"tasks.todoClearDelay": {
		label: "Todo Auto-Clear Delay",
		group: "Todos",
		description: "Delay before completed or abandoned todos are removed from the todo widget",
		type: "number",
		options: [{ value: "0", label: "Instant" }, { value: "60", label: "1 minute", description: "Default" }, { value: "300", label: "5 minutes" }, { value: "900", label: "15 minutes" }, { value: "1800", label: "30 minutes" }, { value: "3600", label: "1 hour" }, { value: "-1", label: "Never" }]
	},
	"temperature": {
		label: "Temperature",
		group: "Sampling",
		description: "Sampling temperature (0 = deterministic, 1 = creative, -1 = provider default)",
		type: "number",
		options: [{ value: "-1", label: "Default", description: "Use provider default" }, { value: "0", label: "0", description: "Deterministic" }, { value: "0.2", label: "0.2", description: "Focused" }, { value: "0.5", label: "0.5", description: "Balanced" }, { value: "0.7", label: "0.7", description: "Creative" }, { value: "1", label: "1", description: "Maximum variety" }]
	},
	"terminal.showImages": {
		label: "Show Inline Images",
		group: "Images",
		description: "Render images inline in the terminal",
		type: "boolean"
	},
	"terminal.showProgress": {
		label: "Native Terminal Progress",
		group: "Display",
		description: "Emit OSC 9;4 indeterminate progress while the agent or context maintenance is running",
		type: "boolean"
	},
	"textVerbosity": {
		label: "Text Verbosity",
		group: "Sampling",
		description: "OpenAI Responses and Codex response verbosity (low, medium, or high)",
		type: "enum",
		values: ["low", "medium", "high"],
		options: [{ value: "low", label: "Low", description: "Prefer concise responses" }, { value: "medium", label: "Medium", description: "Balance brevity and detail (default)" }, { value: "high", label: "High", description: "Prefer detailed responses" }]
	},
	"theme.dark": {
		label: "Dark Theme",
		group: "Theme",
		description: "Theme used when the terminal has a dark background",
		type: "string"
	},
	"theme.light": {
		label: "Light Theme",
		group: "Theme",
		description: "Theme used when the terminal has a light background",
		type: "string"
	},
	"tier.advisor": {
		label: "Service Tier \\u2014 Advisor",
		group: "Sampling",
		description: "Service Tier for the advisor model. None = standard processing; Inherit = match the main agent's live per-family tiers; pick a value to apply it to the advisor model's family.",
		type: "enum",
		values: ["inherit", "none", "auto", "default", "flex", "scale", "priority"],
		options: [{ value: "inherit", label: "Inherit", description: "Match the main agent's live per-family tiers" }, { value: "none", label: "None", description: "Standard processing" }, { value: "auto", label: "Auto", description: "Provider default tier selection (OpenAI family)" }, { value: "default", label: "Default", description: "Standard priority processing (OpenAI family)" }, { value: "flex", label: "Flex", description: "Flexible capacity tier (OpenAI/Google families)" }, { value: "scale", label: "Scale", description: "Scale Tier credits (OpenAI family)" }, { value: "priority", label: "Priority", description: "Priority on every supported family of the spawned model" }]
	},
	"tier.anthropic": {
		label: "Service Tier \\u2014 Anthropic",
		group: "Sampling",
		type: "enum",
		values: ["none", "priority"],
		options: [{ value: "none", label: "None", description: "Standard processing" }]
	},
	"tier.google": {
		label: "Service Tier \\u2014 Google",
		group: "Sampling",
		description: "Processing tier for Gemini (Google AI Studio + Vertex) requests, and Google-family models routed via OpenRouter (none = omit). Sent as the top-level `serviceTier` field.",
		type: "enum",
		values: ["none", "flex", "priority"],
		options: [{ value: "none", label: "None", description: "Standard processing" }, { value: "flex", label: "Flex", description: "Lower cost, higher latency (Gemini API + Vertex)" }, { value: "priority", label: "Priority", description: "Faster, higher reliability (Gemini API + Vertex)" }]
	},
	"tier.openai": {
		label: "Service Tier \\u2014 OpenAI",
		group: "Sampling",
		description: "Processing tier for OpenAI / OpenAI-Codex requests, and OpenAI-family models routed via OpenRouter (none = omit). Sent as `service_tier`.",
		type: "enum",
		values: ["none", "auto", "default", "flex", "scale", "priority"],
		options: [{ value: "none", label: "None", description: "Omit service_tier (standard processing)" }, { value: "auto", label: "Auto", description: "Provider default tier selection" }, { value: "default", label: "Default", description: "Standard priority processing" }, { value: "flex", label: "Flex", description: "Lower cost, higher latency when available" }, { value: "scale", label: "Scale", description: "Scale Tier credits when available" }, { value: "priority", label: "Priority", description: "Faster, higher cost (premium request)" }]
	},
	"tier.subagent": {
		label: "Service Tier \\u2014 Subagent",
		group: "Sampling",
		description: "Service Tier for spawned task/eval subagents. Inherit = match the main agent's live per-family tiers (tracks /fast); pick a value to apply it to whichever family the subagent's model belongs to.",
		type: "enum",
		values: ["inherit", "none", "auto", "default", "flex", "scale", "priority"],
		options: [{ value: "inherit", label: "Inherit", description: "Match the main agent's live per-family tiers" }, { value: "none", label: "None", description: "Standard processing" }, { value: "auto", label: "Auto", description: "Provider default tier selection (OpenAI family)" }, { value: "default", label: "Default", description: "Standard priority processing (OpenAI family)" }, { value: "flex", label: "Flex", description: "Flexible capacity tier (OpenAI/Google families)" }, { value: "scale", label: "Scale", description: "Scale Tier credits (OpenAI family)" }, { value: "priority", label: "Priority", description: "Priority on every supported family of the spawned model" }]
	},
	"title.refreshOnReplan": {
		label: "Refresh Title on Replan",
		group: "Modes",
		description: "Refresh generated session titles after todo init replans unless the title was set by the user",
		type: "boolean"
	},
	"todo.eager": {
		label: "Create Todos Automatically",
		group: "Todos",
		description: "How strongly to push automatic todo-list creation after the first message",
		type: "enum",
		values: ["default", "preferred", "always"],
		options: [{ value: "default", label: "Default", description: "Model decides; no automatic todo list" }, { value: "preferred", label: "Preferred", description: "Suggests a todo list on the first message (reminder, not forced)" }, { value: "always", label: "Always", description: "Forces a comprehensive todo list on the first message" }]
	},
	"todo.enabled": {
		label: "Todos",
		group: "Available Tools",
		description: "Enable the todo tool for task tracking",
		type: "boolean"
	},
	"todo.reminders": {
		label: "Todo Reminders",
		group: "Todos",
		description: "Remind the agent to complete todos before stopping",
		type: "boolean"
	},
	"todo.remindersMax": {
		label: "Todo Reminder Limit",
		group: "Todos",
		description: "Maximum number of todo reminders before giving up",
		type: "number",
		options: [{ value: "1", label: "1 reminder" }, { value: "2", label: "2 reminders" }, { value: "3", label: "3 reminders" }, { value: "5", label: "5 reminders" }]
	},
	"tools.abortOnFabricatedResult": {
		label: "Abort On Fabricated Tool Result",
		group: "Execution",
		description: "With in-band tool calls, stop the model immediately when it starts hallucinating a tool result mid-turn. Disable to let the model finish generating and discard the fabricated continuation instead.",
		type: "boolean"
	},
	"tools.approval": {
		label: "Tool Approval Policies",
		group: "Approvals",
		description: "Per-tool approval policies. Set to 'allow' to auto-approve, 'prompt' to require confirmation, or 'deny' to block. Overrides are honored in every approval mode.",
		type: "record"
	},
	"tools.approvalMode": {
		label: "Tool Approval",
		group: "Approvals",
		description: "Default approval behavior for tool calls. 'Always ask' auto-approves read-only tools only. 'Write' auto-approves read and workspace-write tools. 'Yolo' auto-approves all tiers; user policy may still prompt or block.",
		type: "enum",
		values: ["always-ask", "write", "yolo"],
		options: [{ value: "always-ask", label: "Always ask", description: "Auto-approve read-only tools; require confirmation for write and exec tools." }, { value: "write", label: "Write", description: "Auto-approve read-only and write tools; require confirmation for exec tools such as bash, eval, browser, and task." }, { value: "yolo", label: "Yolo", description: "Auto-approve read, write, and exec tools. User policy can still require confirmation or block calls." }]
	},
	"tools.artifactHeadBytes": {
		label: "Artifact Head Size (KB)",
		group: "Output Limits",
		description: "Amount of head content kept inline alongside the tail when output spills to artifact (middle elision). 0 disables \\u2014 keep tail only.",
		type: "number",
		options: [{ value: "0", label: "0 KB", description: "Disabled; tail-only truncation" }, { value: "1", label: "1 KB", description: "~250 tokens" }, { value: "2.5", label: "2.5 KB", description: "~625 tokens" }, { value: "5", label: "5 KB", description: "~1.25K tokens" }, { value: "10", label: "10 KB", description: "~2.5K tokens" }, { value: "20", label: "20 KB", description: "Default; ~5K tokens" }, { value: "50", label: "50 KB", description: "~12.5K tokens" }, { value: "100", label: "100 KB", description: "~25K tokens" }, { value: "200", label: "200 KB", description: "~50K tokens" }]
	},
	"tools.artifactSpillThreshold": {
		label: "Artifact Spill Threshold (KB)",
		group: "Output Limits",
		description: "Tool output above this size is saved as an artifact; tail is kept inline",
		type: "number",
		options: [{ value: "1", label: "1 KB", description: "~250 tokens" }, { value: "2.5", label: "2.5 KB", description: "~625 tokens" }, { value: "5", label: "5 KB", description: "~1.25K tokens" }, { value: "10", label: "10 KB", description: "~2.5K tokens" }, { value: "20", label: "20 KB", description: "~5K tokens" }, { value: "30", label: "30 KB", description: "~7.5K tokens" }, { value: "50", label: "50 KB", description: "Default; ~12.5K tokens" }, { value: "75", label: "75 KB", description: "~19K tokens" }, { value: "100", label: "100 KB", description: "~25K tokens" }, { value: "200", label: "200 KB", description: "~50K tokens" }, { value: "500", label: "500 KB", description: "~125K tokens" }, { value: "1000", label: "1 MB", description: "~250K tokens" }]
	},
	"tools.artifactTailBytes": {
		label: "Artifact Tail Size (KB)",
		group: "Output Limits",
		description: "Amount of tail content kept inline when output spills to artifact",
		type: "number",
		options: [{ value: "1", label: "1 KB", description: "~250 tokens" }, { value: "2.5", label: "2.5 KB", description: "~625 tokens" }, { value: "5", label: "5 KB", description: "~1.25K tokens" }, { value: "10", label: "10 KB", description: "~2.5K tokens" }, { value: "20", label: "20 KB", description: "Default; ~5K tokens" }, { value: "50", label: "50 KB", description: "~12.5K tokens" }, { value: "100", label: "100 KB", description: "~25K tokens" }, { value: "200", label: "200 KB", description: "~50K tokens" }]
	},
	"tools.artifactTailLines": {
		label: "Artifact Tail Lines",
		group: "Output Limits",
		description: "Maximum lines of tail content kept inline when output spills to artifact",
		type: "number",
		options: [{ value: "50", label: "50 lines", description: "~250 tokens" }, { value: "100", label: "100 lines", description: "~500 tokens" }, { value: "250", label: "250 lines", description: "~1.25K tokens" }, { value: "500", label: "500 lines", description: "Default; ~2.5K tokens" }, { value: "1000", label: "1000 lines", description: "~5K tokens" }, { value: "2000", label: "2000 lines", description: "~10K tokens" }, { value: "5000", label: "5000 lines", description: "~25K tokens" }]
	},
	"tools.format": {
		label: "Tool Calling Mode",
		group: "Experimental",
		description: "Controls how tools are exposed to the model. Auto uses provider-native tool calls unless the selected model is marked as not supporting them, then falls back to the GLM owned dialect. Native forces provider-native tools; the other values force the named owned dialect. Applies on session start.",
		type: "enum",
		values: ["auto", "native", "glm", "hermes", "kimi", "xml", "anthropic", "deepseek", "harmony", "qwen3", "gemini", "gemma", "minimax"],
		options: [{ value: "auto", label: "Auto", description: "Use native tool calls unless the model is known not to support them." }, { value: "native", label: "Native", description: "Use provider-native tool calls." }, { value: "glm", label: "GLM", description: "Use GLM-style in-band tool calls." }, { value: "hermes", label: "Hermes", description: "Use Hermes-style in-band tool calls." }, { value: "kimi", label: "Kimi", description: "Use Kimi-style in-band tool calls." }, { value: "xml", label: "XML", description: "Use generic XML in-band tool calls." }, { value: "anthropic", label: "Anthropic", description: "Use Anthropic-style in-band tool calls." }, { value: "deepseek", label: "DeepSeek", description: "Use DeepSeek-style in-band tool calls." }, { value: "harmony", label: "Harmony", description: "Use Harmony-style in-band tool calls." }, { value: "qwen3", label: "Qwen3", description: "Use the Qwen3 owned dialect." }, { value: "gemini", label: "Gemini", description: "Use the Gemini owned dialect." }, { value: "gemma", label: "Gemma", description: "Use the Gemma owned dialect." }, { value: "minimax", label: "MiniMax", description: "Use the MiniMax owned dialect." }]
	},
	"tools.intentTracing": {
		label: "Intent Tracing",
		group: "Execution",
		description: "Ask the agent to describe the intent of each tool call before executing it",
		type: "boolean"
	},
	"tools.maxTimeout": {
		label: "Max Tool Timeout",
		group: "Execution",
		description: "Maximum timeout in seconds the agent can set for any tool (0 = no limit)",
		type: "number",
		options: [{ value: "0", label: "No limit" }, { value: "30", label: "30 seconds" }, { value: "60", label: "60 seconds" }, { value: "120", label: "120 seconds" }, { value: "300", label: "5 minutes" }, { value: "600", label: "10 minutes" }]
	},
	"tools.outputMaxColumns": {
		label: "Output Column Cap",
		group: "Output Limits",
		description: "Per-line byte cap for streaming tool outputs (bash, python, js eval) and `read`. Lines wider than this are ellipsis-truncated; remaining bytes up to the next newline are dropped. 0 disables.",
		type: "number",
		options: [{ value: "0", label: "Off", description: "No per-line cap" }, { value: "256", label: "256", description: "Tight" }, { value: "512", label: "512" }, { value: "768", label: "768", description: "Default" }, { value: "1024", label: "1024" }, { value: "2048", label: "2048" }, { value: "4096", label: "4096", description: "Loose" }]
	},
	"tools.speculativeExecution.enabled": {
		label: "Experimental Speculative Execution",
		group: "Execution",
		description: "Enable the discard-safe first slice: validated local reads through direct read calls and nested eval. Network requests, provider completions, and live filesystem writes are not part of this baseline.",
		type: "boolean"
	},
	"tools.speculativeExecution.maxInFlight": {
		label: "Speculative Execution Concurrency",
		group: "Execution",
		description: "Maximum number of validated local reads allowed to run before normal dispatch.",
		type: "number",
		options: [{ value: "1", label: "1 operation" }, { value: "2", label: "2 operations" }, { value: "3", label: "3 operations" }, { value: "4", label: "4 operations" }]
	},
	"tools.xdev": {
		label: "xd:// Tools",
		group: "Discovery & MCP",
		description: "Mount rarely-used (discoverable) tools under xd:// device URLs driven via read/write instead of shipping their schemas on every request. Sessions whose explicit tool list grants read but omits write mount devices through a device-only write transport (filesystem writes stay rejected). Disable to expose every enabled tool top-level.",
		type: "boolean"
	},
	"tools.xdevDocs": {
		label: "xd:// Prompt Docs",
		group: "Discovery & MCP",
		description: "Choose which mounted-device docs and schemas are inlined in the system prompt. Built-ins keeps core tools inline while MCP and extension tools stay on-demand.",
		type: "enum",
		values: ["inline", "builtins", "catalog"],
		options: [{ value: "inline", label: "All Devices", description: "Inline docs and schemas for every mounted device." }, { value: "builtins", label: "Built-ins Only", description: "Inline built-in docs; fetch MCP and extension docs on demand." }, { value: "catalog", label: "Catalog Only", description: "List every device; fetch all docs on demand." }]
	},
	"tools.xdevInlineDevices": {
		label: "xd:// Inline Devices",
		group: "Discovery & MCP",
		description: "When xd:// Prompt Docs is Built-ins Only, inline dynamic devices whose names match these glob patterns (for example mcp__context_mode_*). Catalog Only ignores this setting.",
		type: "array"
	},
	"topK": {
		label: "Top K",
		group: "Sampling",
		description: "Sample from top-K tokens (-1 = provider default)",
		type: "number",
		options: [{ value: "-1", label: "Default", description: "Use provider default" }, { value: "1", label: "1", description: "Greedy top token" }, { value: "20", label: "20", description: "Focused" }, { value: "40", label: "40", description: "Balanced" }, { value: "100", label: "100", description: "Broad" }]
	},
	"topP": {
		label: "Top P",
		group: "Sampling",
		description: "Nucleus sampling cutoff (0-1, -1 = provider default)",
		type: "number",
		options: [{ value: "-1", label: "Default", description: "Use provider default" }, { value: "0.1", label: "0.1", description: "Very focused" }, { value: "0.3", label: "0.3", description: "Focused" }, { value: "0.5", label: "0.5", description: "Balanced" }, { value: "0.9", label: "0.9", description: "Broad" }, { value: "1", label: "1", description: "No nucleus filtering" }]
	},
	"treeFilterMode": {
		label: "Session Tree Filter",
		group: "Input",
		description: "Default filter mode when opening the session tree",
		type: "enum",
		values: ["default", "no-tools", "user-only", "labeled-only", "all"]
	},
	"tts.localVoice": {
		label: "Local TTS Voice",
		group: "Services",
		description: "Kokoro voice used by the local TTS backend (American/British, female/male)",
		type: "enum",
		values: ["af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george", "bm_fable"],
		options: [{ value: "af_heart" }, { value: "af_bella" }, { value: "af_nicole" }, { value: "af_aoede" }, { value: "af_kore" }, { value: "af_sarah" }, { value: "am_michael" }, { value: "am_fenrir" }, { value: "am_puck" }, { value: "bf_emma" }, { value: "bm_george" }, { value: "bm_fable" }]
	},
	"ttsr.builtinRules": {
		label: "Built-in Rules",
		group: "Rules (TTSR)",
		description: "Load the default rules shipped with the agent (override individually with ttsr.disabledRules)",
		type: "boolean"
	},
	"ttsr.contextMode": {
		label: "TTSR Context Mode",
		group: "Rules (TTSR)",
		description: "What to do with partial output when TTSR triggers",
		type: "enum",
		values: ["discard", "keep"]
	},
	"ttsr.disabledRules": {
		label: "Disabled Rules",
		group: "Rules (TTSR)",
		description: "Rule names to ignore entirely (applies to bundled defaults and your own rules)",
		type: "array"
	},
	"ttsr.enabled": {
		label: "TTSR",
		group: "Rules (TTSR)",
		description: "Interrupt the agent mid-stream when output matches rule patterns (Time-Traveling Stream Rules)",
		type: "boolean"
	},
	"ttsr.interruptMode": {
		label: "TTSR Interrupt Mode",
		group: "Rules (TTSR)",
		description: "When to interrupt mid-stream vs inject warning after completion",
		type: "enum",
		values: ["always", "prose-only", "tool-only", "never"],
		options: [{ value: "always", label: "always", description: "Interrupt on prose and tool streams" }, { value: "prose-only", label: "prose-only", description: "Interrupt only on reply/thinking matches" }, { value: "tool-only", label: "tool-only", description: "Interrupt only on tool-call argument matches" }, { value: "never", label: "never", description: "Never interrupt; inject warning after completion" }]
	},
	"ttsr.repeatGap": {
		label: "TTSR Repeat Gap",
		group: "Rules (TTSR)",
		description: "Messages before a rule can trigger again",
		type: "number",
		options: [{ value: "5", label: "5 messages" }, { value: "10", label: "10 messages" }, { value: "15", label: "15 messages" }, { value: "20", label: "20 messages" }, { value: "30", label: "30 messages" }]
	},
	"ttsr.repeatMode": {
		label: "TTSR Repeat Mode",
		group: "Rules (TTSR)",
		description: "How rules can repeat: once per session or after a message gap",
		type: "enum",
		values: ["once", "after-gap"]
	},
	"tui.codexResetFireworks": {
		label: "Codex Reset Fireworks",
		group: "Display",
		description: "Celebrate unscheduled Codex weekly usage resets and newly banked saved resets with a top-third fireworks overlay that remains until Escape",
		type: "boolean"
	},
	"tui.hyperlinks": {
		label: "Terminal Hyperlinks",
		group: "Display",
		description: "Wrap paths and URLs in OSC 8 hyperlinks for terminal-native click-to-open (auto: detect support; off: never; always: unconditional)",
		type: "enum",
		values: ["off", "auto", "always"]
	},
	"tui.imeSafeCursor": {
		label: "IME-Safe Prompt Layout",
		group: "Display",
		description: "Move the prompt's bottom border to a separate row so macOS IME preedit cannot displace it",
		type: "boolean"
	},
	"tui.mouse": {
		label: "Mouse Click-to-Focus",
		group: "Display",
		description: "Capture mouse clicks in the main session so live subagent cards and HUD rows focus on click, with a hover highlight on the target. Native text selection becomes Shift+drag and wheel scroll becomes Shift+wheel while on",
		type: "boolean"
	},
	"tui.reactions": {
		label: "Agent Reactions",
		group: "Display",
		description: "Invite the agent to react to your message with an emoji badge on its bubble",
		type: "boolean"
	},
	"tui.renderMermaid": {
		label: "Render Mermaid Diagrams",
		group: "Display",
		description: "Render Mermaid fenced code blocks as ASCII diagrams",
		type: "boolean"
	},
	"tui.resizeScrollback": {
		label: "Resize Scrollback",
		group: "Display",
		description: "How a settled terminal resize refreshes transcript rows retained in terminal scrollback",
		type: "enum",
		values: ["append", "rebuild", "preserve"],
		options: [{ value: "append", label: "Append", description: "Replay the transcript at the new width below retained history" }, { value: "rebuild", label: "Rebuild", description: "Erase all terminal scrollback, then replay one current-width transcript" }, { value: "preserve", label: "Preserve", description: "Repaint only the viewport and keep history wrapped at its old width" }]
	},
	"tui.textSizing": {
		label: "Large Headings (Kitty)",
		group: "Display",
		description: "Render Markdown H1 headings at 2x scale using Kitty's OSC 66 text-sizing protocol. Only takes effect on Kitty terminals; ignored everywhere else. Off by default.",
		type: "boolean"
	},
	"tui.tight": {
		label: "Tight Layout",
		group: "Display",
		description: "Remove the 1-character horizontal padding from the left and right of the terminal output",
		type: "boolean"
	},
	"tui.titleSpinner": {
		label: "Terminal Title Spinner",
		group: "Display",
		description: "Glyph set for the working-state spinner in the terminal title \\u2014 braille sweep, filling moon, single-dot cycle, or ASCII-safe line",
		type: "enum",
		values: ["braille", "pulse", "dots", "line"],
		options: [{ value: "braille", label: "Braille", description: "Classic \\u280B\\u2819\\u2839 sweep (default)" }, { value: "pulse", label: "Pulse", description: "Moon filling \\u25CB\\u25D1\\u25CF then emptying" }, { value: "dots", label: "Dots", description: "Single braille dots cycling" }, { value: "line", label: "Line", description: "ASCII - \\\\ | / for fonts without braille coverage" }]
	},
	"tui.titleState": {
		label: "Terminal Title Run State",
		group: "Display",
		description: "Show the agent run state in the terminal title's separator \\u2014 an animated spinner while working (a static ':' under WSL), '>' when it's your turn, '!' when the agent is waiting on you",
		type: "boolean"
	},
	"tui.vimMode": {
		label: "Vim Editing Mode",
		group: "Input",
		description: "Modal prompt editing. Escape leaves Insert mode; Normal mode has hjkl, 0, $, ^, w, b, e, gg, G, counts, x/D/C, dd/yy, p and u; operators take motions or text objects (diw, ca(, dap); v/V start a Visual selection that y copies and d deletes",
		type: "boolean"
	},
	"tui.vimModeDisplay": {
		label: "Vim Mode Indicator",
		group: "Input",
		description: "How the current Vim mode appears in the status line",
		type: "enum",
		values: ["text", "icon", "none"],
		options: [{ value: "text", label: "Text", description: "Full mode name \\u2014 NORMAL, INSERT, VISUAL, V-LINE" }, { value: "icon", label: "Icon", description: "Single compact glyph per mode" }, { value: "none", label: "Hidden", description: "Do not show the mode in the status line" }]
	},
	"update.channel": {
		label: "Update Channel",
		group: "Startup & Updates",
		description: "Update channel used by omp update and the startup update check",
		type: "enum",
		values: ["stable", "canary"],
		options: [{ value: "stable", label: "Stable" }, { value: "canary", label: "Canary" }]
	},
	"vault.enabled": {
		label: "Obsidian Vault",
		group: "Available Tools",
		description: "Enable the vault:// internal URL for reading and editing Obsidian vault content via the Obsidian CLI. When disabled, vault:// resolution is refused and the vault:// entry is omitted from the system prompt.",
		type: "boolean"
	},
	"web_search.enabled": {
		label: "Web Search",
		group: "Available Tools",
		description: "Enable the web_search tool for live web results",
		type: "boolean"
	},
	"workspace.additionalDirectories": {
		label: "Additional Workspace Dirs",
		group: "General",
		description: "Extra workspace directories added to every session as additional roots (multi-root workspace). Managed live via /add-dir and /remove-dir. Paths resolve relative to cwd; absolute paths recommended. The agent is told these roots exist and can read/grep/glob them.",
		type: "array"
	},
	"worktree.base": {
		label: "Worktree Base Directory",
		group: "Isolation",
		description: "Base directory for agent-managed worktrees \\u2014 task-isolation copies, `github` PR checkouts, and `omp worktree` cleanup all live here. Unset uses ~/.omp/wt. Must be an absolute or ~-relative path; relative paths are ignored. The OMP_WORKTREE_DIR env var overrides this.",
		type: "string"
	},
	"worktree.cleanSource": {
		label: "Clean Source Checkout on /wt",
		group: "Isolation",
		description: "When creating a worktree with `/wt`, reset tracked changes and remove untracked files from the original checkout after carrying them over",
		type: "boolean"
	},
	"worktree.clone": {
		label: "Clone Checkout into Worktrees",
		group: "Isolation",
		description: "New worktrees from `github pr_checkout` and `git worktree add` in bash start as a copy-on-write clone of the current checkout so ignored build artifacts (node_modules, target) carry over; falls back to a plain checkout when the filesystem cannot clone",
		type: "boolean"
	},
};

import { OMP_CONFIG_GROUP_ZH, OMP_CONFIG_KEY_ZH, OMP_CONFIG_OPTION_ZH, OMP_CONFIG_OPTION_PAIR_ZH } from "./ompConfigZh";
import { OMP_CONFIG_DESC_ZH } from "./ompConfigDescZh";

/** Readable title for a config key: curated Chinese, else schema label, else derived. */
export function ompConfigTitle(key: string): string {
	const zh = OMP_CONFIG_KEY_ZH[key];
	if (zh) return zh;
	const label = OMP_CONFIG_META[key]?.label;
	if (label) return label;
	const seg = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
	const words = seg
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[-_\s]+/)
		.filter(Boolean);
	if (words.length === 0) return key;
	return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Schema sub-group for a key (e.g. "主题", "输入框"), Chinese, if known. */
export function ompConfigGroup(key: string): string | null {
	const group = OMP_CONFIG_META[key]?.group;
	if (!group) return null;
	return OMP_CONFIG_GROUP_ZH[group] ?? group;
}

/**
 * Long description for a config key: curated Chinese, else the English schema
 * description, else the runtime-listing fallback passed by the caller.
 */
export function ompConfigDescription(key: string, fallback = ""): string {
	return OMP_CONFIG_DESC_ZH[key] ?? OMP_CONFIG_META[key]?.description ?? fallback;
}

/**
 * Dropdown choices for a config key, or null when the value is free-form.
 * Strict enum values come first (labeled via ui.options when available);
 * number/string fields only expose their schema presets as suggestions.
 */
export function ompConfigOptions(key: string): OmpConfigOption[] | null {
	const meta = OMP_CONFIG_META[key];
	if (!meta) return null;
	if (meta.values && meta.values.length > 0) {
		const labeled = new Map((meta.options ?? []).map((o) => [o.value, o]));
		return meta.values.map((v) => labeled.get(v) ?? { value: v });
	}
	if (meta.options && meta.options.length > 0) return meta.options;
	return null;
}

/** Label for a dropdown choice: curated Chinese pair, shared Chinese value, schema label, raw value. */
export function ompConfigOptionLabel(key: string, opt: OmpConfigOption): string {
	const pair = OMP_CONFIG_OPTION_PAIR_ZH[`${key}:${opt.value}`];
	if (pair) return pair;
	const shared = OMP_CONFIG_OPTION_ZH[opt.value];
	if (shared) return shared;
	return opt.label ?? opt.value;
}
