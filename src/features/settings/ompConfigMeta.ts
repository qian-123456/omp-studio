/** [D] Curated OMP settings metadata (label / group / description) extracted from the
 * installed omp binary's embedded settings schema (the same data omp's /settings TUI uses).
 * Regenerate after an omp upgrade by re-extracting `label:` entries from the binary
 * (strings ~/.local/bin/omp — entries shaped `"key.path": { ... ui: { tab, group, label, description } }`).
 * Keys missing here (settings without UI metadata) fall back to a derived title.
 */

export interface OmpConfigMeta {
	label: string;
	group?: string;
	description?: string;
}

export const OMP_CONFIG_META: Record<string, OmpConfigMeta> = {
	"advisor.enabled": {
		label: "Enable Advisor",
		group: "Advisor"
	},
	"advisor.immuneTurns": {
		label: "Advisor Immune Turns",
		group: "Advisor",
		description: "After an advisor concern or blocker interrupts, route further concerns/blockers non-interruptingly for this many primary turns."
	},
	"advisor.maxNotesPerUpdate": {
		label: "Advisor Max Notes Per Update",
		group: "Advisor",
		description: "Maximum non-blocker advice notes accepted per advisor prompt update (1\\u201332; UI offers 1\\u20135 quick picks). Blockers are exempt."
	},
	"advisor.syncBacklog": {
		label: "Advisor Sync Backlog",
		group: "Advisor",
		description: "Pause the main agent for up to 30 seconds if the advisor falls behind by this many turns. Off disables catch-up delays."
	},
	"ask.enabled": {
		label: "Ask",
		group: "Available Tools"
	},
	"ask.notify": {
		label: "Ask Notification",
		group: "Notifications"
	},
	"ask.timeout": {
		label: "Ask Timeout",
		group: "Notifications",
		description: "Auto-select the recommended ask option after this many seconds (0 disables)"
	},
	"astEdit.enabled": {
		label: "AST Edit",
		group: "Available Tools"
	},
	"astGrep.enabled": {
		label: "AST Grep",
		group: "Available Tools"
	},
	"async.enabled": {
		label: "Async Execution",
		group: "Execution"
	},
	"autoResume": {
		label: "Auto Resume",
		group: "Startup & Updates"
	},
	"autocompleteMaxVisible": {
		label: "Autocomplete Items",
		group: "Input",
		description: "Max visible items in autocomplete dropdown (3-20)"
	},
	"autolearn.autoContinue": {
		label: "Auto-run capture at stop",
		group: "Auto-Learn",
		description: "When on, auto-run one private capture turn at stop (uses extra tokens). When off, only standing auto-learn guidance remains."
	},
	"autolearn.enabled": {
		label: "Auto-Learn (experimental)",
		group: "Auto-Learn"
	},
	"bash.allowCompoundCommands": {
		label: "Allow Compound Commands",
		group: "Bash"
	},
	"bash.autoBackground.enabled": {
		label: "Bash Auto-Background",
		group: "Bash"
	},
	"bash.direnv": {
		label: "direnv Auto-Load",
		group: "Bash"
	},
	"bash.direnvLoadTimeoutMs": {
		label: "direnv Load Timeout (ms)",
		group: "Bash"
	},
	"bash.enabled": {
		label: "Bash",
		group: "Bash"
	},
	"bash.patterns": {
		label: "Bash Approval Patterns",
		group: "Bash"
	},
	"bashInterceptor.enabled": {
		label: "Bash Interceptor",
		group: "Bash"
	},
	"branchSummary.enabled": {
		label: "Branch Summaries",
		group: "General"
	},
	"browser.cdpUrl": {
		label: "Browser CDP URL",
		group: "Grep & Browser"
	},
	"browser.cmux": {
		label: "cmux Browser",
		group: "Grep & Browser"
	},
	"browser.enabled": {
		label: "Browser",
		group: "Available Tools"
	},
	"browser.freezeOnTurnEnd": {
		label: "Freeze Browser Tabs On Turn End",
		group: "Grep & Browser"
	},
	"browser.headless": {
		label: "Headless Browser",
		group: "Grep & Browser"
	},
	"browser.idleCloseSec": {
		label: "Browser Idle Close Timeout",
		group: "Grep & Browser",
		description: "Close OMP-owned headless browser tabs idle longer than this many seconds (0 = never; session dispose still reaps). Applies only to OMP-launched headless tabs, never relay/CDP/spawned browsers or other sessions' tabs."
	},
	"browser.relay": {
		label: "Browser Relay",
		group: "Grep & Browser"
	},
	"browser.relayUrl": {
		label: "Browser Relay URL",
		group: "Grep & Browser"
	},
	"browser.screenshotDir": {
		label: "Screenshot Directory",
		group: "Grep & Browser"
	},
	"checkpoint.enabled": {
		label: "Checkpoint/Rewind",
		group: "Available Tools"
	},
	"codexResets.autoRedeem": {
		label: "Codex Auto-Redeem Saved Resets",
		group: "Services",
		description: "Spend saved Codex rate-limit resets automatically: restore an account blocked by an exhausted 5h or weekly window when a turn is stuck and no other account can take over, and salvage credits that are about to expire. unset asks before the first spend, yes spends without prompting, and no disables both checks."
	},
	"codexResets.keepCredits": {
		label: "Codex Auto-Redeem Reserve",
		group: "Services"
	},
	"codexResets.minBlockedMinutes": {
		label: "Codex Auto-Redeem Min Block",
		group: "Services"
	},
	"codexResets.salvageHorizonHours": {
		label: "Codex Reset Salvage Horizon",
		group: "Services"
	},
	"collab.autoStart": {
		label: "Auto Start",
		group: "Collab",
		description: "Host every interactive session via collab.relayUrl as it starts and publish it to the local registry (omp collab list); rooms rotate on session switch"
	},
	"collab.displayName": {
		label: "Display Name",
		group: "Collab"
	},
	"collab.relayUrl": {
		label: "Relay URL",
		group: "Collab"
	},
	"collab.webUrl": {
		label: "Web UI URL",
		group: "Collab"
	},
	"colorBlindMode": {
		label: "Color-Blind Mode",
		group: "Theme"
	},
	"commands.enableClaudeProject": {
		label: "Claude Project Commands",
		group: "Commands & Skills"
	},
	"commands.enableClaudeUser": {
		label: "Claude User Commands",
		group: "Commands & Skills"
	},
	"commands.enableOpencodeProject": {
		label: "OpenCode Project Commands",
		group: "Commands & Skills"
	},
	"commands.enableOpencodeUser": {
		label: "OpenCode User Commands",
		group: "Commands & Skills"
	},
	"compaction.asyncEnabled": {
		label: "Async Compaction",
		group: "Compaction"
	},
	"compaction.dropUseless": {
		label: "Elide Uneventful Results",
		group: "Compaction"
	},
	"compaction.enabled": {
		label: "Auto-Compact",
		group: "Compaction"
	},
	"compaction.experimentalContextManagement": {
		label: "Notes-backed context windows (experimental)",
		group: "Compaction"
	},
	"compaction.handoffSaveToDisk": {
		label: "Save Handoff Docs",
		group: "Compaction"
	},
	"compaction.idleEnabled": {
		label: "Idle Compaction",
		group: "Compaction"
	},
	"compaction.idleThresholdTokens": {
		label: "Idle Compaction Threshold",
		group: "Compaction",
		description: "Token count above which idle compaction triggers"
	},
	"compaction.idleTimeoutSeconds": {
		label: "Idle Compaction Delay",
		group: "Compaction",
		description: "Seconds to wait while idle before compacting"
	},
	"compaction.methodOrder": {
		label: "Compaction Method Order",
		group: "Compaction",
		description: "Preferred fallback order for automatic context maintenance; unavailable or failed methods advance to the next choice"
	},
	"compaction.midTurnEnabled": {
		label: "Mid-Turn Compaction",
		group: "Compaction"
	},
	"compaction.remoteStreamingV2Enabled": {
		label: "Remote Compaction V2",
		group: "Compaction"
	},
	"compaction.supersedeReads": {
		label: "Supersede Stale Reads",
		group: "Compaction"
	},
	"compaction.thresholdPercent": {
		label: "Compaction Threshold",
		group: "Compaction",
		description: "Percent threshold for context maintenance; set to Default to use legacy reserve-based behavior"
	},
	"compaction.thresholdTokens": {
		label: "Compaction Token Limit",
		group: "Compaction",
		description: "Fixed token limit for context maintenance; overrides percentage if set"
	},
	"completion.notify": {
		label: "Completion Notification",
		group: "Notifications"
	},
	"composer.recallClearedDrafts": {
		label: "Recall Cleared Drafts",
		group: "Input"
	},
	"composer.shape": {
		label: "Composer Shape",
		group: "Composer",
		description: "Visual layout of the input editor and status line"
	},
	"composer.tokenRate": {
		label: "Generation Rate",
		group: "Composer"
	},
	"computer.display": {
		label: "Computer Display",
		group: "Computer"
	},
	"computer.enabled": {
		label: "Computer",
		group: "Available Tools"
	},
	"computer.maxHeight": {
		label: "Computer Screenshot Height",
		group: "Computer"
	},
	"computer.maxWidth": {
		label: "Computer Screenshot Width",
		group: "Computer"
	},
	"contextPromotion.enabled": {
		label: "Auto-Promote Context",
		group: "General"
	},
	"debug.enabled": {
		label: "Debug",
		group: "Available Tools"
	},
	"defaultThinkingLevel": {
		label: "Thinking Level",
		group: "Thinking",
		description: "Reasoning depth for thinking-capable models"
	},
	"dev.autoqa": {
		label: "Auto QA",
		group: "Developer"
	},
	"dev.autoqaPush.endpoint": {
		label: "Auto QA Push Endpoint",
		group: "Developer"
	},
	"display.cacheMissMarker": {
		label: "Cache Miss Marker",
		group: "Display"
	},
	"display.collapseCompacted": {
		label: "Collapse Compacted History",
		group: "Display"
	},
	"display.hideToolActivity": {
		label: "Hide Tool Activity",
		group: "Display"
	},
	"display.pinnedAgents": {
		label: "Pinned Agents",
		group: "Display",
		description: "Pinned live-agent jump list above the editor (off hides it; collapsed shows a few rows with an expander; full lists all)"
	},
	"display.shimmer": {
		label: "Shimmer",
		group: "Display",
		description: "Animation style for working/loading messages"
	},
	"display.showTokenUsage": {
		label: "Show Token Usage",
		group: "Display"
	},
	"display.showTurnTime": {
		label: "Show Turn Time",
		group: "Display"
	},
	"display.smoothStreaming": {
		label: "Smooth Streaming",
		group: "Display"
	},
	"doubleEscapeAction": {
		label: "Double-Escape Action",
		group: "Input"
	},
	"edit.autoRepair.enabled": {
		label: "Auto-Repair Parse Regressions",
		group: "Editing"
	},
	"edit.blackbox.enabled": {
		label: "Record Parse Regressions",
		group: "Editing"
	},
	"edit.blockAutoGenerated": {
		label: "Block Auto-Generated Files",
		group: "Editing"
	},
	"edit.enforceSeenLines": {
		label: "Enforce Seen-Line Guard",
		group: "Editing"
	},
	"edit.fuzzyMatch": {
		label: "Fuzzy Match",
		group: "Editing"
	},
	"edit.fuzzyThreshold": {
		label: "Fuzzy Match Threshold",
		group: "Editing",
		description: "Similarity threshold (0-1) for accepting fuzzy matches"
	},
	"edit.mode": {
		label: "Edit Mode",
		group: "Editing"
	},
	"edit.recoverInlineEdits": {
		label: "Recover Inline Edit Payloads",
		group: "Editing"
	},
	"edit.streamingAbort": {
		label: "Abort on Failed Preview",
		group: "Editing"
	},
	"emojiAutocomplete": {
		label: "Emoji Autocomplete",
		group: "Input"
	},
	"error.notify": {
		label: "Error Notification",
		group: "Notifications"
	},
	"eval.autoBackground.enabled": {
		label: "Eval Auto-Background",
		group: "Eval & Runtimes"
	},
	"eval.js": {
		label: "JavaScript Eval Backend",
		group: "Eval & Runtimes"
	},
	"eval.py": {
		label: "Python Eval Backend",
		group: "Eval & Runtimes"
	},
	"eval.tools.enabled": {
		label: "Eval-Defined Tools",
		group: "Eval & Runtimes"
	},
	"eval.workpool.freshAgents": {
		label: "Fresh Workpool Agents",
		group: "Eval & Runtimes"
	},
	"exa.enabled": {
		label: "Exa",
		group: "Services"
	},
	"exa.searchDelayMs": {
		label: "Exa Search Delay",
		group: "Services"
	},
	"extendedContext": {
		label: "Extended Context",
		group: "General"
	},
	"extensionHandlers.toolCallTimeoutMs": {
		label: "Tool Call Handler Timeout (ms)",
		group: "Extensions"
	},
	"externalThinking": {
		label: "External Thinking",
		group: "Thinking",
		description: "Private scratchpad; not shown to user. Disables supported GPT, Claude, and Gemini reasoning"
	},
	"features.unexpectedStopDetection": {
		label: "Unexpected Stops",
		group: "Agent",
		description: "Automatically recover when the assistant stops without a visible message. Smart also classifies text-only stops with a small model."
	},
	"fetch.enabled": {
		label: "Read URLs",
		group: "Available Tools"
	},
	"find.enabled": {
		label: "Find (semantic grep)",
		group: "Available Tools"
	},
	"followUpMode": {
		label: "Follow-Up Mode",
		group: "Input"
	},
	"generate_image.enabled": {
		label: "Generate Image",
		group: "Available Tools"
	},
	"git.enabled": {
		label: "Enable Git Integration",
		group: "Git"
	},
	"github.cache.enabled": {
		label: "GitHub View Cache",
		group: "GitHub"
	},
	"github.cache.hardTtlSec": {
		label: "GitHub Cache Hard TTL",
		group: "GitHub"
	},
	"github.cache.softTtlSec": {
		label: "GitHub Cache Soft TTL",
		group: "GitHub"
	},
	"github.enabled": {
		label: "GitHub CLI",
		group: "Available Tools"
	},
	"glob.enabled": {
		label: "Glob",
		group: "Available Tools"
	},
	"goal.continuationModes": {
		label: "Goal Continuation Modes",
		group: "Modes"
	},
	"goal.enabled": {
		label: "Goal Mode",
		group: "Modes"
	},
	"goal.statusInFooter": {
		label: "Goal Status in Footer",
		group: "Modes"
	},
	"grep.contextAfter": {
		label: "Grep Context After",
		group: "Grep & Browser",
		description: "Lines of context after each grep match"
	},
	"grep.contextBefore": {
		label: "Grep Context Before",
		group: "Grep & Browser",
		description: "Lines of context before each grep match"
	},
	"grep.enabled": {
		label: "Grep",
		group: "Available Tools"
	},
	"hideThinkingBlock": {
		label: "Hide Thinking Blocks",
		group: "Thinking"
	},
	"hindsight.apiToken": {
		label: "Hindsight API Token",
		group: "Hindsight",
		description: "Bearer token for authenticated Hindsight servers"
	},
	"hindsight.apiUrl": {
		label: "Hindsight API URL",
		group: "Hindsight",
		description: "Hindsight server URL (Cloud or self-hosted)"
	},
	"hindsight.autoRecall": {
		label: "Hindsight Auto Recall",
		group: "Hindsight",
		description: "Recall memories on the first turn of each session"
	},
	"hindsight.autoRetain": {
		label: "Hindsight Auto Retain",
		group: "Hindsight",
		description: "Retain transcript every N turns and at session boundaries"
	},
	"hindsight.bankId": {
		label: "Hindsight Bank ID",
		group: "Hindsight",
		description: "Memory bank identifier (default: project name)"
	},
	"hindsight.mentalModelAutoSeed": {
		label: "Hindsight Mental Model Auto-Seed",
		group: "Hindsight",
		description: "At session start, create any built-in mental models (project-conventions, project-decisions, user-preferences) that do not yet exist on the bank."
	},
	"hindsight.mentalModelsEnabled": {
		label: "Hindsight Mental Models",
		group: "Hindsight",
		description: "Read curated reflect summaries (mental models) into developer instructions at boot. Loads existing models on the bank \\u2014 does not write. Pair with hindsight.mentalModelAutoSeed to also auto-create the built-in seed set."
	},
	"hindsight.retainMode": {
		label: "Hindsight Retain Mode",
		group: "Hindsight",
		description: "full-session = upsert one document per session, last-turn = chunked"
	},
	"hindsight.scoping": {
		label: "Hindsight Scoping",
		group: "Hindsight",
		description: "global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = shared bank with project tags so global + project memories merge on recall"
	},
	"images.autoResize": {
		label: "Auto-Resize Images",
		group: "Images"
	},
	"images.blockImages": {
		label: "Block Images",
		group: "Images"
	},
	"images.describeForTextModels": {
		label: "Describe Images for Text Models",
		group: "Vision"
	},
	"images.questionTimeoutMs": {
		label: "Image Question Timeout",
		group: "Execution",
		description: "Per-request timeout for the vision-model call behind read's ?q= image questions, in milliseconds. A stalled provider fails fast with a timeout error instead of blocking until manual abort. Set to 0 to disable the timeout."
	},
	"images.urls.backends": {
		label: "Image URL Backends",
		group: "Vision",
		description: "Ordered destinations tried when publishing images for provider access"
	},
	"images.urls.bindHost": {
		label: "Image URL Bind Host",
		group: "Vision"
	},
	"images.urls.command": {
		label: "Image Upload Command",
		group: "Vision"
	},
	"images.urls.enabled": {
		label: "Serve Images as URLs",
		group: "Vision"
	},
	"images.urls.publicBaseUrl": {
		label: "Image URL Public Base",
		group: "Vision"
	},
	"images.urls.sshRemotePort": {
		label: "Image URL SSH Remote Port",
		group: "Vision"
	},
	"images.urls.sshTarget": {
		label: "Image URL SSH Target",
		group: "Vision"
	},
	"images.urls.ttlHours": {
		label: "Image URL Lifetime (hours)",
		group: "Vision"
	},
	"includeModelInPrompt": {
		label: "Include Model in Prompt",
		group: "Prompt"
	},
	"includeWorkspaceTree": {
		label: "Include Workspace Tree",
		group: "Prompt"
	},
	"inlineToolDescriptors": {
		label: "Inline Tool Descriptors",
		group: "Prompt",
		description: "Render full tool descriptors in the system prompt and strip top-level/nested descriptions from provider tool schemas so descriptor text is sent once. Auto enables this for Gemini models and disables it otherwise"
	},
	"interruptMode": {
		label: "Interrupt Mode",
		group: "Input"
	},
	"irc.timeoutMs": {
		label: "IRC Timeout",
		group: "Execution",
		description: "Timeout for hub send await:true in milliseconds; 0 disables the timeout"
	},
	"isolation.backend": {
		label: "Isolation Backend",
		group: "Isolation",
		description: "Backend used for subagent isolation and worktree cloning"
	},
	"launch.enabled": {
		label: "Launch",
		group: "Available Tools"
	},
	"live.voice": {
		label: "Live Voice",
		group: "Services",
		description: "Voice used by Codex-backed realtime voice sessions"
	},
	"loop.conditionTimeoutMs": {
		label: "Loop Condition Timeout (ms)",
		group: "Input",
		description: "Max wait for a `/loop --while` / `--until` condition command before treating it as broken and stopping the loop. Set to 0 to wait indefinitely"
	},
	"loop.mode": {
		label: "Loop Mode",
		group: "Input",
		description: "What happens between /loop iterations before re-submitting the prompt"
	},
	"lsp.diagnosticsDeduplicate": {
		label: "Deduplicate Diagnostics",
		group: "LSP"
	},
	"lsp.diagnosticsOnEdit": {
		label: "Diagnostics on Edit",
		group: "LSP"
	},
	"lsp.diagnosticsOnWrite": {
		label: "Diagnostics on Write",
		group: "LSP"
	},
	"lsp.enabled": {
		label: "LSP",
		group: "LSP"
	},
	"lsp.formatOnWrite": {
		label: "Format on Write",
		group: "LSP"
	},
	"lsp.lazy": {
		label: "Lazy LSP Startup",
		group: "LSP"
	},
	"lsp.shared": {
		label: "Shared Language Servers",
		group: "LSP"
	},
	"magicKeywords.enabled": {
		label: "Magic Keywords",
		group: "Magic Keywords"
	},
	"marketplace.autoUpdate": {
		label: "Marketplace Auto-Update",
		group: "Startup & Updates",
		description: "Check for plugin updates on startup"
	},
	"mcp.enableProjectConfig": {
		label: "MCP Project Config",
		group: "Discovery & MCP"
	},
	"mcp.notificationDebounceMs": {
		label: "MCP Notification Debounce",
		group: "Discovery & MCP"
	},
	"mcp.notifications": {
		label: "MCP Update Injection",
		group: "Discovery & MCP"
	},
	"mcp.renderMarkdownResults": {
		label: "MCP Markdown Results",
		group: "Discovery & MCP"
	},
	"memory.backend": {
		label: "Memory Backend",
		group: "General",
		description: "Off, local summary pipeline, Mnemopi SQLite, Hindsight remote memory, or Sharpshooter"
	},
	"minP": {
		label: "Min P",
		group: "Sampling",
		description: "Minimum probability threshold (0-1, -1 = provider default)"
	},
	"mnemopi.autoRecall": {
		label: "Mnemopi Auto Recall",
		group: "Mnemopi",
		description: "Recall local memories into the first turn of each session"
	},
	"mnemopi.autoRetain": {
		label: "Mnemopi Auto Retain",
		group: "Mnemopi",
		description: "Retain completed conversation turns into local Mnemopi memory"
	},
	"mnemopi.bank": {
		label: "Mnemopi Bank",
		group: "Mnemopi",
		description: "Optional shared bank base name. Per-project modes derive project-local banks from it."
	},
	"mnemopi.dbPath": {
		label: "Mnemopi DB Path",
		group: "Mnemopi",
		description: "Optional SQLite DB path. Defaults to the agent memories directory."
	},
	"mnemopi.embeddingApiKey": {
		label: "Mnemopi Embedding API Key",
		group: "Mnemopi",
		description: "Optional embedding API key passed to Mnemopi"
	},
	"mnemopi.embeddingApiUrl": {
		label: "Mnemopi Embedding API URL",
		group: "Mnemopi",
		description: "Optional OpenAI-compatible embedding endpoint passed to Mnemopi"
	},
	"mnemopi.embeddingModel": {
		label: "Mnemopi Embedding Model",
		group: "Mnemopi",
		description: "Advanced: explicit embedding model id that overrides the variant. Leave empty to use mnemopi.embeddingVariant."
	},
	"mnemopi.embeddingVariant": {
		label: "Embedding variant",
		group: "Mnemopi",
		description: "Local embedding model family. en = stronger English model; multilingual = cross-language model. Changing this rebuilds existing memory embeddings on next start."
	},
	"mnemopi.enhancedRecall": {
		label: "Mnemopi Enhanced Recall",
		group: "Mnemopi",
		description: "Enable the tiered query result cache for repeated and similar recall queries"
	},
	"mnemopi.llmApiKey": {
		label: "Mnemopi LLM API Key",
		group: "Mnemopi",
		description: "Optional LLM API key for Mnemopi remote mode"
	},
	"mnemopi.llmBaseUrl": {
		label: "Mnemopi LLM Base URL",
		group: "Mnemopi",
		description: "Optional OpenAI-compatible LLM endpoint for Mnemopi remote mode"
	},
	"mnemopi.llmMode": {
		label: "Mnemopi LLM Mode",
		group: "Mnemopi",
		description: "Use no LLM, the online tiny model (the TINY role from /models, else @smol), or a remote OpenAI-compatible endpoint"
	},
	"mnemopi.llmModel": {
		label: "Mnemopi LLM Model",
		group: "Mnemopi",
		description: "Optional LLM model name for Mnemopi remote mode"
	},
	"mnemopi.noEmbeddings": {
		label: "Mnemopi Disable Embeddings",
		group: "Mnemopi",
		description: "Force deterministic FTS-only recall instead of vector embeddings"
	},
	"mnemopi.polyphonicRecall": {
		label: "Mnemopi Polyphonic Recall",
		group: "Mnemopi",
		description: "Enable 4-voice recall (vector, graph, fact, temporal) fused with reciprocal rank fusion"
	},
	"mnemopi.proactiveLinking": {
		label: "Mnemopi Proactive Linking",
		group: "Mnemopi",
		description: "Ingest new memories into the episodic graph as they are stored, linking them to related entities and memories"
	},
	"mnemopi.scoping": {
		label: "Mnemopi Scoping",
		group: "Mnemopi",
		description: "global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = project-local writes plus global recall visibility"
	},
	"model.loopGuard.checkAssistantContent": {
		label: "Loop Guard Scan Prose",
		group: "Thinking"
	},
	"model.loopGuard.enabled": {
		label: "Loop Guard",
		group: "Thinking"
	},
	"model.loopGuard.toolCallReminder": {
		label: "Loop Guard Tool-Call Reminder",
		group: "Thinking"
	},
	"model.toolCallLoopGuard.enabled": {
		label: "Tool-Call Loop Guard",
		group: "Thinking"
	},
	"model.toolCallLoopGuard.exemptTools": {
		label: "Tool-Call Loop Exempt Tools",
		group: "Thinking"
	},
	"model.toolCallLoopGuard.threshold": {
		label: "Tool-Call Loop Threshold",
		group: "Thinking"
	},
	"modelRoleStorage": {
		label: "Model Role Storage",
		group: "Prompt",
		description: "Where model selector role assignments are saved"
	},
	"omitThinking": {
		label: "Omit Thinking summaries",
		group: "Thinking"
	},
	"paste.largeMenuThreshold": {
		label: "Large Paste Menu",
		group: "Input",
		description: "When a paste reaches this many lines, offer a menu to wrap it in a code block, wrap it in XML tags, or save it to a file. 0 disables the menu (large pastes still collapse to a [Paste] marker)."
	},
	"personality": {
		label: "Personality",
		group: "Prompt",
		description: "Communication style rendered into the system prompt's personality block"
	},
	"plan.autosave": {
		label: "Autosave Plans",
		group: "Modes",
		description: "Automatically save approved plans to disk when plan mode completes"
	},
	"plan.autosaveDir": {
		label: "Autosave Directory",
		group: "Modes",
		description: "Directory for autosaved plans. Supports ~, absolute, and cwd-relative paths. Empty uses <project>/.omp/plans/."
	},
	"plan.defaultOnStartup": {
		label: "Start in Plan Mode",
		group: "Modes",
		description: "Automatically enter plan mode at the start of every new session"
	},
	"plan.enabled": {
		label: "Plan Mode",
		group: "Modes"
	},
	"power.sleepPrevention": {
		label: "Sleep Prevention",
		group: "Power",
		description: "Prevent the system sleeping during active sessions. Each level is cumulative \\u2014 it adds the flags of all lower levels."
	},
	"presencePenalty": {
		label: "Presence Penalty",
		group: "Sampling",
		description: "Penalty for introducing already-present tokens (-1 = provider default)"
	},
	"prewalk.enabled": {
		label: "Enable Prewalk",
		group: "Prewalk"
	},
	"proseOnlyThinking": {
		label: "Prose Only Thinking",
		group: "Thinking"
	},
	"provider.appendOnlyContext": {
		label: "Append-Only Context",
		group: "Protocol",
		description: "Cache system prompt + tool specs and keep an append-only message log so provider prefix caches (DeepSeek, Xiaomi/SGLang, Anthropic) hit at maximum rate. Auto enables for known prefix-cache providers."
	},
	"providers.anthropic.serverSideFallback": {
		label: "Anthropic Server-Side Fallback (Fable 5)",
		group: "Retry & Fallback"
	},
	"providers.antigravityEndpoint": {
		label: "Antigravity Endpoint Mode",
		group: "Services",
		description: "Endpoint routing strategy for google-antigravity providers (chat, search, image, discovery)"
	},
	"providers.autoThinkingMaxEffort": {
		label: "Auto Thinking Ceiling",
		group: "Thinking",
		description: "Highest effort the `auto` classifier may resolve. `xhigh` keeps the classifier one tier below the top, so only an explicit `ultrathink` reaches `max`; `max` lets a turn the classifier judges exceptional bill the top tier on models that expose it."
	},
	"providers.cacheRetention": {
		label: "Prompt Cache Retention",
		group: "Protocol",
		description: "Prompt-cache retention forwarded to providers that support it (Anthropic, Bedrock, OpenRouter, OpenAI)"
	},
	"providers.fetch": {
		label: "Fetch Provider",
		group: "Services",
		description: "Reader backend priority for the fetch/read URL tool"
	},
	"providers.fireworksTier": {
		label: "Fireworks Tier",
		group: "Fireworks"
	},
	"providers.kimiApiFormat": {
		label: "Kimi API Format",
		group: "Protocol",
		description: "API format for Kimi Code provider (auto follows live model metadata)"
	},
	"providers.maxInFlightRequests": {
		label: "Max In-Flight Requests",
		group: "Services"
	},
	"providers.ollama-cloud.maxConcurrency": {
		label: "Ollama Cloud Max Concurrency",
		group: "Services"
	},
	"providers.openai-codex.codeMode": {
		label: "Codex Code Mode",
		group: "Services"
	},
	"providers.openai-codex.codeModeDirectTools": {
		label: "Codex Code Mode Direct Tools",
		group: "Services"
	},
	"providers.openaiWebsockets": {
		label: "OpenAI WebSockets",
		group: "Protocol",
		description: "Websocket policy for OpenAI Codex models (auto uses model defaults, on forces, off disables)"
	},
	"providers.openrouterVariant": {
		label: "OpenRouter Routing",
		group: "Protocol",
		description: "Default routing-variant suffix appended to OpenRouter model IDs (overridden when the selector already names a variant)"
	},
	"providers.streamFirstEventTimeoutSeconds": {
		label: "Stream First Event Timeout",
		group: "Timeouts",
		description: "Seconds to wait for the first model stream event; -1 uses provider/env defaults, 0 disables the watchdog"
	},
	"providers.streamIdleTimeoutSeconds": {
		label: "Stream Idle Timeout",
		group: "Timeouts",
		description: "Seconds a model stream may stay silent between events; -1 uses provider/env defaults, 0 disables the watchdog"
	},
	"providers.tinyModelDevice": {
		label: "Tiny Model Device",
		group: "Tiny Model",
		description: "Inference backend for local tiny models (titles + memory): an ONNX execution provider, or `mlx` to download MLX weights and run them through mlx-lm on Apple silicon. Default uses CPU-only ONNX. The PI_TINY_DEVICE env var overrides this."
	},
	"providers.tinyModelDtype": {
		label: "Tiny Model Precision",
		group: "Tiny Model",
		description: "ONNX quantization/precision for local tiny models. Default uses each model's shipped dtype (q4); lower precision is faster, higher is more faithful. Ignored by the MLX backend (its repos are pre-quantized 4-bit). The PI_TINY_DTYPE env var overrides this."
	},
	"providers.webSearchTimeoutSeconds": {
		label: "Web Search Timeout",
		group: "Services"
	},
	"python.interpreter": {
		label: "Python Interpreter",
		group: "Eval & Runtimes"
	},
	"python.kernelMode": {
		label: "Python Kernel Mode",
		group: "Eval & Runtimes"
	},
	"read.defaultLimit": {
		label: "Default Read Limit",
		group: "Reading",
		description: "Default number of lines returned when agent calls read without a limit"
	},
	"read.renderMarkdown": {
		label: "Markdown Previews",
		group: "Reading"
	},
	"read.summarize.enabled": {
		label: "Read Summaries",
		group: "Read Summaries"
	},
	"read.summarize.minBodyLines": {
		label: "Read Summary Body Lines",
		group: "Read Summaries"
	},
	"read.summarize.minCommentLines": {
		label: "Read Summary Comment Lines",
		group: "Read Summaries"
	},
	"read.summarize.minTotalLines": {
		label: "Read Summary Minimum File Length",
		group: "Read Summaries"
	},
	"read.summarize.prose": {
		label: "Prose Summaries",
		group: "Read Summaries"
	},
	"read.summarize.unfoldLimit": {
		label: "Read Summary Unfold Ceiling",
		group: "Read Summaries"
	},
	"read.summarize.unfoldUntil": {
		label: "Read Summary Unfold Target",
		group: "Read Summaries"
	},
	"read.toolResultPreview": {
		label: "Inline Read Previews",
		group: "Reading"
	},
	"readLineNumbers": {
		label: "Line Numbers",
		group: "Reading"
	},
	"recap.enabled": {
		label: "Idle Recap",
		group: "Notifications"
	},
	"recap.idleSeconds": {
		label: "Idle Recap Delay",
		group: "Notifications",
		description: "Seconds to wait while idle before showing the recap"
	},
	"repetitionPenalty": {
		label: "Repetition Penalty",
		group: "Sampling",
		description: "Penalty for repeated tokens (-1 = provider default)"
	},
	"retry.fallbackChains": {
		label: "Retry Fallback Chains",
		group: "Retry & Fallback"
	},
	"retry.fallbackRevertPolicy": {
		label: "Fallback Revert Policy",
		group: "Retry & Fallback",
		description: "When to return to the primary model after a fallback"
	},
	"retry.maxDelayMs": {
		label: "Max Retry Delay",
		group: "Retry & Fallback"
	},
	"retry.maxRetries": {
		label: "Retry Attempts",
		group: "Retry & Fallback",
		description: "Maximum retry attempts on API errors"
	},
	"retry.modelFallback": {
		label: "Retry Model Fallback",
		group: "Retry & Fallback"
	},
	"retry.usageAwareFallback": {
		label: "Usage-Aware Fallback",
		group: "Retry & Fallback"
	},
	"retry.usageReservePct": {
		label: "Reserve Margin",
		group: "Retry & Fallback",
		description: "Treat a coding-plan model as near its limit below this remaining percentage. Unknown or unmapped usage keeps the primary model."
	},
	"retry.usageReservePolicy": {
		label: "Reserve Policy",
		group: "Retry & Fallback",
		description: "What to do when every same-provider coding-plan account is inside the reserve margin."
	},
	"retry.waitForUsageReset": {
		label: "Wait For Usage Reset",
		group: "Retry & Fallback"
	},
	"searxng.endpoint": {
		label: "SearXNG Endpoint",
		group: "Services"
	},
	"secrets.enabled": {
		label: "Hide Secrets",
		group: "Privacy"
	},
	"security.enabled": {
		label: "Security",
		group: "Available Tools"
	},
	"share.redactSecrets": {
		label: "Share Secret Redaction",
		group: "Collab"
	},
	"share.serverUrl": {
		label: "Share Server",
		group: "Collab"
	},
	"share.store": {
		label: "Share Store",
		group: "Collab",
		description: "Where /share uploads the encrypted session blob"
	},
	"sharpshooter.model": {
		label: "Sharpshooter Model",
		group: "Sharpshooter"
	},
	"shellMinimizer.enabled": {
		label: "Shell Minimizer",
		group: "Bash"
	},
	"shellMinimizer.sourceOutlineLevel": {
		label: "Shell Minimizer Source Outline",
		group: "Bash"
	},
	"showHardwareCursor": {
		label: "Show Hardware Cursor",
		group: "Display"
	},
	"skillful": {
		label: "List Skills in Prompt",
		group: "Prompt"
	},
	"skills.enableSkillCommands": {
		label: "Skill Commands",
		group: "Commands & Skills"
	},
	"snapcompact.shape": {
		label: "Snapcompact Shape",
		group: "Experimental",
		description: "Frame shape snapcompact prints text with (compaction archive and inline imaging). Auto picks a shape tuned for the current model."
	},
	"snapcompact.systemPrompt": {
		label: "Snapcompact System Prompt",
		group: "Experimental",
		description: "Experimental: render selected system prompt text as dense PNG image(s) and attach to the first user message (vision models only). Saves tokens; loses prompt caching for imaged text."
	},
	"snapcompact.toolResults": {
		label: "Snapcompact Tool Results",
		group: "Experimental"
	},
	"speech.enabled": {
		label: "Speech Vocalization",
		group: "Services"
	},
	"speech.enhanced": {
		label: "Enhanced Speech Rewriting",
		group: "Services"
	},
	"speech.mode": {
		label: "Speech Vocalization Mode",
		group: "Services",
		description: "What to speak: all = assistant messages + thinking; assistant = messages only; yield = only the final message at turn end"
	},
	"speech.voice": {
		label: "Speech Vocalization Voice",
		group: "Services",
		description: "Kokoro voice used when speaking the assistant's output aloud"
	},
	"speechgen.enabled": {
		label: "Speech Generation",
		group: "Available Tools"
	},
	"spelling.autocomplete": {
		label: "Word Autocomplete (macOS)",
		group: "Input",
		description: "Show macOS dictionary word completions as inline hints accepted with Tab"
	},
	"spelling.autocorrect": {
		label: "Autocorrect (macOS)",
		group: "Input",
		description: "Apply confident macOS spelling corrections after completed words"
	},
	"spelling.typoDetection": {
		label: "Typo Detection (macOS)",
		group: "Input",
		description: "Mark misspelled prompt words with the active macOS dictionaries"
	},
	"startup.changelogMode": {
		label: "Startup Changelog",
		group: "Startup & Updates",
		description: "Choose whether update notes start as a summary, full details, or stay hidden"
	},
	"startup.checkUpdate": {
		label: "Check for Updates",
		group: "Startup & Updates"
	},
	"startup.quiet": {
		label: "Quiet Startup",
		group: "Startup & Updates"
	},
	"startup.setupWizard": {
		label: "Setup Wizard",
		group: "Startup & Updates"
	},
	"startup.showSplash": {
		label: "Show Startup Splash",
		group: "Startup & Updates"
	},
	"statusLine.compactThinkingLevel": {
		label: "Compact Thinking Level",
		group: "Status Line"
	},
	"statusLine.contextLine": {
		label: "Context-Reactive Line",
		group: "Status Line",
		description: "How the line between the left and right segments reflects context usage (box composer only)"
	},
	"statusLine.preset": {
		label: "Status Line Preset",
		group: "Status Line",
		description: "Pre-built status line configurations"
	},
	"statusLine.separator": {
		label: "Status Line Separator",
		group: "Status Line",
		description: "Style of separators between segments"
	},
	"statusLine.sessionAccent": {
		label: "Session Accent",
		group: "Status Line"
	},
	"statusLine.showHookStatus": {
		label: "Show Hook Status",
		group: "Status Line"
	},
	"statusLine.transparent": {
		label: "Transparent Status Line",
		group: "Status Line"
	},
	"steeringMode": {
		label: "Steering Mode",
		group: "Input"
	},
	"stream.redactPatterns": {
		label: "Extra Redaction Patterns",
		group: "Stream"
	},
	"stream.serverUrl": {
		label: "Stream Server",
		group: "Stream"
	},
	"stt.enabled": {
		label: "Speech-to-Text",
		group: "Speech"
	},
	"stt.submitTrigger": {
		label: "Speech-to-Text Submit Trigger",
		group: "Speech",
		description: "Choose when speech dictation automatically submits: Never, Release (2+ words), Release with complete sentence, or When I Say Submit."
	},
	"symbolPreset": {
		label: "Symbol Preset",
		group: "Theme",
		description: "Glyph set for icons and symbols (Unicode, Nerd Font, or ASCII)"
	},
	"task.agentIdleTtlMs": {
		label: "Agent Idle TTL",
		group: "Subagents"
	},
	"task.batch": {
		label: "Batch Task Calls",
		group: "Subagents"
	},
	"task.eager": {
		label: "Prefer Task Delegation",
		group: "Subagents",
		description: "How strongly to push delegating work to subagents"
	},
	"task.enableEffort": {
		label: "Per-Task Effort",
		group: "Subagents"
	},
	"task.enableLsp": {
		label: "LSP in Subagents",
		group: "Subagents"
	},
	"task.isolation.apply": {
		label: "Apply Isolated Changes",
		group: "Isolation"
	},
	"task.isolation.commits": {
		label: "Isolation Commit Style",
		group: "Isolation",
		description: "Commit message style for nested repo changes (generic or AI-generated)"
	},
	"task.isolation.enabled": {
		label: "Isolate Subagents",
		group: "Isolation"
	},
	"task.isolation.merge": {
		label: "Isolation Merge Strategy",
		group: "Isolation",
		description: "How isolated task changes are integrated (patch apply or branch merge)"
	},
	"task.maxConcurrency": {
		label: "Max Concurrent Tasks",
		group: "Subagents",
		description: "Maximum number of subagents running concurrently"
	},
	"task.maxEffort": {
		label: "Maximum Per-Spawn Effort",
		group: "Subagents",
		description: "Maximum reasoning effort allowed for the task tool's per-spawn effort hint. Lower values prevent callers from escalating subagents above this ceiling; the default preserves the model's full range."
	},
	"task.maxRecursionDepth": {
		label: "Max Task Recursion",
		group: "Subagents",
		description: "How many levels deep subagents can spawn their own subagents"
	},
	"task.maxRuntimeMs": {
		label: "Max Subagent Runtime",
		group: "Subagents",
		description: "Hard wall-clock limit per subagent (ms). 0 disables it. Defense-in-depth against provider-side stream hangs that escape the inference-layer watchdog; triggers a normal subagent abort with a 'timed out' reason."
	},
	"task.prewalk": {
		label: "Generic Task Prewalk",
		group: "Subagents"
	},
	"task.showResolvedModelBadge": {
		label: "Show Resolved Model Badge",
		group: "Display"
	},
	"task.softRequestBudget": {
		label: "Soft Subagent Request Budget",
		group: "Subagents",
		description: "Soft per-subagent request budget (assistant requests per run). Crossing it injects a wrap-up steering notice (see task.softRequestBudgetNotice); at 1.5x the budget the run is force-stopped and the agent must yield its partial findings. 0 disables the guard. Bundled scout/sonic agents cap out at a lower built-in budget, so a value below that cap still applies to them."
	},
	"task.softRequestBudgetNotice": {
		label: "Soft Request Budget Notice",
		group: "Subagents"
	},
	"tasks.todoClearDelay": {
		label: "Todo Auto-Clear Delay",
		group: "Todos",
		description: "Delay before completed or abandoned todos are removed from the todo widget"
	},
	"temperature": {
		label: "Temperature",
		group: "Sampling",
		description: "Sampling temperature (0 = deterministic, 1 = creative, -1 = provider default)"
	},
	"terminal.showImages": {
		label: "Show Inline Images",
		group: "Images",
		description: "Render images inline in the terminal"
	},
	"terminal.showProgress": {
		label: "Native Terminal Progress",
		group: "Display"
	},
	"textVerbosity": {
		label: "Text Verbosity",
		group: "Sampling",
		description: "OpenAI Responses and Codex response verbosity (low, medium, or high)"
	},
	"theme.dark": {
		label: "Dark Theme",
		group: "Theme",
		description: "Theme used when the terminal has a dark background"
	},
	"theme.light": {
		label: "Light Theme",
		group: "Theme",
		description: "Theme used when the terminal has a light background"
	},
	"tier.advisor": {
		label: "Service Tier \\u2014 Advisor",
		group: "Sampling",
		description: "Service Tier for the advisor model. None = standard processing; Inherit = match the main agent's live per-family tiers; pick a value to apply it to the advisor model's family."
	},
	"tier.anthropic": {
		label: "Service Tier \\u2014 Anthropic",
		group: "Sampling"
	},
	"tier.google": {
		label: "Service Tier \\u2014 Google",
		group: "Sampling",
		description: "Processing tier for Gemini (Google AI Studio + Vertex) requests, and Google-family models routed via OpenRouter (none = omit). Sent as the top-level `serviceTier` field."
	},
	"tier.openai": {
		label: "Service Tier \\u2014 OpenAI",
		group: "Sampling",
		description: "Processing tier for OpenAI / OpenAI-Codex requests, and OpenAI-family models routed via OpenRouter (none = omit). Sent as `service_tier`."
	},
	"tier.subagent": {
		label: "Service Tier \\u2014 Subagent",
		group: "Sampling",
		description: "Service Tier for spawned task/eval subagents. Inherit = match the main agent's live per-family tiers (tracks /fast); pick a value to apply it to whichever family the subagent's model belongs to."
	},
	"title.refreshOnReplan": {
		label: "Refresh Title on Replan",
		group: "Modes"
	},
	"todo.eager": {
		label: "Create Todos Automatically",
		group: "Todos",
		description: "How strongly to push automatic todo-list creation after the first message"
	},
	"todo.enabled": {
		label: "Todos",
		group: "Available Tools"
	},
	"todo.reminders": {
		label: "Todo Reminders",
		group: "Todos"
	},
	"todo.remindersMax": {
		label: "Todo Reminder Limit",
		group: "Todos",
		description: "Maximum number of todo reminders before giving up"
	},
	"tools.abortOnFabricatedResult": {
		label: "Abort On Fabricated Tool Result",
		group: "Execution"
	},
	"tools.approval": {
		label: "Tool Approval Policies",
		group: "Approvals"
	},
	"tools.approvalMode": {
		label: "Tool Approval",
		group: "Approvals",
		description: "Default approval behavior for tool calls. 'Always ask' auto-approves read-only tools only. 'Write' auto-approves read and workspace-write tools. 'Yolo' auto-approves all tiers; user policy may still prompt or block."
	},
	"tools.artifactHeadBytes": {
		label: "Artifact Head Size (KB)",
		group: "Output Limits",
		description: "Amount of head content kept inline alongside the tail when output spills to artifact (middle elision). 0 disables \\u2014 keep tail only."
	},
	"tools.artifactSpillThreshold": {
		label: "Artifact Spill Threshold (KB)",
		group: "Output Limits",
		description: "Tool output above this size is saved as an artifact; tail is kept inline"
	},
	"tools.artifactTailBytes": {
		label: "Artifact Tail Size (KB)",
		group: "Output Limits",
		description: "Amount of tail content kept inline when output spills to artifact"
	},
	"tools.artifactTailLines": {
		label: "Artifact Tail Lines",
		group: "Output Limits",
		description: "Maximum lines of tail content kept inline when output spills to artifact"
	},
	"tools.format": {
		label: "Tool Calling Mode",
		group: "Experimental",
		description: "Controls how tools are exposed to the model. Auto uses provider-native tool calls unless the selected model is marked as not supporting them, then falls back to the GLM owned dialect. Native forces provider-native tools; the other values force the named owned dialect. Applies on session start."
	},
	"tools.intentTracing": {
		label: "Intent Tracing",
		group: "Execution"
	},
	"tools.maxTimeout": {
		label: "Max Tool Timeout",
		group: "Execution",
		description: "Maximum timeout in seconds the agent can set for any tool (0 = no limit)"
	},
	"tools.outputMaxColumns": {
		label: "Output Column Cap",
		group: "Output Limits",
		description: "Per-line byte cap for streaming tool outputs (bash, python, js eval) and `read`. Lines wider than this are ellipsis-truncated; remaining bytes up to the next newline are dropped. 0 disables."
	},
	"tools.speculativeExecution.enabled": {
		label: "Experimental Speculative Execution",
		group: "Execution"
	},
	"tools.speculativeExecution.maxInFlight": {
		label: "Speculative Execution Concurrency",
		group: "Execution",
		description: "Maximum number of validated local reads allowed to run before normal dispatch."
	},
	"tools.xdev": {
		label: "xd:// Tools",
		group: "Discovery & MCP"
	},
	"tools.xdevDocs": {
		label: "xd:// Prompt Docs",
		group: "Discovery & MCP",
		description: "Choose which mounted-device docs and schemas are inlined in the system prompt. Built-ins keeps core tools inline while MCP and extension tools stay on-demand."
	},
	"tools.xdevInlineDevices": {
		label: "xd:// Inline Devices",
		group: "Discovery & MCP"
	},
	"topK": {
		label: "Top K",
		group: "Sampling",
		description: "Sample from top-K tokens (-1 = provider default)"
	},
	"topP": {
		label: "Top P",
		group: "Sampling",
		description: "Nucleus sampling cutoff (0-1, -1 = provider default)"
	},
	"treeFilterMode": {
		label: "Session Tree Filter",
		group: "Input"
	},
	"tts.localVoice": {
		label: "Local TTS Voice",
		group: "Services",
		description: "Kokoro voice used by the local TTS backend (American/British, female/male)"
	},
	"ttsr.builtinRules": {
		label: "Built-in Rules",
		group: "Rules (TTSR)"
	},
	"ttsr.contextMode": {
		label: "TTSR Context Mode",
		group: "Rules (TTSR)"
	},
	"ttsr.disabledRules": {
		label: "Disabled Rules",
		group: "Rules (TTSR)"
	},
	"ttsr.enabled": {
		label: "TTSR",
		group: "Rules (TTSR)"
	},
	"ttsr.interruptMode": {
		label: "TTSR Interrupt Mode",
		group: "Rules (TTSR)",
		description: "When to interrupt mid-stream vs inject warning after completion"
	},
	"ttsr.repeatGap": {
		label: "TTSR Repeat Gap",
		group: "Rules (TTSR)",
		description: "Messages before a rule can trigger again"
	},
	"ttsr.repeatMode": {
		label: "TTSR Repeat Mode",
		group: "Rules (TTSR)"
	},
	"tui.codexResetFireworks": {
		label: "Codex Reset Fireworks",
		group: "Display"
	},
	"tui.hyperlinks": {
		label: "Terminal Hyperlinks",
		group: "Display"
	},
	"tui.imeSafeCursor": {
		label: "IME-Safe Prompt Layout",
		group: "Display"
	},
	"tui.mouse": {
		label: "Mouse Click-to-Focus",
		group: "Display"
	},
	"tui.reactions": {
		label: "Agent Reactions",
		group: "Display"
	},
	"tui.renderMermaid": {
		label: "Render Mermaid Diagrams",
		group: "Display"
	},
	"tui.resizeScrollback": {
		label: "Resize Scrollback",
		group: "Display",
		description: "How a settled terminal resize refreshes transcript rows retained in terminal scrollback"
	},
	"tui.textSizing": {
		label: "Large Headings (Kitty)",
		group: "Display"
	},
	"tui.tight": {
		label: "Tight Layout",
		group: "Display"
	},
	"tui.titleSpinner": {
		label: "Terminal Title Spinner",
		group: "Display",
		description: "Glyph set for the working-state spinner in the terminal title \\u2014 braille sweep, filling moon, single-dot cycle, or ASCII-safe line"
	},
	"tui.titleState": {
		label: "Terminal Title Run State",
		group: "Display"
	},
	"tui.vimMode": {
		label: "Vim Editing Mode",
		group: "Input"
	},
	"tui.vimModeDisplay": {
		label: "Vim Mode Indicator",
		group: "Input",
		description: "How the current Vim mode appears in the status line"
	},
	"update.channel": {
		label: "Update Channel",
		group: "Startup & Updates",
		description: "Update channel used by omp update and the startup update check"
	},
	"vault.enabled": {
		label: "Obsidian Vault",
		group: "Available Tools"
	},
	"web_search.enabled": {
		label: "Web Search",
		group: "Available Tools"
	},
	"workspace.additionalDirectories": {
		label: "Additional Workspace Dirs",
		group: "General"
	},
	"worktree.base": {
		label: "Worktree Base Directory",
		group: "Isolation"
	},
	"worktree.cleanSource": {
		label: "Clean Source Checkout on /wt",
		group: "Isolation"
	},
	"worktree.clone": {
		label: "Clone Checkout into Worktrees",
		group: "Isolation"
	},
};

import { OMP_CONFIG_GROUP_ZH, OMP_CONFIG_KEY_ZH } from "./ompConfigZh";

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
