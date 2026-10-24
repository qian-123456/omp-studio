import { AlertTriangle, Check, ExternalLink, FolderInput, Loader2, Tag, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../../components/Modal";
import { Notice } from "../../components/Notice";
import type { SessionMeta } from "../../lib/contracts";
import { isSessionBusy } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { setSessionGroup, takeoverExternal, updateSessionMeta } from "../../lib/ipc";
import { isInside } from "../../lib/paths";
import { sessionDisplayName } from "../../lib/sessionName";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { removeWorktreeFlow } from "../git/removeWorktree";
import { archiveSessions } from "./archiveUndo";
import { groupsForMode, useSessionGroups } from "./sessionGroups";
import { useSidebarStore } from "./sidebarStore";
import {
	type ArchiveWorktreeTarget,
	useSessionActions,
} from "./sessionActions";
import { useT } from "../../stores/language";

export function restoreSidebarFocus(prevElement: HTMLElement | null) {
	if (
		prevElement &&
		document.contains(prevElement) &&
		prevElement !== document.body &&
		!prevElement.hasAttribute("data-session-id")
	) {
		prevElement.focus();
		return;
	}
	const list = document.querySelector<HTMLElement>("[data-sidebar-list]");
	list?.focus();
}

function useDialogFocusRestore() {
	const prevFocusRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		prevFocusRef.current = (document.activeElement as HTMLElement) ?? null;
		return () => {
			const prev = prevFocusRef.current;
			requestAnimationFrame(() => {
				restoreSidebarFocus(prev);
			});
		};
	}, []);
}

function handleTabTrap(e: React.KeyboardEvent<HTMLElement>) {
	if (e.key !== "Tab") return;
	const dialog = e.currentTarget;
	const focusable = Array.from(
		dialog.querySelectorAll<HTMLElement>(
			'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
		),
	).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
	if (focusable.length === 0) return;
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (e.shiftKey) {
		if (
			document.activeElement === first ||
			!focusable.includes(document.activeElement as HTMLElement)
		) {
			e.preventDefault();
			last?.focus();
		}
	} else {
		if (
			document.activeElement === last ||
			!focusable.includes(document.activeElement as HTMLElement)
		) {
			e.preventDefault();
			first?.focus();
		}
	}
}

/** Keeps keys inside the dialog (except Escape, which Modal claims on window) and traps Tab. */
function dialogKeyDown(e: React.KeyboardEvent<HTMLElement>) {
	if (e.key !== "Escape") e.stopPropagation();
	handleTabTrap(e);
}

/**
 * Modal 1: Archive with Worktree Confirmation.
 * Portaled to body at Z_LAYER.modal.
 */
