import {
	ArrowRight,
	Bot,
	Bug,
	Check,
	FileText,
	Inbox,
	Lightbulb,
	ListTodo,
	MessageSquare,
	Plus,
	Quote,
	RefreshCw,
	Send,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
	BacklogItem,
	BacklogKind,
	BacklogRef,
	BacklogStatus,
	Workspace,
} from "../../lib/contracts";
import { onBacklogChanged } from "../../lib/events";
import {
	backlogAdd,
	backlogBuildPrompt,
	backlogDelete,
	backlogList,
	backlogUpdate,
	dispatchPrompt,
	listWorkspaces,
	rpcSend,
	rpcStart,
} from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

const KIND_META: Record<
	BacklogKind,
	{ label: string; icon: typeof Lightbulb; color: string }
> = {
	idea: {
		label: "想法",
		icon: Lightbulb,
		color: "bg-amber-500/15 text-amber-300 border-amber-500/30",
	},
	bug: {
		label: "缺陷",
		icon: Bug,
		color: "bg-rose-500/15 text-rose-300 border-rose-500/30",
	},
	todo: {
		label: "待办",
		icon: ListTodo,
		color: "bg-sky-500/15 text-sky-300 border-sky-500/30",
	},
};

const STATUS_LABELS: Record<BacklogStatus, string> = {
	inbox: "收集箱",
	dispatched: "已派发",
	done: "已完成",
	closed: "已关闭",
};

