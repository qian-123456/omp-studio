/**
 * Typed wrappers for every Tauri command in docs/ARCHITECTURE.md §7.
 * JS uses camelCase argument keys; Tauri maps them to snake_case.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
	AppPaths,
	BacklogItem,
	BacklogKind,
	BacklogPatch,
	BacklogRef,
	BaseSyncResult,
	BranchInfo,
	DdnsStatus,
	DiscoveredModel,
	DirEntry,
	GitHistory,
	GitBadge,
	GitSummary,
	LiveSessionInfo,
	McpConfigSnapshot,
	McpServerPatch,
	MergePreview,
	MobileStatus,
	Model,
	ModelContextWindowEdit,
	ModelKindEntry,
	ModelProbeKind,
	ModelProbeResult,
	ModelReplaceEdit,
	ModelReplaceRecord,
	ModelReplaceResult,
	ModelUsageScan,
	OauthLoginProvider,
	OauthLoginStatus,
	OmpConfigListResult,
	OmpProjectConfigFile,
	PromptComposition,
	ModelRoleSnapshot,
	ModelSwitchRuleInput,
	ModelTemplateInput,
	OmpProviderInfo,
	OmpImportResult,
	OmpUsageReportData,
	PairingInfo,
	PairingTarget,
	PathCheck,
	PerfBreakdown,
	PrivacyMarkScope,
	PrivacySnapshot,
	SecretClassification,
	SecretEntry,
	SecretEntryPatch,
	PendingUiRequest,
	PluginCatalog,
	ProcessMemoryInfo,
	ProviderApi,
	ProviderConfig,
	ProviderTestResult,
	PrUrlInfo,
	ServiceInfo,
	SessionMeta,
	SessionMetaPatch,
	SessionGroup,
	Settings,
	Schedule,
	ScheduleDraft,
	ScheduleRun,
	SkillsCatalog,
	SkillUsageReport,
	StartOpts,
	SpaceMode,
	SubagentSummary,
	SubagentTranscript,
	SwitchResult,
	SwitchStatus,
	TemplatePreview,
	TemplateStoreSnapshot,
	TmRun,
	Todo,
	TodoCounts,
	TranscriptPage,
	TurnCheckpoint,
	TurnUndoResult,
	SessionSnapshot,
	UsageSummary,
	WorktreeInfo,
	Workspace,
} from "./contracts";
import { useLive } from "../stores/live";

// ---- LEAD ----

export const getSettings = () => invoke<Settings>("get_settings");

export const saveSettings = (settings: Settings) =>
	invoke<Settings>("save_settings", { settings });

export const appPaths = () => invoke<AppPaths>("app_paths");

export const allowedToolsList = () => invoke<string[]>("allowed_tools_list");

// ---- A — catalog ----

export const listSessions = () => invoke<SessionMeta[]>("list_sessions");

export const getTranscript = (sessionId: string, fromOffset?: number, tailId?: string | null) =>
	invoke<TranscriptPage>("get_transcript", {
		sessionId,
		fromOffset: fromOffset ?? null,
		tailId: tailId ?? null,
	});

export const updateSessionMeta = (
	sessionId: string,
	patch: SessionMetaPatch,
) => invoke<SessionMeta>("update_session_meta", { sessionId, patch });

export const markSeen = (sessionId: string) =>
	invoke<void>("mark_seen", { sessionId });

export const acceptSession = (sessionId: string, archive: boolean) =>
	invoke<void>("accept_session", { sessionId, archive });

export const listWorkspaces = () => invoke<Workspace[]>("list_workspaces");

export const addWorkspace = (path: string, mode?: SpaceMode) =>
	invoke<Workspace>("add_workspace", { path, mode: mode ?? null });

export const removeWorkspace = (id: string) =>
	invoke<void>("remove_workspace", { id });

export const reorderWorkspaces = (ids: string[]) =>
	invoke<void>("reorder_workspaces", { ids });

export const listSessionGroups = () =>
	invoke<SessionGroup[]>("list_session_groups");

export const createSessionGroup = (mode: SpaceMode, name: string) =>
	invoke<SessionGroup>("create_session_group", { mode, name });

export const renameSessionGroup = (id: string, name: string) =>
	invoke<SessionGroup>("rename_session_group", { id, name });

export const deleteSessionGroup = (id: string) =>
	invoke<void>("delete_session_group", { id });

export const reorderSessionGroups = (ids: string[]) =>
	invoke<void>("reorder_session_groups", { ids });

/** Assign a global-workspace session to a group (null ungroups). */
export const setSessionGroup = (sessionId: string, groupId: string | null) =>
	invoke<void>("set_session_group", { sessionId, groupId });

export const sessionUsage = (sessionId: string) =>
	invoke<UsageSummary>("session_usage", { sessionId });
