/**
 * "🩺 AI会诊" tab of the Token panel. Manual-by-default diagnosis of the
 * selected session: only the distilled skeleton is sent to the model; the
 * result offers editable prompt drafts that are copied or put into the
 * composer — never written to files.
 */
import clsx from "clsx";
import { AlertCircle, Loader2, Send, Settings as SettingsIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { SessionMeta, TranscriptItem } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { useComposer } from "../../stores/composer";
import { useUi } from "../../stores/ui";
import { useSettings } from "../settings/store";
import { type DiagnosticLens, type DiagnosticPrescription, distillSessionSkeleton } from "./distribution";
import { useDoctor } from "./doctorStore";

const LENSES: { value: DiagnosticLens; label: string; hint: string }[] = [
	{ value: "cost", label: "🪙 省钱瘦身", hint: "找出上下文浪费、重复读取与无效重试" },
	{ value: "prompt", label: "🎯 提问调优", hint: "分析需求表述是否导致范围蔓延或反复返工" },
	{ value: "quality", label: "🛡️ 代码暗坑", hint: "排查过度设计、隐藏风险与未验证的改动" },
	{ value: "freeform", label: "💬 自由提问", hint: "就本对话提出你自己的问题" },
];

const CARD = "rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3";

function formatTok(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function autoModeLabel(mode: string | undefined, idle: number | undefined, time: string | undefined): string {
	if (mode === "idle") return `闲置 ${idle ?? 30} 分钟后自动体检`;
	if (mode === "scheduled") return `每日 ${time ?? "23:00"} 自动体检`;
	return "手动（仅在你点击时体检）";
}

export function DoctorView({
	sessionId,
	meta,
	items,
}: {
	sessionId: string;
	meta: SessionMeta | undefined;
	items: TranscriptItem[];
}) {
	const state = useDoctor((s) => s.bySession[sessionId]);
	const settings = useSettings((s) => s.settings);
	const doctorModel = settings?.doctorModel || "smol";

	const [lens, setLens] = useState<DiagnosticLens>(state?.lens ?? "cost");
	const [question, setQuestion] = useState("");
	const [followUp, setFollowUp] = useState("");

	const localTokens = useMemo(() => {
		const sk = distillSessionSkeleton(items, {
			id: sessionId,
			title: meta?.title,
			model: meta?.model ?? undefined,
			cwd: meta?.cwd,
		});
		return Math.ceil(sk.dehydratedPromptText.length / 2);
	}, [items, sessionId, meta?.title, meta?.model, meta?.cwd]);

	const skeletonTokens = state?.skeletonTokens || localTokens;
	const running = state?.status === "running";
	const result = state?.result ?? null;
	const thread = state?.thread ?? [];
	const canStart = !running && (lens !== "freeform" || question.trim().length > 0);

	const start = () => {
		if (!canStart) return;
		void useDoctor.getState().runDiagnosis(sessionId, lens, lens === "freeform" ? question.trim() : undefined);
	};
	const sendFollowUp = () => {
		const q = followUp.trim();
		if (!q || running || !result) return;
		setFollowUp("");
		void useDoctor.getState().askFollowUp(sessionId, q);
	};

	return (
		<div className="min-w-0 space-y-3 break-words [overflow-wrap:anywhere]">
			{/* Lens selector */}
			<div className={CARD}>
				<div className="mb-2 text-[11.5px] font-medium text-neutral-200">选择体检方向</div>
				<div className="grid grid-cols-2 gap-1.5">
					{LENSES.map((l) => (
						<button
							key={l.value}
							type="button"
							title={l.hint}
							onClick={() => setLens(l.value)}
							className={clsx(
								"rounded-lg border px-2 py-1.5 text-left text-[11px] transition-all",
								lens === l.value
									? "border-[var(--accent)] bg-[var(--accent)]/10 text-neutral-100"
									: "border-[var(--border)] text-neutral-400 hover:bg-[var(--bg-hover)]",
							)}
						>
							{l.label}
						</button>
					))}
				</div>
				<div className="mt-1.5 text-[10px] text-neutral-500">{LENSES.find((l) => l.value === lens)?.hint}</div>
				{lens === "freeform" && (
					<textarea
						value={question}
						onChange={(e) => setQuestion(e.target.value)}
						placeholder="例如：为什么这次改动反复失败？我该怎么描述需求才能一次做对？（必填）"
						rows={3}
						className="mt-2 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-2 text-[11px] text-neutral-200 outline-none focus:border-[var(--accent)]"
					/>
				)}

				<div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
					<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-400">
						⚡ 已脱水为 ~{formatTok(skeletonTokens)} token 骨架
					</span>
				</div>
				<div className="mt-1 text-[10px] text-neutral-500">
					只发送这份精简骨架（目标、动作序列、报错、改动文件），不会发送完整对话记录。
				</div>

				<button
					type="button"
					disabled={!canStart}
					onClick={start}
					className={clsx(
						"mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-all",
						canStart
							? "bg-[var(--accent)] text-white hover:opacity-90"
							: "cursor-not-allowed bg-[var(--bg-hover)] text-neutral-500",
					)}
				>
					{running ? <Loader2 size={12} className="animate-spin" /> : null}
					{running ? "体检中…" : result ? "🩺 重新体检" : "🩺 开始体检"}
				</button>
				<div className="mt-1 text-center text-[10px] text-neutral-500">
					使用模型 <span className="font-mono text-neutral-400">{doctorModel}</span>，每次体检会消耗少量 token
				</div>
			</div>

			{/* Error */}
			{state?.status === "error" && (
				<div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
					<div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-red-400">
						<AlertCircle size={12} /> 体检失败
					</div>
					<pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] text-red-300/90">
						{state.error ?? "未知错误"}
					</pre>
					<button
						type="button"
						onClick={start}
						disabled={!canStart}
						className="mt-2 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-[var(--bg-hover)] disabled:opacity-50"
					>
						重试
					</button>
				</div>
			)}

			{/* Result */}
			{result && (
				<>
					<div className={CARD}>
						<div className="mb-1 flex items-center justify-between">
							<span className="text-[11.5px] font-medium text-neutral-200">核心结论</span>
							{state?.diagnosedAt && (
								<span className="text-[10px] text-neutral-500">
									{relativeTime(new Date(state.diagnosedAt).toISOString())}
								</span>
							)}
						</div>
						<div className="text-[11.5px] leading-relaxed text-neutral-200 break-words">{result.conclusion}</div>
						{result.systemicTags.length > 0 && (
							<div className="mt-2 flex flex-wrap gap-1">
								{result.systemicTags.map((t) => (
									<span
										key={t}
										className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400"
									>
										{t}
									</span>
								))}
							</div>
						)}
					</div>

					{result.evidence.length > 0 && (
						<div className={CARD}>
							<div className="mb-1 text-[11.5px] font-medium text-neutral-200">事实证据</div>
							<ul className="list-disc space-y-1 pl-4 text-[11px] text-neutral-300">
								{result.evidence.map((e, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static list per result
									<li key={i}>{e}</li>
								))}
							</ul>
						</div>
					)}

					<div className={CARD}>
						<div className="mb-1 text-[11.5px] font-medium text-neutral-200">根因分析</div>
						<div className="text-[11px] leading-relaxed text-neutral-300">{result.rootCause}</div>
					</div>

					{result.prescriptions.length > 0 && (
						<div className="space-y-2">
							<div className="px-0.5 text-[11.5px] font-medium text-neutral-200">纠偏 Prompt 草稿</div>
							{result.prescriptions.map((p, i) => (
								<PrescriptionCard
									// biome-ignore lint/suspicious/noArrayIndexKey: reseed drafts when a new result arrives
									key={`${result.generatedAt}-${i}`}
									sessionId={sessionId}
									prescription={p}
								/>
							))}
						</div>
					)}

					{/* Follow-up thread */}
					<div className={CARD}>
						<div className="mb-1.5 text-[11.5px] font-medium text-neutral-200">追问</div>
						{thread.length > 0 && (
							<div className="mb-2 space-y-1.5">
								{thread.map((t, i) => (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: append-only thread
										key={i}
										className={clsx(
											"whitespace-pre-wrap rounded-lg px-2 py-1.5 text-[11px]",
											t.role === "user"
												? "ml-6 bg-[var(--accent)]/10 text-neutral-200"
												: "mr-6 bg-[var(--bg-panel)] text-neutral-300",
										)}
									>
										{t.text}
									</div>
								))}
							</div>
						)}
						<div className="flex items-center gap-1.5">
							<input
								value={followUp}
								onChange={(e) => setFollowUp(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
										e.preventDefault();
										sendFollowUp();
									}
								}}
								disabled={running}
								placeholder={running ? "体检中…" : "继续追问，回车发送"}
								className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-[var(--accent)] disabled:opacity-50"
							/>
							<button
								type="button"
								onClick={sendFollowUp}
								disabled={running || !followUp.trim()}
								className="rounded-lg border border-[var(--border)] p-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] disabled:opacity-40"
								title="发送"
							>
								<Send size={12} />
							</button>
						</div>
					</div>
				</>
			)}

			{/* Settings hint */}
			<div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-[10.5px] text-neutral-500">
				<span>
					体检模式：{autoModeLabel(settings?.doctorAutoMode, settings?.doctorIdleMinutes, settings?.doctorScheduleTime)}
					· 模型 <span className="font-mono">{doctorModel}</span>
				</span>
				<button
					type="button"
					onClick={() => useUi.getState().openSettings("doctor")}
					className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-neutral-400 hover:bg-[var(--bg-hover)]"
					title="设置 → 会话体检"
				>
					<SettingsIcon size={11} /> 设置
				</button>
			</div>
		</div>
	);
}

