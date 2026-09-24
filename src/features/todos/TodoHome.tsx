import {
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	ListTodo,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { supervisorRefresh } from "../../lib/ipc";
import { useSettings } from "../settings/store";
import { TodoRow } from "./TodoRow";
import { splitTodos } from "./logic";
import { startTodos, useTodos } from "./store";

export function TodoHome() {
	const todos = useTodos((s) => s.todos);
	const counts = useTodos((s) => s.counts);
	const refreshTodos = useTodos((s) => s.refresh);

	const settings = useSettings((s) => s.settings);
	const updateSettings = useSettings((s) => s.update);
	const loadSettings = useSettings((s) => s.load);

	const [refreshingSupervisor, setRefreshingSupervisor] = useState(false);
	const [showClosed, setShowClosed] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);

	useEffect(() => {
		startTodos();
		void loadSettings();
	}, [loadSettings]);

	const { open, closed } = splitTodos(todos);

	const handleRefreshSupervisor = async () => {
		setRefreshingSupervisor(true);
		setActionError(null);
		try {
			await supervisorRefresh();
			await refreshTodos();
		} catch (e) {
			setActionError(String(e));
		} finally {
			setRefreshingSupervisor(false);
		}
	};

	return (
		<div className="flex h-full flex-col overflow-y-auto bg-neutral-950 p-6 text-neutral-200">
			{/* Header area */}
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800/80 pb-4">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
						<ListTodo className="h-5 w-5" />
					</div>
					<div>
						<h1 className="text-lg font-semibold text-neutral-100">智能待办</h1>
						<p className="text-xs text-neutral-400">
							聚合待审批、提问、报错、待验收与监工建议 ·{" "}
							<span className="text-amber-400 font-medium">
								{counts.open}
							</span>{" "}
							项待处理
						</p>
					</div>
				</div>

				{/* Top Controls & Switches */}
				<div className="flex flex-wrap items-center gap-3 text-xs">
					{/* System Detection Switch */}
					<label className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 hover:border-neutral-700">
						<input
							type="checkbox"
							className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
							checked={settings?.systemDetection ?? true}
							onChange={(e) =>
								updateSettings({ systemDetection: e.target.checked })
							}
						/>
						<span className="text-neutral-300">系统检测</span>
					</label>

					{/* Supervisor Switch */}
					<label className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 hover:border-neutral-700">
						<input
							type="checkbox"
							className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-800 text-violet-500 focus:ring-0"
							checked={settings?.supervisorEnabled ?? false}
							onChange={(e) =>
								updateSettings({ supervisorEnabled: e.target.checked })
							}
						/>
						<span className="text-neutral-300">监工建议</span>
					</label>

					{/* Refresh Supervisor Button */}
					<button
						type="button"
						disabled={refreshingSupervisor || !(settings?.supervisorEnabled)}
						onClick={handleRefreshSupervisor}
						title={
							settings?.supervisorEnabled
								? "手动触发一次监工扫描"
								: "请先开启监工建议开关"
						}
						className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/80 px-3 py-1.5 font-medium text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
					>
						<Sparkles
							className={`h-3.5 w-3.5 text-violet-400 ${
								refreshingSupervisor ? "animate-spin" : ""
							}`}
						/>
						<span>刷新监工</span>
					</button>

					{/* Refresh queue button */}
					<button
						type="button"
						onClick={() => void refreshTodos()}
						title="刷新待办列表"
						className="inline-flex items-center rounded-lg border border-neutral-800 bg-neutral-900/80 p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					>
						<RefreshCw className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{actionError && (
				<div className="mb-4 rounded-lg border border-rose-800/50 bg-rose-950/20 p-3 text-xs text-rose-300">
					{actionError}
				</div>
			)}

			{/* Main Open Queue */}
			<div className="flex-1 space-y-3">
				{open.length === 0 ? (
					<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800/80 py-16 text-center">
						<CheckCircle2 className="h-10 w-10 text-emerald-500/40" />
						<div className="mt-3 text-sm font-medium text-neutral-300">
							暂无待办事项
						</div>
						<p className="mt-1 max-w-sm text-xs text-neutral-500">
							所有会话运行平稳，无待审批或异常。有新的审批、报错或验收请求时将自动排入此处。
						</p>
					</div>
				) : (
					open.map((t, idx) => (
						<TodoRow
							key={t.id}
							todo={t}
							isMostUrgent={idx === 0}
						/>
					))
				)}

				{/* Collapsed Done/Ignored Section */}
				{closed.length > 0 && (
					<div className="mt-8 pt-4 border-t border-neutral-800/60">
						<button
							type="button"
							onClick={() => setShowClosed(!showClosed)}
							className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200"
						>
							{showClosed ? (
								<ChevronDown className="h-4 w-4" />
							) : (
								<ChevronRight className="h-4 w-4" />
							)}
							<span>已处理事项 ({closed.length})</span>
						</button>

						{showClosed && (
							<div className="mt-3 space-y-2">
								{closed.map((t) => (
									<TodoRow key={t.id} todo={t} />
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
