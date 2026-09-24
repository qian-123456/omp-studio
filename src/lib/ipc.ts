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
	GitCommit,
	GitSummary,
	LiveSessionInfo,
	MobileStatus,
	PairingInfo,
	PendingUiRequest,
	ServiceInfo,
	SessionMeta,
	SessionMetaPatch,
	Settings,
	StartOpts,
	TmRun,
	Todo,
	TodoCounts,
	TranscriptPage,
	UsageSummary,
	WorktreeInfo,
	Workspace,
} from "./contracts";

// ---- LEAD ----

export const getSettings = () => invoke<Settings>("get_settings");

export const saveSettings = (settings: Settings) =>
	invoke<Settings>("save_settings", { settings });

export const appPaths = () => invoke<AppPaths>("app_paths");

// ---- A — catalog ----

export const listSessions = () => invoke<SessionMeta[]>("list_sessions");

export const getTranscript = (sessionId: string, fromOffset?: number) =>
	invoke<TranscriptPage>("get_transcript", {
		sessionId,
		fromOffset: fromOffset ?? null,
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

export const addWorkspace = (path: string) =>
	invoke<Workspace>("add_workspace", { path });

export const removeWorkspace = (id: string) =>
	invoke<void>("remove_workspace", { id });

export const reorderWorkspaces = (ids: string[]) =>
	invoke<void>("reorder_workspaces", { ids });

export const sessionUsage = (sessionId: string) =>
	invoke<UsageSummary>("session_usage", { sessionId });

export const rescanSessions = () => invoke<void>("rescan_sessions");

// ---- B — rpc ----

export const rpcStart = (opts: StartOpts) =>
	invoke<LiveSessionInfo>("rpc_start", { opts });

export const rpcEnsureLive = (sessionId: string) =>
	invoke<LiveSessionInfo>("rpc_ensure_live", { sessionId });

export const rpcSend = (sessionId: string, command: unknown) =>
	invoke<unknown>("rpc_send", { sessionId, command });

export const rpcUiRespond = (sessionId: string, response: unknown) =>
	invoke<void>("rpc_ui_respond", { sessionId, response });

export const rpcPendingUi = (sessionId: string) =>
	invoke<PendingUiRequest[]>("rpc_pending_ui", { sessionId });

export const rpcStop = (sessionId: string) =>
	invoke<void>("rpc_stop", { sessionId });

export const rpcListLive = () => invoke<LiveSessionInfo[]>("rpc_list_live");

export const takeoverExternal = (sessionId: string) =>
	invoke<LiveSessionInfo>("takeover_external", { sessionId });

export const createSideChat = (
	parentSessionId: string,
	question: string,
	selection?: string,
) =>
	invoke<LiveSessionInfo>("create_side_chat", {
		parentSessionId,
		question,
		selection: selection ?? null,
	});

// ---- C — git / time machine ----

export const gitSummary = (cwd: string) =>
	invoke<GitSummary>("git_summary", { cwd });

export const gitLog = (cwd: string, limit: number) =>
	invoke<GitCommit[]>("git_log", { cwd, limit });

export const gitDiff = (cwd: string, path?: string, sha?: string) =>
	invoke<string>("git_diff", {
		cwd,
		path: path ?? null,
		sha: sha ?? null,
	});

export const gitCreateWorktree = (repo: string, name: string) =>
	invoke<WorktreeInfo>("git_create_worktree", { repo, name });

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

// ---- D — todos / supervisor / summaries / diagnose ----

export const todosList = (includeClosed: boolean) =>
	invoke<Todo[]>("todos_list", { includeClosed });

export const todosAct = (id: string, action: "done" | "ignore") =>
	invoke<void>("todos_act", { id, action });

export const todosCounts = () => invoke<TodoCounts>("todos_counts");

export const supervisorRefresh = () => invoke<void>("supervisor_refresh");

export const summaryGet = (sessionId: string, ensure: boolean) =>
	invoke<string | null>("summary_get", { sessionId, ensure });

export const diagnoseBuildPrompt = (targetSessionId: string) =>
	invoke<string>("diagnose_build_prompt", { targetSessionId });

// ---- D — backlog ----

export const backlogList = () => invoke<BacklogItem[]>("backlog_list");

export const backlogAdd = (
	text: string,
	kind: BacklogKind,
	refs: BacklogRef[],
) => invoke<BacklogItem>("backlog_add", { text, kind, refs });

export const backlogUpdate = (id: string, patch: BacklogPatch) =>
	invoke<BacklogItem>("backlog_update", { id, patch });

export const backlogDelete = (id: string) =>
	invoke<void>("backlog_delete", { id });

export const backlogBuildPrompt = (id: string) =>
	invoke<string>("backlog_build_prompt", { id });

// ---- D — notify ----

export const notifyTest = () => invoke<void>("notify_test");

// ---- E — mobile / tunnel ----

export const mobileStart = () => invoke<MobileStatus>("mobile_start");

export const mobileStop = () => invoke<void>("mobile_stop");

export const mobileStatus = () => invoke<MobileStatus>("mobile_status");

export const mobileCreatePairing = () =>
	invoke<PairingInfo>("mobile_create_pairing");

export const mobileRevokeAll = () => invoke<void>("mobile_revoke_all");

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

export const termOpenSession = (sessionId: string, cols: number, rows: number) =>
	invoke<string>("term_open_session", { sessionId, cols, rows });

export const installStatusExtensionGlobally = () =>
	invoke<string>("install_status_extension_globally");
