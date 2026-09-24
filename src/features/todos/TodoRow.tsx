import {
	ArrowRight,
	Check,
	CheckCheck,
	HelpCircle,
	MessageSquare,
	Play,
	Power,
	RefreshCw,
	Stethoscope,
	X,
} from "lucide-react";
import { useState } from "react";
import type { Todo } from "../../lib/contracts";
import {
	acceptSession,
	backlogBuildPrompt,
	backlogUpdate,
	dispatchPrompt,
	rpcEnsureLive,
	rpcUiRespond,
	servicesStop,
	todosAct,
} from "../../lib/ipc";
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
}

export function TodoRow({ todo, isMostUrgent, compact }: TodoRowProps) {
	const selectSession = useUi((s) => s.selectSession);
	const openModal = useUi((s) => s.openModal);
	const session = useSessions((s) =>
		todo.sessionId ? s.sessions[todo.sessionId] : undefined,
	);
	const refreshTodos = useTodos((s) => s.refresh);

	const [answering, setAnswering] = useState(false);
	const [answerInput, setAnswerInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const uiReq = uiRequestOf(todo);
	const isOpen = todo.status === "open";

	const handleAct = async (action: "done" | "ignore") => {
		setBusy(true);
		setError(null);
		try {
			await todosAct(todo.id, action);
			await refreshTodos();
		} catch (e) {
			setError(String(e));
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
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	const handleAnswer = async (value: string) => {
		if (!todo.sessionId || !uiReq) return;
		setBusy(true);
		setError(null);
		try {
			await rpcUiRespond(
				todo.sessionId,
				buildUiResponse(uiReq, { value }),
			);
			setAnswering(false);
			await refreshTodos();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	const handleReview = async (archive: boolean) => {
		if (!todo.sessionId) return;
		setBusy(true);
		setError(null);
		try {
			await acceptSession(todo.sessionId, archive);
			await todosAct(todo.id, "done");
			await refreshTodos();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	const handleResume = async () => {
		if (!todo.sessionId) return;
		setBusy(true);
		setError(null);
		try {
			await rpcEnsureLive(todo.sessionId);
			await todosAct(todo.id, "done");
			await refreshTodos();
		} catch (e) {
			setError(String(e));
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
			await todosAct(todo.id, "done");
			await refreshTodos();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	const handleStopService = async (pid: number) => {
		setBusy(true);
		setError(null);
		try {
			await servicesStop(pid);
			await todosAct(todo.id, "done");
			await refreshTodos();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	};

	const sessionTitle = session?.title || todo.sessionId;

	return (
		<div
			className={`group relative rounded-lg border transition-all ${
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
								onClick={() => todo.sessionId && selectSession(todo.sessionId)}
								className="inline-flex max-w-[200px] truncate items-center gap-1 rounded bg-neutral-800/80 px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
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
						<div className="text-xs text-neutral-400 line-clamp-2">
							{todo.detail}
						</div>
					)}

					{error && <div className="text-xs text-rose-400">{error}</div>}
				</div>

				{/* Quick status badge for closed items */}
				{!isOpen && (
					<div className="shrink-0 text-xs text-neutral-500">
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
						<div className="flex flex-1 flex-col gap-1.5">
							{Array.isArray(uiReq?.options) && uiReq.options.length > 0 ? (
								<div className="flex flex-wrap gap-1">
									{uiReq.options.map((c: string) => (
										<button
											key={c}
											type="button"
											disabled={busy}
											onClick={() => handleAnswer(c)}
											className="inline-flex items-center rounded bg-sky-600/20 px-2 py-0.5 text-xs text-sky-200 hover:bg-sky-600/30 disabled:opacity-50"
										>
											{c}
										</button>
									))}
								</div>
							) : answering ? (
								<div className="flex items-center gap-1.5">
									<input
										type="text"
										value={answerInput}
										onChange={(e) => setAnswerInput(e.target.value)}
										placeholder="输入回答..."
										className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200 focus:border-sky-500 focus:outline-none"
										onKeyDown={(e) => {
											if (e.key === "Enter" && answerInput.trim()) {
												void handleAnswer(answerInput.trim());
											}
										}}
									/>
									<button
										type="button"
										disabled={busy || !answerInput.trim()}
										onClick={() => handleAnswer(answerInput.trim())}
										className="rounded bg-sky-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
									>
										提交
									</button>
									<button
										type="button"
										onClick={() => setAnswering(false)}
										className="text-xs text-neutral-400 hover:text-neutral-200"
									>
										取消
									</button>
								</div>
							) : (
								<button
									type="button"
									onClick={() => setAnswering(true)}
									className="inline-flex items-center gap-1 rounded bg-sky-600/20 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-600/30"
								>
									<HelpCircle className="h-3.5 w-3.5" /> 回答问题
								</button>
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
									onClick={() => selectSession(todo.sessionId)}
									className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
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
								onClick={() => selectSession(todo.sessionId)}
								className="ml-auto inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300"
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
