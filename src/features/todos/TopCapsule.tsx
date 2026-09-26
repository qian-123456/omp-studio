import {
	AlertCircle,
	Bot,
	ChevronRight,
	Copy,
	Inbox,
	ListTodo,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "../../lib/dialogs";
import { useEscapeKey } from "../../lib/hooks";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import { useBacklog } from "../backlog/backlogStore";
import { useSettings } from "../settings/store";
import { TodoRow } from "./TodoRow";
import { splitTodos, subagentBucket, subagentCounts } from "./logic";
import { startTodos, useTodos } from "./store";
export function TopCapsule() {
	const settings = useSettings((s) => s.settings);
	const loadSettings = useSettings((s) => s.load);

	const todos = useTodos((s) => s.todos);
	const counts = useTodos((s) => s.counts);

	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const setCenter = useUi((s) => s.setCenter);

	const live = useLive((s) =>
		selectedSessionId ? s.sessions[selectedSessionId] : undefined,
	);

	const [openTodoPopover, setOpenTodoPopover] = useState(false);
	const [openSubPopover, setOpenSubPopover] = useState(false);
	const [expandedSubId, setExpandedSubId] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Backlog capsule segment state (panel itself is BacklogPanel, rendered in App)
	const backlogOpen = useBacklog((s) => s.open);
	const toggleBacklog = useBacklog((s) => s.toggle);
	const setBacklogOpen = useBacklog((s) => s.setOpen);
	const backlogItems = useBacklog((s) => s.items);

	useEffect(() => {
		startTodos();
		void loadSettings();
		useBacklog
			.getState()
			.load()
			.catch(() => {});
	}, [loadSettings]);

	// Close on Escape key
	useEscapeKey(
		() => {
			setOpenTodoPopover(false);
			setOpenSubPopover(false);
		},
		openTodoPopover || openSubPopover,
	);

	// Close popovers on click outside
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setOpenTodoPopover(false);
				setOpenSubPopover(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Auto-collapse popovers when selected session changes
	useEffect(() => {
		setOpenTodoPopover(false);
		setOpenSubPopover(false);
	}, [selectedSessionId]);

	if (settings && !settings.capsuleVisible) {
		return null;
	}

	const subagents = live?.subagents ?? {};
	const subCounts = subagentCounts(subagents);
	const hasSubagents = Object.keys(subagents).length > 0;
	const { open: openTodos } = splitTodos(todos);

	return (
		<div ref={containerRef} className="relative flex items-center gap-1.5">
			{/* Main Capsule Pill */}
			<div className="flex items-center rounded-full border border-neutral-700/80 bg-neutral-800/80 p-0.5 text-xs shadow-sm">
				{/* Todo Queue Button Segment */}
				<button
					type="button"
					onClick={() => {
						setOpenTodoPopover(!openTodoPopover);
						setOpenSubPopover(false);
						setBacklogOpen(false);
					}}
					className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors ${
						openTodoPopover
							? "bg-neutral-700 text-neutral-100"
							: "text-neutral-300 hover:bg-neutral-700/60 hover:text-neutral-100"
					}`}
				>
					<span
						className={`h-2 w-2 rounded-full ${
							counts.open > 0 ? "bg-amber-400 animate-pulse" : "bg-neutral-500"
						}`}
					/>
					<ListTodo className="h-3.5 w-3.5 text-neutral-400" />
					<span>
						待处理{" "}
						<strong className="text-amber-400 font-semibold">
							{counts.open}
						</strong>
						/{counts.total}
					</span>
				</button>

				{/* Backlog Inbox Segment */}
				<div className="h-3.5 w-[1px] bg-neutral-700" />
				<button
					type="button"
					onClick={() => {
						toggleBacklog();
						setOpenTodoPopover(false);
						setOpenSubPopover(false);
					}}
					className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors ${
						backlogOpen
							? "bg-neutral-700 text-neutral-100"
							: "text-neutral-300 hover:bg-neutral-700/60 hover:text-neutral-100"
					}`}
					title="收集箱"
				>
					<Inbox className="h-3.5 w-3.5 text-amber-400" />
					<span>收集箱</span>
					<span className="rounded bg-amber-500/20 px-1 py-0.2 text-[10px] text-amber-300">
						{backlogItems.filter((i) => i.status === "inbox").length}
					</span>
				</button>

				{/* Subagent Strip Segment (when active session has subagents) */}
				{hasSubagents && (
					<>
						<div className="h-3.5 w-[1px] bg-neutral-700" />
						<button
							type="button"
							onClick={() => {
								setOpenSubPopover(!openSubPopover);
								setOpenTodoPopover(false);
								setBacklogOpen(false);
							}}
							className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors ${
								openSubPopover
									? "bg-neutral-700 text-neutral-100"
									: "text-neutral-300 hover:bg-neutral-700/60 hover:text-neutral-100"
							}`}
							title="查看当前会话的子任务状态"
						>
							<Bot className="h-3.5 w-3.5 text-violet-400" />
							<span>子任务</span>
							{subCounts.running > 0 && (
								<span className="rounded bg-sky-500/20 px-1 py-0.2 text-[10px] text-sky-300">
									{subCounts.running} 运行
								</span>
							)}
							{subCounts.done > 0 && (
								<span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[10px] text-emerald-300">
									{subCounts.done} 完成
								</span>
							)}
							{subCounts.failed > 0 && (
								<span className="rounded bg-rose-500/20 px-1 py-0.2 text-[10px] text-rose-300">
									{subCounts.failed} 失败
								</span>
							)}
						</button>
					</>
				)}
			</div>

			{/* Todo Popover Dropdown */}
			{openTodoPopover && (
				<div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-2xl">
					<div className="mb-2 flex items-center justify-between border-b border-neutral-800 pb-2">
						<div className="flex items-center gap-2">
							<span className="text-xs font-semibold text-neutral-200">
								待处理队列 ({openTodos.length})
							</span>
							<button
								type="button"
								onClick={() => {
									setOpenTodoPopover(false);
									setCenter("home");
								}}
								className="inline-flex items-center gap-0.5 text-[11px] text-amber-400 hover:underline"
							>
								<span>查看完整待办</span>
								<ChevronRight className="h-3 w-3" />
							</button>
						</div>
						<button
							type="button"
							onClick={() => setOpenTodoPopover(false)}
							className="rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
							title="关闭待办列表"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>

					<div className="max-h-80 space-y-2 overflow-y-auto pr-0.5">
						{openTodos.length === 0 ? (
							<div className="py-6 text-center text-xs text-neutral-500">
								暂无待处理待办
							</div>
						) : (
							openTodos.slice(0, 5).map((t, idx) => (
								<TodoRow
									key={t.id}
									todo={t}
									isMostUrgent={idx === 0}
									compact
									onAction={() => setOpenTodoPopover(false)}
									onNavigate={() => setOpenTodoPopover(false)}
								/>
							))
						)}
					</div>

					{/* Guide to remaining items if truncated */}
					{openTodos.length > 5 && (
						<div className="mt-2 border-t border-neutral-800/80 pt-2 text-center">
							<button
								type="button"
								onClick={() => {
									setOpenTodoPopover(false);
									setCenter("home");
								}}
								className="w-full rounded-lg bg-neutral-800/70 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-neutral-800 hover:text-amber-300"
							>
								还有 {openTodos.length - 5} 项未显示 · 查看完整待办 →
							</button>
						</div>
					)}
				</div>
			)}

			{/* Subagents Popover Dropdown */}
			{openSubPopover && (
				<div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-2xl">
					<div className="mb-2 flex items-center justify-between border-b border-neutral-800 pb-2">
						<div className="text-xs font-semibold text-neutral-200">
							子任务列表 ({Object.keys(subagents).length})
						</div>
						<button
							type="button"
							onClick={() => setOpenSubPopover(false)}
							className="text-neutral-500 hover:text-neutral-300"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>

					<div className="max-h-72 space-y-1.5 overflow-y-auto">
						{Object.entries(subagents).map(([id, sub]) => {
							const agent =
								typeof sub.agent === "string" && sub.agent ? sub.agent : null;
							const task = typeof sub.task === "string" ? sub.task : "";
							const bucket = subagentBucket(String(sub.status ?? ""));
							const isExpanded = expandedSubId === id;

							return (
								<div
									key={id}
									onClick={() =>
										setExpandedSubId(isExpanded ? null : id)
									}
									className={`cursor-pointer rounded-lg border transition-all ${
										isExpanded
											? "border-neutral-700 bg-neutral-900/90 shadow-sm"
											: "border-neutral-800 bg-neutral-950/60 hover:border-neutral-700"
									} p-2 text-xs`}
								>
									<div className="flex items-center justify-between gap-1.5">
										<div className="flex min-w-0 items-center gap-1.5">
											<span className="truncate font-medium text-neutral-200">
												{agent || sub.label || id}
											</span>
											<ChevronRight
												className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${
													isExpanded ? "rotate-90" : ""
												}`}
											/>
										</div>

										{/* Status badge with red indicator for failed */}
										<span
											className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
												bucket === "failed"
													? "border border-rose-500/30 bg-rose-500/20 text-rose-300"
													: bucket === "running"
														? "bg-sky-500/20 text-sky-300"
														: bucket === "done"
															? "bg-emerald-500/20 text-emerald-300"
															: "bg-neutral-800 text-neutral-400"
											}`}
										>
											{bucket === "failed" && (
												<AlertCircle className="h-2.5 w-2.5 text-rose-400" />
											)}
											<span>{sub.status || "未知"}</span>
										</span>
									</div>

									{task && (
										<div
											className={`mt-1 text-[11px] text-neutral-400 ${
												isExpanded
													? "whitespace-pre-wrap break-words leading-relaxed"
													: "line-clamp-2"
											}`}
										>
											{task}
										</div>
									)}

									{/* Expanded details view */}
									{isExpanded && (
										<div
											className="mt-2 space-y-1.5 border-t border-neutral-800/80 pt-2 text-[11px]"
											onClick={(e) => e.stopPropagation()}
										>
											<div className="flex items-center justify-between text-neutral-400">
												<span>
													ID: <code className="text-neutral-300">{id}</code>
												</span>
												<button
													type="button"
													onClick={async () => {
														await copyText(task || id);
														toast.success("已复制任务信息");
													}}
													className="inline-flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
												>
													<Copy className="h-2.5 w-2.5" />
													<span>复制</span>
												</button>
											</div>
											{Boolean(sub.error) && (
												<div className="rounded border border-rose-800/50 bg-rose-950/40 p-1.5 text-rose-300">
													错误: {String(sub.error)}
												</div>
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