function ArchiveWorktreeModal({
	target,
	onClose,
}: {
	target: ArchiveWorktreeTarget;
	onClose: () => void;
}) {
	const { t } = useT();
	useDialogFocusRestore();
	const [busy, setBusy] = useState(false);
	const initialBtnRef = useRef<HTMLButtonElement>(null);
	const isMountedRef = useRef(true);

	useEffect(() => {
		isMountedRef.current = true;
		initialBtnRef.current?.focus();
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	// P9: Sibling sessions check
	const allSessions = useSessions((s) => s.sessions);
	const targetId = target.session.id;
	const wtPath = target.wt.path;

	const siblingSessions = useMemo(() => {
		const siblingIdsSet = new Set<string>();
		for (const id of target.wt.sessionIds ?? []) {
			if (id !== targetId) siblingIdsSet.add(id);
		}
		for (const s of Object.values(allSessions)) {
			if (s.id !== targetId && isInside(s.cwd, wtPath)) {
				siblingIdsSet.add(s.id);
			}
		}
		return Array.from(siblingIdsSet)
			.map((id) => allSessions[id])
			.filter((s): s is SessionMeta => Boolean(s));
	}, [allSessions, target.wt.sessionIds, targetId, wtPath]);

	const busyOrActiveSiblings = useMemo(() => {
		return siblingSessions.filter(
			(s) =>
				s.live ||
				isSessionBusy(s) ||
				s.status === "external" ||
				s.externalPid != null,
		);
	}, [siblingSessions]);

	const hasBusyOrActive = busyOrActiveSiblings.length > 0;

	const handleKeepWorktree = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await archiveSessions([target.session.id]);
			if (isMountedRef.current) onClose();
		} catch (err) {
			if (isMountedRef.current) toast.error(t("sessions.archiveFailed", { error: errMsg(err) }));
		} finally {
			if (isMountedRef.current) setBusy(false);
		}
	};

	const handleCleanWorktree = async () => {
		if (busy || hasBusyOrActive) return;
		setBusy(true);
		try {
			const removed = await removeWorktreeFlow(target.repo, target.wt);
			if (!isMountedRef.current) return;
			if (removed) {
				try {
					await Promise.race([
						useWorktrees.getState().refresh(),
						new Promise<void>((resolve) => setTimeout(resolve, 4000)),
					]);
				} catch {
					// refresh error shouldn't block archive
				}
				if (!isMountedRef.current) return;
				await archiveSessions([target.session.id]);
				if (!isMountedRef.current) return;
				onClose();
			}
		} catch (err) {
			if (isMountedRef.current) {
				toast.error(t("sessions.cleanOrArchiveFailed", { error: errMsg(err) }));
			}
		} finally {
			if (isMountedRef.current) {
				setBusy(false);
			}
		}
	};
	return (
		<Modal
			onClose={onClose}
			title={t("sessions.archiveAndCleanTitle")}
			icon={<AlertTriangle size={14} className="text-amber-400" />}
			size="md"
		>
			<div className="flex flex-col gap-3 p-5 pt-4 text-[var(--text)]" onKeyDown={dialogKeyDown}>

				<p className="text-xs text-[var(--text-muted)] leading-relaxed">
					{t("sessions.sessionLinkedWorktree")}
					<code className="mx-1 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text)] break-all">
						{target.wt.path}
					</code>
				</p>

				{target.wt.dirty > 0 && (
					<Notice tone="warning">
						{t("sessions.worktreeDirtyNoticePrefix")}
						<span className="font-bold">{target.wt.dirty}</span>
						{t("sessions.worktreeDirtyNoticeSuffix")}
					</Notice>
				)}

				<div className="mt-2 flex flex-col gap-2 text-xs">
					<button
						ref={initialBtnRef}
						type="button"
						disabled={busy}
						onClick={handleKeepWorktree}
						className="press-scale rounded-xl border border-[var(--border-divider)] bg-[var(--bg-hover)] p-3 text-left hover:bg-[var(--bg-active-fill)] transition-colors disabled:opacity-50"
					>
						<div className="font-semibold text-[var(--text)]">
							{t("sessions.archiveSessionOnly")}
						</div>
						<div className="text-[11px] text-[var(--text-muted)] mt-0.5">
							{t("sessions.archiveSessionOnlyDesc")}
						</div>
					</button>

					{siblingSessions.length > 0 && (
						<div
							className={`rounded-lg border p-2.5 text-xs leading-normal ${
								hasBusyOrActive
									? "border-rose-500/40 bg-rose-500/10 text-rose-300"
									: "border-[var(--border-divider)] bg-[var(--bg-hover)] text-[var(--text-muted)]"
							}`}
						>
							<span>
								{hasBusyOrActive
									? t("sessions.worktreeSiblingSessionsActive", {
											count: siblingSessions.length,
											active: busyOrActiveSiblings.length,
										})
									: t("sessions.worktreeSiblingSessions", { count: siblingSessions.length })}
							</span>
							{hasBusyOrActive && (
								<p className="mt-1 text-[11px] text-rose-300/90 font-medium">
									{t("sessions.worktreeActiveWarning")}
								</p>
							)}
						</div>
					)}

					<button
						type="button"
						disabled={busy || hasBusyOrActive}
						onClick={handleCleanWorktree}
						title={
							hasBusyOrActive
								? t("sessions.worktreeHasActiveSessionsTooltip", { names: busyOrActiveSiblings.map((s) => sessionDisplayName(s)).join(t("sessions.listSeparator")) })
								: undefined
						}
						className="press-scale rounded-xl border border-rose-500/40 bg-rose-950/20 p-3 text-left hover:bg-rose-950/40 text-rose-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
					>
						<div className="font-semibold flex items-center gap-1.5">
							{busy ? (
								<Loader2 size={13} className="animate-spin" />
							) : (
								<Trash2 size={13} />
							)}
							{t("sessions.archiveAndCleanWorktree")}
						</div>
						<div className="text-[11px] text-rose-300/80 mt-0.5">
							{hasBusyOrActive
								? t("sessions.worktreeStopActiveFirstDesc")
								: t("sessions.worktreeCleanPromptDesc")}
						</div>
					</button>

					<button
						type="button"
						onClick={onClose}
						className="press-scale mt-1 rounded-lg px-3 py-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] text-center transition-colors"
					>
						{t("common.cancel")}
					</button>
				</div>
			</div>
		</Modal>
	);
}

