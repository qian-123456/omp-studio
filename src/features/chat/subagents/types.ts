/**
 * omp `task` tool + subagent wire types (rpc protocol §1.4–1.6).
 * Shared by the live store reducer and the subagents UI; field names match
 * the JSON frames verbatim.
 */

export type SubagentStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "aborted";

/** One recent tool call inside `AgentProgress.recentTools`. */
export interface AgentRecentTool {
	tool: string;
	args?: unknown;
	argsKey?: string;
	intent?: string;
	isError?: boolean;
	endMs?: number;
}

export interface AgentRetryState {
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	errorMessage?: string;
	startedAtMs?: number;
}

/** `subagent_progress` payload.progress / `details.progress[]`. */
export interface AgentProgress {
	index: number;
	id: string;
	agent: string;
	/** bundled | user | project */
	agentSource?: string;
	status: SubagentStatus;
	task: string;
	assignment?: string;
	description?: string;
	lastIntent?: string;
	currentTool?: string;
	currentToolArgs?: unknown;
	currentToolArgsKey?: string;
	currentToolIntent?: string;
	currentToolStartMs?: number;
	recentTools: AgentRecentTool[];
	recentOutput: string[];
	toolCount: number;
	requests: number;
	/** input + output + cacheWrite; cacheRead excluded. */
	tokens: number;
	contextTokens?: number;
	contextWindow?: number;
	cost: number;
	durationMs: number;
	modelOverride?: string | string[];
	modelRole?: string;
	/** `provider/id[:thinking]`. */
	resolvedModel?: string;
	resolvedModelIdentity?: string;
	resolvedThinkingLevel?: string;
	resolvedModelIsFallback?: boolean;
	resolvedModelRoute?: string;
	advisor?: string;
	retryState?: AgentRetryState;
	retryFailure?: { attempt: number; errorMessage?: string };
	/** Nested task details for sub-subagents. */
	inflightTaskDetails?: TaskToolDetails | null;
}

/** Finished per-agent row in `TaskToolDetails.results`. */
export interface SingleResult extends AgentProgress {
	exitCode?: number;
	/** The subagent's final output text. */
	output?: string;
	stderr?: string;
	truncated?: boolean;
	structuredOutput?: unknown;
	error?: string;
	aborted?: boolean;
	abortReason?: string;
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: number;
	};
	outputPath?: string;
	outputMeta?: { lineCount?: number; charCount?: number };
	isolated?: boolean;
	patchPath?: string;
	hasRootChanges?: boolean;
	branchName?: string;
	branchBaseSha?: string;
	nestedPatches?: string[];
	nestedPatchPaths?: string[];
}

export interface TaskAsyncInfo {
	state: "running" | "completed" | "failed";
	jobId: string;
	type: "task";
}

/** `task` tool `result.details` / live `partialResult.details`. */
export interface TaskToolDetails {
	projectAgentsDir: string | null;
	results: SingleResult[];
	totalDurationMs: number;
	usage?: { totalTokens?: number; cost?: number };
	outputPaths?: string[];
	progress?: AgentProgress[];
	async?: TaskAsyncInfo;
}

/** `subagent_lifecycle` payload.status is `started` for a running agent. */
export type SubagentLifecycleStatus =
	| "started"
	| "completed"
	| "failed"
	| "aborted";

/** `subagent_lifecycle` frame payload. */
export interface SubagentLifecyclePayload {
	id: string;
	agent: string;
	agentSource?: string;
	description?: string;
	status: SubagentLifecycleStatus;
	sessionFile?: string;
	parentToolCallId?: string;
	index: number;
	detached?: boolean;
}

/** `subagent_progress` frame payload. */
export interface SubagentProgressPayload {
	index: number;
	/** Usually only on `progress.id`; tolerated at payload level too. */
	id?: string;
	description?: string;
	agent: string;
	agentSource?: string;
	task: string;
	parentToolCallId?: string;
	assignment?: string;
	progress: AgentProgress;
	sessionFile?: string;
	detached?: boolean;
}

/** `get_subagents` response row. */
export interface RpcSubagentSnapshot {
	id: string;
	index: number;
	agent: string;
	agentSource?: string;
	description?: string;
	status: string;
	task?: string;
	assignment?: string;
	sessionFile?: string;
	lastUpdate?: number;
	progress?: AgentProgress;
	parentToolCallId?: string;
}

/**
 * One subagent as tracked by the live store. `label` is kept populated for the
 * TopCapsule popover (agent ?? description ?? task preview ?? id).
 */
export interface SubagentInfo {
	status: SubagentStatus;
	label: string;
	index?: number;
	agent?: string;
	agentSource?: string;
	description?: string;
	task?: string;
	assignment?: string;
	sessionFile?: string;
	parentToolCallId?: string;
	progress?: AgentProgress;
	/** Epoch ms of the last lifecycle/progress frame. */
	lastUpdate?: number;
}