export const sessionSnapshot = (sessionId: string) =>
	invoke<SessionSnapshot>("session_snapshot", { sessionId });

export const listModels = () => invoke<Model[]>("list_models");
export const listWorkspaceFiles = (cwd: string) =>
	invoke<string[]>("list_workspace_files", { cwd });
export const rescanSessions = () => invoke<void>("rescan_sessions");

/** Permanently delete a session (refused while live). */
export const deleteSession = (sessionId: string) =>
	invoke<void>("delete_session", { sessionId });

export const sessionExportHtml = (sessionId: string) =>
	invoke<string>("session_export_html", { sessionId });

/** `omp share <file>`: uploads an E2E-encrypted snapshot, returns the share link. */
export const sessionShare = (sessionId: string) =>
	invoke<string>("session_share", { sessionId });

/** AI doctor diagnosis on a distilled session skeleton prompt; null model → settings.doctorModel. */
export const heatmapDiagnose = (prompt: string, model: string | null) =>
	invoke<string>("heatmap_diagnose", { prompt, model });

// ---- B — rpc ----

export const rpcStart = (opts: StartOpts) =>
	invoke<LiveSessionInfo>("rpc_start", { opts });

export const rpcEnsureLive = (sessionId: string, cwd?: string) =>
	invoke<LiveSessionInfo>("rpc_ensure_live", { sessionId, cwd: cwd ?? null });

export const rpcSend = (sessionId: string, command: unknown) =>
	invoke<unknown>("rpc_send", { sessionId, command });

export const rpcUiRespond = (sessionId: string, response: unknown) =>
	invoke<void>("rpc_ui_respond", { sessionId, response });

export const rpcPendingUi = (sessionId: string) =>
	invoke<PendingUiRequest[]>("rpc_pending_ui", { sessionId });

export const rpcStop = (sessionId: string) =>
	invoke<void>("rpc_stop", { sessionId });

export const rpcRestart = (sessionId: string) =>
	invoke<LiveSessionInfo>("rpc_restart", { sessionId });

export const rpcListLive = () => invoke<LiveSessionInfo[]>("rpc_list_live");

export const takeoverExternal = (sessionId: string) =>
	invoke<LiveSessionInfo>("takeover_external", { sessionId });

/** Fork the parent into a side chat. Never sends a prompt. */
export const createSideChat = (parentSessionId: string, model?: string) =>
	invoke<LiveSessionInfo>("create_side_chat", {
		parentSessionId,
		model: model ?? null,
	});

/** First message of a side chat: sends the rendered context+selection+question prompt. */
export const sideChatAsk = (
	sessionId: string,
	question: string,
	selection?: string,
) =>
	invoke<void>("side_chat_ask", {
		sessionId,
		question,
		selection: selection ?? null,
	});

/**
 * Full-session fork of the parent (cut at the last complete turn, or exactly
 * after `entryId`). Never sends a prompt; send the user's first message
 * with `sendPrompt` afterwards.
 */
export const forkSession = (parentId: string, entryId?: string, model?: string) =>
	invoke<LiveSessionInfo>("fork_session", {
		parentId,
		entryId: entryId ?? null,
		model: model ?? null,
	});

/** Contract C5: subagent sessions spawned by a parent session file. */
export const subagentList = (parentFile: string) =>
	invoke<SubagentSummary[]>("subagent_list", { parentFile });

/** Contract C5: normalized subagent transcript; `fromByte` for tailing. */
export const subagentTranscript = (
	parentFile: string,
	agentId: string,
	fromByte?: number,
) =>
	invoke<SubagentTranscript>("subagent_transcript", {
		parentFile,
		agentId,
		fromByte: fromByte ?? null,
	});

// ---- C — git / time machine ----

export const gitSummary = (cwd: string) =>
	invoke<GitSummary>("git_summary", { cwd });

/** Sidebar badge (branch/dirty/worktree); null when `cwd` is not a repo. */
export const gitBadge = (cwd: string) =>
	invoke<GitBadge | null>("git_badge", { cwd });

/** Main repo root for `cwd` (resolves linked worktrees); null when not a repo. */
export const gitRepoRoot = (cwd: string) =>
	invoke<string | null>("git_repo_root", { cwd });

export const gitLog = (cwd: string, limit: number) =>
	invoke<GitHistory>("git_log", { cwd, limit });

export const gitDiff = (cwd: string, path?: string, sha?: string) =>
	invoke<string>("git_diff", {
		cwd,
		path: path ?? null,
		sha: sha ?? null,
	});

export const gitCreateWorktree = (
	repo: string,
	name: string,
	opts?: { branch?: string; base?: string },
) =>
	invoke<WorktreeInfo>("git_create_worktree", {
		repo,
		name,
		branch: opts?.branch ?? null,
		base: opts?.base ?? null,
	});

