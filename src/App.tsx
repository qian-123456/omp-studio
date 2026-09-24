import clsx from "clsx";
import {
	Home,
	Inbox,
	PanelRightClose,
	PanelRightOpen,
	Settings as SettingsIcon,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { BacklogPage } from "./features/backlog/BacklogPage";
import { QuickCapture } from "./features/backlog/QuickCapture";
import { SessionView } from "./features/chat/SessionView";
import { DiagnoseDialog } from "./features/diagnose/DiagnoseDialog";
import { DocView } from "./features/editor/DocView";
import { GitPanel } from "./features/git/GitPanel";
import { NewSessionDialog } from "./features/git/NewSessionDialog";
import { HeatmapPanel } from "./features/heatmap/HeatmapPanel";
import { ServicesPanel } from "./features/services/ServicesPanel";
import { SessionSidebar } from "./features/sessions/SessionSidebar";
import { SettingsPage } from "./features/settings/SettingsPage";
import { SideChatPanel } from "./features/sidechat/SideChatPanel";
import { TodoHome } from "./features/todos/TodoHome";
import { TodoPanel } from "./features/todos/TodoPanel";
import { TopCapsule } from "./features/todos/TopCapsule";
import { type RightTab, useUi } from "./stores/ui";

const RIGHT_TABS: { id: RightTab; label: string }[] = [
	{ id: "sidechat", label: "侧聊" },
	{ id: "heatmap", label: "热力图" },
	{ id: "todos", label: "待办" },
	{ id: "git", label: "Git" },
	{ id: "services", label: "服务" },
];

function RightPanelBody({ tab }: { tab: RightTab }) {
	switch (tab) {
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
				<TodoHome />
			);
		case "doc":
			return docPath ? <DocView path={docPath} /> : <TodoHome />;
		case "backlog":
			return <BacklogPage />;
		case "settings":
			return <SettingsPage />;
		default:
			return <TodoHome />;
	}
}

export default function App() {
	const rightTab = useUi((s) => s.rightTab);
	const rightOpen = useUi((s) => s.rightOpen);
	const setRightTab = useUi((s) => s.setRightTab);
	const toggleRight = useUi((s) => s.toggleRight);
	const setCenter = useUi((s) => s.setCenter);
	const centerView = useUi((s) => s.centerView);

	// Resizable left sidebar (~280px).
	const [sidebarWidth, setSidebarWidth] = useState(280);
	const dragging = useRef(false);
	const onDragStart = useCallback(() => {
		dragging.current = true;
	}, []);
	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!dragging.current) return;
			setSidebarWidth(Math.min(480, Math.max(200, e.clientX)));
		};
		const onUp = () => {
			dragging.current = false;
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
	}, []);

	const navBtn = (view: "home" | "backlog" | "settings", label: string, icon: ReactNode) => (
		<button
			type="button"
			onClick={() => setCenter(view)}
			className={clsx(
				"flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs",
				centerView === view
					? "bg-neutral-800 text-neutral-100"
					: "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
			)}
		>
			{icon}
			{label}
		</button>
	);

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-200">
			{/* Top bar — overlay titlebar; left padding clears the traffic lights. */}
			<header
				data-tauri-drag-region
				className="flex h-12 shrink-0 items-center gap-1 border-b border-neutral-800 pl-[78px] pr-3"
			>
				{navBtn("home", "首页", <Home size={14} />)}
				{navBtn("backlog", "收集箱", <Inbox size={14} />)}
				{navBtn("settings", "设置", <SettingsIcon size={14} />)}
				<div className="flex-1" data-tauri-drag-region />
				<TopCapsule />
				<button
					type="button"
					onClick={toggleRight}
					className="ml-2 rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
					title={rightOpen ? "收起右侧面板" : "展开右侧面板"}
				>
					{rightOpen ? (
						<PanelRightClose size={16} />
					) : (
						<PanelRightOpen size={16} />
					)}
				</button>
			</header>

			<div className="flex min-h-0 flex-1">
				{/* Left: session sidebar */}
				<aside
					style={{ width: sidebarWidth }}
					className="shrink-0 border-r border-neutral-800 bg-neutral-900/40"
				>
					<SessionSidebar />
				</aside>
				{/* Sidebar drag handle */}
				<div
					onMouseDown={onDragStart}
					className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-indigo-500/40"
				/>

				{/* Center */}
				<main className="min-w-0 flex-1">
					<CenterView />
				</main>

				{/* Right panel */}
				{rightOpen && (
					<aside className="flex w-[360px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-900/40">
						<div className="flex shrink-0 items-center gap-1 border-b border-neutral-800 px-2 py-1.5">
							{RIGHT_TABS.map((t) => (
								<button
									key={t.id}
									type="button"
									onClick={() => setRightTab(t.id)}
									className={clsx(
										"rounded-md px-2.5 py-1 text-xs",
										rightTab === t.id
											? "bg-neutral-800 text-neutral-100"
											: "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
									)}
								>
									{t.label}
								</button>
							))}
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto">
							<RightPanelBody tab={rightTab} />
						</div>
					</aside>
				)}
			</div>

			{/* Global modals — render nothing unless ui.modal matches. */}
			<QuickCapture />
			<DiagnoseDialog />
			<NewSessionDialog />
		</div>
	);
}
