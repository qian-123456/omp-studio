import React, {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { QuickCapture } from "./features/backlog/QuickCapture";
import { HandbackDialog } from "./features/sidechat/HandbackDialog";
import { SessionView } from "./features/chat/SessionView";
import { SessionSidebar } from "./features/sessions/SessionSidebar";
import { useSidebarStore } from "./features/sessions/sidebarStore";
import { PendingSessionView } from "./features/sessions/PendingSessionView";
import { usePendingSession } from "./features/sessions/pendingSession";
import { ForkDraftView } from "./features/sessions/ForkDraftView";
import { useForkDraft } from "./features/sessions/forkDraft";
import { StartPage } from "./features/home/StartPage";
import { useDoctorAutoScheduler } from "./features/heatmap/doctorStore";
import { startTodos } from "./features/todos/store";

import { terminalSetCurrentSession } from "./lib/ipc";
import { installNativeShortcuts } from "./lib/nativeShortcuts";
import { suspendScrollPills } from "./lib/scrollPills";
import { useSessions } from "./stores/sessions";
import { useOmpUpdate, watchOmpStaleness, watchOmpUpdateChecks } from "./stores/ompUpdate";
import { useStartupImageGc } from "./features/settings/useStartupImageGc";
import {
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	SIDEBAR_COLLAPSE_THRESHOLD,
	type CenterView,
	useUi,
} from "./stores/ui";
import { Toaster } from "./components/Toaster";
import { BottomBar } from "./components/BottomBar";
import { CENTER_WITHOUT_RIGHT_PANEL, CenterHeader } from "./components/CenterHeader";
import { RightAside } from "./components/RightAside";

const DocView = lazy(() =>
	import("./features/editor/DocView").then((m) => ({ default: m.DocView })),
);
const InboxPage = lazy(() =>
	import("./features/inbox/InboxPage").then((m) => ({ default: m.InboxPage })),
);
const SchedulesPage = lazy(() =>
	import("./features/schedules/SchedulesPage").then((m) => ({ default: m.SchedulesPage })),
);
const SkillsPage = lazy(() =>
	import("./features/skills/SkillsPage").then((m) => ({ default: m.SkillsPage })),
);

// Lazy-load heavy overlay modals so cold-start bundle stays small
const DiagnoseDialog = lazy(() =>
	import("./features/diagnose/DiagnoseDialog").then((m) => ({ default: m.DiagnoseDialog })),
);
const ShareImageDialog = lazy(() =>
	import("./features/chat/share/ShareImageDialog").then((m) => ({ default: m.ShareImageDialog })),
);
const NewSessionDialog = lazy(() =>
	import("./features/git/NewSessionDialog").then((m) => ({ default: m.NewSessionDialog })),
);
const ResumeMissingCwdDialog = lazy(() =>
	import("./features/sessions/ResumeMissingCwdDialog").then((m) => ({
		default: m.ResumeMissingCwdDialog,
	})),
);
const SettingsOverlay = lazy(() =>
	import("./features/settings/SettingsOverlay").then((m) => ({ default: m.SettingsOverlay })),
);

/** Catches render errors so a broken view shows a readable message, not a black screen. */
class ErrorBoundary extends React.Component<
	{ children: ReactNode; label: string },
	{ error: string | null; stack: string | null }
> {
	state = { error: null as string | null, stack: null as string | null };
	static getDerivedStateFromError(e: unknown) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
	componentDidCatch(_error: unknown, info: React.ErrorInfo) {
		this.setState({ stack: info.componentStack ?? null });
	}
	render() {
		if (this.state.error) {
			return (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-neutral-400">
					<div className="font-medium text-red-400">
						{this.props.label} 渲染出错
					</div>
					<div className="mt-1 font-mono text-[11px] text-neutral-500">
						{this.state.error}
					</div>
					<button
						type="button"
						onClick={() => this.setState({ error: null, stack: null })}
						className="mt-3 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-neutral-300 hover:bg-neutral-700"
					>
						重试
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}

function MainCenterView({ activeView }: { activeView: CenterView }) {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const hasPending = usePendingSession((s) => s.pending !== null);
	const hasForkDraft = useForkDraft((s) => s.draft !== null);
	const docPath = useUi((s) => s.docPath);
	let view: ReactNode;
	switch (activeView) {
		case "session":
			view = selectedSessionId ? (
				<SessionView sessionId={selectedSessionId} />
			) : hasForkDraft ? (
				<ForkDraftView />
			) : hasPending ? (
				<PendingSessionView />
			) : (
				<StartPage />
			);
			break;
		case "doc":
			view = docPath ? <DocView path={docPath} /> : <StartPage />;
			break;
		case "inbox":
			view = <InboxPage />;
			break;
		case "schedules":
			view = <SchedulesPage />;
			break;
		case "skills":
			view = <SkillsPage />;
			break;
		default:
			view = <StartPage />;
	}
	return <Suspense fallback={null}>{view}</Suspense>;
}

export default function App() {
	useStartupImageGc();
	const rightOpen = useUi((s) => s.rightOpen);
	const toggleRight = useUi((s) => s.toggleRight);
	const setRightWidth = useUi((s) => s.setRightWidth);

	const sidebarOpen = useUi((s) => s.sidebarOpen);
	const toggleSidebar = useUi((s) => s.toggleSidebar);
	const sidebarWidth = useUi((s) => s.sidebarWidth);
	const setSidebarWidth = useUi((s) => s.setSidebarWidth);
	const setSidebarOpen = useUi((s) => s.setSidebarOpen);

	const centerView = useUi((s) => s.centerView);
	const previousCenterView = useUi((s) => s.previousCenterView);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const lastSessionId = useUi((s) => s.lastSessionId);
	const returnToSession = useUi((s) => s.returnToSession);
	const selectSession = useUi((s) => s.selectSession);
	useDoctorAutoScheduler();

	// Track the underlying view so when settings overlay opens, the center view stays mounted
	const lastNonSettingsCenterView = useRef<CenterView>("home");
	if (centerView !== "settings") {
		lastNonSettingsCenterView.current = centerView;
	}
	const effectiveCenterView =
		centerView === "settings"
			? previousCenterView ?? lastNonSettingsCenterView.current
			: centerView;
	// Full-width views drop the right dock entirely; the persisted `rightOpen`
	// preference stays untouched so it is restored on the next normal view.
	const rightVisible = rightOpen && !CENTER_WITHOUT_RIGHT_PANEL.has(effectiveCenterView);
	// Narrow selector for parentId needed by Cmd+[ shortcut (no whole-map subscription)
	const parentId = useSessions(
		useCallback(
			(s) => {
				const id = selectedSessionId || lastSessionId;
				if (!id) return null;
				const session = s.sessions[id];
				return (
					session?.parentId ??
					(session && "parentSessionId" in session && typeof session.parentSessionId === "string"
						? session.parentSessionId
						: null)
				);
			},
			[selectedSessionId, lastSessionId],
		),
	);

	// Resizable sidebars: delta-drag (seam keeps its grab offset under the pointer), rAF-throttled
	// live updates, persistence only on drag end. Cursor/user-select live on the overlay div, so
	// they disappear with it — no global body styles to leak.
	const drag = useRef<{ side: "left" | "right"; grabOffsetX: number } | null>(null);
	const [draggingSide, setDraggingSide] = useState<"left" | "right" | null>(null);
	const isDragging = draggingSide !== null;

	const onLeftDragStart = useCallback((e: React.MouseEvent) => {
		if (e.button !== 0) return;
		e.preventDefault();
		drag.current = { side: "left", grabOffsetX: e.clientX - useUi.getState().sidebarWidth };
		setDraggingSide("left");
	}, []);

	const onRightDragStart = useCallback((e: React.MouseEvent) => {
		if (e.button !== 0) return;
		e.preventDefault();
		const seamX = window.innerWidth - useUi.getState().rightWidth;
		drag.current = { side: "right", grabOffsetX: e.clientX - seamX };
		setDraggingSide("right");
	}, []);

	useEffect(() => {
		if (!draggingSide) return;
		let rafId: number | null = null;
		let latestClientX: number | null = null;

		const updateWidth = () => {
			rafId = null;
			const d = drag.current;
			if (!d || latestClientX === null) return;
			// Live update without persisting; the store setter (which writes localStorage) runs on end.
			if (d.side === "left") {
				const raw = latestClientX - d.grabOffsetX;
				if (raw < SIDEBAR_COLLAPSE_THRESHOLD) {
					useUi.setState({ sidebarOpen: false });
				} else {
					const w = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, raw));
					useUi.setState({ sidebarOpen: true, sidebarWidth: w });
				}
			} else {
				const w = Math.min(720, Math.max(260, window.innerWidth - latestClientX + d.grabOffsetX));
				useUi.setState({ rightWidth: w });
			}
		};

		const onMove = (e: MouseEvent) => {
			latestClientX = e.clientX;
			if (rafId === null) rafId = requestAnimationFrame(updateWidth);
		};

		const end = () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				updateWidth();
			}
			const d = drag.current;
			drag.current = null;
			if (d) {
				const s = useUi.getState();
				if (d.side === "left") {
					if (!s.sidebarOpen) {
						setSidebarOpen(false);
					} else {
						setSidebarOpen(true);
						setSidebarWidth(s.sidebarWidth);
					}
				} else {
					setRightWidth(s.rightWidth);
				}
			}
			setDraggingSide(null);
		};

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") end();
		};

		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", end);
		window.addEventListener("blur", end);
		window.addEventListener("keydown", onKey);
		return () => {
			if (rafId !== null) cancelAnimationFrame(rafId);
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", end);
			window.removeEventListener("blur", end);
			window.removeEventListener("keydown", onKey);
		};
	}, [draggingSide, setSidebarWidth, setRightWidth, setSidebarOpen]);

	useEffect(() => {
		suspendScrollPills(draggingSide !== null);
		return () => suspendScrollPills(false);
	}, [draggingSide]);

	// Global keyboard shortcuts: Cmd+B (left sidebar) / Cmd+J (right panel) / Cmd+[ (return to session/parent)
	// Cmd+` (right-panel command terminal) / Cmd+Shift+` (selected session: chat ⇄ Agent terminal)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (centerView === "settings") return;
			const isMod = e.metaKey || e.ctrlKey;
			if (!isMod) return;
			if (e.key.toLowerCase() === "b" && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				toggleSidebar();
			} else if (
				e.key.toLowerCase() === "j" &&
				!e.shiftKey &&
				!e.altKey &&
				!CENTER_WITHOUT_RIGHT_PANEL.has(effectiveCenterView)
			) {
				e.preventDefault();
				toggleRight();
			} else if (e.key === "[" && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				// On a full-page view (doc/inbox/…) ⌘[ leaves it first; only on the
				// session itself does it climb to the side-chat parent.
				if (parentId && effectiveCenterView === "session") {
					selectSession(parentId);
				} else {
					returnToSession();
				}

			} else if ((e.key === "`" || e.code === "Backquote") && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				const ui = useUi.getState();
				if (ui.rightOpen && ui.rightTab === "terminal") ui.setRightOpen(false);
				else ui.setRightTab("terminal");
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [
		centerView,
		effectiveCenterView,
		toggleSidebar,
		toggleRight,
		parentId,
		selectSession,
		returnToSession,
	]);

	useEffect(() => installNativeShortcuts(), []);

	// Initialize todos subscription; load versions and auto-check omp updates at the configured interval
	useEffect(() => {
		startTodos();
		void useOmpUpdate.getState().checkOnStartup();
		const stopChecks = watchOmpUpdateChecks();
		const stopStaleness = watchOmpStaleness();
		return () => {
			stopChecks();
			stopStaleness();
		};
	}, []);



	// Keep ~/.omp-workspace/current-session in sync with selected session
	const selectedSessionFile = useSessions(
		useCallback(
			(s) => (selectedSessionId ? (s.sessions[selectedSessionId]?.file ?? null) : null),
			[selectedSessionId],
		),
	);
	useEffect(() => {
		terminalSetCurrentSession(selectedSessionId ? selectedSessionFile : null).catch(() => {});
	}, [selectedSessionId, selectedSessionFile]);

	// Restore last session once the session list finishes loading
	const hasLoaded = useSessions((s) => s.hasLoaded);
	const restoredRef = useRef(false);
	useEffect(() => {
		if (!hasLoaded || restoredRef.current) return;
		restoredRef.current = true;
		const last = useUi.getState().lastSessionId;
		if (!last) return;
		const exists = useSessions.getState().sessions[last];
		// Modes are isolated: only restore a session that belongs to the active mode.
		if (exists && exists.mode === useSidebarStore.getState().activeMode) {
			useUi.setState({ selectedSessionId: last, centerView: "session" });
		} else {
			useUi.getState().leaveSession();
		}
	}, [hasLoaded]);

	return (
		<div id="app-shell" className="relative flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-200">
			<div
				id="app-wallpaper-background"
				aria-hidden
				className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center transition-all duration-300"
				style={{ backgroundImage: "var(--app-wallpaper-url)" }}
			/>
			<div
				id="app-wallpaper-veil"
				aria-hidden
				className="pointer-events-none fixed inset-0 z-0 transition-all duration-300"
			/>
			{/* Body row: [left column][center column][right aside]; right aside spans full window height */}
			<div className="relative z-10 flex min-h-0 flex-1">
				{/* Invisible drag overlay prevents text selection and event loss across iframes/terminals */}
				{isDragging && (
					<div className="fixed inset-0 z-(--z-pill) cursor-col-resize select-none" />
				)}

				{/* Left column: topbar cell + session sidebar, strictly matches sidebarWidth */}
				{sidebarOpen && (
					<>
						<div
							style={{ width: sidebarWidth }}
							className="flex shrink-0 flex-col vibrancy-chrome"
						>
							<aside className="min-h-0 flex-1">
								<SessionSidebar />
							</aside>
						</div>
						{/* Sidebar drag handle */}
						<div
							onMouseDown={onLeftDragStart}
							className="group/handle relative z-40 w-0 shrink-0 cursor-col-resize"
							title="拖拽调节左栏宽度"
						>
							<div className="absolute inset-y-0 left-1/2 w-2 -translate-x-1/2" />
							<div
								className={`pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors ${draggingSide === "left" ? "bg-[#0A84FF]/60" : "bg-[var(--border-divider)] group-hover/handle:bg-[#0A84FF]/60"}`}
							/>
						</div>
					</>
				)}

				{/* Center column: topbar + main conversation view */}
				<div className="flex min-w-0 flex-1 flex-col">
					<CenterHeader
						sidebarOpen={sidebarOpen}
						toggleSidebar={toggleSidebar}
						rightOpen={rightOpen}
						toggleRight={toggleRight}
					/>

					{/* Center main view */}
					<main className="min-h-0 min-w-0 flex-1">
						<ErrorBoundary label="主视图">
							<MainCenterView activeView={effectiveCenterView} />
						</ErrorBoundary>
					</main>
				</div>

				{/* Right panel — spans the full window height above the BottomBar */}
				{rightVisible && (
					<>
						{/* Right panel drag handle */}
						<div
							onMouseDown={onRightDragStart}
							className="group/handle relative z-40 w-0 shrink-0 cursor-col-resize"
							title="拖拽调节右栏宽度"
						>
							<div className="absolute inset-y-0 left-1/2 w-2 -translate-x-1/2" />
							<div
								className={`pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors ${draggingSide === "right" ? "bg-[#0A84FF]/60" : "bg-[var(--border-divider)] group-hover/handle:bg-[#0A84FF]/60"}`}
							/>
						</div>
						<RightAside />
					</>
				)}
			</div>

			{/* Bottom status bar (CC GUI & dsh session stats) */}
			<BottomBar />
			{/* Global notifications stack */}
			<Toaster />
			{/* Global modals — render nothing unless ui.modal matches. Lazy loaded in Suspense */}
			<QuickCapture />
			<HandbackDialog />
			<Suspense fallback={null}>
				<DiagnoseDialog />
				<ShareImageDialog />
				<NewSessionDialog />
				<ResumeMissingCwdDialog />
				<SettingsOverlay />
			</Suspense>
		</div>
	);
}
