import {
	ArrowRight,
	Bot,
	Bug,
	Check,
	CornerDownLeft,
	FileText,
	Lightbulb,
	ListTodo,
	Loader2,
	MessageSquare,
	Pencil,
	Plus,
	Quote,
	RefreshCw,
	Send,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NativeSelect } from "../../components/NativeSelect";
import type {
	BacklogItem,
	BacklogKind,
	BacklogRef,
	BacklogStatus,
	Workspace,
} from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	backlogAdd,
	backlogBuildPrompt,
	backlogDelete,
	backlogUpdate,
	dispatchPrompt,
	listWorkspaces,
	rpcStart,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useBacklog } from "./backlogStore";

const KIND_META: Record<
	BacklogKind,
	{ label: string; icon: typeof Lightbulb; color: string }
> = {
	todo: {
		label: "待办",
		icon: ListTodo,
		color: "bg-sky-500/15 text-sky-300 border-sky-500/30",
	},
	bug: {
		label: "缺陷",
		icon: Bug,
		color: "bg-rose-500/15 text-rose-300 border-rose-500/30",
	},
	idea: {
		label: "想法",
		icon: Lightbulb,
		color: "bg-amber-500/15 text-amber-300 border-amber-500/30",
	},
};

const STATUS_LABELS: Record<BacklogStatus, string> = {
	inbox: "收集箱",
	dispatched: "已派发",
	done: "已完成",
	closed: "已关闭",
};

