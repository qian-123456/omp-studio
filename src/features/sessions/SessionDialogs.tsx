import { AlertTriangle, Check, ExternalLink, FolderInput, Loader2, Trash2, X } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z_LAYER } from "../../components/FloatingLayer";
import type { SessionMeta } from "../../lib/contracts";
import { isSessionBusy } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { takeoverExternal, updateSessionMeta } from "../../lib/ipc";
import { isInside } from "../../lib/paths";
import { sessionDisplayName } from "../../lib/sessionName";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { removeWorktreeFlow } from "../git/removeWorktree";
import { archiveSessions } from "./archiveUndo";
import {
	type ArchiveWorktreeTarget,
	useSessionActions,
} from "./sessionActions";

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
			if (isMountedRef.current) toast.error(`归档失败: ${errMsg(err)}`);
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
				toast.error(`清理或归档失败: ${errMsg(err)}`);
			}
		} finally {
			if (isMountedRef.current) {
				setBusy(false);
			}
		}
	};
	return (
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="archive-worktree-title"
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Escape") {
						e.preventDefault();
						onClose();
					}
					handleTabTrap(e);
				}}
				className="w-full max-w-md rounded-2xl bg-[var(--bg-panel)] p-5 text-[var(--text)] shadow-apple-modal hairline flex flex-col gap-3"
			>
				<div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
					<AlertTriangle size={18} />
					<span id="archive-worktree-title">归档会话与工作树清理</span>
				</div>

				<p className="text-xs text-[var(--text-muted)] leading-relaxed">
					此会话关联了工作树：
					<code className="mx-1 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text)] break-all">
						{target.wt.path}
					</code>
				</p>

				{target.wt.dirty > 0 && (
					<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-300 leading-normal">
						⚠️ 该工作树包含{" "}
						<span className="font-bold">{target.wt.dirty}</span>{" "}
						个未提交的改动。清理工作树时将提示是否强制清理并放弃改动。
					</div>
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
							仅归档会话 (保留工作树)
						</div>
						<div className="text-[11px] text-[var(--text-muted)] mt-0.5">
							会话归档，但保留工作树文件与本地分支。
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
								该工作树还有 {siblingSessions.length} 个会话
								{hasBusyOrActive
									? `，其中 ${busyOrActiveSiblings.length} 个运行中/活动`
									: ""}
								。
							</span>
							{hasBusyOrActive && (
								<p className="mt-1 text-[11px] text-rose-300/90 font-medium">
									⚠️ 存在运行中或活动的会话，清理将导致目录被删除。请先停止这些会话后再清理工作树。
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
								? `工作树仍有活动会话（${busyOrActiveSiblings.map((s) => sessionDisplayName(s)).join("、")}），无法清理`
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
							归档并清理工作树
						</div>
						<div className="text-[11px] text-rose-300/80 mt-0.5">
							{hasBusyOrActive
								? "该工作树包含运行中或活动会话，请先停止它们"
								: "移除该工作树目录；如包含未提交改动将弹出确认。"}
						</div>
					</button>

					<button
						type="button"
						onClick={onClose}
						className="press-scale mt-1 rounded-lg px-3 py-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] text-center transition-colors"
					>
						取消
					</button>
				</div>
			</div>
		</div>
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
	const workspaces = useSessions((s) => s.workspaces);
	const sessions = useSessions((s) => s.sessions);
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
						? "更新工作区归属失败"
						: `更新工作区归属失败: 全部 ${failedCount} 个会话均未能更新`,
				);
				return;
			}

			if (failedCount > 0) {
				toast.info(
					`已更新 ${successes.length} 个会话的工作区归属，${failedCount} 个会话更新失败`,
				);
			} else {
				toast.success(
					targetWsId === "" ? "已恢复自动归属" : "已更新工作区归属",
				);
			}
			onClose();
		} catch (err) {
			toast.error(`更新工作区归属失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !busy) onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="assign-workspace-title"
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Escape" && !busy) {
						e.preventDefault();
						onClose();
					}
					handleTabTrap(e);
				}}
				className="w-full max-w-sm rounded-2xl bg-[var(--bg-panel)] p-5 text-[var(--text)] shadow-apple-modal hairline flex flex-col gap-3"
			>
				<div className="flex items-center justify-between pb-1 border-b border-[var(--border-divider)]">
					<div className="flex items-center gap-2 font-semibold text-sm">
						<FolderInput size={16} />
						<span id="assign-workspace-title">
							{sessionIds.length > 1
								? `归入工作区（已选 ${sessionIds.length} 个会话）`
								: "归入工作区"}
						</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="press-scale text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded-md"
						title="关闭"
					>
						<X size={15} />
					</button>
				</div>

				<div className="max-h-64 overflow-y-auto space-y-1 pr-1">
					{workspaces.map((ws, idx) => {
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
						<span>恢复自动归属（移除工作区绑定）</span>
						{(commonWorkspaceId === "" || commonWorkspaceId === null) && (
							<Check size={14} className="shrink-0" />
						)}
					</button>
				</div>
			</div>
		</div>
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
			toast.success("已成功接管外部会话");
			onClose();
		} catch (err) {
			toast.error(`接管会话失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !busy) onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="takeover-dialog-title"
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Escape" && !busy) {
						e.preventDefault();
						onClose();
					}
					handleTabTrap(e);
				}}
				className="w-full max-w-sm rounded-2xl bg-[var(--bg-panel)] p-5 text-[var(--text)] shadow-apple-modal hairline flex flex-col gap-3"
			>
				<div className="flex items-center gap-2 pb-1 text-purple-400 font-semibold text-sm">
					<ExternalLink size={18} />
					<span id="takeover-dialog-title">接管外部会话</span>
				</div>
				<p className="text-xs text-[var(--text-muted)] leading-relaxed">
					接管外部会话：
					<strong className="text-rose-400 font-medium">
						可能丢失未落盘状态
					</strong>
					。接管后该会话将由本应用作为主控进程管理。确定要继续接管吗？
				</p>
				<div className="mt-2 flex justify-end gap-2 text-xs">
					<button
						type="button"
						disabled={busy}
						onClick={onClose}
						className="press-scale rounded-lg px-3 py-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
					>
						取消
					</button>
					<button
						ref={confirmBtnRef}
						type="button"
						disabled={busy}
						onClick={handleConfirm}
						className="press-scale flex items-center gap-1.5 rounded-lg bg-purple-600 px-3.5 py-1.5 font-medium text-white hover:bg-purple-500 disabled:opacity-60 transition-colors"
					>
						{busy && <Loader2 size={12} className="animate-spin" />}
						确定接管
					</button>
				</div>
			</div>
		</div>
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
	const takeoverSessionId = useSessionActions((s) => s.takeoverSessionId);

	const setArchiveTarget = useSessionActions(
		(s) => s.setArchiveWorktreeTarget,
	);
	const setAssignSessionIds = useSessionActions(
		(s) => s.setAssignSessionIds,
	);
	const setTakeoverSessionId = useSessionActions(
		(s) => s.setTakeoverSessionId,
	);

	if (
		typeof document === "undefined" ||
		(!archiveTarget && !assignSessionIds && !takeoverSessionId)
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
