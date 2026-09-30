import {
	ArrowRight,
	Check,
	CheckCheck,
	ChevronDown,
	ChevronUp,
	Edit3,
	HelpCircle,
	Loader2,
	MessageSquare,
	Play,
	Power,
	RefreshCw,
	RotateCcw,
	Stethoscope,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Todo } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import {
	acceptSession,
	backlogBuildPrompt,
	backlogUpdate,
	dispatchPrompt,
	rpcUiRespond,
	servicesStop,
} from "../../lib/ipc";
import { ensureLive, isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import {
	KIND_COLOR,
	KIND_LABEL,
	buildUiResponse,
	servicePid,
	suggestionAction,
	uiRequestOf,
} from "./logic";
import { useTodos } from "./store";

interface TodoRowProps {
	todo: Todo;
	isMostUrgent?: boolean;
	compact?: boolean;
	isFocused?: boolean;
	onAction?: () => void;
	onNavigate?: () => void;
}
export function TodoRow({
	todo,
	isMostUrgent,
	compact,
	isFocused,
	onAction,
	onNavigate,
}: TodoRowProps) {
	const rowRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const selectSession = useUi((s) => s.selectSession);
	const openModal = useUi((s) => s.openModal);
	const session = useSessions((s) =>
		todo.sessionId ? s.sessions[todo.sessionId] : undefined,
	);
	const actTodo = useTodos((s) => s.act);
	const reopenTodo = useTodos((s) => s.reopen);
	const refreshTodos = useTodos((s) => s.refresh);

	const [answering, setAnswering] = useState(false);
	const [answerInput, setAnswerInput] = useState("");
	const [answerValidation, setAnswerValidation] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (isFocused && rowRef.current) {
			rowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
	}, [isFocused]);

	useEffect(() => {
		if (answering && textareaRef.current) {
			textareaRef.current.focus();
		}
	}, [answering]);
	const uiReq = uiRequestOf(todo);
	const isOpen = todo.status === "open";

	const handleAct = async (action: "done" | "ignore") => {
		setBusy(true);
		setError(null);
		try {
			await actTodo(todo.id, action);
			if (action === "ignore") {
				toast.info("已忽略待办，可随时在「已处理事项」中重新打开或撤销");
			} else {
				toast.success("已完成待办事项");
			}
			onAction?.();
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	};

	const handleReopen = async () => {
		setBusy(true);
		setError(null);
		try {
			await reopenTodo(todo.id);
			onAction?.();
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	};

	const handleApprove = async (confirmed: boolean) => {
		if (!todo.sessionId || !uiReq) return;
		setBusy(true);
		setError(null);
		try {
			await rpcUiRespond(
				todo.sessionId,
				buildUiResponse(uiReq, { confirmed }),
			);
			await refreshTodos();
			toast.success(confirmed ? "已同意审批" : "已拒绝审批");
			onAction?.();
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	};

	const handleAnswer = async (value: string) => {
		if (!todo.sessionId || !uiReq) return;
		const trimmed = value.trim();
		if (!trimmed) {
			setAnswerValidation("请输入回答内容");
			return;
		}
		setAnswerValidation(null);
		setBusy(true);
		setError(null);
		try {
			await rpcUiRespond(
				todo.sessionId,
				buildUiResponse(uiReq, { value: trimmed }),
			);
			setAnswering(false);
			setAnswerInput("");
			await refreshTodos();
			toast.success("已提交回答");
			onAction?.();
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	};

	const handleReview = async (archive: boolean) => {
		if (!todo.sessionId) return;
		if (archive) {
			const confirmed = await confirmDialog(
				"确定验收并归档当前会话吗？归档后会话将从活跃列表中移出。",
				{
					title: "验收并归档确认",
					danger: true,
					okLabel: "验收并归档",
				},
			);
			if (!confirmed) return;
		}
		setBusy(true);
		setError(null);
		try {
			await acceptSession(todo.sessionId, archive);
			await actTodo(todo.id, "done");
			await refreshTodos();
			toast.success(archive ? "已验收并归档会话" : "已验收会话");
			onAction?.();
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	};

	const handleResume = async () => {
		if (!todo.sessionId) return;
		setBusy(true);
		setError(null);
		try {
			await ensureLive(todo.sessionId);
			await actTodo(todo.id, "done");
			await refreshTodos();
			toast.success("已恢复会话运行");
			onAction?.();
		} catch (e) {
			if (isResumeCancelled(e)) {
				setBusy(false);
				return;
			}
			const msg = errMsg(e);
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	};

	const handleDiagnose = () => {
		if (!todo.sessionId) return;
		openModal("diagnose", { sessionId: todo.sessionId });
	};

	const handleRunSuggestion = async () => {
		const action = suggestionAction(todo);
		if (!action) return;
		setBusy(true);
		setError(null);
		try {
			const prompt = await backlogBuildPrompt(action.backlogId);
			await dispatchPrompt(action.targetSessionId, prompt);
			await backlogUpdate(action.backlogId, {
				status: "dispatched",
				targetSessionId: action.targetSessionId,
			});
			await actTodo(todo.id, "done");
			await refreshTodos();
			toast.success("已采纳监工建议并派发");
			onAction?.();
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	};

	const handleStopService = async (pid: number) => {
		const confirmed = await confirmDialog(
			`确定终止 PID 为 ${pid} 的后台服务进程吗？`,
			{
				title: "停止服务确认",
				danger: true,
				okLabel: "停止服务",
			},
		);
		if (!confirmed) return;
		setBusy(true);
		setError(null);
		try {
			await servicesStop(pid);
			await actTodo(todo.id, "done");
			await refreshTodos();
			toast.success(`已终止服务进程 (PID: ${pid})`);
			onAction?.();
		} catch (e) {
			const msg = errMsg(e);
			setError(msg);
			toast.error(msg);
		} finally {
			setBusy(false);
		}
	};

	const handleGoSession = () => {
		if (todo.sessionId) {
			selectSession(todo.sessionId);
			onNavigate?.();
		}
	};

	// Handlers are declared above
	const sessionTitle = session?.title || todo.sessionId;

	return (
		<div
			ref={rowRef}
			tabIndex={0}
			className={`group relative rounded-lg border transition-all outline-none ${
				isFocused ? "ring-2 ring-amber-500/80 border-amber-500" : ""
			} ${
				isOpen
					? isMostUrgent
						? "border-amber-500/50 bg-amber-950/15 shadow-sm shadow-amber-950/20"
						: "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700"
					: "border-neutral-800/60 bg-neutral-950/40 opacity-75 hover:opacity-100"
			} ${compact ? "p-2.5 text-xs" : "p-3.5 text-sm"}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex flex-wrap items-center gap-1.5">
						<span
							className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
								KIND_COLOR[todo.kind] ?? "bg-neutral-800 text-neutral-300"
							}`}
						>
							{KIND_LABEL[todo.kind] ?? todo.kind}
						</span>

						{sessionTitle && (
							<button
								type="button"
								onClick={handleGoSession}
								className="inline-flex max-w-[200px] truncate items-center gap-1 rounded bg-neutral-800/80 px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 focus:opacity-100"
								title={`跳转到会话: ${sessionTitle}`}
							>
								<MessageSquare className="h-3 w-3 shrink-0" />
								<span className="truncate">{sessionTitle}</span>
							</button>
						)}

						{isMostUrgent && isOpen && (
							<span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300">
								最紧急
							</span>
						)}

						<span className="text-[11px] text-neutral-500">
							{new Date(todo.createdAt).toLocaleTimeString([], {
								hour: "2-digit",
								minute: "2-digit",
							})}
						</span>
					</div>

					<div
						className={`font-medium ${
							isOpen ? "text-neutral-100" : "text-neutral-400 line-through"
						}`}
					>
						{todo.title}
					</div>

					{todo.detail && (
						<div className="mt-0.5 text-xs text-neutral-400">
							<div
								className={
									expanded
										? "whitespace-pre-wrap break-words leading-relaxed"
										: "line-clamp-2"
								}
								title={!expanded ? todo.detail : undefined}
							>
								{todo.detail}
							</div>
							{(todo.detail.length > 80 || todo.detail.includes("\n")) && (
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										setExpanded(!expanded);
									}}
									className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-400/90 hover:text-amber-300 hover:underline"
								>
									{expanded ? (
										<>
											<ChevronUp className="h-3 w-3" />
											<span>收起全文</span>
										</>
									) : (
										<>
											<ChevronDown className="h-3 w-3" />
											<span>展开全文</span>
										</>
									)}
								</button>
							)}
						</div>
					)}

					{error && <div className="text-xs text-rose-400">{error}</div>}
				</div>

				{/* Quick status badge & reopen button for closed items */}
				{!isOpen && (
					<div className="flex shrink-0 items-center gap-2">
						<div className="text-xs text-neutral-500">
							{todo.status === "done" ? (
								<span className="inline-flex items-center gap-1 text-emerald-400/80">
									<Check className="h-3.5 w-3.5" /> 已完成
								</span>
							) : (
								<span className="inline-flex items-center gap-1 text-neutral-500">
									<X className="h-3.5 w-3.5" /> 已忽略
								</span>
							)}
						</div>
						<button
							type="button"
							disabled={busy}
							onClick={handleReopen}
							className="inline-flex items-center gap-1 rounded border border-neutral-700/80 bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 disabled:opacity-50"
							title="重新打开此待办事项"
						>
							<RotateCcw className="h-3 w-3" />
							<span>重新打开</span>
						</button>
					</div>
				)}
			</div>

			{/* Interactive Action Area for Open Items */}
			{isOpen && (
				<div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-neutral-800/60 pt-2">
					{/* Approval Inline Actions */}
					{todo.kind === "approval" && (
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								disabled={busy}
								onClick={() => handleApprove(true)}
								className="inline-flex items-center gap-1 rounded bg-emerald-600/20 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50"
							>
								<Check className="h-3.5 w-3.5" /> 同意
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => handleApprove(false)}
								className="inline-flex items-center gap-1 rounded bg-rose-600/20 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-600/30 disabled:opacity-50"
							>
								<X className="h-3.5 w-3.5" /> 拒绝
							</button>
						</div>
					)}

					{/* Question Inline Actions */}
					{todo.kind === "question" && (
						<div className="flex flex-1 flex-col gap-2">
							{Array.isArray(uiReq?.options) && uiReq.options.length > 0 && (
								<div className="flex flex-wrap items-stretch gap-1.5">
									{uiReq.options.map((c: string, idx: number) => {
										const desc = uiReq.optionDetails?.[idx]?.description;
										return (
											<button
												key={c}
												type="button"
												disabled={busy}
												onClick={() => handleAnswer(c)}
												title={desc || c}
												className="inline-flex flex-col items-start rounded border border-sky-600/30 bg-sky-600/15 px-2.5 py-1 text-left text-xs text-sky-200 hover:bg-sky-600/25 hover:border-sky-500/50 disabled:opacity-50"
											>
												<span className="font-medium">{c}</span>
												{desc && (
													<span className="text-[10px] text-sky-300/70">
														{desc}
													</span>
												)}
											</button>
										);
									})}
									{!answering && (
										<button
											type="button"
											disabled={busy}
											onClick={() => setAnswering(true)}
											className="inline-flex items-center gap-1 rounded border border-neutral-700 bg-neutral-800/80 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 disabled:opacity-50"
											title="提供预设选项之外的自定义回答"
										>
											<Edit3 className="h-3 w-3" />
											<span>自定义回答...</span>
										</button>
									)}
								</div>
							)}

							{(!uiReq?.options || uiReq.options.length === 0) && !answering && (
								<button
									type="button"
									onClick={() => setAnswering(true)}
									className="inline-flex items-center gap-1 self-start rounded bg-sky-600/20 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-600/30"
								>
									<HelpCircle className="h-3.5 w-3.5" />
									<span>回答问题</span>
								</button>
							)}

							{answering && (
								<div className="flex flex-col gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/70 p-2">
									<textarea
										ref={textareaRef}
										value={answerInput}
										onChange={(e) => {
											setAnswerInput(e.target.value);
											if (answerValidation) setAnswerValidation(null);
										}}
										placeholder={
											uiReq?.placeholder ||
											"输入回答（支持 Cmd/Ctrl+Enter 快速提交，Esc 取消）..."
										}
										rows={3}
										className="w-full resize-y rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-sky-500 focus:outline-none"
										onKeyDown={(e) => {
											if (isComposing(e)) return;
											if (e.key === "Escape") {
												e.stopPropagation();
												setAnswering(false);
												setAnswerValidation(null);
											} else if (
												(e.key === "Enter" && (e.metaKey || e.ctrlKey)) ||
												(e.key === "Enter" && !e.shiftKey)
											) {
												e.preventDefault();
												void handleAnswer(answerInput);
											}
										}}
									/>
									{answerValidation && (
										<div className="text-[11px] text-rose-400">
											{answerValidation}
										</div>
									)}
									<div className="flex items-center justify-between gap-2 pt-1">
										<span className="text-[10px] text-neutral-500">
											Enter 或 Cmd+Enter 提交 · Esc 取消
										</span>
										<div className="flex items-center gap-1.5">
											<button
												type="button"
												onClick={() => {
													setAnswering(false);
													setAnswerValidation(null);
												}}
												className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:text-neutral-200"
											>
												取消
											</button>
											<button
												type="button"
												disabled={busy}
												onClick={() => handleAnswer(answerInput)}
												className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
											>
												{busy && <Loader2 className="h-3 w-3 animate-spin" />}
												<span>提交回答</span>
											</button>
										</div>
									</div>
								</div>
							)}
						</div>
					)}

					{/* Review Inline Actions */}
					{todo.kind === "review" && (
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								disabled={busy}
								onClick={() => handleReview(false)}
								className="inline-flex items-center gap-1 rounded bg-orange-600/20 px-2.5 py-1 text-xs font-medium text-orange-300 hover:bg-orange-600/30 disabled:opacity-50"
							>
								<Check className="h-3.5 w-3.5" /> 验收
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => handleReview(true)}
								className="inline-flex items-center gap-1 rounded bg-purple-600/20 px-2.5 py-1 text-xs font-medium text-purple-300 hover:bg-purple-600/30 disabled:opacity-50"
							>
								<CheckCheck className="h-3.5 w-3.5" /> 验收并归档
							</button>
						</div>
					)}

					{/* Error & Interrupted Actions */}
					{(todo.kind === "error" || todo.kind === "interrupted") && (
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								disabled={busy}
								onClick={handleResume}
								className="inline-flex items-center gap-1 rounded bg-emerald-600/20 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50"
							>
								<RefreshCw
									className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
								/>{" "}
								恢复
							</button>
							<button
								type="button"
								onClick={handleDiagnose}
								className="inline-flex items-center gap-1 rounded bg-amber-600/20 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-600/30"
							>
								<Stethoscope className="h-3.5 w-3.5" /> 诊断
							</button>
						</div>
					)}

					{/* Suggestion Actions */}
					{todo.kind === "suggestion" && (
						<div className="flex items-center gap-1.5">
							{suggestionAction(todo) && (
								<button
									type="button"
									disabled={busy}
									onClick={handleRunSuggestion}
									className="inline-flex items-center gap-1 rounded bg-violet-600/20 px-2.5 py-1 text-xs font-medium text-violet-300 hover:bg-violet-600/30 disabled:opacity-50"
								>
									<Play className="h-3.5 w-3.5" /> 采纳建议
								</button>
							)}
							{todo.sessionId && (
								<button
									type="button"
									onClick={handleGoSession}
									className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 focus:opacity-100"
								>
									<ArrowRight className="h-3.5 w-3.5" /> 查看会话
								</button>
							)}
						</div>
					)}

					{/* ServiceLeft Actions */}
					{todo.kind === "service_left" && (
						<div className="flex items-center gap-1.5">
							{servicePid(todo) !== null && (
								<button
									type="button"
									disabled={busy}
									onClick={() => handleStopService(servicePid(todo)!)}
									className="inline-flex items-center gap-1 rounded bg-rose-600/20 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-600/30 disabled:opacity-50"
								>
									<Power className="h-3.5 w-3.5" /> 停止服务 (PID{" "}
									{servicePid(todo)})
								</button>
							)}
						</div>
					)}

					{/* Common Done button (if not already approval/review) */}
					{todo.kind !== "approval" &&
						todo.kind !== "review" &&
						todo.kind !== "suggestion" && (
							<button
								type="button"
								disabled={busy}
								onClick={() => handleAct("done")}
								className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
							>
								<Check className="h-3.5 w-3.5" /> 完成
							</button>
						)}

					{/* Ignore button */}
					<button
						type="button"
						disabled={busy}
						onClick={() => handleAct("ignore")}
						className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 disabled:opacity-50"
					>
						忽略
					</button>

					{/* Jump to session if available and not already a session button */}
					{todo.sessionId &&
						todo.kind !== "suggestion" && (
							<button
								type="button"
								onClick={handleGoSession}
								className="ml-auto inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 focus:opacity-100"
							>
								<span>进入会话</span>
								<ArrowRight className="h-3 w-3" />
							</button>
						)}
				</div>
			)}
		</div>
	);
}