export const gitListWorktrees = (repo: string) =>
	invoke<WorktreeInfo[]>("git_list_worktrees", { repo });

export const gitRemoveWorktree = (
	repo: string,
	path: string,
	deleteBranch: boolean,
	force: boolean,
) =>
	invoke<void>("git_remove_worktree", { repo, path, deleteBranch, force });

export const gitScanOrphans = () =>
	invoke<WorktreeInfo[]>("git_scan_orphans");

export const gitResetTo = (repo: string, sha: string, mode: "soft" | "hard") =>
	invoke<void>("git_reset_to", { repo, sha, mode });

export const gitRestoreFile = (repo: string, path: string) =>
	invoke<void>("git_restore_file", { repo, path });

export const gitListBranches = (repo: string) =>
	invoke<string[]>("git_list_branches", { repo });

export const gitListBranchesDetailed = (repo: string) =>
	invoke<BranchInfo[]>("git_list_branches_detailed", { repo });

export const gitDeleteBranch = (
	repo: string,
	branch: string,
	isRemote = false,
	force = false,
) => invoke<void>("git_delete_branch", { repo, branch, isRemote, force });

export const gitSyncBranch = (
	repo: string,
	branch: string,
	action: "fetch" | "pull" | "push",
) => invoke<string>("git_sync_branch", { repo, branch, action });

export const gitMergePreview = (
	repo: string,
	targetBranch: string,
	sourceBranch: string,
) => invoke<MergePreview>("git_merge_preview", { repo, targetBranch, sourceBranch });

export const gitMergeBranch = (repo: string, sourceBranch: string) =>
	invoke<string>("git_merge_branch", { repo, sourceBranch });

/** Patch of commits on HEAD since its merge-base with the local base branch. */
export const gitDiffBase = (cwd: string) => invoke<string>("git_diff_base", { cwd });

/** Rebase onto the base branch; conflicts abort and reject with `CONFLICT:\n<files>`. */
export const gitRebaseOntoBase = (cwd: string) => invoke<string>("git_rebase_onto_base", { cwd });

/** Reset tracked files to HEAD and remove untracked (non-ignored) files. */
export const gitDiscardAll = (cwd: string) => invoke<void>("git_discard_all", { cwd });

/** Merge base into the worktree's branch, then fast-forward the local base (local only). */
export const gitSyncWithBase = (cwd: string) =>
	invoke<BaseSyncResult>("git_sync_with_base", { cwd });

export const gitGetPrUrl = (
	repo: string,
	sourceBranch: string,
	targetBranch?: string,
) => invoke<PrUrlInfo>("git_get_pr_url", { repo, sourceBranch, targetBranch });

export const gitCommitSuggest = (cwd: string) =>
	invoke<string>("git_commit_suggest", { cwd });

/** Commits every uncommitted change (new files included). */
export const gitCommit = (cwd: string, message: string) =>
	invoke<string>("git_commit", { cwd, message });

/** Turn checkpoints of one session, oldest first. */
export const gitSessionTurns = (sessionFile: string) =>
	invoke<TurnCheckpoint[]>("git_session_turns", { sessionFile });

/** Turn checkpoints of every session whose cwd is this worktree, oldest first. */
export const gitWorktreeTurns = (cwd: string) =>
	invoke<TurnCheckpoint[]>("git_worktree_turns", { cwd });

/** Undo a turn of a session: also rolls back every later non-undone turn
 * (cascade). force=false refuses when files changed since those turns. */
export const gitUndoTurn = (
	cwd: string,
	sessionFile: string,
	turnId: string,
	force: boolean,
) =>
	invoke<TurnUndoResult>("git_undo_turn", { cwd, sessionFile, turnId, force });

/** Auto-commit rule text the checkpoints extension injects (for display). */
export const checkpointsRule = () => invoke<string>("checkpoints_rule");

export const tmRun = (repo: string, sha: string, command?: string) =>
	invoke<TmRun>("tm_run", { repo, sha, command: command ?? null });

export const tmList = () => invoke<TmRun[]>("tm_list");

export const tmStop = (runId: string, removeWorktree: boolean) =>
	invoke<void>("tm_stop", { runId, removeWorktree });

// ---- C — services + file IO ----

export const servicesList = (all: boolean) =>
	invoke<ServiceInfo[]>("services_list", { all });

export const servicesStop = (pid: number) =>
	invoke<void>("services_stop", { pid });

export const readTextFile = (path: string) =>
	invoke<string>("read_text_file", { path });

export const writeTextFile = (path: string, content: string) =>
	invoke<void>("write_text_file", { path, content });

/** Text plus the on-disk stamp used for conflict detection; null content = file missing. */
export interface StampedText {
	content: string | null;
	stamp: string | null;
}

