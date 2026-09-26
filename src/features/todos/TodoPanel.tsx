import {
	ArrowRight,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	ListTodo,
	RefreshCw,
	RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { TodoRow } from "./TodoRow";
import { splitTodos } from "./logic";
import { startTodos, useTodos } from "./store";

export function TodoPanel() {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const setCenter = useUi((s) => s.setCenter);
	const session = useSessions((s) =>
		selectedSessionId ? s.sessions[selectedSessionId] : undefined,
	);
	const todos = useTodos((s) => s.todos);
	const refreshTodos = useTodos((s) => s.refresh);
	const lastIgnored = useTodos((s) => s.lastIgnored);
	const undoIgnore = useTodos((s) => s.undoIgnore);
	const actTodo = useTodos((s) => s.act);

	const [scope, setScope] = useState<"current" | "all">(
		selectedSessionId ? "current" : "all",
	);
	const [showClosed, setShowClosed] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(0);

	useEffect(() => {
		startTodos();
	}, []);

	// If a session becomes selected, we keep current scope unless it was forced to all
	useEffect(() => {
		if (!selectedSessionId && scope === "current") {
			// Stay on current tab to show helpful guidance
		}
	}, [selectedSessionId, scope]);

	const currentSplits = splitTodos(todos, selectedSessionId);
	const allSplits = splitTodos(todos);

	const isCurrent = scope === "current";
	const activeSplits = isCurrent ? currentSplits : allSplits;
	const { open, closed } = activeSplits;

	// Clamp focused index
	useEffect(() => {
		if (focusedIndex >= open.length && open.length > 0) {
			setFocusedIndex(open.length - 1);
		}
	}, [open.length, focusedIndex]);

	// Keyboard triage flow (j/k or ↑/↓, y/n/x/Enter)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
			if (tag === "input" || tag === "textarea") return;
			if (open.length === 0) return;

			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				setFocusedIndex((i) => Math.min(open.length - 1, i + 1));
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				setFocusedIndex((i) => Math.max(0, i - 1));
			} else if (e.key === "y") {
				const target = open[focusedIndex];
				if (target && target.kind !== "approval" && target.kind !== "review") {
					e.preventDefault();
					void actTodo(target.id, "done");
				}
			} else if (e.key === "x" || e.key === "n") {
				const target = open[focusedIndex];
				if (target) {
					e.preventDefault();
					void actTodo(target.id, "ignore");
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, focusedIndex, actTodo]);

	const sessionTitle = session?.title || selectedSessionId;

	const handleRefresh = async () => {
		await refreshTodos();
		toast.info("已刷新待办列表");
	};

	return (
		<div className="flex h-full flex-col overflow-y-auto bg-neutral-900/40 p-3 text-neutral-200">
			{/* Scope Switcher Segmented Control */}
			<div className="mb-3 flex items-center justify-between gap-2 border-b border-neutral-800 pb-2">
				<div className="flex rounded-lg bg-neutral-800/80 p-0.5 text-xs font-medium">
					<button
						type="button"
						onClick={() => setScope("current")}
						title={sessionTitle ? `当前会话: ${sessionTitle}` : "当前会话"}
						className={`rounded-md px-2.5 py-1 transition-colors ${
							isCurrent
								? "bg-neutral-700 text-neutral-100 shadow-sm"
								: "text-neutral-400 hover:text-neutral-200"
						}`}
					>
						当前会话 ({currentSplits.open.length})
					</button>
					<button
						type="button"
						onClick={() => setScope("all")}
						className={`rounded-md px-2.5 py-1 transition-colors ${
							!isCurrent
								? "bg-neutral-700 text-neutral-100 shadow-sm"
								: "text-neutral-400 hover:text-neutral-200"
						}`}
					>
						全部待办 ({allSplits.open.length})
					</button>
				</div>

				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => setCenter("home")}
						title="前往待办中心首页"
						className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
					>
						<ExternalLink className="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onClick={handleRefresh}
						title="刷新待办"
						className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
					>
						<RefreshCw className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{/* Undo Ignored Banner */}
			{lastIgnored && (
				<div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-600/40 bg-amber-950/20 px-2.5 py-1.5 text-xs text-amber-200">
					<span className="truncate">已忽略: {lastIgnored.title}</span>
					<button
						type="button"
						onClick={() => void undoIgnore()}
						className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/30"
					>
						<RotateCcw className="h-3 w-3" /> 撤销
					</button>
				</div>
			)}

			{/* Current Session Unselected Fallback */}
			{isCurrent && !selectedSessionId && (
				<div className="my-auto flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800 p-6 text-center text-neutral-500">
					<ListTodo className="mb-2 h-8 w-8 text-neutral-600" />
					<div className="text-xs font-medium text-neutral-300">
						未选择当前会话
					</div>
					<div className="mt-1 max-w-[220px] text-[11px] text-neutral-500">
						选择一个会话以查看其专属待办，或直接切换到全局待办列表。
					</div>
					<div className="mt-4 flex flex-col gap-1.5 w-full">
						<button
							type="button"
							onClick={() => setScope("all")}
							className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
						>
							<span>查看全部待办 ({allSplits.open.length})</span>
							<ArrowRight className="h-3 w-3" />
						</button>
						<button
							type="button"
							onClick={() => setCenter("home")}
							className="inline-flex items-center justify-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
						>
							前往待办中心首页
						</button>
					</div>
				</div>
			)}
			{!(isCurrent && !selectedSessionId) && (
				<div className="flex-1 space-y-2">
				{isCurrent && sessionTitle && (
					<div
						className="mb-1 truncate text-[11px] font-medium text-neutral-400"
						title={`当前会话: ${sessionTitle}`}
					>
						会话: {sessionTitle}
					</div>
				)}
				{open.length === 0 ? (
					<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 py-8 text-center text-neutral-500">
						<CheckCircle2 className="mb-1 h-6 w-6 text-emerald-500/40" />
						<div className="text-xs text-neutral-400">
							{isCurrent ? "当前会话无待办" : "暂无待办事项"}
						</div>
					</div>
				) : (
					open.map((t, idx) => (
						<TodoRow
							key={t.id}
							todo={t}
							isMostUrgent={idx === 0}
							isFocused={idx === focusedIndex}
							compact
						/>
					))
				)}

				{/* Closed items */}
				{closed.length > 0 && (
					<div className="mt-4 pt-2 border-t border-neutral-800/60">
						<button
							type="button"
							onClick={() => setShowClosed(!showClosed)}
							className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300"
						>
							{showClosed ? (
								<ChevronDown className="h-3.5 w-3.5" />
							) : (
								<ChevronRight className="h-3.5 w-3.5" />
							)}
							<span>已处理 ({closed.length})</span>
						</button>

						{showClosed && (
							<div className="mt-2 space-y-1.5">
								{closed.map((t) => (
									<TodoRow key={t.id} todo={t} compact />
								))}
							</div>
						)}
					</div>
				)}
				</div>
			)}
		</div>
	);
}
