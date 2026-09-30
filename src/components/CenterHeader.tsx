import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	ArrowLeft,
	Copy,
	FileDown,
	FolderOpen,
	PanelLeftOpen,
	PanelRightOpen,
	QrCode,
	Share2,
	Terminal,
	X,
} from "lucide-react";
import React, {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { FloatingLayer } from "./FloatingLayer";
import { TopCapsule } from "../features/todos/TopCapsule";
import { formatSessionMarkdown } from "../features/chat/exportMarkdown";
import { sessionDisplayName } from "../lib/sessionName";
import { useLive } from "../stores/live";
import { useSessions } from "../stores/sessions";
import { type CenterView, useUi } from "../stores/ui";
import type { PairingInfo, SessionStatus } from "../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../lib/dialogs";
import { isComposing, useEscapeKey } from "../lib/hooks";
import {
	mobileCreatePairing,
	sessionExportHtml,
	takeoverExternal,
	updateSessionMeta,
} from "../lib/ipc";
import { toast } from "../lib/toast";

const isMac =
	typeof navigator !== "undefined" &&
	/Macintosh|Mac OS X|macOS/i.test(navigator.userAgent);

const STATUS_LABEL: Record<SessionStatus, string> = {
	working: "运行中",
	awaiting_approval: "待批准",
	awaiting_answer: "待回答",
	review: "待验收",
	idle: "空闲",
	error: "出错",
	interrupted: "已中断",
	suspended: "已挂起",
	external: "外部",
};

const STATUS_DOT: Record<SessionStatus, string> = {
	working: "bg-emerald-400 animate-pulse",
	awaiting_approval: "bg-amber-400",
	awaiting_answer: "bg-sky-400",
	review: "bg-orange-400",
	idle: "bg-neutral-500",
	error: "bg-red-500",
	interrupted: "bg-red-800",
	suspended: "bg-neutral-600",
	external: "bg-purple-500",
};

/** Header title for non-session center views. */
const CENTER_TITLE: Partial<Record<CenterView, string>> = {
	doc: "文档",
	inbox: "收件箱",
	schedules: "定时任务",
	skills: "技能与扩展",
	agentTerminal: "Agent 终端",
};

export interface CenterHeaderProps {
	sidebarOpen: boolean;
	toggleSidebar: () => void;
	rightOpen: boolean;
	toggleRight: () => void;
}

export const CenterHeader = React.memo(function CenterHeader({
	sidebarOpen,
	toggleSidebar,
	rightOpen,
	toggleRight,
}: CenterHeaderProps) {
	const centerView = useUi((s) => s.centerView);
	const previousCenterView = useUi((s) => s.previousCenterView);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const lastSessionId = useUi((s) => s.lastSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const returnToSession = useUi((s) => s.returnToSession);
	const setCenter = useUi((s) => s.setCenter);

	// Track the underlying view so when settings overlay opens, the center view stays mounted
	const lastNonSettingsCenterView = useRef<CenterView>("home");
	if (centerView !== "settings") {
		lastNonSettingsCenterView.current = centerView;
	}
	const effectiveCenterView =
		centerView === "settings"
			? previousCenterView ?? lastNonSettingsCenterView.current
			: centerView;

	const activeSessionId = selectedSessionId || lastSessionId;
	const activeSession = useSessions(
		useCallback(
			(s) => (activeSessionId ? s.sessions[activeSessionId] : undefined),
			[activeSessionId],
		),
	);

	const parentId = useSessions(
		useCallback(
			(s) => {
				const active = activeSessionId ? s.sessions[activeSessionId] : undefined;
				return (
					active?.parentId ??
					(active && "parentSessionId" in active && typeof active.parentSessionId === "string"
						? active.parentSessionId
						: null)
				);
			},
			[activeSessionId],
		),
	);

	const parentSession = useSessions(
		useCallback(
			(s) => (parentId ? s.sessions[parentId] : undefined),
			[parentId],
		),
	);

	const isViewingSession =
		effectiveCenterView === "session" && !!selectedSessionId && !!activeSession;

	// Narrow live subscription: only boolean flags, so streaming tokens NEVER re-render CenterHeader!
	const sessionStreaming = useLive(
		useCallback(
			(s) => (activeSessionId ? s.sessions[activeSessionId]?.streaming === true : false),
			[activeSessionId],
		),
	);
	const sessionAlive = useLive(
		useCallback(
			(s) => (activeSessionId ? s.sessions[activeSessionId]?.alive === true : false),
			[activeSessionId],
		),
	);

	const sessionStatus: SessionStatus = sessionStreaming
		? "working"
		: (activeSession?.status ?? (sessionAlive ? "working" : "idle"));

	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [shareOpen, setShareOpen] = useState(false);
	const [qrPairing, setQrPairing] = useState<PairingInfo | null>(null);
	const [busyAction, setBusyAction] = useState(false);
	const shareBtnRef = useRef<HTMLButtonElement>(null);

	// Reset header state on session change
	useEffect(() => {
		setEditingTitle(false);
		setShareOpen(false);
		setQrPairing(null);
	}, [activeSession?.id]);

	// Escape key to close popovers/modals/title editing
	useEscapeKey(() => {
		if (qrPairing) {
			setQrPairing(null);
		} else if (shareOpen) {
			setShareOpen(false);
		} else if (editingTitle) {
			setEditingTitle(false);
		}
	}, editingTitle || shareOpen || !!qrPairing);

	const startEditTitle = () => {
		if (!activeSession) return;
		setTitleDraft(activeSession.title ?? activeSession.id.slice(0, 8));
		setEditingTitle(true);
	};

	const saveTitle = async () => {
		const trimmed = titleDraft.trim();
		setEditingTitle(false);
		if (!trimmed || !activeSession || trimmed === activeSession.title) return;
		try {
			await updateSessionMeta(activeSession.id, { customName: trimmed });
			toast.success("会话标题已更新");
		} catch (err) {
			toast.error(`重命名失败: ${errMsg(err)}`);
		}
	};

	const handleOpenInFinder = async () => {
		if (!activeSession?.cwd) return;
		try {
			await revealItemInDir(activeSession.cwd);
		} catch {
			try {
				await openPath(activeSession.cwd);
			} catch (e) {
				toast.error(`在访达中打开失败: ${errMsg(e)}`);
			}
		}
	};

	const handleCopyMarkdown = async () => {
		setShareOpen(false);
		if (!activeSession) return;
		const items = useLive.getState().sessions[activeSession.id]?.items ?? [];
		if (items.length === 0) {
			toast.info("当前会话暂无消息");
			return;
		}
		const md = formatSessionMarkdown(
			items,
			sessionDisplayName(activeSession),
		);
		try {
			await copyText(md);
			toast.success("已复制整场对话 Markdown");
		} catch (e) {
			toast.error(`复制失败: ${errMsg(e)}`);
		}
	};

	const handleExportHtml = async () => {
		setShareOpen(false);
		if (!activeSession) return;
		try {
			const outPath = await sessionExportHtml(activeSession.id);
			toast.success(`已导出 HTML: ${outPath}`);
			try {
				await revealItemInDir(outPath);
			} catch {
				// ignore reveal failure
			}
		} catch (err) {
			toast.error(`导出 HTML 失败: ${errMsg(err)}`);
		}
	};

	const handleMobilePair = async () => {
		setShareOpen(false);
		try {
			const info = await mobileCreatePairing(false);
			setQrPairing(info);
		} catch (e) {
			toast.error(`获取配对码失败: ${errMsg(e)}`);
		}
	};

	const takeover = async () => {
		if (!activeSession) return;
		const ok = await confirmDialog("接管外部会话可能丢失其未落盘状态，确认接管？", {
			danger: true,
			okLabel: "接管",
		});
		if (!ok) return;
		setBusyAction(true);
		try {
			await takeoverExternal(activeSession.id);
			toast.success("已成功接管外部会话");
		} catch (err) {
			toast.error(`接管失败: ${errMsg(err)}`);
		} finally {
			setBusyAction(false);
		}
	};

	return (
		<>
			<header
				data-tauri-drag-region
				className="relative z-30 flex h-10 shrink-0 items-center border-b border-[var(--border-divider)] vibrancy-chrome select-none"
			>
				{/* Expand sidebar cell — only rendered when the sidebar is closed */}
				{!sidebarOpen && (
					<div
						className={clsx(
							"flex h-full shrink-0 items-center border-r border-[var(--border-divider)] px-2",
							isMac ? "pl-[78px]" : "pl-2",
						)}
					>
						<button
							type="button"
							onClick={toggleSidebar}
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-95 transition-all"
							title="展开左侧栏 (⌘B)"
						>
							<PanelLeftOpen size={15} />
						</button>
					</div>
				)}
				<div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3.5">
					{/* Current view info */}
					{isViewingSession ? (
						<div className="flex min-w-0 items-center gap-2">
							{/* Side-chat parent breadcrumb: ← #N 父标题 / */}
							{parentId && (
								<>
									<button
										type="button"
										onClick={() => selectSession(parentId)}
										className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--bg-active-fill)] px-2 py-0.5 text-xs text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95 transition-all"
										title={`返回父会话：${parentSession ? sessionDisplayName(parentSession) : parentId}`}
									>
										<span>←</span>
										<span className="max-w-[120px] md:max-w-[160px] truncate text-neutral-300">
											{parentSession ? sessionDisplayName(parentSession) : "父会话"}
										</span>
									</button>
									<span className="text-neutral-600 shrink-0">/</span>
								</>
							)}

							{/* Status dot */}
							<span
								className={clsx("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[sessionStatus])}
								title={STATUS_LABEL[sessionStatus]}
							/>

							{/* Double-click rename or display title */}
							{editingTitle ? (
								<input
									autoFocus
									type="text"
									value={titleDraft}
									onChange={(e) => setTitleDraft(e.target.value)}
									onBlur={saveTitle}
									onKeyDown={(e) => {
										if (isComposing(e)) return;
										if (e.key === "Enter") {
											e.preventDefault();
											void saveTitle();
										} else if (e.key === "Escape") {
											e.preventDefault();
											setEditingTitle(false);
										}
									}}
									className="h-6 rounded border border-indigo-500 bg-neutral-900 px-1.5 py-0 text-[13px] font-medium text-neutral-100 outline-none"
								/>
							) : (
								<span
									onDoubleClick={startEditTitle}
									className="min-w-0 max-w-[200px] md:max-w-[320px] lg:max-w-[450px] cursor-pointer select-none truncate text-[13px] font-semibold tracking-[-0.015em] text-neutral-100 underline-offset-4 hover:text-white hover:underline decoration-neutral-600 transition-colors"
									title={`双击重命名会话\n${sessionDisplayName(activeSession)}${activeSession.cwd ? `\n路径: ${activeSession.cwd}` : ""}`}
								>
									{sessionDisplayName(activeSession)}
								</span>
							)}
						</div>
					) : (
						<div className="flex min-w-0 items-center gap-2">
							{activeSession && (
								<button
									type="button"
									onClick={returnToSession}
									className="flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-xs text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200 active:scale-95 transition-all"
									title={`返回会话: ${sessionDisplayName(activeSession)}`}
								>
									<ArrowLeft size={13} />
									<span className="max-w-[180px] truncate">
										返回 {sessionDisplayName(activeSession)}
									</span>
								</button>
							)}
							{CENTER_TITLE[effectiveCenterView] && (
								<span className="text-[13px] font-medium text-neutral-300 shrink-0">
									{CENTER_TITLE[effectiveCenterView]}
								</span>
							)}
						</div>
					)}

					{/* Drag spacer */}
					<div className="flex-1 min-w-2" data-tauri-drag-region />

					{/* Right: Actions & Capsule */}
					<div className="flex items-center gap-1.5 shrink-0">
						{isViewingSession && (
							<>
								{sessionStatus === "external" && (
									<button
										type="button"
										disabled={busyAction}
										onClick={() => void takeover()}
										className="flex shrink-0 items-center gap-1.5 rounded-lg border border-purple-800/50 bg-purple-950/40 px-2 py-1 text-xs font-medium text-purple-300 hover:bg-purple-900/50 disabled:opacity-50 transition-colors"
									>
										<span>接管</span>
									</button>
								)}

								{/* Finder */}
								<button
									type="button"
									disabled={!activeSession.cwd}
									onClick={handleOpenInFinder}
									title={activeSession.cwd ? `在访达中显示 (${activeSession.cwd})` : "无工作目录"}
									className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200 disabled:opacity-30 transition-colors"
								>
									<FolderOpen size={14} />
								</button>

								{/* Share trigger button */}
								<button
									ref={shareBtnRef}
									type="button"
									onClick={() => setShareOpen((v) => !v)}
									title="分享与导出"
									className={clsx(
										"flex h-7 w-7 items-center justify-center rounded-md transition-colors",
										shareOpen
											? "bg-neutral-800 text-neutral-100"
											: "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200",
									)}
								>
									<Share2 size={14} />
								</button>

								{/* Share Popover using FloatingLayer */}
								<FloatingLayer
									anchor={shareOpen ? shareBtnRef.current : null}
									placement="bottom-end"
									layer="popover"
									offset={6}
									onDismiss={() => setShareOpen(false)}
									ignoreRefs={[shareBtnRef]}
									className="w-44 rounded-lg border border-neutral-700 bg-neutral-900 p-1 text-xs shadow-xl"
								>
									<button
										type="button"
										onClick={handleCopyMarkdown}
										className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white"
									>
										<Copy size={13} />
										<span>复制为 Markdown</span>
									</button>
									<button
										type="button"
										onClick={handleExportHtml}
										className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white"
									>
										<FileDown size={13} />
										<span>导出为 HTML</span>
									</button>
									<button
										type="button"
										onClick={handleMobilePair}
										className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white"
									>
										<QrCode size={13} />
										<span>手机扫码查看</span>
									</button>
								</FloatingLayer>
							</>
						)}

						{/* Agent Terminal Center Page Toggle */}
						<button
							type="button"
							onClick={() => {
								if (effectiveCenterView === "agentTerminal") {
									const prev = previousCenterView ?? (selectedSessionId ? "session" : "home");
									setCenter(prev === "agentTerminal" ? (selectedSessionId ? "session" : "home") : prev);
								} else {
									setCenter("agentTerminal");
								}
							}}
							aria-label={effectiveCenterView === "agentTerminal" ? "返回主视图" : "打开 Agent 终端"}
							aria-pressed={effectiveCenterView === "agentTerminal"}
							title={
								effectiveCenterView === "agentTerminal"
									? "返回主视图"
									: "打开 Agent 终端（全屏中心页，可输入 omp/claude/codex 接管）"
							}
							className={clsx(
								"flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium active:scale-95 transition-all",
								effectiveCenterView === "agentTerminal"
									? "border border-indigo-500/40 bg-indigo-600/20 text-indigo-300"
									: "text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200",
							)}
						>
							<Terminal size={13} />
							<span>终端</span>
						</button>
						<TopCapsule />

						{/* Show expand right panel button only when right panel is closed */}
						{!rightOpen && (
							<button
								type="button"
								onClick={toggleRight}
								className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-95 transition-all"
								title="展开右侧面板 (⌘J)"
							>
								<PanelRightOpen size={15} />
							</button>
						)}
					</div>
				</div>
			</header>

			{/* Mobile QR Pairing modal portaled to body */}
			{qrPairing &&
				createPortal(
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-xs p-4"
						onMouseDown={(e) => {
							if (e.target === e.currentTarget) setQrPairing(null);
						}}
					>
						<div
							className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl bg-[var(--bg-panel)] p-5 text-neutral-200 shadow-apple-modal hairline"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="flex w-full items-center justify-between border-b border-[var(--border-divider)] pb-2">
								<span className="text-xs font-medium text-neutral-200">
									手机扫码查看
								</span>
								<button
									type="button"
									onClick={() => setQrPairing(null)}
									className="rounded p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
									title="关闭"
								>
									<X size={14} />
								</button>
							</div>
							<div
								className="rounded-lg bg-white p-3 [&_svg]:h-44 [&_svg]:w-44"
								dangerouslySetInnerHTML={{ __html: qrPairing.qrSvg }}
							/>
							<div className="text-center text-[11px] text-neutral-400">
								手机与电脑在同一局域网下扫码即可接力查看
							</div>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
});