export interface MemoryFileInfo {
	rel: string;
	editable: boolean;
}

export const ompMemoryProjects = () => invoke<string[]>("omp_memory_projects");
export const ompMemoryFiles = (slug: string) =>
	invoke<MemoryFileInfo[]>("omp_memory_files", { slug });
export const ompMemoryRead = (slug: string, rel: string) =>
	invoke<StampedText>("omp_memory_read", { slug, rel });
export const ompMemoryWrite = (slug: string, rel: string, content: string, expectedStamp: string | null) =>
	invoke<string | null>("omp_memory_write", { slug, rel, content, expectedStamp });
export const ompMemoryDeleteSkill = (slug: string, name: string) =>
	invoke<void>("omp_memory_delete_skill", { slug, name });
export const ompRuleRead = (path: string) => invoke<StampedText>("omp_rule_read", { path });
export const ompRuleWrite = (path: string, content: string, expectedStamp: string | null) =>
	invoke<string | null>("omp_rule_write", { path, content, expectedStamp });
export const ompAgentRead = (path: string) => invoke<StampedText>("omp_agent_read", { path });
export const ompAgentWrite = (path: string, content: string, expectedStamp: string | null) =>
	invoke<string | null>("omp_agent_write", { path, content, expectedStamp });

export const fsReadDir = (path: string) =>
	invoke<DirEntry[]>("fs_read_dir", { path });

export const validatePath = (path: string) =>
	invoke<PathCheck>("validate_path", { path });

export const saveClipboardImage = (base64Png: string) =>
	invoke<string>("save_clipboard_image", { base64Png });

/** Copy an image file into the app clip cache (asset-protocol readable,
 * outlives temp sources); returns the copy's path. */
export const importImageFile = (path: string) =>
	invoke<string>("import_image_file", { path });

/** Real filesystem paths of files on the macOS pasteboard (Finder copy).
 * Empty when the clipboard holds no file URLs or reading is unsupported. */
export const clipboardFilePaths = () =>
	invoke<string[]>("clipboard_file_paths");

/** Persist pasted/dropped bytes under the app cache dir; returns the path
 * used as the file-attachment reference (WKWebView File objects carry none). */
export const saveClipboardFile = (base64Data: string, fileName?: string) =>
	invoke<string>("save_clipboard_file", { base64Data, fileName: fileName ?? null });

export const saveShareImage = (base64Png: string, path: string) =>
	invoke<void>("save_share_image", { base64Png, path });

export type { PerfBreakdown, ProcessMemoryInfo } from "./contracts";

export const getAppMemoryUsage = () =>
	invoke<ProcessMemoryInfo>("app_memory_usage");

/** System memory split (app / omp spawned / external / other / free) + instances. */
export const perfBreakdown = () =>
	invoke<PerfBreakdown>("perf_breakdown");

// ---- D — todos / summaries / diagnose ----

export const todosList = (includeClosed: boolean) =>
	invoke<Todo[]>("todos_list", { includeClosed });

export const todosAct = (id: string, action: "done" | "ignore" | "reopen") =>
	invoke<void>("todos_act", { id, action });

export const todosCounts = () => invoke<TodoCounts>("todos_counts");


export const summaryGet = (sessionId: string, ensure: boolean) =>
	invoke<string | null>("summary_get", { sessionId, ensure });

export const diagnoseBuildPrompt = (targetSessionId: string) =>
	invoke<string>("diagnose_build_prompt", { targetSessionId });

/** Persisted app-local thread rows of a session (opaque JSON array; §6 `local_rows`). */
export const localRowsGet = (sessionId: string) =>
	invoke<unknown>("local_rows_get", { sessionId });

export const localRowsSet = (sessionId: string, rows: unknown[]) =>
	invoke<void>("local_rows_set", { sessionId, rows });

/** Send through the backend so busy sessions receive follow-up prompts.
 * Echoes the prompt optimistically so the sender sees it immediately —
 * the transcript page only refreshes on mount or turn end. */
export const dispatchPrompt = async (sessionId: string, prompt: string) => {
	await invoke<void>("dispatch_prompt", { sessionId, prompt });
	useLive.getState().addUserEcho(sessionId, prompt);
};

// ---- D — backlog ----

export const backlogList = () => invoke<BacklogItem[]>("backlog_list");

export const backlogAdd = (
	text: string,
	kind: BacklogKind,
	refs: BacklogRef[],
	projectDir?: string | null,
) =>
	invoke<BacklogItem>("backlog_add", {
		text,
		kind,
		refs,
		projectDir: projectDir ?? null,
	});

export const backlogUpdate = (id: string, patch: BacklogPatch) =>
	invoke<BacklogItem>("backlog_update", { id, patch });