/**
 * Modal 2: Assign Session(s) to Workspace.
 * Portaled to body at Z_LAYER.modal.
 * Supports 1..N session ids (Contract 3).
 * Supports "恢复自动归属" with workspaceId: "" (R7).
 */
function AssignWorkspaceModal({
	sessionIds,
	onClose,
}: {
	sessionIds: string[];
	onClose: () => void;
}) {
	const { t } = useT();
	const workspaces = useSessions((s) => s.workspaces);
	const sessions = useSessions((s) => s.sessions);
	const activeMode = useSidebarStore((s) => s.activeMode);
	// Workspaces are per space: only the active mode's rows are assignable.
	const modeWorkspaces = useMemo(
		() => workspaces.filter((w) => w.mode === activeMode),
		[workspaces, activeMode],
	);
	const [busy, setBusy] = useState(false);
	useDialogFocusRestore();
	const initialBtnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		initialBtnRef.current?.focus();
	}, []);

	// Check if all selected sessions share a workspaceId
	const commonWorkspaceId = (() => {
		if (sessionIds.length === 0) return null;
		const first = sessions[sessionIds[0]]?.workspaceId ?? "";
		const allSame = sessionIds.every(
			(id) => (sessions[id]?.workspaceId ?? "") === first,
		);
		return allSame ? first : null;
	})();

	const handleAssign = async (targetWsId: string) => {
		if (busy) return;
		setBusy(true);
		try {
			const results = await Promise.allSettled(
				sessionIds.map((id) =>
					updateSessionMeta(id, { workspaceId: targetWsId }),
				),
			);
			const successes: SessionMeta[] = [];
			let failedCount = 0;
			for (const r of results) {
				if (r.status === "fulfilled") {
					successes.push(r.value);
				} else {
					failedCount++;
				}
			}

			if (successes.length > 0) {
				useSessions.getState().upsert(successes);
			}

			if (failedCount === sessionIds.length) {
				toast.error(
					sessionIds.length === 1
						? t("sessions.assignWorkspaceFailed")
						: t("sessions.assignWorkspaceFailedAll", { count: failedCount }),
				);
				return;
			}

			if (failedCount > 0) {
				toast.info(
					t("sessions.assignWorkspacePartial", { success: successes.length, failed: failedCount }),
				);
			} else {
				toast.success(
					targetWsId === "" ? t("sessions.assignWorkspaceRestored") : t("sessions.assignWorkspaceSuccess"),
				);
			}
			onClose();
		} catch (err) {
			toast.error(t("sessions.assignWorkspaceFailedError", { error: errMsg(err) }));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal
			onClose={onClose}
			title={
				sessionIds.length > 1
					? t("sessions.assignWorkspaceModalTitleMulti", { count: sessionIds.length })
					: t("sessions.assignWorkspaceModalTitleSingle")
			}
			icon={<FolderInput size={14} />}
			size="sm"
			closeOnBackdrop={!busy}
			closeOnEscape={!busy}
		>
			<div className="flex flex-col gap-3 p-5 pt-4 text-[var(--text)]" onKeyDown={dialogKeyDown}>

				<div className="max-h-64 overflow-y-auto space-y-1 pr-1">
					{modeWorkspaces.map((ws, idx) => {
						const isCurrent = commonWorkspaceId === ws.id;
						return (
							<button
								key={ws.id}
								ref={idx === 0 ? initialBtnRef : undefined}
								type="button"
								disabled={busy}
								onClick={() => handleAssign(ws.id)}
								className={`press-scale flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
									isCurrent
										? "bg-[var(--primary)]/15 text-[var(--primary)] font-medium"
										: "text-[var(--text)] hover:bg-[var(--bg-hover)]"
								}`}
							>
								<span className="truncate">
									{ws.kind === "global" ? `🌐 ${ws.name}` : `📁 ${ws.name}`}
								</span>
								{isCurrent && <Check size={14} className="shrink-0" />}
							</button>
						);
					})}

					<div className="my-1 border-t border-[var(--border-divider)]" />

					{/* R7: Reset workspace override by sending workspaceId: "" */}
					<button
						type="button"
						disabled={busy}
						onClick={() => handleAssign("")}
						className={`press-scale flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
							commonWorkspaceId === "" || commonWorkspaceId === null
								? "bg-[var(--primary)]/15 text-[var(--primary)] font-medium"
								: "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
						}`}
					>
						<span>{t("sessions.restoreAutoAssignment")}</span>
						{(commonWorkspaceId === "" || commonWorkspaceId === null) && (
							<Check size={14} className="shrink-0" />
						)}
					</button>
				</div>
			</div>
		</Modal>
	);
}