function PrescriptionCard({ sessionId, prescription }: { sessionId: string; prescription: DiagnosticPrescription }) {
	const [text, setText] = useState(prescription.promptDraft);
	const [copied, setCopied] = useState(false);
	return (
		<div className={CARD}>
			<div className="mb-1 text-[11px] font-medium text-neutral-200">{prescription.label}</div>
			{prescription.explanation && (
				<div className="mb-1.5 text-[10.5px] text-neutral-500">{prescription.explanation}</div>
			)}
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				rows={4}
				className="w-full min-w-0 resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-2 font-mono text-[10.5px] text-neutral-200 outline-none focus:border-[var(--accent)]"
			/>
			<div className="mt-1.5 flex justify-end gap-1.5">
				<button
					type="button"
					onClick={() => {
						void navigator.clipboard.writeText(text).then(() => {
							setCopied(true);
							setTimeout(() => setCopied(false), 1500);
						});
					}}
					className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-[var(--bg-hover)]"
				>
					{copied ? "已复制" : "复制"}
				</button>
				<button
					type="button"
					onClick={() => {
						const c = useComposer.getState();
						c.setDraft(sessionId, text);
						c.focusComposer(sessionId);
					}}
					className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11px] text-white hover:opacity-90"
				>
					填入输入框
				</button>
			</div>
		</div>
	);
}