/** Soft delete: moves items to the trash (sets `deletedAt`). */
export const backlogDelete = (ids: string[]) =>
	invoke<void>("backlog_delete", { ids });

/** Takes items out of the trash; they return to their previous status. */
export const backlogRestore = (ids: string[]) =>
	invoke<void>("backlog_restore", { ids });

/** Permanently deletes items (trash "彻底删除" / "清空废纸篓"). */
export const backlogPurge = (ids: string[]) =>
	invoke<void>("backlog_purge", { ids });

export const backlogBuildPrompt = (ids: string[]) =>
	invoke<string>("backlog_build_prompt", { ids });

// ---- D — notify ----

export const notifyTest = () => invoke<void>("notify_test");

// ---- D — settings (OMP config bridge) ----

export const ompConfigList = () => invoke<OmpConfigListResult>("omp_config_list");

export const ompConfigSet = (key: string, value: string) =>
	invoke<void>("omp_config_set", { key, value });

export const ompConfigReset = (key: string) =>
	invoke<void>("omp_config_reset", { key });

/** Read `<cwd>/.omp/config.yml` verbatim (exists=false when missing). */
export const ompProjectConfigRead = (cwd: string) =>
	invoke<OmpProjectConfigFile>("omp_project_config_read", { cwd });

/** Model-role snapshot for `cwd`: global and project layers plus every discovered agent resolved. */
export const ompModelRolesRead = (cwd: string | null, sessionModel: string | null) =>
	invoke<ModelRoleSnapshot>("omp_model_roles_read", { cwd, sessionModel });

/** Set (`value`) or delete (`null`) one `modelRoles` / `task.agentModelOverrides` entry in one scope. */
export const ompModelRolesSet = (
	cwd: string | null,
	scope: "global" | "project",
	table: "modelRoles" | "agentModelOverrides",
	name: string,
	value: string | null,
	sessionModel: string | null,
) => invoke<ModelRoleSnapshot>("omp_model_roles_set", { cwd, scope, table, name, value, sessionModel });

// ---- D — settings (bulk model replace, §7 model_replace.rs) ----

/** Every stored model reference across global/project config, app settings and schedules. */
export const modelUsageScan = () => invoke<ModelUsageScan>("model_usage_scan");

/** Apply planned edits; `recordId` appends to that record (retry of failed items). */
export const modelReplaceApply = (
	fromModel: string,
	toModel: string,
	edits: ModelReplaceEdit[],
	recordId: string | null = null,
) => invoke<ModelReplaceResult>("model_replace_apply", { fromModel, toModel, edits, recordId });

/** Applied replacements, newest first. */
export const modelReplaceHistory = () => invoke<ModelReplaceRecord[]>("model_replace_history");

/** Restore one record's previous values (items whose value changed again are skipped). */
export const modelReplaceUndo = (recordId: string) =>
	invoke<ModelReplaceResult>("model_replace_undo", { recordId });

/** One-shot real probe of a selector, exercised the way its kind is used; never called automatically. */
export const modelProbe = (model: string, kind: ModelProbeKind) =>
	invoke<ModelProbeResult>("model_probe", { model, kind });

/** Every catalog model of every kind (`omp models --kind all --json`); slow (~8s). */
export const modelKindCatalog = () => invoke<ModelKindEntry[]>("model_kind_catalog");

/** Spawns a throwaway no-session omp in `cwd` and returns what an empty new session would carry in context (no model call). */
export const promptCompositionProbe = (cwd: string) =>
	invoke<PromptComposition>("prompt_composition_probe", { cwd });

// ---- providers ----

export const providerList = () => invoke<ProviderConfig[]>("provider_list");

/** Upsert metadata; `apiKey` non-empty → (re)encrypt into the vault, else keep existing. */
export const providerSave = (config: ProviderConfig, apiKey?: string | null) =>
	invoke<ProviderConfig>("provider_save", { config, apiKey: apiKey ?? null });

export const providerDelete = (id: string) =>
	invoke<void>("provider_delete", { id });

export const providerSetEnabled = (id: string, enabled: boolean) =>
	invoke<void>("provider_set_enabled", { id, enabled });

export const providerReorder = (ids: string[]) =>
	invoke<void>("provider_reorder", { ids });

/** Real HTTP probe with the key decrypted in memory only. */
export const providerTest = (id: string) =>
	invoke<ProviderTestResult>("provider_test", { id });

/** Real HTTP probe for a specific model under a provider. */
export const providerTestModel = (id: string, modelId: string) =>
	invoke<ProviderTestResult>("provider_test_model", { id, modelId });

/** Fetches model list directly from the provider's API endpoint (without CORS restrictions). */
export const providerFetchModels = (
	baseUrl: string,
	api: ProviderApi,
	apiKey?: string | null,
	providerId?: string | null,
) =>
	invoke<DiscoveredModel[]>("provider_fetch_models", {
		baseUrl,
		apiKey: apiKey ?? null,
		api,
		providerId: providerId ?? null,
	});

