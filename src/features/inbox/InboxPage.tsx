import {
	ArrowRight,
	Bug,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	CornerDownLeft,
	Edit3,
	Lightbulb,
	ListTodo,
	Loader2,
	Plus,
	RefreshCw,
	RotateCcw,
	Send,
	Settings as SettingsIcon,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { NativeSelect } from "../../components/NativeSelect";
import type {
	BacklogItem,
	BacklogKind,
	BacklogRef,
	Todo,
	Workspace,
} from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import {
	backlogAdd,
	backlogBuildPrompt,
	backlogDelete,
	backlogUpdate,
	dispatchPrompt,
	listWorkspaces,
	rpcStart,
	supervisorRefresh,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useBacklog } from "../backlog/backlogStore";
import { useSettings } from "../settings/store";
import { TodoRow } from "../todos/TodoRow";
import { splitTodos } from "../todos/logic";
import { startTodos, useTodos } from "../todos/store";

const BACKLOG_KIND_META: Record<
	BacklogKind,
	{ label: string; icon: typeof Lightbulb; badgeCls: string }
> = {
	todo: {
		label: "待办",
		icon: ListTodo,
		badgeCls: "bg-sky-500/15 text-sky-300 border border-sky-500/30",
	},
	bug: {
		label: "缺陷",
		icon: Bug,
		badgeCls: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
	},
	idea: {
		label: "想法",
		icon: Lightbulb,
		badgeCls: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
	},
};

type InboxTab = "todos" | "backlog";

export function InboxPage() {
	const [activeTab, setActiveTab] = useState<InboxTab>("todos");

	// Todos Store
	const todos = useTodos((s) => s.todos);
	const counts = useTodos((s) => s.counts);
	const refreshTodos = useTodos((s) => s.refresh);
	const actTodo = useTodos((s) => s.act);
	const lastIgnored = useTodos((s) => s.lastIgnored);
	const undoIgnore = useTodos((s) => s.undoIgnore);

	// Backlog Store
	const backlogItems = useBacklog((s) => s.items);
	const loadBacklog = useBacklog((s) => s.load);

	// Settings & UI
	const settings = useSettings((s) => s.settings);
	const openSettings = useUi((s) => s.openSettings);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);
	const liveSessions = useLive((s) => s.sessions);

	// Toggles
	const [showCompletedTodos, setShowCompletedTodos] = useState(false);
	const [showCompletedBacklog, setShowCompletedBacklog] = useState(false);
	const [refreshingSupervisor, setRefreshingSupervisor] = useState(false);

	// Keyboard focus in todo queue
	const [focusedTodoIndex, setFocusedTodoIndex] = useState(0);

	// Backlog Capture form state
	const [captureText, setCaptureText] = useState("");
	const [captureKind, setCaptureKind] = useState<BacklogKind>("todo");
	const [attachSession, setAttachSession] = useState(true);
	const [captureSubmitting, setCaptureSubmitting] = useState(false);

	// Backlog Dispatch Modal state
	const [dispatchingItem, setDispatchingItem] = useState<BacklogItem | null>(null);
	const [dispatchTargetType, setDispatchTargetType] = useState<"existing" | "new">("existing");
	const [selectedExistingId, setSelectedExistingId] = useState("");
	const [selectedWorkspacePath, setSelectedWorkspacePath] = useState("");
	const [newSessionModel, setNewSessionModel] = useState("");
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [dispatching, setDispatching] = useState(false);
	const [dispatchError, setDispatchError] = useState<string | null>(null);

	// Backlog Inline Edit state
	const [editingBacklogId, setEditingBacklogId] = useState<string | null>(null);
	const [editingBacklogText, setEditingBacklogText] = useState("");
	const [savingEdit, setSavingEdit] = useState(false);

	// Follow user preference for showing completed todos by default
	useEffect(() => {
		if (settings?.homeShowCompletedTodos !== undefined) {
			setShowCompletedTodos(settings.homeShowCompletedTodos);
		}
	}, [settings?.homeShowCompletedTodos]);

	// Initialize data
	useEffect(() => {
		void startTodos();
		void loadBacklog();
		void listWorkspaces().then(setWorkspaces).catch(() => {});
	}, [loadBacklog]);

	const { open: openTodos, closed: closedTodos } = useMemo(() => {
		return splitTodos(todos);
	}, [todos]);

	// Group open todos by urgency
	const groupedOpenTodos = useMemo(() => {
		const groups: {
			key: string;
			title: string;
			items: Todo[];
			badgeColor: string;
		}[] = [
			{
				key: "dialogs",
				title: "待审批与提问",
				items: openTodos.filter(
					(t) => t.kind === "approval" || t.kind === "question",
				),
				badgeColor: "bg-amber-500/20 text-amber-300",
			},
			{
				key: "errors",
				title: "报错与中断",
				items: openTodos.filter(
					(t) => t.kind === "error" || t.kind === "interrupted",
				),
				badgeColor: "bg-rose-500/20 text-rose-300",
			},
			{
				key: "review",
				title: "待验收会话",
				items: openTodos.filter((t) => t.kind === "review"),
				badgeColor: "bg-orange-500/20 text-orange-300",
			},
			{
				key: "schedules",
				title: "定时任务运行",
				items: openTodos.filter((t) => t.kind === "schedule_run"),
				badgeColor: "bg-blue-500/20 text-blue-300",
			},
			{
				key: "suggestions",
				title: "监工建议与提醒",
				items: openTodos.filter(
					(t) => t.kind === "suggestion" || t.kind === "service_left",
				),
				badgeColor: "bg-violet-500/20 text-violet-300",
			},
		];
		return groups.filter((g) => g.items.length > 0);
	}, [openTodos]);

	// Flat list of open todos for indexing / keyboard triage
	const flattenedTodos = useMemo(() => {
		return groupedOpenTodos.flatMap((g) => g.items);
	}, [groupedOpenTodos]);

	// Group backlog items by status
	const {
		inboxBacklog,
		dispatchedBacklog,
		closedBacklog,
	} = useMemo(() => {
		const inbox: BacklogItem[] = [];
		const dispatched: BacklogItem[] = [];
		const closed: BacklogItem[] = [];
		for (const it of backlogItems) {
			if (it.status === "inbox") inbox.push(it);
			else if (it.status === "dispatched") dispatched.push(it);
			else closed.push(it);
		}
		return {
			inboxBacklog: inbox,
			dispatchedBacklog: dispatched,
			closedBacklog: closed,
		};
	}, [backlogItems]);

	// Keyboard triage for open todos
	useEffect(() => {
		if (activeTab !== "todos") return;
		const onKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
			if (tag === "input" || tag === "textarea") return;
			if (flattenedTodos.length === 0) return;

			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				setFocusedTodoIndex((i) => Math.min(flattenedTodos.length - 1, i + 1));
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				setFocusedTodoIndex((i) => Math.max(0, i - 1));
			} else if (e.key === "e") {
				const target = flattenedTodos[focusedTodoIndex];
				if (target) {
					e.preventDefault();
					void actTodo(target.id, "ignore");
				}
			} else if (e.key === "Enter") {
				const target = flattenedTodos[focusedTodoIndex];
				if (target?.sessionId) {
					e.preventDefault();
					selectSession(target.sessionId);
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [activeTab, flattenedTodos, focusedTodoIndex, actTodo, selectSession]);

	// Supervisor manual refresh
	const handleRefreshSupervisor = async () => {
		setRefreshingSupervisor(true);
		try {
			await supervisorRefresh();
			toast.success("已请求监工刷新分析");
			await refreshTodos();
		} catch (e) {
			toast.error(`刷新失败: ${errMsg(e)}`);
		} finally {
			setRefreshingSupervisor(false);
		}
	};

	// Backlog capture submit
	const handleAddBacklog = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = captureText.trim();
		if (!trimmed) return;
		setCaptureSubmitting(true);
		try {
			const refs: BacklogRef[] = [];
			if (attachSession && selectedSessionId) {
				refs.push({
					kind: "session",
					sessionId: selectedSessionId,
					path: null,
					text: null,
					lines: null,
				});
			}
			await backlogAdd(trimmed, captureKind, refs);
			toast.success("已加入想法收集");
			setCaptureText("");
			await loadBacklog();
		} catch (err) {
			toast.error(`添加失败: ${errMsg(err)}`);
		} finally {
			setCaptureSubmitting(false);
		}
	};

	// Backlog "填入当前会话"
	const handleFillCurrent = async (item: BacklogItem) => {
		if (!selectedSessionId) {
			toast.error("当前未选择会话");
			return;
		}
		try {
			useComposer.getState().setDraft(selectedSessionId, item.text);
			useComposer.getState().focusComposer(selectedSessionId);
			selectSession(selectedSessionId);

			// Mark item dispatched with targetSessionId
			await backlogUpdate(item.id, {
				status: "dispatched",
				targetSessionId: selectedSessionId,
			});
			await loadBacklog();
			toast.success("已填入当前会话输入框并标记为已派发");
		} catch (err) {
			toast.error(`操作失败: ${errMsg(err)}`);
		}
	};

	// Open dispatch modal
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
			workspaces[0]?.path ||
				(selectedSessionId ? sessions[selectedSessionId]?.cwd : "") ||
				"",
		);
	};

	// Execute dispatch
	const handleExecuteDispatch = async () => {
		if (!dispatchingItem) return;
		setDispatching(true);
		setDispatchError(null);
		try {
			const prompt = await backlogBuildPrompt(dispatchingItem.id);
			let targetId = selectedExistingId;

			if (dispatchTargetType === "new") {
				const info = await rpcStart({
					cwd: selectedWorkspacePath || ".",
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
			await loadBacklog();
			selectSession(targetId);
		} catch (err) {
			const msg = errMsg(err);
			setDispatchError(msg);
			toast.error(`派发失败: ${msg}`);
		} finally {
			setDispatching(false);
		}
	};

	// Save inline edit
	const handleSaveEdit = async (id: string) => {
		const trimmed = editingBacklogText.trim();
		if (!trimmed) {
			toast.error("内容不能为空");
			return;
		}
		setSavingEdit(true);
		try {
			await backlogUpdate(id, { text: trimmed });
			toast.success("已更新条目内容");
			setEditingBacklogId(null);
			await loadBacklog();
		} catch (err) {
			toast.error(`更新失败: ${errMsg(err)}`);
		} finally {
			setSavingEdit(false);
		}
	};

	// Delete backlog item
	const handleDeleteBacklog = async (id: string) => {
		const confirmed = await confirmDialog("确定要删除该收集项吗？", {
			danger: true,
			title: "删除收集项",
			okLabel: "删除",
		});
		if (!confirmed) return;
		try {
			await backlogDelete(id);
			toast.success("已删除收集项");
			await loadBacklog();
		} catch (err) {
			toast.error(`删除失败: ${errMsg(err)}`);
		}
	};

	// Current session title
	const activeSessionTitle = selectedSessionId
		? sessions[selectedSessionId]?.title || selectedSessionId
		: null;

	return (
		<div className="flex h-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
			{/* Top Bar Header */}
			<div className="flex shrink-0 items-center justify-between border-b border-[var(--border-divider)] px-6 py-3.5">
				{/* Segmented Tab Switcher */}
				<div className="flex items-center gap-2">
					<div className="flex rounded-lg bg-[var(--bg-panel)] p-1 text-xs font-medium shadow-sm">
						<button
							type="button"
							onClick={() => setActiveTab("todos")}
							className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 transition-all ${
								activeTab === "todos"
									? "bg-[var(--bg-active-fill)] text-[var(--text)] shadow-sm font-semibold"
									: "text-[var(--text-dim)] hover:text-[var(--text)]"
							}`}
						>
							<ListTodo className="h-4 w-4 text-amber-400" />
							<span>等我处理</span>
							{counts.open > 0 && (
								<span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-300">
									{counts.open}
								</span>
							)}
						</button>

						<button
							type="button"
							onClick={() => setActiveTab("backlog")}
							className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 transition-all ${
								activeTab === "backlog"
									? "bg-[var(--bg-active-fill)] text-[var(--text)] shadow-sm font-semibold"
									: "text-[var(--text-dim)] hover:text-[var(--text)]"
							}`}
						>
							<Lightbulb className="h-4 w-4 text-sky-400" />
							<span>想法收集</span>
							{inboxBacklog.length > 0 && (
								<span className="rounded-full bg-sky-500/20 px-1.5 py-0.2 text-[10px] font-bold text-sky-300">
									{inboxBacklog.length}
								</span>
							)}
						</button>
					</div>

					{activeTab === "todos" && (
						<span className="hidden text-[11px] text-[var(--text-dim)] sm:inline">
							键盘导航: j/k 切换 · e 忽略 · Enter 进入会话
						</span>
					)}
				</div>

				{/* Right Actions */}
				<div className="flex items-center gap-2">
					{settings?.supervisorEnabled && (
						<button
							type="button"
							disabled={refreshingSupervisor}
							onClick={handleRefreshSupervisor}
							className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-divider)] bg-[var(--bg-panel)] px-2.5 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50"
							title="触发监工对全局活跃会话进行新一轮智能分析"
						>
							<Sparkles
								className={`h-3.5 w-3.5 text-violet-400 ${
									refreshingSupervisor ? "animate-spin" : ""
								}`}
							/>
							<span>刷新监工</span>
						</button>
					)}

					<button
						type="button"
						onClick={async () => {
							await refreshTodos();
							await loadBacklog();
							toast.info("已刷新数据");
						}}
						className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-divider)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
						title="刷新列表"
					>
						<RefreshCw className="h-3.5 w-3.5" />
					</button>

					<button
						type="button"
						onClick={() => openSettings("inbox")}
						className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-divider)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
						title="收件箱设置"
					>
						<SettingsIcon className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{/* Main Scrollable Content */}
			<div className="flex-1 overflow-y-auto px-6 py-5">
				<div className="mx-auto max-w-4xl space-y-6">
					{/* Tab 1: 等我处理 (Inbound queue) */}
					{activeTab === "todos" && (
						<div className="space-y-6">
							{/* Undo Ignored Banner */}
							{lastIgnored && (
								<div className="flex items-center justify-between gap-3 rounded-xl border border-amber-600/40 bg-amber-950/20 px-3.5 py-2 text-xs text-amber-200 shadow-sm">
									<div className="flex items-center gap-2 min-w-0">
										<RotateCcw className="h-4 w-4 shrink-0 text-amber-400" />
										<span className="truncate">
											已忽略事项: <strong>{lastIgnored.title}</strong>
										</span>
									</div>
									<button
										type="button"
										onClick={() => void undoIgnore()}
										className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/30"
									>
										撤销忽略
									</button>
								</div>
							)}

							{/* Open Items by Urgency */}
							{groupedOpenTodos.length === 0 ? (
								<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-divider)] py-16 text-center">
									<div className="mb-3 rounded-full bg-emerald-500/10 p-3">
										<CheckCircle2 className="h-8 w-8 text-emerald-400" />
									</div>
									<h3 className="text-sm font-semibold text-[var(--text)]">
										所有待处理事项均已处理完毕
									</h3>
									<p className="mt-1 max-w-md text-xs text-[var(--text-dim)]">
										当 Agent
										需要审批、向你提问、跑完待验收或任务报错时，会自动呈现在这里。
									</p>
								</div>
							) : (
								<div className="space-y-6">
									{groupedOpenTodos.map((group) => (
										<div key={group.key} className="space-y-2">
											<div className="flex items-center justify-between px-1">
												<div className="flex items-center gap-2">
													<h4 className="text-xs font-semibold text-[var(--text)]">
														{group.title}
													</h4>
													<span
														className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${group.badgeColor}`}
													>
														{group.items.length}
													</span>
												</div>
											</div>

											<div className="space-y-2">
												{group.items.map((t) => {
													const flatIdx = flattenedTodos.findIndex(
														(item) => item.id === t.id,
													);
													return (
														<TodoRow
															key={t.id}
															todo={t}
															isMostUrgent={flatIdx === 0}
															isFocused={flatIdx === focusedTodoIndex}
														/>
													);
												})}
											</div>
										</div>
									))}
								</div>
							)}

							{/* Processed / Closed Items Accordion */}
							{closedTodos.length > 0 && (
								<div className="border-t border-[var(--border-divider)] pt-4">
									<button
										type="button"
										onClick={() => setShowCompletedTodos(!showCompletedTodos)}
										className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-dim)] hover:text-[var(--text)]"
									>
										{showCompletedTodos ? (
											<ChevronDown className="h-4 w-4" />
										) : (
											<ChevronRight className="h-4 w-4" />
										)}
										<span>已处理事项 ({closedTodos.length})</span>
									</button>

									{showCompletedTodos && (
										<div className="mt-3 space-y-2">
											{closedTodos.slice(0, 20).map((t) => (
												<TodoRow key={t.id} todo={t} compact />
											))}
											{closedTodos.length > 20 && (
												<div className="py-2 text-center text-xs text-[var(--text-dim)]">
													仅显示最近 20 项处理记录
												</div>
											)}
										</div>
									)}
								</div>
							)}
						</div>
					)}

					{/* Tab 2: 想法收集 (Outbound backlog) */}
					{activeTab === "backlog" && (
						<div className="space-y-6">
							{/* Capture Form Card */}
							<div className="rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-4 shadow-sm">
								<form onSubmit={handleAddBacklog} className="space-y-3">
									<div className="flex items-center gap-2">
										<input
											type="text"
											value={captureText}
											onChange={(e) => setCaptureText(e.target.value)}
											placeholder="随时记下想法、缺陷或待办，稍后一键派给 Agent..."
											className="flex-1 rounded-lg border border-[var(--border-divider)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-sky-500 focus:outline-none"
										/>
										<button
											type="submit"
											disabled={captureSubmitting || !captureText.trim()}
											className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
										>
											{captureSubmitting ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : (
												<Plus className="h-3.5 w-3.5" />
											)}
											<span>记录</span>
										</button>
									</div>

									{/* Kind selection chips & context attachments */}
									<div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
										<div className="flex items-center gap-1.5">
											{(["todo", "bug", "idea"] as BacklogKind[]).map((k) => {
												const meta = BACKLOG_KIND_META[k];
												const Icon = meta.icon;
												const isSelected = captureKind === k;
												return (
													<button
														key={k}
														type="button"
														onClick={() => setCaptureKind(k)}
														className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
															isSelected
																? meta.badgeCls
																: "text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
														}`}
													>
														<Icon className="h-3 w-3" />
														<span>{meta.label}</span>
													</button>
												);
											})}
										</div>

										{activeSessionTitle && (
											<label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)]">
												<input
													type="checkbox"
													checked={attachSession}
													onChange={(e) => setAttachSession(e.target.checked)}
													className="rounded border-[var(--border-divider)]"
												/>
												<span className="truncate max-w-[240px]">
													关联当前会话 ({activeSessionTitle})
												</span>
											</label>
										)}
									</div>
								</form>
							</div>

							{/* Backlog Items List */}
							<div className="space-y-6">
								{/* 1. 待派发 (inbox) */}
								<div className="space-y-2">
									<div className="flex items-center justify-between px-1">
										<div className="flex items-center gap-2">
											<h4 className="text-xs font-semibold text-[var(--text)]">
												待派发事项
											</h4>
											<span className="rounded-full bg-sky-500/20 px-1.5 py-0.2 text-[10px] font-bold text-sky-300">
												{inboxBacklog.length}
											</span>
										</div>
									</div>

									{inboxBacklog.length === 0 ? (
										<div className="rounded-xl border border-dashed border-[var(--border-divider)] p-6 text-center text-xs text-[var(--text-dim)]">
											收集箱暂无待派发条目，在上方输入框随手记一条吧！
										</div>
									) : (
										<div className="space-y-2">
											{inboxBacklog.map((item) => (
												<BacklogRow
													key={item.id}
													item={item}
													isEditing={editingBacklogId === item.id}
													editingText={editingBacklogText}
													savingEdit={savingEdit}
													onStartEdit={() => {
														setEditingBacklogId(item.id);
														setEditingBacklogText(item.text);
													}}
													onCancelEdit={() => setEditingBacklogId(null)}
													onChangeEditingText={setEditingBacklogText}
													onSaveEdit={() => handleSaveEdit(item.id)}
													onOpenDispatch={() => handleOpenDispatch(item)}
													onFillCurrent={() => handleFillCurrent(item)}
													onMarkDone={async () => {
														await backlogUpdate(item.id, { status: "done" });
														await loadBacklog();
													}}
													onCloseItem={async () => {
														await backlogUpdate(item.id, { status: "closed" });
														await loadBacklog();
													}}
													onDelete={() => handleDeleteBacklog(item.id)}
													hasSelectedSession={Boolean(selectedSessionId)}
												/>
											))}
										</div>
									)}
								</div>

								{/* 2. 已派发 (dispatched) */}
								{dispatchedBacklog.length > 0 && (
									<div className="space-y-2 pt-2">
										<div className="flex items-center justify-between px-1">
											<div className="flex items-center gap-2">
												<h4 className="text-xs font-semibold text-[var(--text)]">
													已派发追踪
												</h4>
												<span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-bold text-emerald-300">
													{dispatchedBacklog.length}
												</span>
											</div>
										</div>

										<div className="space-y-2">
											{dispatchedBacklog.map((item) => {
												const targetSession = item.targetSessionId
													? sessions[item.targetSessionId]
													: null;
												const isLive = item.targetSessionId
													? Boolean(liveSessions[item.targetSessionId])
													: false;

												return (
													<div
														key={item.id}
														className="rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-3 text-xs"
													>
														<div className="flex items-start justify-between gap-3">
															<div className="flex-1 space-y-1">
																<div className="flex items-center gap-2">
																	<span
																		className={`rounded px-1.5 py-0.2 text-[10px] font-medium ${
																			BACKLOG_KIND_META[item.kind]?.badgeCls
																		}`}
																	>
																		{BACKLOG_KIND_META[item.kind]?.label}
																	</span>
																	{item.targetSessionId && (
																		<button
																			type="button"
																			onClick={() =>
																				selectSession(item.targetSessionId!)
																			}
																			className="inline-flex items-center gap-1 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
																		>
																			<span
																				className={`h-1.5 w-1.5 rounded-full ${
																					isLive
																						? "bg-emerald-400 animate-pulse"
																						: "bg-neutral-500"
																				}`}
																			/>
																			<span className="truncate max-w-[200px]">
																				{targetSession?.title ||
																					item.targetSessionId}
																			</span>
																			<ArrowRight className="h-2.5 w-2.5" />
																		</button>
																	)}
																</div>
																<p className="text-[var(--text)] font-medium">
																	{item.text}
																</p>
															</div>

															<div className="flex shrink-0 items-center gap-1">
																<button
																	type="button"
																	onClick={async () => {
																		await backlogUpdate(item.id, {
																			status: "done",
																		});
																		await loadBacklog();
																	}}
																	className="rounded px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10"
																>
																	完成
																</button>
																<button
																	type="button"
																	onClick={async () => {
																		await backlogUpdate(item.id, {
																			status: "inbox",
																		});
																		await loadBacklog();
																	}}
																	className="rounded px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
																	title="放回待派发"
																>
																	放回
																</button>
															</div>
														</div>
													</div>
												);
											})}
										</div>
									</div>
								)}

								{/* 3. 已完成与关闭 (closed / done) */}
								{closedBacklog.length > 0 && (
									<div className="border-t border-[var(--border-divider)] pt-4">
										<button
											type="button"
											onClick={() =>
												setShowCompletedBacklog(!showCompletedBacklog)
											}
											className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-dim)] hover:text-[var(--text)]"
										>
											{showCompletedBacklog ? (
												<ChevronDown className="h-4 w-4" />
											) : (
												<ChevronRight className="h-4 w-4" />
											)}
											<span>已完成与关闭 ({closedBacklog.length})</span>
										</button>

										{showCompletedBacklog && (
											<div className="mt-3 space-y-2">
												{closedBacklog.map((item) => (
													<div
														key={item.id}
														className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-divider)] bg-[var(--bg-panel)] px-3 py-2 text-xs opacity-70"
													>
														<div className="flex items-center gap-2 truncate">
															<span
																className={`rounded px-1.5 py-0.2 text-[10px] ${
																	item.status === "done"
																		? "bg-emerald-500/15 text-emerald-300"
																		: "bg-neutral-500/15 text-neutral-400"
																}`}
															>
																{item.status === "done" ? "已完成" : "已关闭"}
															</span>
															<span className="truncate line-through text-[var(--text-dim)]">
																{item.text}
															</span>
														</div>

														<div className="flex items-center gap-1">
															<button
																type="button"
																onClick={async () => {
																	await backlogUpdate(item.id, {
																		status: "inbox",
																	});
																	await loadBacklog();
																}}
																className="rounded px-2 py-0.5 text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
															>
																放回
															</button>
															<button
																type="button"
																onClick={() => handleDeleteBacklog(item.id)}
																className="rounded p-1 text-[var(--text-dim)] hover:text-rose-400"
															>
																<Trash2 className="h-3 w-3" />
															</button>
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Dispatch Modal Dialog using FloatingLayer */}
			{dispatchingItem && (
				<FloatingLayer
					anchor={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
					placement="bottom-start"
					layer="modal"
					onDismiss={() => {
						if (!dispatching) setDispatchingItem(null);
					}}
					className="w-[460px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 p-5 shadow-apple-modal"
				>
					<div className="space-y-4">
						<div className="flex items-center justify-between border-b border-[var(--border-divider)] pb-2.5">
							<div className="flex items-center gap-2">
								<Send className="h-4 w-4 text-sky-400" />
								<h3 className="text-sm font-semibold text-[var(--text)]">
									派发给 Agent
								</h3>
							</div>
							<button
								type="button"
								disabled={dispatching}
								onClick={() => setDispatchingItem(null)}
								className="rounded p-1 text-[var(--text-dim)] hover:text-[var(--text)]"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						{/* Item Summary Preview */}
						<div className="rounded-lg bg-[var(--bg)] p-3 text-xs text-[var(--text-dim)]">
							<span className="font-medium text-[var(--text)]">任务内容:</span>{" "}
							{dispatchingItem.text}
						</div>

						{/* Target Session Type */}
						<div className="space-y-2">
							<div className="text-xs font-medium text-[var(--text-dim)]">
								目标会话
							</div>
							<div className="grid grid-cols-2 gap-2 text-xs">
								<button
									type="button"
									onClick={() => setDispatchTargetType("existing")}
									className={`rounded-lg border p-2.5 text-center font-medium transition-all ${
										dispatchTargetType === "existing"
											? "border-sky-500 bg-sky-500/10 text-sky-300"
											: "border-[var(--border-divider)] bg-[var(--bg)] text-[var(--text-dim)] hover:text-[var(--text)]"
									}`}
								>
									现有会话
								</button>
								<button
									type="button"
									onClick={() => setDispatchTargetType("new")}
									className={`rounded-lg border p-2.5 text-center font-medium transition-all ${
										dispatchTargetType === "new"
											? "border-sky-500 bg-sky-500/10 text-sky-300"
											: "border-[var(--border-divider)] bg-[var(--bg)] text-[var(--text-dim)] hover:text-[var(--text)]"
									}`}
								>
									开启新会话
								</button>
							</div>
						</div>

						{/* Existing Session Dropdown */}
						{dispatchTargetType === "existing" && (
							<div className="space-y-1.5 text-xs">
								<label className="text-[var(--text-dim)]">选择会话</label>
								<NativeSelect
									value={selectedExistingId}
									onChange={(e) => setSelectedExistingId(e.target.value)}
									className="w-full"
								>
									{Object.values(sessions).map((s) => (
										<option key={s.id} value={s.id}>
											{s.title || s.id}
										</option>
									))}
								</NativeSelect>
							</div>
						)}

						{/* New Session Workspace & Model */}
						{dispatchTargetType === "new" && (
							<div className="space-y-3 text-xs">
								<div className="space-y-1.5">
									<label className="text-[var(--text-dim)]">工作区目录</label>
									<NativeSelect
										value={selectedWorkspacePath}
										onChange={(e) => setSelectedWorkspacePath(e.target.value)}
										className="w-full"
									>
										{workspaces.map((w) => (
											<option key={w.path} value={w.path}>
												{w.name} ({w.path})
											</option>
										))}
									</NativeSelect>
								</div>
								<div className="space-y-1.5">
									<label className="text-[var(--text-dim)]">
										指定模型 (可选)
									</label>
									<input
										type="text"
										value={newSessionModel}
										onChange={(e) => setNewSessionModel(e.target.value)}
										placeholder="留空使用默认模型"
										className="w-full rounded-lg border border-[var(--border-divider)] bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--text)] focus:border-sky-500 focus:outline-none"
									/>
								</div>
							</div>
						)}

						{dispatchError && (
							<div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
								{dispatchError}
							</div>
						)}

						{/* Actions */}
						<div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-divider)]">
							<button
								type="button"
								disabled={dispatching}
								onClick={() => setDispatchingItem(null)}
								className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
							>
								取消
							</button>
							<button
								type="button"
								disabled={dispatching}
								onClick={handleExecuteDispatch}
								className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
							>
								{dispatching && (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								)}
								<span>确认派发</span>
							</button>
						</div>
					</div>
				</FloatingLayer>
			)}
		</div>
	);
}

