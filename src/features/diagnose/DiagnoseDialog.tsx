import {
	ChevronDown,
	ChevronRight,
	FileText,
	RefreshCw,
	Send,
	Stethoscope,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
	diagnoseBuildPrompt,
	dispatchPrompt,
	rpcSend,
	rpcStart,
} from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

/**
 * [D] Diagnose dialog. Always mounted; opened via
 * `ui.openModal("diagnose", { sessionId })`.
 */
export function DiagnoseDialog() {
	const modal = useUi((s) => s.modal);
	const closeModal = useUi((s) => s.closeModal);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);

	const isVisible = modal?.name === "diagnose";
	const targetSessionId =
		typeof modal?.props?.sessionId === "string" ? modal.props.sessionId : "";

	const [prompt, setPrompt] = useState<string>("");
	const [loadingPrompt, setLoadingPrompt] = useState(false);
	const [showPromptPreview, setShowPromptPreview] = useState(false);

	const [targetType, setTargetType] = useState<"existing" | "new">("existing");
	const [selectedExistingId, setSelectedExistingId] = useState<string>("");
	const [newSessionModel, setNewSessionModel] = useState<string>("");
	const [dispatching, setDispatching] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const targetSession = targetSessionId ? sessions[targetSessionId] : undefined;

	useEffect(() => {
		if (isVisible && targetSessionId) {
			setError(null);
			setLoadingPrompt(true);
			setDispatching(false);

			// Choose default existing diagnoser: first session that is not target
			const candidateIds = Object.keys(sessions).filter(
				(id) => id !== targetSessionId,
			);
			setSelectedExistingId(candidateIds[0] || "");

			void diagnoseBuildPrompt(targetSessionId)
				.then((p) => {
					setPrompt(p);
				})
				.catch((err) => {
					setError(`生成诊断提示词失败: ${String(err)}`);
				})
				.finally(() => {
					setLoadingPrompt(false);
				});
		}
	}, [isVisible, targetSessionId, sessions]);

	if (!isVisible) return null;

	const handleExecuteDiagnose = async () => {
		if (!prompt) return;
		setDispatching(true);
		setError(null);
		try {
			let diagnoserId = selectedExistingId;
			if (targetType === "new") {
				const cwd = targetSession?.cwd || ".";
				const info = await rpcStart({
					cwd,
					model: newSessionModel.trim() || undefined,
				});
				diagnoserId = info.sessionId;
				await rpcSend(diagnoserId, { type: "prompt", text: prompt });
			} else {
				if (!diagnoserId) throw new Error("请选择用于诊断的会话");
				await dispatchPrompt(diagnoserId, prompt);
			}

			closeModal();
			selectSession(diagnoserId);
		} catch (err) {
			setError(String(err));
			setDispatching(false);
		}
	};

	const candidateSessions = Object.values(sessions).filter(
		(s) => s.id !== targetSessionId,
	);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
			onClick={(e) => {
				if (e.target === e.currentTarget) closeModal();
			}}
		>
			<div className="w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
				{/* Dialog Header */}
				<div className="mb-4 flex items-center justify-between border-b border-neutral-800 pb-3">
					<div className="flex items-center gap-2.5">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
							<Stethoscope className="h-4 w-4" />
						</div>
						<div>
							<h2 className="text-sm font-semibold text-neutral-100">
								诊断异常会话
							</h2>
							<p className="text-[11px] text-neutral-400">
								收集报错上下文与摘要，派发给诊断专家 Agent
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={closeModal}
						className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{error && (
					<div className="mb-4 rounded-lg border border-rose-800/50 bg-rose-950/20 p-2.5 text-xs text-rose-300">
						{error}
					</div>
				)}

				{/* Target Session Info Card */}
				<div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-xs">
					<div className="flex items-center justify-between">
						<span className="font-semibold text-neutral-300">
							被诊断会话: {targetSession?.title || targetSessionId}
						</span>
						<span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-medium text-rose-300">
							{targetSession?.status ?? "异常"}
						</span>
					</div>
					{targetSession?.cwd && (
						<div className="mt-1 text-[11px] text-neutral-500 truncate">
							工作目录: {targetSession.cwd}
						</div>
					)}
				</div>

				{/* Prompt Preview Accordion */}
				<div className="mb-5 rounded-xl border border-neutral-800 bg-neutral-950/40">
					<button
						type="button"
						onClick={() => setShowPromptPreview(!showPromptPreview)}
						className="flex w-full items-center justify-between p-3 text-xs font-medium text-neutral-400 hover:text-neutral-200"
					>
						<div className="flex items-center gap-1.5">
							<FileText className="h-3.5 w-3.5" />
							<span>诊断上下文提示词 ({prompt ? `${prompt.length} 字符` : "准备中..."})</span>
						</div>
						{showPromptPreview ? (
							<ChevronDown className="h-4 w-4" />
						) : (
							<ChevronRight className="h-4 w-4" />
						)}
					</button>

					{showPromptPreview && (
						<div className="border-t border-neutral-800 p-3">
							{loadingPrompt ? (
								<div className="flex items-center gap-2 py-2 text-xs text-neutral-500">
									<RefreshCw className="h-3 w-3 animate-spin" />
									<span>正在扫描会话尾部错误和生成摘要...</span>
								</div>
							) : (
								<pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-neutral-950 p-2.5 text-[11px] text-neutral-300 font-mono">
									{prompt}
								</pre>
							)}
						</div>
					)}
				</div>

				{/* Diagnoser Target Selection */}
				<div className="space-y-3">
					<div className="text-xs font-semibold text-neutral-300">
						由哪个 Agent 执行诊断？
					</div>

					<div className="flex rounded-lg border border-neutral-800 bg-neutral-950/60 p-1 text-xs font-medium">
						<button
							type="button"
							onClick={() => setTargetType("existing")}
							className={`flex-1 rounded-md py-1.5 transition-colors ${
								targetType === "existing"
									? "bg-neutral-800 text-neutral-100"
									: "text-neutral-400 hover:text-neutral-200"
							}`}
						>
							现有会话
						</button>
						<button
							type="button"
							onClick={() => setTargetType("new")}
							className={`flex-1 rounded-md py-1.5 transition-colors ${
								targetType === "new"
									? "bg-neutral-800 text-neutral-100"
									: "text-neutral-400 hover:text-neutral-200"
							}`}
						>
							新开诊断会话
						</button>
					</div>

					{targetType === "existing" ? (
						candidateSessions.length === 0 ? (
							<div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-xs text-neutral-500">
								没有其他可用会话，请选择「新开诊断会话」。
							</div>
						) : (
							<div>
								<label className="mb-1 block text-xs text-neutral-400">
									选择执行诊断的会话
								</label>
								<select
									value={selectedExistingId}
									onChange={(e) => setSelectedExistingId(e.target.value)}
									className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-100 focus:border-amber-500 focus:outline-none"
								>
									{candidateSessions.map((s) => (
										<option key={s.id} value={s.id}>
											{s.title || s.id} ({s.status})
										</option>
									))}
								</select>
							</div>
						)
					) : (
						<div className="space-y-2">
							<div>
								<label className="mb-1 block text-xs text-neutral-400">
									模型 (可选)
								</label>
								<input
									type="text"
									value={newSessionModel}
									onChange={(e) => setNewSessionModel(e.target.value)}
									placeholder="留空使用默认模型，或输入指定模型"
									className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
								/>
							</div>
							<div className="text-[11px] text-neutral-500">
								新会话将在目标会话的工作目录 ({targetSession?.cwd ?? "当前目录"}) 下启动。
							</div>
						</div>
					)}
				</div>

				{/* Actions */}
				<div className="mt-6 flex items-center justify-end gap-2 border-t border-neutral-800 pt-4">
					<button
						type="button"
						onClick={closeModal}
						className="rounded-lg px-4 py-2 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					>
						取消
					</button>
					<button
						type="button"
						disabled={
							loadingPrompt ||
							dispatching ||
							!prompt ||
							(targetType === "existing" && !selectedExistingId)
						}
						onClick={handleExecuteDiagnose}
						className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
					>
						<Send className="h-3.5 w-3.5" />
						<span>{dispatching ? "正在启动诊断..." : "开始诊断"}</span>
					</button>
				</div>
			</div>
		</div>
	);
}