/** Plaintext .env text (clipboard only — never persisted by the app). */
export const providerExportEnvText = (ids?: string[] | null) =>
	invoke<string>("provider_export_env_text", { ids: ids ?? null });

export const ompProvidersList = () =>
	invoke<OmpProviderInfo[]>("omp_providers_list");

export const providerImportOmp = (ids: string[]) =>
	invoke<OmpImportResult[]>("provider_import_omp", { ids });

/** Targeted edit of `~/.omp/agent/models.yml` modelOverrides contextWindow (null deletes). */
export const ompModelsSetContextWindows = (entries: ModelContextWindowEdit[]) =>
	invoke<void>("omp_models_set_context_windows", { entries });
/** Existing models.yml modelOverrides contextWindow values (only provider/model/window). */
export const ompModelsContextWindowOverrides = () =>
	invoke<ModelContextWindowEdit[]>("omp_models_context_window_overrides");

export const oauthLoginProviders = () =>
	invoke<OauthLoginProvider[]>("oauth_login_providers");

export const oauthLoginStart = (providerId: string) =>
	invoke<void>("oauth_login_start", { providerId });

export const oauthLoginRespond = (payload: Record<string, unknown>) =>
	invoke<void>("oauth_login_respond", { payload });

export const oauthLoginCancel = () =>
	invoke<void>("oauth_login_cancel");

export const oauthLoginOpenUrl = (url: string) =>
	invoke<void>("oauth_login_open_url", { url });

export const oauthLoginStatus = () =>
	invoke<OauthLoginStatus | null>("oauth_login_status");

export const ompUsageReport = (refresh?: boolean) =>
	invoke<OmpUsageReportData>("omp_usage_report", { refresh: refresh ?? false });

// ---- D — model templates + quota switching (角色模板与额度自动切换) ----

/** Templates, rules, switch log, settings, per-scope current templates and rule conflicts. */
export const modelTemplatesSnapshot = () =>
	invoke<TemplateStoreSnapshot>("model_templates_snapshot");

/**
 * New-template draft seeded from the `modelRoles` written in one scope's own config layer
 * (`scope`: `"global"` or a project directory; nothing is stored). A project scope reads only
 * the project file, never values inherited from the global config.
 */
export const modelTemplateCapture = (name: string, scope: string) =>
	invoke<ModelTemplateInput>("model_template_capture", { name, scope });

/** Create (`input.id === null`) or update one template; returns the fresh snapshot. */
export const modelTemplateSave = (input: ModelTemplateInput) =>
	invoke<TemplateStoreSnapshot>("model_template_save", { input });

/** Delete one template (and its rules); returns the fresh snapshot. */
export const modelTemplateDelete = (id: string) =>
	invoke<TemplateStoreSnapshot>("model_template_delete", { id });

/** Read-only diff against the template's own scope, with the quota preflight verdict. */
export const modelTemplatePreview = (templateId: string) =>
	invoke<TemplatePreview>("model_template_preview", { templateId });

/** Apply one template to its scope's config and push it to that scope's live sessions. */
export const modelTemplateApply = (templateId: string, force = false) =>
	invoke<SwitchResult>("model_template_apply", { templateId, force });

/** Validate then create/update one rule; returns the fresh snapshot. */
export const modelSwitchRuleSave = (input: ModelSwitchRuleInput) =>
	invoke<TemplateStoreSnapshot>("model_switch_rule_save", { input });

export const modelSwitchRuleDelete = (id: string) =>
	invoke<TemplateStoreSnapshot>("model_switch_rule_delete", { id });

/** Rewrite the order of one scope's rules (only that scope's ids); returns the fresh snapshot. */
export const modelSwitchRulesReorder = (scope: string, ids: string[]) =>
	invoke<TemplateStoreSnapshot>("model_switch_rules_reorder", { scope, ids });

/** Store the poll interval (60..=86400 s); returns the fresh snapshot. */
export const modelSwitchSettingsSet = (pollIntervalSecs: number) =>
	invoke<TemplateStoreSnapshot>("model_switch_settings_set", { pollIntervalSecs });

/** Live poller status: last check, last error, providers, blocked notice. */
export const modelSwitchStatus = (refresh?: boolean) =>
	invoke<SwitchStatus>("model_switch_status", { refresh: refresh ?? false });

/** Run one evaluation now; `null` = no rule hit and nothing was applied. */
export const modelSwitchRunNow = () =>
	invoke<SwitchResult | null>("model_switch_run_now");

/** Revert one switch log row. */
export const modelSwitchUndo = (logId: string) =>
	invoke<SwitchResult>("model_switch_undo", { logId });

