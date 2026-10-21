import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	ArrowLeft,
	Copy,
	FileDown,
	FolderOpen,
	PanelLeftOpen,
	PanelRightOpen,
	Link2,
	QrCode,
	Image as ImageIcon,
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
import { IdeasCapsule } from "../features/backlog/IdeasCapsule";
import { formatSessionMarkdown } from "../features/chat/exportMarkdown";
import { useShareSelection } from "../features/chat/share/shareStore";
import { sessionDisplayName } from "../lib/sessionName";
import { useLive } from "../stores/live";
import { useSessions } from "../stores/sessions";
import { deriveLoadState } from "../lib/loadState";
import { type CenterView, useUi } from "../stores/ui";
import { usePendingSession } from "../features/sessions/pendingSession";
import { backLabel, resolveBackTarget, shouldEscapeGoBack } from "../lib/centerBack";
import type { PairingInfo, SessionStatus } from "../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../lib/dialogs";
import { isComposing, useEscapeKey } from "../lib/hooks";
import {
	mobileCreatePairing,
	sessionExportHtml,
	sessionShare,
	updateSessionMeta,
} from "../lib/ipc";
import { toast } from "../lib/toast";
import { claimEscape, isEscapeClaimed } from "../lib/escapeClaim";
import { useTrafficLightsVisible } from "../lib/trafficLights";



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

/** Center views that always use the full width — the right dock is hidden. */
export const CENTER_WITHOUT_RIGHT_PANEL: ReadonlySet<CenterView> = new Set([
	"inbox",
	"schedules",
	"skills",
]);

