import { CheckCircle2, ChevronDown, ChevronRight, ListTodo, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { TodoRow } from "./TodoRow";
import { splitTodos } from "./logic";
import { startTodos, useTodos } from "./store";

export function TodoPanel() {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const session = useSessions((s) =>
		selectedSessionId ? s.sessions[selectedSessionId] : undefined,
	);
	const todos = useTodos((s) => s.todos);
	const refreshTodos = useTodos((s) => s.refresh);
	const [showClosed, setShowClosed] = useState(false);

	useEffect(() => {
		startTodos();
	}, []);

	if (!selectedSessionId) {
		return (
			<div className="flex h-full flex-col items-center justify-center p-4 text-center text-neutral-500">
				<ListTodo className="h-8 w-8 text-neutral-600 mb-2" />
				<div className="text-xs text-neutral-400 font-medium">未选择会话</div>
				<div className="text-[11px] text-neutral-600 mt-1 max-w-[200px]">
					在左侧会话列表中选择一个会话以查看其专属待办事项。
				</div>
			</div>
		);
	}

	const sessionTitle = session?.title || selectedSessionId;
	const { open, closed } = splitTodos(todos, selectedSessionId);

	return (
		<div className="flex h-full flex-col overflow-y-auto bg-neutral-900/40 p-3 text-neutral-200">
			{/* Panel Header */}
			<div className="mb-3 flex items-center justify-between border-b border-neutral-800 pb-2">
				<div className="min-w-0 flex-1">
					<div className="text-xs font-semibold text-neutral-200 truncate">
						{sessionTitle}
					</div>
					<div className="text-[11px] text-neutral-500">
						待处理待办: <span className="text-amber-400 font-medium">{open.length}</span> 项
					</div>
				</div>
				<button
					type="button"
					onClick={() => void refreshTodos()}
					title="刷新"
					className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
				>
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			</div>

			{/* Open Items for Selected Session */}
			<div className="flex-1 space-y-2">
				{open.length === 0 ? (
					<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 py-8 text-center text-neutral-500">
						<CheckCircle2 className="h-6 w-6 text-emerald-500/40 mb-1" />
						<div className="text-xs text-neutral-400">当前会话无待办</div>
					</div>
				) : (
					open.map((t, idx) => (
						<TodoRow
							key={t.id}
							todo={t}
							isMostUrgent={idx === 0}
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
		</div>
	);
}