// ---- E — mobile / tunnel ----

export const mobileStart = () => invoke<MobileStatus>("mobile_start");

export const mobileStop = () => invoke<void>("mobile_stop");

export const mobileStatus = () => invoke<MobileStatus>("mobile_status");

/** Generate a pairing link using the requested target network (LAN, Cloudflare tunnel, or IPv6 direct). */
export const mobileCreatePairing = (target: PairingTarget = "lan") =>
	invoke<PairingInfo>("mobile_create_pairing", { target });

export const mobileRevokeAll = () => invoke<void>("mobile_revoke_all");

export const mobileIpv6Start = () => invoke<MobileStatus>("mobile_ipv6_start");

export const mobileIpv6Stop = () => invoke<void>("mobile_ipv6_stop");

export const mobileDdnsSetToken = (token: string) =>
	invoke<DdnsStatus>("mobile_ddns_set_token", { token });

export const mobileDdnsClearToken = () => invoke<DdnsStatus>("mobile_ddns_clear_token");

export const mobileDdnsSync = () => invoke<DdnsStatus>("mobile_ddns_sync");

export const tunnelStart = () => invoke<MobileStatus>("tunnel_start");

export const tunnelStop = () => invoke<void>("tunnel_stop");

// ---- E — terminal ----

export const termOpen = (
	cwd: string,
	command: string[],
	cols: number,
	rows: number,
) => invoke<string>("term_open", { cwd, command, cols, rows });

export const termWrite = (termId: string, data: string) =>
	invoke<void>("term_write", { termId, data });

export const termResize = (termId: string, cols: number, rows: number) =>
	invoke<void>("term_resize", { termId, cols, rows });

export const termClose = (termId: string) =>
	invoke<void>("term_close", { termId });

export const termOpenSession = (
	sessionId: string,
	agent: string = "omp",
	cols: number = 80,
	rows: number = 24,
) => invoke<string>("term_open_session", { sessionId, agent, cols, rows });

/** Shell command that resumes the session in an external terminal with the app's
 * prompt-shaping flags (keeps the provider prompt cache warm). No API keys. */
export const sessionResumeCommand = (sessionId: string) =>
	invoke<string>("session_resume_command", { sessionId });

/** Records/clears the transcript the drawer's bare `omp` should resume. */
export const terminalSetCurrentSession = (path: string | null) =>
	invoke<void>("terminal_set_current_session", { path });

export const installStatusExtensionGlobally = () =>
	invoke<string>("install_status_extension_globally");

// ---- E — schedules (定时任务) ----

export const listSchedules = () => invoke<Schedule[]>("schedules_list");

export const saveSchedule = (schedule: ScheduleDraft) =>
	invoke<Schedule>("schedules_save", { schedule });

export const deleteSchedule = (id: string) =>
	invoke<void>("schedules_delete", { id });

export const setScheduleEnabled = (id: string, enabled: boolean) =>
	invoke<Schedule>("schedules_set_enabled", { id, enabled });

export const runScheduleNow = (id: string) =>
	invoke<ScheduleRun>("schedules_run_now", { id });

export const listScheduleRuns = (scheduleId: string, limit?: number) =>
	invoke<ScheduleRun[]>("schedule_runs", {
		scheduleId,
		limit: limit ?? null,
	});

// ---- F — skills & extensions (Skills 管理) ----

export const skillsList = (cwd?: string | null) =>
	invoke<SkillsCatalog>("skills_list", { cwd: cwd ?? null });

export const skillsRead = (path: string) =>
	invoke<string>("skills_read", { path });

/** Moves a whole skill directory to the OS Trash (restorable). */
export const skillsTrash = (dir: string) =>
	invoke<void>("skills_trash", { dir });

/** Per-skill trigger counts scanned from session transcripts over `days` days. */
export const skillsUsage = (days = 45) =>
	invoke<SkillUsageReport>("skills_usage", { days });

// ---- D — MCP servers + plugin enablement (omp-managed config files) ----

/** OMP-managed mcp.json files and their servers (secrets masked). */
export const mcpConfigList = (cwd?: string | null) =>
	invoke<McpConfigSnapshot>("mcp_config_list", { cwd: cwd ?? null });

/** Add/update a server entry; `patch` merges (`null` deletes; env/headers merge per key). */
export const mcpServerUpsert = (
	path: string,
	name: string,
	patch: McpServerPatch,
	cwd?: string | null,
) =>
	invoke<void>("mcp_server_upsert", { cwd: cwd ?? null, path, name, patch });

export const mcpServerRemove = (path: string, name: string, cwd?: string | null) =>
	invoke<void>("mcp_server_remove", { cwd: cwd ?? null, path, name });