/** Header title for non-session center views. */
const CENTER_TITLE: Partial<Record<CenterView, string>> = {
	doc: "文档",
	inbox: "收件箱",
	schedules: "定时任务",
	skills: "Skills 管理",
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
	const setCenter = useUi((s) => s.setCenter);
	const isTerminalOpen = useUi((s) => s.rightOpen && s.rightTab === "terminal");
	const handleToggleTerminal = useCallback(() => {
		const { rightOpen, rightTab, setRightOpen, setRightTab } = useUi.getState();
		if (rightOpen && rightTab === "terminal") {
			setRightOpen(false);
		} else {
			setRightTab("terminal");
		}
	}, []);

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

	// New-session placeholder: a fresh session is on its way, so no "back" affordance.
	const placeholderShowing = usePendingSession(
		(s) => s.pending !== null && effectiveCenterView === "session" && !selectedSessionId,
	);
	const isViewingSession =
		effectiveCenterView === "session" && !!selectedSessionId && !!activeSession;
	// Session selected (e.g. restored) but the session index has not arrived yet.
	const sessionsLoadState = deriveLoadState(
		useSessions((s) => s.hasLoaded),
		useSessions((s) => s.loadError),
	);
	const sessionMetaPending =
		effectiveCenterView === "session" &&
		!!selectedSessionId &&
		!activeSession &&
		sessionsLoadState !== "ready";

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

	const handleShareLink = async () => {
		setShareOpen(false);
		if (!activeSession) return;
		const ok = await confirmDialog(
			"将把本会话加密后上传到 OMP 分享服务（与 /share 相同）。拿到链接的任何人都能查看内容，已知密钥会自动脱敏。继续？",
			{ title: "创建分享链接", okLabel: "创建并复制" },
		);
		if (!ok) return;
		toast.info("正在生成分享链接…");
		try {
			const url = await sessionShare(activeSession.id);
			await copyText(url);
			toast.success("分享链接已复制");
		} catch (err) {
			toast.error(`创建分享链接失败: ${errMsg(err)}`);
		}
	};

	const handleMobilePair = async () => {
		setShareOpen(false);
		try {
			const info = await mobileCreatePairing("lan");
			setQrPairing(info);
		} catch (e) {
			toast.error(`获取配对码失败: ${errMsg(e)}`);
		}
	};


	const backTarget = resolveBackTarget({
		view: effectiveCenterView,
		selectedSessionId,
		lastSessionId,
		sessionExists: () => !!activeSession,
		placeholderShowing,
	});
	const backText = backTarget
		? backLabel(backTarget, activeSession ? sessionDisplayName(activeSession) : null)
		: "";
	const goBack = () => {
		if (!backTarget) return;
		if (backTarget.kind === "session") selectSession(backTarget.sessionId);
		else setCenter("home");
	};

	// Esc leaves a full-page view, but only when no editor/dialog/popover owns it.
	const goBackRef = useRef(goBack);
	goBackRef.current = goBack;
	const hasBackTarget = !!backTarget;
	useEffect(() => {
		if (!hasBackTarget || centerView === "settings") return;
		const onKey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			const editable =
				!!el &&
				(el.isContentEditable ||
					["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
					!!el.closest?.(".cm-editor, .monaco-editor"));
			if (
				shouldEscapeGoBack({
					key: e.key,
					escapeClaimed: isEscapeClaimed(e),
					composing: isComposing({ nativeEvent: e, key: e.key }),
					targetEditable: editable,
					overlayOpen: !!document.querySelector('[role="dialog"],[aria-modal="true"]'),
					hasBackTarget: true,
				})
			) {
				goBackRef.current();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [hasBackTarget, centerView]);

	const trafficLightsVisible = useTrafficLightsVisible();
	return (
		<>
			<header
				data-tauri-drag-region
				className="relative z-30 flex h-10 shrink-0 items-center border-b border-[var(--border-divider)] vibrancy-chrome select-none"
			>
				{/* Expand sidebar button — only rendered when the sidebar is closed */}
				{!sidebarOpen && (
					<div className={clsx("flex shrink-0 items-center pr-1", trafficLightsVisible ? "pl-[78px]" : "pl-2.5")}>
						<button
							type="button"
							onClick={toggleSidebar}
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
							title="展开左侧栏 (⌘B)"
						>
							<PanelLeftOpen size={16} strokeWidth={1.5} />
						</button>
					</div>
				)}
				<div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3.5">
					{/* Current view info */}
					{isViewingSession ? (
						<div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
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
								data-tauri-drag-region
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
											claimEscape(e);
											setEditingTitle(false);
										}
									}}
									className="h-6 rounded border border-indigo-500 bg-neutral-900 px-1.5 py-0 text-[13px] font-medium text-neutral-100 outline-none"
								/>
							) : (
								<span
									onDoubleClick={startEditTitle}
									className="min-w-0 max-w-[200px] md:max-w-[320px] lg:max-w-[450px] cursor-pointer select-none truncate text-[13px] font-semibold tracking-[-0.015em] text-neutral-100 underline-offset-4 hover:text-[var(--text)] hover:underline decoration-neutral-600 transition-colors"
									title={`双击重命名会话\n${sessionDisplayName(activeSession)}${activeSession.cwd ? `\n路径: ${activeSession.cwd}` : ""}`}
								>
									{sessionDisplayName(activeSession)}
								</span>
							)}
						</div>
					) : sessionMetaPending ? (
						<div
							role="status"
							className={clsx(
								"flex min-w-0 items-center gap-2 text-[13px]",
								sessionsLoadState === "error" ? "text-red-400" : "animate-pulse text-neutral-500",
							)}
						>
							<span className="h-2 w-2 shrink-0 rounded-full bg-neutral-700" />
							{sessionsLoadState === "error" ? "会话信息加载失败" : "正在加载中"}
						</div>
					) : (
						<div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
							{backTarget && (
								<>
									<button
										type="button"
										onClick={goBack}
										className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md py-0.5 pl-1 pr-2 text-left text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-100 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
										title={`返回${backTarget.kind === "session" ? "会话" : ""}：${backText}（Esc）`}
									>
										<ArrowLeft size={14} strokeWidth={1.75} className="shrink-0" />
										<span className="text-xs leading-[14px]">
											{backTarget.kind === "session" ? "返回会话" : "返回首页"}
										</span>
									</button>
									<span className="shrink-0 text-neutral-600">/</span>
								</>
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
									className="w-52 rounded-lg border border-neutral-700 bg-neutral-900 p-1 text-xs shadow-xl"
								>
									<button
										type="button"
										onClick={() => {
											if (activeSession) useShareSelection.getState().begin(activeSession.id);
											setShareOpen(false);
										}}
										className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
									>
										<ImageIcon size={13} />
										<span>选择消息分享为图片</span>
									</button>
									<button
										type="button"
										onClick={handleShareLink}
										className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
									>
										<Link2 size={13} />
										<span>创建分享链接</span>
									</button>
									<button
										type="button"
										onClick={handleCopyMarkdown}
										className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
									>
										<Copy size={13} />
										<span>复制为 Markdown</span>
									</button>
									<button
										type="button"
										onClick={handleExportHtml}
										className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
									>
										<FileDown size={13} />
										<span>导出为 HTML</span>
									</button>
									<button
										type="button"
										onClick={handleMobilePair}
										className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
									>
										<QrCode size={13} />
										<span>手机扫码查看</span>
									</button>
								</FloatingLayer>
							</>
						)}

						{/* Terminal entry: toggle command terminal (right panel) */}
						<button
							type="button"
							onClick={handleToggleTerminal}
							aria-label="终端"
							title={`终端 (${isMac ? "⌘" : "Ctrl+"}\`)`}
							className={clsx(
								"relative flex h-7 w-7 items-center justify-center rounded-lg active:scale-95 transition-all",
								isTerminalOpen
									? "border border-indigo-500/40 bg-indigo-600/20 text-indigo-300"
									: "text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200",
							)}
						>
							<Terminal size={15} />
						</button>
						<IdeasCapsule />

						{/* Right-panel toggle — hidden on full-width views (skills/inbox/schedules) */}
						{!rightOpen && !CENTER_WITHOUT_RIGHT_PANEL.has(effectiveCenterView) && (
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
						className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-[var(--overlay)] backdrop-blur-xs p-4"
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