export function BacklogPanel() {
	const open = useBacklog((s) => s.open);
	const setOpen = useBacklog((s) => s.setOpen);
	const items = useBacklog((s) => s.items);
	const loading = useBacklog((s) => s.loading);
	const load = useBacklog((s) => s.load);

	/** Store-backed reload that surfaces failures in the panel. */
	const loadItems = async () => {
		try {
			await load();
		} catch (e) {
			setError(String(e));
		}
	};

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
	const [dispatchError, setDispatchError] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingText, setEditingText] = useState<string>("");
	const [savingEdit, setSavingEdit] = useState(false);

	useEscapeKey(() => {
		if (dispatchingItem) {
			setDispatchingItem(null);
		} else {
			setOpen(false);
		}
	}, open);

	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);

	const currentSession = selectedSessionId
		? sessions[selectedSessionId]
		: undefined;


	useEffect(() => {
		void loadItems();
		void listWorkspaces().then(setWorkspaces).catch(() => {});
	}, [open]);

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
			toast.success("已加入收集箱");
			setInputText("");
			await loadItems();
		} catch (err) {
			const msg = errMsg(err);
			setError(msg);
			toast.error(`添加失败: ${msg}`);
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
		const confirmed = await confirmDialog("确定要从收集箱删除该条目吗？", {
			danger: true,
			title: "删除收集项",
			okLabel: "删除",
		});
		if (!confirmed) return;
		try {
			await backlogDelete(id);
			toast.success("已删除收集项");
			await loadItems();
		} catch (err) {
			const msg = errMsg(err);
			setError(msg);
			toast.error(`删除失败: ${msg}`);
		}
	};

	const handleStartEdit = (item: BacklogItem) => {
		setEditingId(item.id);
		setEditingText(item.text);
	};

	const handleSaveEdit = async (id: string) => {
		const trimmed = editingText.trim();
		if (!trimmed) {
			toast.error("内容不能为空");
			return;
		}
		setSavingEdit(true);
		try {
			await backlogUpdate(id, { text: trimmed });
			toast.success("已更新条目内容");
			setEditingId(null);
			await loadItems();
		} catch (err) {
			const msg = errMsg(err);
			toast.error(`更新失败: ${msg}`);
		} finally {
			setSavingEdit(false);
		}
	};

	const handleFillCurrent = (item: BacklogItem) => {
		if (!selectedSessionId) {
			toast.error("没有选中的会话");
			return;
		}
		useComposer.getState().setDraft(selectedSessionId, item.text);
		useComposer.getState().focusComposer(selectedSessionId);
		selectSession(selectedSessionId); // 确保 centerView 切回 session
		setOpen(false);
		toast.success("已填入输入框");
	};

	const handleOpenDispatch = (item: BacklogItem) => {
		setDispatchingItem(item);
		setDispatchError(null);
		const sessionIds = Object.keys(sessions);
		if (sessionIds.length === 0) {
			setDispatchTargetType("new");
		} else {
			setDispatchTargetType("existing");
			setSelectedExistingId(
				selectedSessionId && sessions[selectedSessionId]
					? selectedSessionId
					: sessionIds[0] || "",
			);
		}
		setSelectedWorkspacePath(
			workspaces[0]?.path || currentSession?.cwd || "",
		);
	};

	const handleExecuteDispatch = async () => {
		if (!dispatchingItem) return;
		setDispatching(true);
		setDispatchError(null);
		try {
			const prompt = await backlogBuildPrompt(dispatchingItem.id);
			let targetId = selectedExistingId;

			if (dispatchTargetType === "new") {
				const info = await rpcStart({
					cwd: selectedWorkspacePath || process.cwd?.() || ".",
					model: newSessionModel.trim() || undefined,
				});
				targetId = info.sessionId;
			} else {
				if (!targetId) throw new Error("请选择目标会话");
			}
			await dispatchPrompt(targetId, prompt);

			await backlogUpdate(dispatchingItem.id, {
				status: "dispatched",
				targetSessionId: targetId,
			});

			toast.success("已成功派发给 Agent");
			setDispatchingItem(null);
			await loadItems();
			selectSession(targetId);
			setOpen(false);
		} catch (err) {
			const msg = errMsg(err);
			setDispatchError(msg);
			toast.error(`派发失败: ${msg}`);
		} finally {
			setDispatching(false);
		}
	};

	if (!open) return null;

	const filteredItems = items.filter((it) => it.status === activeTab);

	return (
		<div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)}>
			{/* Anchored popover panel — transparent capture layer closes it, no dimming. */}
			<div
				className="absolute right-2 top-11 flex w-[480px] max-w-[calc(100vw-2rem)] max-h-[70vh] flex-col rounded-xl border border-neutral-700/80 bg-neutral-900 shadow-2xl"
				onMouseDown={(e) => e.stopPropagation()}
			>
				{/* Top Row: Capture Input */}
				<form
					onSubmit={handleAdd}
					className="flex shrink-0 items-center gap-2 border-b border-neutral-800/80 bg-neutral-900/90 px-4 py-2"
				>
					<div className="flex shrink-0 items-center gap-1">
						{(["todo", "bug", "idea"] as BacklogKind[]).map((k) => {
							const meta = KIND_META[k];
							const Icon = meta.icon;
							const isSelected = inputKind === k;
							return (
								<button
									key={k}
									type="button"
									onClick={() => setInputKind(k)}
									className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
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

					<input
						type="text"
						value={inputText}
						onChange={(e) => setInputText(e.target.value)}
						placeholder="记下要处理的事情... (Enter 提交)"
						className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-100 placeholder-neutral-500 focus:border-neutral-600 focus:outline-none"
					/>

					{selectedSessionId && (
						<label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-300">
							<input
								type="checkbox"
								checked={attachCurrentSession}
								onChange={(e) => setAttachCurrentSession(e.target.checked)}
								className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
							/>
							<span
								className="max-w-[130px] truncate"
								title={`关联当前会话: ${currentSession?.title || selectedSessionId}`}
							>
								关联当前会话
							</span>
						</label>
					)}

					<button
						type="submit"
						disabled={submitting || !inputText.trim()}
						className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
					>
						{submitting ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<Plus className="h-3 w-3" />
						)}
						<span>添加</span>
					</button>

					<button
						type="button"
						onClick={() => void loadItems()}
						title="刷新"
						className="shrink-0 rounded-md border border-neutral-800 p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					>
						<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
					</button>
				</form>

				{/* Status Tabs */}
				<div className="flex shrink-0 items-center justify-between border-b border-neutral-800/80 bg-neutral-900/50 px-4 py-1.5">
					<div className="flex items-center gap-1">
						{(["inbox", "dispatched", "done", "closed"] as BacklogStatus[]).map((st) => {
							const count = items.filter((it) => it.status === st).length;
							const isActive = activeTab === st;
							return (
								<button
									key={st}
									type="button"
									onClick={() => setActiveTab(st)}
									className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
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
						})}
					</div>

					<button
						type="button"
						onClick={() => setOpen(false)}
						title="收起面板 (Esc)"
						className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{/* List Items */}
				<div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-1.5">
					{error && (
						<div className="rounded-md border border-rose-800/50 bg-rose-950/20 p-2 text-xs text-rose-300">
							{error}
						</div>
					)}

					{filteredItems.length === 0 ? (
						<div className="py-8 text-center text-xs text-neutral-500">
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
									className="group flex items-center justify-between gap-3 rounded-lg border border-neutral-800/80 bg-neutral-950/40 px-3 py-1.5 transition-all hover:border-neutral-700 hover:bg-neutral-900/60"
								>
									{editingId === item.id ? (
										<div className="flex-1 space-y-2 py-1">
											<textarea
												autoFocus
												value={editingText}
												onChange={(e) => setEditingText(e.target.value)}
												rows={2}
												className="w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-100 focus:border-amber-500 focus:outline-none"
												onKeyDown={(e) => {
													if (isComposing(e)) return;
													if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
														e.preventDefault();
														void handleSaveEdit(item.id);
													}
													if (e.key === "Escape") {
														e.preventDefault();
														setEditingId(null);
													}
												}}
											/>
											<div className="flex items-center gap-2">
												<button
													type="button"
													disabled={savingEdit || !editingText.trim()}
													onClick={() => void handleSaveEdit(item.id)}
													className="inline-flex items-center gap-1 rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
												>
													{savingEdit ? (
														<Loader2 className="h-3 w-3 animate-spin" />
													) : (
														<Check className="h-3 w-3" />
													)}
													<span>保存 (⌘Enter)</span>
												</button>
												<button
													type="button"
													onClick={() => setEditingId(null)}
													className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800"
												>
													取消 (Esc)
												</button>
											</div>
										</div>
									) : (
										<>
											{/* Left: kind + text + refs + targetSession + time */}
											<div className="flex min-w-0 flex-1 items-center gap-2">
												<span
													className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.color}`}
													title={meta.label}
												>
													<Icon className="h-2.5 w-2.5" />
													<span>{meta.label}</span>
												</span>

												<span
													onDoubleClick={() => handleStartEdit(item)}
													title={`${item.text}\n(双击就地编辑)`}
													className="min-w-0 flex-1 truncate cursor-pointer text-xs font-medium text-neutral-200 hover:text-neutral-100"
												>
													{item.text}
												</span>

												{/* References */}
												{item.refs.length > 0 && (
													<div className="flex shrink-0 items-center gap-1">
														{item.refs.map((ref, idx) => {
															if (ref.kind === "session" && ref.sessionId) {
																const s = sessions[ref.sessionId];
																return (
																	<button
																		key={idx}
																		type="button"
																		onClick={() =>
																			ref.sessionId && selectSession(ref.sessionId)
																		}
																		title={`会话: ${s?.title || ref.sessionId}`}
																		className="inline-flex items-center gap-0.5 rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:text-neutral-200"
																	>
																		<MessageSquare className="h-2.5 w-2.5" />
																		<span className="max-w-[70px] truncate">
																			{s?.title || ref.sessionId}
																		</span>
																	</button>
																);
															}
															if (ref.kind === "file" && ref.path) {
																return (
																	<span
																		key={idx}
																		title={ref.path}
																		className="inline-flex items-center gap-0.5 rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] text-neutral-400"
																	>
																		<FileText className="h-2.5 w-2.5" />
																		<span className="max-w-[60px] truncate">
																			{ref.path}
																		</span>
																	</span>
																);
															}
															if (ref.kind === "annotation" && ref.text) {
																return (
																	<span
																		key={idx}
																		title={ref.text}
																		className="inline-flex items-center gap-0.5 rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] text-neutral-400"
																	>
																		<Quote className="h-2.5 w-2.5" />
																		<span className="max-w-[60px] truncate">
																			{ref.text}
																		</span>
																	</span>
																);
															}
															return null;
														})}
													</div>
												)}

												{/* Target session link */}
												{item.targetSessionId && (
													<button
														type="button"
														onClick={() =>
															item.targetSessionId && selectSession(item.targetSessionId)
														}
														title={`目标会话: ${targetSession?.title || item.targetSessionId}`}
														className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-400 hover:underline"
													>
														<Bot className="h-2.5 w-2.5" />
														<span className="max-w-[80px] truncate">
															{targetSession?.title || item.targetSessionId}
														</span>
														<ArrowRight className="h-2.5 w-2.5" />
													</button>
												)}

												<span className="shrink-0 text-[10px] text-neutral-500">
													{new Date(item.createdAt).toLocaleString([], {
														month: "numeric",
														day: "numeric",
														hour: "2-digit",
														minute: "2-digit",
													})}
												</span>
											</div>

											{/* Right: action buttons */}
											<div className="flex shrink-0 items-center gap-1">
												{item.status === "inbox" && (
													<>
														<button
															type="button"
															disabled={!selectedSessionId}
															onClick={() => handleFillCurrent(item)}
															title={
																selectedSessionId
																	? "填入当前会话输入框"
																	: "先选中一个会话"
															}
															className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
														>
															<CornerDownLeft className="h-3 w-3" />
															<span>填入当前</span>
														</button>
														<button
															type="button"
															onClick={() => handleOpenDispatch(item)}
															title="派发给 Agent..."
															className="rounded-md border border-neutral-800 p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
														>
															<Send className="h-3 w-3" />
														</button>
														<button
															type="button"
															onClick={() => handleUpdateStatus(item.id, "done")}
															title="标记完成"
															className="rounded-md border border-neutral-800 p-1 text-neutral-400 hover:bg-neutral-800 hover:text-emerald-300"
														>
															<Check className="h-3 w-3" />
														</button>
														<button
															type="button"
															onClick={() => handleUpdateStatus(item.id, "closed")}
															title="关闭"
															className="rounded-md border border-neutral-800 p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
														>
															<X className="h-3 w-3" />
														</button>
													</>
												)}

												{item.status === "dispatched" && (
													<>
														<button
															type="button"
															onClick={() => handleOpenDispatch(item)}
															className="inline-flex items-center gap-1 rounded-md border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
														>
															<RefreshCw className="h-3 w-3" />
															<span>重新派发</span>
														</button>
														<button
															type="button"
															onClick={() => handleUpdateStatus(item.id, "done")}
															title="标记完成"
															className="rounded-md border border-neutral-800 p-1 text-neutral-400 hover:bg-neutral-800 hover:text-emerald-300"
														>
															<Check className="h-3 w-3" />
														</button>
													</>
												)}

												{(item.status === "done" || item.status === "closed") && (
													<button
														type="button"
														onClick={() => handleUpdateStatus(item.id, "inbox")}
														className="rounded-md border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
													>
														放回收集箱
													</button>
												)}

												<button
													type="button"
													onClick={() => handleStartEdit(item)}
													title="编辑内容"
													className="rounded-md p-1 text-neutral-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-neutral-800 hover:text-neutral-200"
												>
													<Pencil className="h-3 w-3" />
												</button>

												<button
													type="button"
													onClick={() => handleDelete(item.id)}
													title="删除"
													className="rounded-md p-1 text-neutral-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-rose-950/40 hover:text-rose-400"
												>
													<Trash2 className="h-3 w-3" />
												</button>
											</div>
										</>
									)}
								</div>
							);
						})
					)}
				</div>
			</div>

			{/* Dispatch Modal */}
			{dispatchingItem && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-xs p-4 pointer-events-auto"
					onMouseDown={(e) => {
						e.stopPropagation();
						if (e.target === e.currentTarget) setDispatchingItem(null);
					}}
				>
					<div
						className="w-full max-w-lg rounded-2xl bg-[var(--bg-panel)] p-6 shadow-apple-modal hairline"
						onMouseDown={(e) => e.stopPropagation()}
					>
						<div className="mb-4 flex items-center justify-between border-b border-[var(--border-divider)] pb-3">
							<div className="flex items-center gap-2">
								<Send className="h-5 w-5 text-amber-400" />
								<h2 className="text-base font-semibold text-neutral-100">
									派发给 Agent
								</h2>
							</div>
							<button
								type="button"
								onClick={() => setDispatchingItem(null)}
								className="rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						{dispatchError && (
							<div className="mb-4 rounded-lg border border-rose-800/50 bg-rose-950/20 p-2.5 text-xs text-rose-300">
								{dispatchError}
							</div>
						)}

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
								{Object.keys(sessions).length === 0 ? (
									<div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-xs text-neutral-400">
										<span>暂无可用的现有会话。</span>
										<button
											type="button"
											onClick={() => setDispatchTargetType("new")}
											className="ml-2 font-medium text-amber-400 hover:underline"
										>
											切换至「新建会话」
										</button>
									</div>
								) : (
									<div>
										<label className="mb-1 block text-xs font-medium text-neutral-400">
											选择目标会话
										</label>
										<NativeSelect
											value={selectedExistingId}
											onChange={(e) => setSelectedExistingId(e.target.value)}
										>
											{Object.values(sessions).map((s) => (
												<option key={s.id} value={s.id}>
													{s.title || s.id} ({s.status})
												</option>
											))}
										</NativeSelect>
									</div>
								)}
							</div>
						) : (
							<div className="space-y-3">
								<div>
									<label className="mb-1 block text-xs font-medium text-neutral-400">
										选择工作区目录
									</label>
									<NativeSelect
										value={selectedWorkspacePath}
										onChange={(e) => setSelectedWorkspacePath(e.target.value)}
									>
										{workspaces.map((w) => (
											<option key={w.id} value={w.path}>
												{w.name} ({w.path})
											</option>
										))}
									</NativeSelect>
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
								{dispatching ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Send className="h-3.5 w-3.5" />
								)}
								<span>{dispatching ? "正在派发..." : "确认派发"}</span>
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