interface BacklogRowProps {
	item: BacklogItem;
	isEditing: boolean;
	editingText: string;
	savingEdit: boolean;
	hasSelectedSession: boolean;
	onStartEdit: () => void;
	onCancelEdit: () => void;
	onChangeEditingText: (v: string) => void;
	onSaveEdit: () => void;
	onOpenDispatch: () => void;
	onFillCurrent: () => void;
	onMarkDone: () => void;
	onCloseItem: () => void;
	onDelete: () => void;
}

function BacklogRow({
	item,
	isEditing,
	editingText,
	savingEdit,
	hasSelectedSession,
	onStartEdit,
	onCancelEdit,
	onChangeEditingText,
	onSaveEdit,
	onOpenDispatch,
	onFillCurrent,
	onMarkDone,
	onCloseItem,
	onDelete,
}: BacklogRowProps) {
	const kindMeta = BACKLOG_KIND_META[item.kind];

	if (isEditing) {
		return (
			<div className="rounded-xl border border-sky-500/40 bg-[var(--bg-panel)] p-3 text-xs shadow-sm">
				<textarea
					value={editingText}
					onChange={(e) => onChangeEditingText(e.target.value)}
					rows={3}
					className="w-full resize-y rounded border border-[var(--border-divider)] bg-[var(--bg)] p-2 text-xs text-[var(--text)] focus:border-sky-500 focus:outline-none"
					placeholder="修改条目内容..."
				/>
				<div className="mt-2 flex items-center justify-end gap-2">
					<button
						type="button"
						disabled={savingEdit}
						onClick={onCancelEdit}
						className="rounded px-2.5 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
					>
						取消
					</button>
					<button
						type="button"
						disabled={savingEdit || !editingText.trim()}
						onClick={onSaveEdit}
						className="inline-flex items-center gap-1 rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
					>
						{savingEdit && <Loader2 className="h-3 w-3 animate-spin" />}
						<span>保存</span>
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-3.5 text-xs transition-colors hover:border-[var(--text-dim)]/40 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 space-y-1.5">
					<div className="flex items-center gap-2">
						<span
							className={`rounded px-1.5 py-0.2 text-[10px] font-medium ${kindMeta?.badgeCls}`}
						>
							{kindMeta?.label}
						</span>
						<span className="text-[11px] text-[var(--text-dim)]">
							{new Date(item.createdAt).toLocaleDateString([], {
								month: "numeric",
								day: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							})}
						</span>
					</div>

					<p className="whitespace-pre-wrap break-words leading-relaxed text-[var(--text)] font-medium">
						{item.text}
					</p>
				</div>

				{/* Quick Actions */}
				<div className="flex shrink-0 flex-wrap items-center gap-1">
					<button
						type="button"
						onClick={onOpenDispatch}
						className="inline-flex items-center gap-1 rounded bg-sky-600/15 px-2.5 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-600/25"
						title="组装 Prompt 并指派给 Agent"
					>
						<Send className="h-3 w-3" />
						<span>派给 Agent</span>
					</button>

					{hasSelectedSession && (
						<button
							type="button"
							onClick={onFillCurrent}
							className="inline-flex items-center gap-1 rounded bg-[var(--bg-hover)] px-2 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
							title="填入当前会话输入框并标记为已派发"
						>
							<CornerDownLeft className="h-3 w-3" />
							<span>填入当前</span>
						</button>
					)}

					<button
						type="button"
						onClick={onMarkDone}
						className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-emerald-400"
						title="标记完成"
					>
						<Check className="h-3.5 w-3.5" />
					</button>

					<button
						type="button"
						onClick={onStartEdit}
						className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
						title="编辑"
					>
						<Edit3 className="h-3.5 w-3.5" />
					</button>

					<button
						type="button"
						onClick={onCloseItem}
						className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
						title="关闭"
					>
						<X className="h-3.5 w-3.5" />
					</button>

					<button
						type="button"
						onClick={onDelete}
						className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-rose-400"
						title="删除"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		</div>
	);
}
