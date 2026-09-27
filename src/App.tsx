import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	ArrowLeft,
	MessageSquare,
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightOpen,
	TerminalSquare,
	X,
} from "lucide-react";
import React, {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { BacklogPanel } from "./features/backlog/BacklogPanel";
import { QuickCapture } from "./features/backlog/QuickCapture";
import { SessionView } from "./features/chat/SessionView";
import { DiagnoseDialog } from "./features/diagnose/DiagnoseDialog";
import { DocView } from "./features/editor/DocView";
import { FileExplorer } from "./features/explorer/FileExplorer";
import { GitPanel } from "./features/git/GitPanel";
import { NewSessionDialog } from "./features/git/NewSessionDialog";
import { HeatmapPanel } from "./features/heatmap/HeatmapPanel";
import { ServicesPanel } from "./features/services/ServicesPanel";
import { SessionSidebar } from "./features/sessions/SessionSidebar";
import { SessionOverflowMenu } from "./components/SessionOverflowMenu";
import { SettingsPage } from "./features/settings/SettingsPage";
import { SideChatPanel } from "./features/sidechat/SideChatPanel";
import { StartPage } from "./features/home/StartPage";
import { TodoPanel } from "./features/todos/TodoPanel";
import { TopCapsule } from "./features/todos/TopCapsule";
import { startTodos, useTodos } from "./features/todos/store";
import { destroySessionTerminal } from "./features/terminal/terminalRegistry";
import { TerminalDrawer } from "./features/terminal/TerminalDrawer";
import { onServicesChanged, onSessionsRemoved } from "./lib/events";
import { gitSummary, servicesList } from "./lib/ipc";
import type { PairingInfo, SessionStatus } from "./lib/contracts";
import { confirmDialog, copyText, errMsg } from "./lib/dialogs";
import { isComposing, useEscapeKey } from "./lib/hooks";
import { mobileCreatePairing, takeoverExternal, updateSessionMeta } from "./lib/ipc";
import { toast } from "./lib/toast";
import { formatSessionMarkdown } from "./features/chat/exportMarkdown";
import { sessionDisplayName } from "./lib/sessionName";
import { useLive } from "./stores/live";
import { useSessions } from "./stores/sessions";
import { type RightTab, useUi } from "./stores/ui";
import { Toaster } from "./components/Toaster";
import { BottomBar } from "./components/BottomBar";
import { RightPanelHeader } from "./components/RightPanelHeader";
import { RightPanelEmptyState } from "./components/RightPanelEmptyState";
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



/** Catches render errors so a broken view shows a readable message, not a black screen. */
class ErrorBoundary extends React.Component<
	{ children: ReactNode; label: string },
	{ error: string | null; stack: string | null }
> {
	state = { error: null as string | null, stack: null as string | null };
	static getDerivedStateFromError(e: unknown) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
	componentDidCatch(_e: unknown, info: { componentStack?: string | null }) {
		this.setState({ stack: info.componentStack ?? null });
		console.error(`[ErrorBoundary:${this.props.label}]`, _e, info.componentStack);
	}
	render() {
		if (this.state.error) {
			return (
				<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
					<div className="text-sm text-rose-300">{this.props.label} 渲染出错</div>
					<pre className="max-w-md whitespace-pre-wrap text-left text-[11px] text-neutral-500">
						{this.state.error}
					</pre>
					{this.state.stack && (
						<pre className="max-h-40 max-w-md overflow-y-auto whitespace-pre-wrap text-left text-[10px] text-neutral-600">
							{this.state.stack}
						</pre>
					)}
					<button
						type="button"
						onClick={() => this.setState({ error: null, stack: null })}
						className="rounded bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
					>
						重试
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
function RightPanelBody({ tab }: { tab: RightTab }) {
	switch (tab) {
		case "explorer":
			return <FileExplorer />;
		case "sidechat":
			return <SideChatPanel />;
		case "heatmap":
			return <HeatmapPanel />;
		case "todos":
			return <TodoPanel />;
		case "git":
			return <GitPanel />;
		case "services":
			return <ServicesPanel />;
	}
}

function CenterView() {
	const centerView = useUi((s) => s.centerView);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const docPath = useUi((s) => s.docPath);
	switch (centerView) {
		case "session":
			return selectedSessionId ? (
				<SessionView sessionId={selectedSessionId} />
			) : (
				<StartPage />
			);
		case "doc":
			return docPath ? <DocView path={docPath} /> : <StartPage />;
		case "settings":
			return <SettingsPage />;
		default:
			return <StartPage />;
	}
}

export default function App() {
	const rightTab = useUi((s) => s.rightTab);
	const rightOpen = useUi((s) => s.rightOpen);
	const toggleRight = useUi((s) => s.toggleRight);
	const rightWidth = useUi((s) => s.rightWidth);
	const setRightWidth = useUi((s) => s.setRightWidth);

	const sidebarOpen = useUi((s) => s.sidebarOpen);
	const toggleSidebar = useUi((s) => s.toggleSidebar);
	const sidebarWidth = useUi((s) => s.sidebarWidth);
	const setSidebarWidth = useUi((s) => s.setSidebarWidth);

	const centerView = useUi((s) => s.centerView);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const lastSessionId = useUi((s) => s.lastSessionId);
	const returnToSession = useUi((s) => s.returnToSession);
	const selectSession = useUi((s) => s.selectSession);
	const setSessionViewMode = useUi((s) => s.setSessionViewMode);

	// Active session for return-to-session, badges and topbar
	const activeSessionId = selectedSessionId || lastSessionId;
	const activeSession = useSessions((s) =>
		activeSessionId ? s.sessions[activeSessionId] : undefined,
	);
	const parentId =
		activeSession?.parentId ??
		(activeSession && "parentSessionId" in activeSession && typeof activeSession.parentSessionId === "string"
			? activeSession.parentSessionId
			: null);
	const parentSession = useSessions((s) =>
		parentId ? s.sessions[parentId] : undefined,
	);

	const isViewingSession =
		centerView === "session" && !!selectedSessionId && !!activeSession;

	const sessionViewMode = useUi((s) =>
		activeSession ? s.sessionViewMode[activeSession.id] ?? "chat" : "chat",
	);

	const sessionLive = useLive((s) =>
		activeSession ? s.sessions[activeSession.id] : undefined,
	);
	const sessionStreaming = sessionLive?.streaming === true;
	const sessionStatus: SessionStatus = sessionStreaming
		? "working"
		: (activeSession?.status ?? (sessionLive?.alive ? "working" : "idle"));

	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [qrPairing, setQrPairing] = useState<PairingInfo | null>(null);
	const [busyAction, setBusyAction] = useState(false);

	// Reset header state on session change
	useEffect(() => {
		setEditingTitle(false);
		setQrPairing(null);
	}, [activeSession?.id]);
	// Escape key to close popovers/modals/title editing
	useEscapeKey(() => {
		if (qrPairing) {
			setQrPairing(null);
		} else if (editingTitle) {
			setEditingTitle(false);
		}
	}, editingTitle || !!qrPairing);

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

	const handleMobilePair = async () => {
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
	// Resizable sidebars with text selection disabled during drag
	const draggingSide = useRef<"left" | "right" | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	const onLeftDragStart = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		draggingSide.current = "left";
		setIsDragging(true);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "col-resize";
	}, []);

	const onRightDragStart = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		draggingSide.current = "right";
		setIsDragging(true);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "col-resize";
	}, []);

	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!draggingSide.current) return;
			if (draggingSide.current === "left") {
				setSidebarWidth(e.clientX);
			} else if (draggingSide.current === "right") {
				setRightWidth(window.innerWidth - e.clientX);
			}
		};
		const onUp = () => {
			if (draggingSide.current) {
				draggingSide.current = null;
				setIsDragging(false);
				document.body.style.userSelect = "";
				document.body.style.cursor = "";
			}
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		};
	}, [setSidebarWidth, setRightWidth]);

	// Global keyboard shortcuts: Cmd+B (left sidebar) / Cmd+J (right panel) / Cmd+[ (return to session/parent)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const isMod = e.metaKey || e.ctrlKey;
			if (!isMod) return;

			if (e.key.toLowerCase() === "b" && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				toggleSidebar();
			} else if (e.key.toLowerCase() === "j" && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				toggleRight();
			} else if (e.key === "[" && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				if (parentId) {
					selectSession(parentId);
				} else {
					returnToSession();
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [toggleSidebar, toggleRight, parentId, selectSession, returnToSession]);

	// Initialize todos subscription
	useEffect(() => {
		startTodos();
	}, []);
	// Clean up terminal PTY sessions when sessions are permanently removed
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		onSessionsRemoved((ids) => {
			for (const id of ids) {
				destroySessionTerminal(id);
			}
		})
			.then((un) => {
				unlisten = un;
			})
			.catch((err) => {
				console.error(
					"Failed to listen on sessions:removed for terminal cleanup",
					err,
				);
			});
		return () => {
			if (unlisten) unlisten();
		};
	}, []);


	// Restore last session once the session list finishes loading (fall back to home).
	const hasLoaded = useSessions((s) => s.hasLoaded);
	const restoredRef = useRef(false);
	useEffect(() => {
		if (!hasLoaded || restoredRef.current) return;
		restoredRef.current = true;
		const last = useUi.getState().lastSessionId;
		if (!last) return;
		const exists = useSessions.getState().sessions[last];
		if (exists) {
			useUi.setState({ selectedSessionId: last, centerView: "session" });
		}
	}, [hasLoaded]);


	// Tab badges calculation:
	// 1. Todos count
	const todosCounts = useTodos((s) => s.counts);
	const allTodos = useTodos((s) => s.todos);
	const sessionOpenTodos = selectedSessionId
		? allTodos.filter(
				(t) => t.sessionId === selectedSessionId && t.status === "open",
			).length
		: todosCounts.open;
	const todosBadge = sessionOpenTodos > 0 ? sessionOpenTodos : todosCounts.open;

	// 2. Git dirty count
	const [gitDirtyCount, setGitDirtyCount] = useState<number>(0);
	useEffect(() => {
		if (!activeSession?.cwd) {
			setGitDirtyCount(0);
			return;
		}
		if (activeSession.git?.dirty != null) {
			setGitDirtyCount(activeSession.git.dirty);
		}
		let cancelled = false;
		gitSummary(activeSession.cwd)
			.then((summary) => {
				if (!cancelled && summary && Array.isArray(summary.files)) {
					setGitDirtyCount(summary.files.length);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [activeSession?.id, activeSession?.cwd, activeSession?.updatedAt, activeSession?.git?.dirty]);

	// 3. Services count
	const [servicesCount, setServicesCount] = useState<number>(0);
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		servicesList(false)
			.then((list) => setServicesCount(list.length))
			.catch(() => {});
		onServicesChanged((list) => setServicesCount(list.length))
			.then((u) => {
				unlisten = u;
			})
			.catch(() => {});
		return () => {
			unlisten?.();
		};
	}, []);

	// 4. Sidechat count
	const allSessions = useSessions((s) => s.sessions);
	const sidechatCount = selectedSessionId
		? Object.values(allSessions).filter((s) => s.parentId === selectedSessionId).length
		: 0;

	// 5. Heatmap count
	const heatmapCount = useLive((s) =>
		selectedSessionId ? (s.sessions[selectedSessionId]?.items.length ?? 0) : 0,
	);

	const tabBadges: Record<RightTab, number> = {
		explorer: 0,
		sidechat: sidechatCount,
		heatmap: heatmapCount,
		todos: todosBadge,
		git: gitDirtyCount,
		services: servicesCount,
	};



	return (
		<div className="flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-200">
			{/* Top bar — column-aligned single-row header; left column strictly matches sidebarWidth */}
			<header
				data-tauri-drag-region
				className="flex h-10 shrink-0 border-b border-neutral-800/80 bg-neutral-950/80 backdrop-blur-sm select-none"
			>
				{/* Left column topbar — matches sidebarWidth with right border */}
				{sidebarOpen ? (
					<div
						style={{ width: sidebarWidth }}
						className="flex h-full shrink-0 items-center justify-between border-r border-neutral-800/80 px-2.5"
					>
						{/* macOS traffic light spacer */}
						<div className={isMac ? "w-[68px] shrink-0" : "hidden"} />
						<div className="flex-1" data-tauri-drag-region />
						{/* Collapse sidebar button */}
						<button
							type="button"
							onClick={toggleSidebar}
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-200 transition-colors"
							title="收起左侧栏 (⌘B)"
						>
							<PanelLeftClose size={15} />
						</button>
					</div>
				) : (
					<div
						className={clsx(
							"flex h-full shrink-0 items-center border-r border-neutral-800/80 px-2",
							isMac ? "pl-[78px]" : "pl-2",
						)}
					>
						<button
							type="button"
							onClick={toggleSidebar}
							className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-200 transition-colors"
							title="展开左侧栏 (⌘B)"
						>
							<PanelLeftOpen size={15} />
						</button>
					</div>
				)}

				{/* Center column topbar — aligns precisely with main conversation view */}
				<div className="flex flex-1 min-w-0 items-center justify-between gap-2 px-3.5">
					{/* Current view info */}
					{isViewingSession ? (
						<div className="flex min-w-0 items-center gap-2">
							{/* Side-chat parent breadcrumb: ← #N 父标题 / */}
							{parentId && (
								<>
									<button
										type="button"
										onClick={() => selectSession(parentId)}
										className="flex shrink-0 items-center gap-1 rounded-md bg-neutral-800/60 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700/80 hover:text-white transition-colors"
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
									className="min-w-0 max-w-[200px] md:max-w-[320px] lg:max-w-[450px] cursor-pointer select-none truncate text-[13px] font-medium text-neutral-200 underline-offset-4 hover:text-white hover:underline decoration-neutral-600"
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
									className="flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-800/40 bg-indigo-950/30 px-2.5 py-0.5 text-xs text-indigo-300 hover:bg-indigo-900/40 hover:text-indigo-200 transition-colors"
									title={`返回会话: ${sessionDisplayName(activeSession)}`}
								>
									<ArrowLeft size={13} />
									<span className="max-w-[180px] truncate">
										返回 {sessionDisplayName(activeSession)}
									</span>
								</button>
							)}
							<span className="text-[13px] font-medium text-neutral-300 shrink-0">
								{centerView === "settings"
									? "设置"
									: centerView === "doc"
										? "文档"
										: centerView === "backlog"
											? "收集箱"
											: "待办任务"}
							</span>
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

								{/* Session Overflow Menu (Finder, Share, Resilience) */}
								<SessionOverflowMenu
									sessionId={activeSession.id}
									cwd={activeSession.cwd}
									onOpenInFinder={handleOpenInFinder}
									onCopyMarkdown={handleCopyMarkdown}
									onMobilePair={handleMobilePair}
								/>
								{/* Terminal / Chat toggle */}
								<button
									type="button"
									onClick={() =>
										setSessionViewMode(
											activeSession.id,
											sessionViewMode === "chat" ? "terminal" : "chat",
										)
									}
									className={clsx(
										"flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
										sessionViewMode === "terminal"
											? "border border-indigo-500/40 bg-indigo-600/20 text-indigo-300"
											: "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200",
									)}
									aria-label={sessionViewMode === "chat" ? "切换到会话终端" : "返回聊天视图"}
									title={sessionViewMode === "chat" ? "用完整终端接管此会话（omp --resume，可交互操作 Agent）" : "返回聊天视图"}
								>
									{sessionViewMode === "chat" ? (
										<>
											<TerminalSquare size={13} />
											<span>会话终端</span>
										</>
									) : (
										<>
											<MessageSquare size={13} />
											<span>聊天</span>
										</>
									)}
								</button>
							</>
						)}

						<TopCapsule />

						{/* Show expand right panel button only when right panel is closed */}
						{!rightOpen && (
							<button
								type="button"
								onClick={toggleRight}
								className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-200 transition-colors"
								title="展开右侧面板 (⌘J)"
							>
								<PanelRightOpen size={15} />
							</button>
						)}
					</div>
				</div>
			</header>

			<div className="relative flex min-h-0 flex-1">
				{/* Invisible drag overlay prevents text selection and event loss across iframes/terminals */}
				{isDragging && (
					<div className="fixed inset-0 z-50 cursor-col-resize select-none" />
				)}

				{/* Left: session sidebar */}
				{sidebarOpen && (
					<>
						<aside
							style={{ width: sidebarWidth }}
							className="shrink-0 border-r border-neutral-800 bg-neutral-900/40"
						>
							<SessionSidebar />
						</aside>
						{/* Sidebar drag handle */}
						<div
							onMouseDown={onLeftDragStart}
							className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-indigo-500/40 active:bg-indigo-500/60"
							title="拖拽调节左栏宽度"
						/>
					</>
				)}

				{/* Center */}
				<main className="min-w-0 flex-1">
					<ErrorBoundary label="主视图">
						<CenterView />
					</ErrorBoundary>
				</main>

				{/* Right panel */}
				{rightOpen && (
					<>
						{/* Right panel drag handle */}
						<div
							onMouseDown={onRightDragStart}
							className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-indigo-500/40 active:bg-indigo-500/60"
							title="拖拽调节右栏宽度"
						/>
						<aside
							style={{ width: rightWidth }}
							className="flex shrink-0 flex-col border-l border-neutral-800 bg-neutral-900/40"
						>
							{rightTab ? (
								<>
									<RightPanelHeader
										activeTab={rightTab}
										tabBadges={tabBadges}
									/>
									<div className="min-h-0 flex-1 overflow-y-auto">
										<ErrorBoundary label="右侧面板">
											<RightPanelBody tab={rightTab} />
										</ErrorBoundary>
									</div>
								</>
							) : (
								<RightPanelEmptyState tabBadges={tabBadges} />
							)}
						</aside>
					</>
				)}
			</div>

			{/* Bottom status bar (CC GUI & dsh session stats) */}
			<BottomBar />
			{/* Global notifications stack */}
			<Toaster />
			{/* Global bottom-drawer terminal (Codex-style overlay) */}
			<TerminalDrawer />

			{/* Mobile QR Pairing modal */}
			{qrPairing && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) setQrPairing(null);
					}}
				>
					<div
						className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex w-full items-center justify-between border-b border-neutral-800 pb-2">
							<span className="text-xs font-medium text-neutral-200">
								手机扫码查看
							</span>
							<button
								type="button"
								onClick={() => setQrPairing(null)}
								className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
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
				</div>
			)}
			{/* Global modals — render nothing unless ui.modal matches. */}
			<BacklogPanel />
			<QuickCapture />
			<DiagnoseDialog />
			<NewSessionDialog />
		</div>
	);
}