/**
 * Modal 2b: Move Session(s) into a SessionGroup (无项目 area only).
 * Portaled to body at Z_LAYER.modal. groupId null = 移回无分组.
 */
function MoveToGroupModal({
	sessionIds,
	onClose,
}: {
	sessionIds: string[];
	onClose: () => void;
}) {
	const { t } = useT();
	const groups = useSessionGroups((s) => s.groups);
	const loadGroups = useSessionGroups((s) => s.load);
	const activeMode = useSidebarStore((s) => s.activeMode);
	const sessions = useSessions((s) => s.sessions);
	const [busy, setBusy] = useState(false);
	useDialogFocusRestore();
	const initialBtnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		initialBtnRef.current?.focus();
		void loadGroups();
	}, [loadGroups]);

	const modeGroups = useMemo(
		() => groupsForMode(groups, activeMode),
		[groups, activeMode],
	);

	// Current common groupId across the selection (null when mixed).
	const commonGroupId = (() => {
		if (sessionIds.length === 0) return null;
		const first = sessions[sessionIds[0]]?.groupId ?? null;
		return sessionIds.every((id) => (sessions[id]?.groupId ?? null) === first)
			? first
			: null;
	})();

	const handleMove = async (groupId: string | null) => {
		if (busy) return;
		setBusy(true);
		try {
			const results = await Promise.allSettled(
				sessionIds.map((id) => setSessionGroup(id, groupId)),
			);
			const successes: SessionMeta[] = [];
			let failedCount = 0;
			for (let i = 0; i < results.length; i++) {
				const r = results[i];
				if (r.status === "fulfilled") {
					const cur = useSessions.getState().sessions[sessionIds[i]];
					if (cur) successes.push({ ...cur, groupId });
				} else {
					failedCount++;
				}
			}
			if (successes.length > 0) useSessions.getState().upsert(successes);

			if (failedCount === sessionIds.length) {
				toast.error(t("sessions.moveToGroupFailed"));
				return;
			}
			if (failedCount > 0) {
				toast.info(t("sessions.moveToGroupPartial", { success: successes.length, failed: failedCount }));
			} else {
				toast.success(groupId ? t("sessions.movedToGroup") : t("sessions.movedToNoGroup"));
			}
			onClose();
		} catch (err) {
			toast.error(t("sessions.moveToGroupFailedError", { error: errMsg(err) }));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal
			onClose={onClose}
			title={
				sessionIds.length > 1
					? t("sessions.moveToGroupModalTitleMulti", { count: sessionIds.length })
					: t("sessions.moveToGroupModalTitleSingle")
			}
			icon={<Tag size={14} />}
			size="sm"
			closeOnBackdrop={!busy}
			closeOnEscape={!busy}
		>
			<div className="flex flex-col gap-3 p-5 pt-4 text-[var(--text)]" onKeyDown={dialogKeyDown}>

				<div className="max-h-64 overflow-y-auto space-y-1 pr-1">
					{modeGroups.map((g, idx) => {
						const isCurrent = commonGroupId === g.id;
						return (
							<button
								key={g.id}
								ref={idx === 0 ? initialBtnRef : undefined}
								type="button"
								disabled={busy}
								onClick={() => handleMove(g.id)}
								className={`press-scale flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
									isCurrent
										? "bg-[var(--primary)]/15 text-[var(--primary)] font-medium"
										: "text-[var(--text)] hover:bg-[var(--bg-hover)]"
								}`}
							>
								<span className="truncate">{g.name}</span>
								{isCurrent && <Check size={14} className="shrink-0" />}
							</button>
						);
					})}

					{modeGroups.length === 0 && (
						<div className="px-3 py-2 text-[11px] text-[var(--text-dim)]">
							{t("sessions.noGroupsPrompt")}
						</div>
					)}

					<div className="my-1 border-t border-[var(--border-divider)]" />

					<button
						type="button"
						ref={modeGroups.length === 0 ? initialBtnRef : undefined}
						disabled={busy}
						onClick={() => handleMove(null)}
						className={`press-scale flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
							commonGroupId === null
								? "bg-[var(--primary)]/15 text-[var(--primary)] font-medium"
								: "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
						}`}
					>
						<span>{t("sessions.noGroupOption")}</span>
						{commonGroupId === null && <Check size={14} className="shrink-0" />}
					</button>
				</div>
			</div>
		</Modal>
	);
}