export function BacklogPage() {
	const [items, setItems] = useState<BacklogItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [activeTab, setActiveTab] = useState<BacklogStatus>("inbox");

	// Capture Form State
	const [inputText, setInputText] = useState("");
	const [inputKind, setInputKind] = useState<BacklogKind>("todo");
	const [attachCurrentSession, setAttachCurrentSession] = useState(true);
	const [submitting, setSubmitting] = useState(false);

	// Dispatch Modal State
	const [dispatchingItem, setDispatchingItem] = useState<BacklogItem | null>(null);
	const [dispatchTargetType, setDispatchTargetType] = useState<"existing" | "new">("existing");
	const [selectedExistingId, setSelectedExistingId] = useState<string>("");
	const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string>("");
	const [newSessionModel, setNewSessionModel] = useState<string>("");
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [dispatching, setDispatching] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);

	const currentSession = selectedSessionId
		? sessions[selectedSessionId]
		: undefined;

	const loadItems = async () => {
		try {
			setLoading(true);
			const list = await backlogList();
			setItems(list);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void loadItems();
		void listWorkspaces().then(setWorkspaces).catch(() => {});
		const unlisten = onBacklogChanged(() => {
			void loadItems();
		});
		return () => {
			void unlisten.then((fn) => fn());
		};
	}, []);

	const handleAdd = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = inputText.trim();
		if (!trimmed) return;
		setSubmitting(true);
		setError(null);
		try {
			const refs: BacklogRef[] = [];
			if (attachCurrentSession && selectedSessionId) {
				refs.push({ kind: "session", sessionId: selectedSessionId, path: null, text: null, lines: null });
			}
			await backlogAdd(trimmed, inputKind, refs);
			setInputText("");
			await loadItems();
		} catch (err) {
			setError(String(err));
		} finally {
			setSubmitting(false);
		}
	};

	const handleUpdateStatus = async (id: string, status: BacklogStatus) => {
		try {
			await backlogUpdate(id, { status });
			await loadItems();
		} catch (err) {
			setError(String(err));
		}
	};

	const handleDelete = async (id: string) => {
		try {
			await backlogDelete(id);
			await loadItems();
		} catch (err) {
			setError(String(err));
		}
	};

	const handleOpenDispatch = (item: BacklogItem) => {
		setDispatchingItem(item);
		// Default to selectedSessionId if present, else first session
		const sessionIds = Object.keys(sessions);
		setSelectedExistingId(
			selectedSessionId && sessions[selectedSessionId]
				? selectedSessionId
				: sessionIds[0] || "",
		);
		setSelectedWorkspacePath(
			workspaces[0]?.path || currentSession?.cwd || "",
		);
	};

	const handleExecuteDispatch = async () => {
		if (!dispatchingItem) return;
		setDispatching(true);
		setError(null);
		try {
			const prompt = await backlogBuildPrompt(dispatchingItem.id);
			let targetId = selectedExistingId;

			if (dispatchTargetType === "new") {
				const info = await rpcStart({
					cwd: selectedWorkspacePath || process.cwd?.() || ".",
					model: newSessionModel.trim() || undefined,
				});
				targetId = info.sessionId;
				// Send the prompt to the newly started session
				await rpcSend(targetId, { type: "prompt", text: prompt });
			} else {
				if (!targetId) throw new Error("请选择目标会话");
				await dispatchPrompt(targetId, prompt);
			}

			await backlogUpdate(dispatchingItem.id, {
				status: "dispatched",
				targetSessionId: targetId,
			});

			setDispatchingItem(null);
			await loadItems();
			selectSession(targetId);
		} catch (err) {
			setError(String(err));
		} finally {
			setDispatching(false);
		}
	};

	const filteredItems = items.filter((it) => it.status === activeTab);

	return (
		<div className="flex h-full flex-col overflow-y-auto bg-neutral-950 p-6 text-neutral-200">
			{/* Page Header */}
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-4">
				<div>
					<div className="flex items-center gap-2">
						<Inbox className="h-5 w-5 text-amber-400" />
						<h1 className="text-lg font-semibold text-neutral-100">收集箱</h1>
					</div>
					<p className="mt-1 text-xs text-neutral-500">
						额度用完/报错中断时先存进来；模型太贵时先攒着；会话正忙不想打断时先记下
					</p>
				</div>
				<button
					type="button"
					onClick={() => void loadItems()}
					title="刷新"
					className="rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
				>
					<RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
				</button>
			</div>

			{error && (
				<div className="mb-4 rounded-lg border border-rose-800/50 bg-rose-950/20 p-3 text-xs text-rose-300">
					{error}
				</div>
			)}

			{/* Capture Box */}
			<form
				onSubmit={handleAdd}
				className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-sm"
			>
				<div className="mb-3 flex items-center justify-between">
					<div className="text-xs font-semibold text-neutral-300">新建收集项</div>
					{/* Kind Chips */}
					<div className="flex items-center gap-1.5">
						{(["todo", "bug", "idea"] as BacklogKind[]).map((k) => {
							const meta = KIND_META[k];
							const Icon = meta.icon;
							const isSelected = inputKind === k;
							return (
								<button
									key={k}
									type="button"
									onClick={() => setInputKind(k)}
									className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
										isSelected
											? meta.color
											: "border-neutral-800 bg-neutral-800/40 text-neutral-400 hover:bg-neutral-800"
									}`}
								>
									<Icon className="h-3 w-3" />
									<span>{meta.label}</span>
								</button>
							);
						})}
					</div>
				</div>

				<textarea
					value={inputText}
					onChange={(e) => setInputText(e.target.value)}
					placeholder="记下要处理的事情，随时派给 Agent..."
					rows={2}
					className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950/80 p-2.5 text-xs text-neutral-100 placeholder-neutral-500 focus:border-neutral-600 focus:outline-none"
				/>

				<div className="mt-3 flex items-center justify-between text-xs">
					{selectedSessionId && (
						<label className="flex cursor-pointer items-center gap-1.5 text-neutral-400 hover:text-neutral-300">
							<input
								type="checkbox"
								checked={attachCurrentSession}
								onChange={(e) => setAttachCurrentSession(e.target.checked)}
								className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
							/>
							<span>关联当前会话: {currentSession?.title || selectedSessionId}</span>
						</label>
					)}
					{!selectedSessionId && <div />}

					<button
						type="submit"
						disabled={submitting || !inputText.trim()}
						className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
					>
						<Plus className="h-3.5 w-3.5" />
						<span>加入收集箱</span>
					</button>
				</div>
			</form>

			{/* Status Tabs */}
			<div className="mb-4 flex items-center gap-1 border-b border-neutral-800/80 pb-2">
				{(["inbox", "dispatched", "done", "closed"] as BacklogStatus[]).map(
					(st) => {
						const count = items.filter((it) => it.status === st).length;
						const isActive = activeTab === st;
						return (
							<button
								key={st}
								type="button"
								onClick={() => setActiveTab(st)}
								className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
									isActive
										? "bg-neutral-800 text-neutral-100"
										: "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200"
								}`}
							>
								<span>{STATUS_LABELS[st]}</span>
								<span
									className={`rounded-full px-1.5 py-0.2 text-[10px] ${
										isActive
											? "bg-neutral-700 text-neutral-200"
											: "bg-neutral-800/80 text-neutral-500"
									}`}
								>
									{count}
								</span>
							</button>
						);
					},
				)}
			</div>

			{/* List Items */}
			<div className="flex-1 space-y-2.5">
				{filteredItems.length === 0 ? (
					<div className="py-12 text-center text-xs text-neutral-500">
						{activeTab === "inbox"
							? "收集箱暂无待办，输入上方内容开始收集"
							: `暂无${STATUS_LABELS[activeTab]}事项`}
					</div>
				) : (
					filteredItems.map((item) => {
						const meta = KIND_META[item.kind];
						const Icon = meta.icon;
						const targetSession = item.targetSessionId
							? sessions[item.targetSessionId]
							: undefined;

						return (
							<div
								key={item.id}
								className="group rounded-xl border border-neutral-800 bg-neutral-900/40 p-3.5 transition-all hover:border-neutral-700"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="flex flex-1 flex-col gap-1.5">
										<div className="flex flex-wrap items-center gap-2">
											<span
												className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.color}`}
											>
												<Icon className="h-3 w-3" />
												<span>{meta.label}</span>
											</span>

											<span className="text-[11px] text-neutral-500">
												{new Date(item.createdAt).toLocaleString([], {
													month: "short",
													day: "numeric",
													hour: "2-digit",
													minute: "2-digit",
												})}
											</span>

											{item.status === "dispatched" && (
												<span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
													已派发
												</span>
											)}
										</div>

										<div className="text-sm font-medium text-neutral-200 whitespace-pre-wrap">
											{item.text}
										</div>

										{/* References */}
										{item.refs.length > 0 && (
											<div className="flex flex-wrap gap-1.5 pt-1">
												{item.refs.map((ref, idx) => {
													if (ref.kind === "session" && ref.sessionId) {
														const s = sessions[ref.sessionId];
														return (
															<button
																key={idx}
																type="button"
																onClick={() => ref.sessionId && selectSession(ref.sessionId)}
																className="inline-flex items-center gap-1 rounded bg-neutral-800/80 px-2 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-200"
															>
																<MessageSquare className="h-3 w-3" />
																<span>
																	{s?.title || ref.sessionId}
																</span>
															</button>
														);
													}
													if (ref.kind === "file" && ref.path) {
														return (
															<span
																key={idx}
																className="inline-flex items-center gap-1 rounded bg-neutral-800/80 px-2 py-0.5 text-[11px] text-neutral-400"
															>
																<FileText className="h-3 w-3" />
																<span>{ref.path}</span>
															</span>
														);
													}
													if (ref.kind === "annotation" && ref.text) {
														return (
															<span
																key={idx}
																className="inline-flex items-center gap-1 rounded bg-neutral-800/80 px-2 py-0.5 text-[11px] text-neutral-400"
															>
																<Quote className="h-3 w-3" />
																<span className="line-clamp-1">{ref.text}</span>
															</span>
														);
													}
													return null;
												})}
											</div>
										)}

										{/* Dispatched target session link */}
										{item.targetSessionId && (
											<div className="flex items-center gap-2 pt-1 text-xs text-neutral-400">
												<span>目标会话:</span>
												<button
													type="button"
													onClick={() =>
														item.targetSessionId &&
														selectSession(item.targetSessionId)
													}
													className="inline-flex items-center gap-1 font-medium text-amber-400 hover:underline"
												>
													<Bot className="h-3.5 w-3.5" />
													<span>
														{targetSession?.title ||
															item.targetSessionId}
													</span>
													<ArrowRight className="h-3 w-3" />
												</button>
											</div>
										)}
									</div>

									{/* Action Buttons */}
									<div className="flex items-center gap-1.5">
										{item.status === "inbox" && (
											<>
												<button
													type="button"
													onClick={() => handleOpenDispatch(item)}
													className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30"
												>
													<Send className="h-3.5 w-3.5" />
													<span>派给 Agent</span>
												</button>
												<button
													type="button"
													onClick={() => handleUpdateStatus(item.id, "done")}
													title="标记完成"
													className="rounded-lg border border-neutral-800 p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-emerald-300"
												>
													<Check className="h-3.5 w-3.5" />
												</button>
												<button
													type="button"
													onClick={() => handleUpdateStatus(item.id, "closed")}
													title="关闭"
													className="rounded-lg border border-neutral-800 p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
												>
													<X className="h-3.5 w-3.5" />
												</button>
											</>
										)}

										{item.status === "dispatched" && (
											<>
												<button
													type="button"
													onClick={() => handleOpenDispatch(item)}
													className="inline-flex items-center gap-1 rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
												>
													<RefreshCw className="h-3 w-3" />
													<span>重新派发</span>
												</button>
												<button
													type="button"
													onClick={() => handleUpdateStatus(item.id, "done")}
													title="标记完成"
													className="rounded-lg border border-neutral-800 p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-emerald-300"
												>
													<Check className="h-3.5 w-3.5" />
												</button>
											</>
										)}

										{(item.status === "done" || item.status === "closed") && (
											<button
												type="button"
												onClick={() => handleUpdateStatus(item.id, "inbox")}
												className="rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
											>
												放回收集箱
											</button>
										)}

										<button
											type="button"
											onClick={() => handleDelete(item.id)}
											title="删除"
											className="rounded-lg p-1.5 text-neutral-500 opacity-0 group-hover:opacity-100 hover:bg-rose-950/40 hover:text-rose-400"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									</div>
								</div>
							</div>
						);
					})
				)}
			</div>

			{/* Dispatch Modal */}
			{dispatchingItem && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
					<div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
						<div className="mb-4 flex items-center justify-between border-b border-neutral-800 pb-3">
							<div className="flex items-center gap-2">
								<Send className="h-5 w-5 text-amber-400" />
								<h2 className="text-base font-semibold text-neutral-100">
									派发给 Agent
								</h2>
							</div>
							<button
								type="button"
								onClick={() => setDispatchingItem(null)}
								className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						{/* Item Summary Preview */}
						<div className="mb-4 rounded-lg bg-neutral-950 p-3 text-xs text-neutral-300">
							<span className="font-semibold text-neutral-400">派发内容: </span>
							{dispatchingItem.text}
						</div>

						{/* Target Type Selector */}
						<div className="mb-4 flex rounded-lg border border-neutral-800 bg-neutral-950/60 p-1 text-xs font-medium">
							<button
								type="button"
								onClick={() => setDispatchTargetType("existing")}
								className={`flex-1 rounded-md py-1.5 transition-colors ${
									dispatchTargetType === "existing"
										? "bg-neutral-800 text-neutral-100"
										: "text-neutral-400 hover:text-neutral-200"
								}`}
							>
								现有会话
							</button>
							<button
								type="button"
								onClick={() => setDispatchTargetType("new")}
								className={`flex-1 rounded-md py-1.5 transition-colors ${
									dispatchTargetType === "new"
										? "bg-neutral-800 text-neutral-100"
										: "text-neutral-400 hover:text-neutral-200"
								}`}
							>
								新建会话
							</button>
						</div>

						{/* Target configuration */}
						{dispatchTargetType === "existing" ? (
							<div className="space-y-3">
								<div>
									<label className="mb-1 block text-xs font-medium text-neutral-400">
										选择目标会话
									</label>
									<select
										value={selectedExistingId}
										onChange={(e) => setSelectedExistingId(e.target.value)}
										className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-100 focus:border-amber-500 focus:outline-none"
									>
										{Object.values(sessions).map((s) => (
											<option key={s.id} value={s.id}>
												{s.title || s.id} ({s.status})
											</option>
										))}
									</select>
								</div>
							</div>
						) : (
							<div className="space-y-3">
								<div>
									<label className="mb-1 block text-xs font-medium text-neutral-400">
										选择工作区目录
									</label>
									<select
										value={selectedWorkspacePath}
										onChange={(e) => setSelectedWorkspacePath(e.target.value)}
										className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-100 focus:border-amber-500 focus:outline-none"
									>
										{workspaces.map((w) => (
											<option key={w.id} value={w.path}>
												{w.name} ({w.path})
											</option>
										))}
									</select>
								</div>
								<div>
									<label className="mb-1 block text-xs font-medium text-neutral-400">
										模型名称 (可选)
									</label>
									<input
										type="text"
										value={newSessionModel}
										onChange={(e) => setNewSessionModel(e.target.value)}
										placeholder="例如: default, smol, slow"
										className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
									/>
								</div>
							</div>
						)}

						<div className="mt-6 flex items-center justify-end gap-2 border-t border-neutral-800 pt-4">
							<button
								type="button"
								onClick={() => setDispatchingItem(null)}
								className="rounded-lg px-4 py-2 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
							>
								取消
							</button>
							<button
								type="button"
								disabled={
									dispatching ||
									(dispatchTargetType === "existing" && !selectedExistingId)
								}
								onClick={handleExecuteDispatch}
								className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
							>
								<Send className="h-3.5 w-3.5" />
								<span>{dispatching ? "正在派发..." : "确认派发"}</span>
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