/** Toggle `enabled` on the file defining `name` (sweeps stale user overrides). */
export const mcpServerSetEnabled = (
	name: string,
	enabled: boolean,
	cwd?: string | null,
) => invoke<void>("mcp_server_set_enabled", { cwd: cwd ?? null, name, enabled });

/** Atomically move an MCP server definition from one mcp.json file to another. */
export const mcpServerMove = (
	fromPath: string,
	toPath: string,
	name: string,
	cwd?: string | null,
) =>
	invoke<void>("mcp_server_move", {
		cwd: cwd ?? null,
		fromPath,
		toPath,
		name,
	});

/** Installed npm/link/marketplace plugins across user + project roots. */
export const pluginsList = (cwd?: string | null) =>
	invoke<PluginCatalog>("plugins_list", { cwd: cwd ?? null });

/** Toggle `plugins.<name>.enabled` in that scope's omp-plugins.lock.json. */
export const pluginSetEnabled = (
	name: string,
	enabled: boolean,
	cwd?: string | null,
) => invoke<void>("plugin_set_enabled", { cwd: cwd ?? null, name, enabled });

/** Permanently delete one discovered extension module (file or index dir). */
export const extensionDelete = (path: string, cwd?: string | null) =>
	invoke<void>("extension_delete", { cwd: cwd ?? null, path });

/** Re-enable a `.disabled`-suffixed extension by renaming it back (same dir). */
export const extensionEnableFile = (path: string, cwd?: string | null) =>
	invoke<void>("extension_enable_file", { cwd: cwd ?? null, path });

/** Resolve the configured omp binary, probe `omp --version`, and report agent-dir paths. */
export const ompInfo = () => invoke<import("./contracts").OmpInfo>("omp_info");
/** Run `omp update --check` (30s timeout) and parse current/latest versions. */
export const ompUpdateCheck = () =>
	invoke<import("./contracts").OmpUpdateStatus>("omp_update_check");
/** Run `omp update` (300s timeout) and re-probe `omp --version`. */
export const ompUpdateRun = () => invoke<import("./contracts").OmpUpdateResult>("omp_update_run");
/** Stat-only check: current omp binary fingerprint and live sessions spawned from an older one. */
export const rpcOmpStaleness = () => invoke<import("./contracts").OmpStaleness>("rpc_omp_staleness");

// --- [P] privacy placeholders ---
export const privacyList = () => invoke<PrivacySnapshot>("privacy_list");
export const privacyClassify = (sessionId: string | null, value: string) =>
	invoke<SecretClassification>("privacy_classify", { sessionId, value });
export const privacyMark = (
	sessionId: string | null,
	value: string,
	label: string | null,
	track: boolean,
	scope: PrivacyMarkScope = "all",
) => invoke<SecretEntry>("privacy_mark", { sessionId, value, label, track, scope });
export const privacyUpdate = (id: string, patch: SecretEntryPatch) =>
	invoke<SecretEntry>("privacy_update", { id, patch });
export const privacyDelete = (id: string) =>
	invoke<void>("privacy_delete", { id });
export const privacySessionEntryIds = (sessionId: string) =>
	invoke<string[]>("privacy_session_entry_ids", { sessionId });

// --- storage (设置 ▸ 存储空间) ---
export const storageOverview = () =>
	invoke<import("./contracts").StorageOverview>("storage_overview");
/** `drafts`: unsent composer draft texts (they live in localStorage, so the UI passes them in). */
export const storageImagesPreview = (drafts: string[]) =>
	invoke<import("./contracts").StorageGcSummary>("storage_images_preview", { drafts });
export const storageImagesClean = (drafts: string[]) =>
	invoke<import("./contracts").StorageGcSummary>("storage_images_clean", { drafts });
/** Startup GC; resolves null when the 24h throttle skipped the run. */
export const storageImageGcAuto = (drafts: string[]) =>
	invoke<import("./contracts").StorageGcSummary | null>("storage_image_gc_auto", { drafts });
export const storageClearWebCache = () => invoke<number>("storage_clear_web_cache");
export const storageCleanStatusRecords = () =>
	invoke<import("./contracts").StorageGcSummary>("storage_clean_status_records");
export const storageCompactDb = () =>
	invoke<import("./contracts").StorageCompactResult>("storage_compact_db");
export const storageSessionsOverview = () =>
	invoke<import("./contracts").StorageSessionsOverview>("storage_sessions_overview");
export const storageStaleSessionsPreview = (days: number) =>
	invoke<import("./contracts").StorageStalePreview>("storage_stale_sessions_preview", { days });
/** Move sessions (transcript + lock + artifacts dir) to the macOS Trash. */
export const storageTrashSessions = (ids: string[]) =>
	invoke<import("./contracts").StorageTrashReport>("storage_trash_sessions", { ids });