/**
 * Modal 3: Takeover Confirmation.
 * Portaled to body at Z_LAYER.modal.
 */
function TakeoverModal({
	sessionId,
	onClose,
}: {
	sessionId: string;
	onClose: () => void;
}) {
	const { t } = useT();
	useDialogFocusRestore();
	const [busy, setBusy] = useState(false);
	const confirmBtnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		confirmBtnRef.current?.focus();
	}, []);

	const handleConfirm = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await takeoverExternal(sessionId);
			useUi.getState().selectSession(sessionId);
			toast.success(t("sessions.takeoverExternalSuccess"));
			onClose();
		} catch (err) {
			toast.error(t("sessions.takeoverExternalFailed", { error: errMsg(err) }));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal
			onClose={onClose}
			title={t("sessions.takeoverModalTitle")}
			icon={<ExternalLink size={14} className="text-purple-400" />}
			size="sm"
			closeOnBackdrop={!busy}
			closeOnEscape={!busy}
		>
			<div className="flex flex-col gap-3 p-5 pt-4 text-[var(--text)]" onKeyDown={dialogKeyDown}>
				<p className="text-xs text-[var(--text-muted)] leading-relaxed">
					{t("sessions.takeoverModalDesc")}
					<strong className="text-rose-400 font-medium">
						{t("sessions.takeoverModalWarning")}
					</strong>
					{t("sessions.takeoverModalTrailing")}
				</p>
				<div className="mt-2 flex justify-end gap-2 text-xs">
					<button
						type="button"
						disabled={busy}
						onClick={onClose}
						className="press-scale rounded-lg px-3 py-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
					>
						{t("common.cancel")}
					</button>
					<button
						ref={confirmBtnRef}
						type="button"
						disabled={busy}
						onClick={handleConfirm}
						className="press-scale flex items-center gap-1.5 rounded-lg bg-purple-600 px-3.5 py-1.5 font-medium text-white hover:bg-purple-500 disabled:opacity-60 transition-colors"
					>
						{busy && <Loader2 size={12} className="animate-spin" />}
						{t("sessions.confirmTakeover")}
					</button>
				</div>
			</div>
		</Modal>
	);
}

/**
 * Root session dialogs component:
 * Rendered once in SessionSidebar, portaled to document.body at Z_LAYER.modal.
 * Eliminates inline modals inside the backdrop-filtered sidebar column (R2).
 */
export function SessionDialogs() {
	const archiveTarget = useSessionActions((s) => s.archiveWorktreeTarget);
	const assignSessionIds = useSessionActions((s) => s.assignSessionIds);
	const moveToGroupSessionIds = useSessionActions((s) => s.moveToGroupSessionIds);
	const takeoverSessionId = useSessionActions((s) => s.takeoverSessionId);

	const setArchiveTarget = useSessionActions(
		(s) => s.setArchiveWorktreeTarget,
	);
	const setAssignSessionIds = useSessionActions(
		(s) => s.setAssignSessionIds,
	);
	const setMoveToGroupSessionIds = useSessionActions(
		(s) => s.setMoveToGroupSessionIds,
	);
	const setTakeoverSessionId = useSessionActions(
		(s) => s.setTakeoverSessionId,
	);

	if (
		typeof document === "undefined" ||
		(!archiveTarget &&
			!assignSessionIds &&
			!moveToGroupSessionIds &&
			!takeoverSessionId)
	) {
		return null;
	}

	return createPortal(
		<>
			{archiveTarget && (
				<ArchiveWorktreeModal
					target={archiveTarget}
					onClose={() => setArchiveTarget(null)}
				/>
			)}
			{assignSessionIds && (
				<AssignWorkspaceModal
					sessionIds={assignSessionIds}
					onClose={() => setAssignSessionIds(null)}
				/>
			)}
			{moveToGroupSessionIds && (
				<MoveToGroupModal
					sessionIds={moveToGroupSessionIds}
					onClose={() => setMoveToGroupSessionIds(null)}
				/>
			)}
			{takeoverSessionId && (
				<TakeoverModal
					sessionId={takeoverSessionId}
					onClose={() => setTakeoverSessionId(null)}
				/>
			)}
		</>,
		document.body,
	);
}
