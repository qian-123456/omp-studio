/**
 * "🩺 AI会诊" tab of the Token panel. Manual-by-default diagnosis of the
 * selected session: only the distilled skeleton is sent to the model; the
 * result offers editable prompt drafts that are copied or put into the
 * composer — never written to files.
 */
import clsx from "clsx";
import { AlertCircle, Loader2, Send, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "../../components/CopyButton";
import { isComposing } from "../../lib/hooks";
import type { SessionMeta, TranscriptItem } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { useComposer } from "../../stores/composer";
import { useUi } from "../../stores/ui";
import { useSettings } from "../settings/store";
import { useT, tNow } from "../../stores/language";
import { type DiagnosticLens, type DiagnosticPrescription, distillSessionSkeleton } from "./distribution";
import { useDoctor } from "./doctorStore";

const PRESET_LENS_KEYS: { value: DiagnosticLens; labelKey: string; hintKey: string }[] = [
	{ value: "cost", labelKey: "doctor.lensCostLabel", hintKey: "doctor.lensCostHint" },
	{ value: "prompt", labelKey: "doctor.lensPromptLabel", hintKey: "doctor.lensPromptHint" },
	{ value: "quality", labelKey: "doctor.lensQualityLabel", hintKey: "doctor.lensQualityHint" },
];

/** Restore the preset lenses of the last run; a question-only run restores an empty selection. */
function presetLenses(saved: DiagnosticLens[] | undefined): DiagnosticLens[] {
	if (!saved || saved.length === 0) return ["cost"];
	return saved.filter((l) => l !== "freeform");
}

const CARD = "rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3";

function formatTok(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function autoModeLabel(mode: string | undefined, idle: number | undefined, time: string | undefined): string {
	if (mode === "idle") return tNow("doctor.autoModeIdle", { idle: idle ?? 30 });
	if (mode === "scheduled") return tNow("doctor.autoModeScheduled", { time: time ?? "23:00" });
	return tNow("doctor.autoModeManual");
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
	const { t } = useT();
	const state = useDoctor((s) => s.bySession[sessionId]);
	const settings = useSettings((s) => s.settings);
	const doctorModel = settings?.doctorModel || "smol";
	const [selectedLenses, setSelectedLenses] = useState<DiagnosticLens[]>(() => presetLenses(state?.lenses));
	const [question, setQuestion] = useState("");
	const lastSession = useRef(sessionId);
	useEffect(() => {
		if (lastSession.current === sessionId) return;
		lastSession.current = sessionId;
		setSelectedLenses(presetLenses(useDoctor.getState().bySession[sessionId]?.lenses));
		setQuestion("");
	}, [sessionId]);
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
	const canStart = !running && (selectedLenses.length > 0 || question.trim().length > 0);

	const start = () => {
		if (!canStart) return;
		void useDoctor.getState().runDiagnosis(sessionId, selectedLenses, question.trim() || undefined);
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
				<div className="mb-2 text-[11.5px] font-medium text-neutral-200">{t("doctor.selectLens")}</div>
				<div className="grid grid-cols-2 gap-1.5">
					{PRESET_LENS_KEYS.map((l) => {
						const active = selectedLenses.includes(l.value);
						return (
							<button
								key={l.value}
								type="button"
								role="checkbox"
								aria-checked={active}
								title={t(l.hintKey)}
								onClick={() =>
									setSelectedLenses((cur) => (cur.includes(l.value) ? cur.filter((x) => x !== l.value) : [...cur, l.value]))
								}
								className={clsx(
									"rounded-lg border px-2 py-1.5 text-left text-[11px] transition-all",
									active
										? "border-[var(--accent)] bg-[var(--accent)]/10 text-neutral-100"
										: "border-[var(--border)] text-neutral-400 hover:bg-[var(--bg-hover)]",
								)}
							>
								<span className="mr-1">{active ? "☑" : "☐"}</span>
								{t(l.labelKey)}
							</button>
						);
					})}
				</div>
				<div className="mt-1.5 text-[10px] text-neutral-500">
					{selectedLenses.map((l) => t(PRESET_LENS_KEYS.find((k) => k.value === l)?.hintKey ?? "")).filter(Boolean).join(" · ")}
				</div>
				<textarea
					value={question}
					onChange={(e) => setQuestion(e.target.value)}
					placeholder={t("doctor.freeformPlaceholder")}
					rows={3}
					className="mt-2 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-2 text-[11px] text-neutral-200 outline-none focus:border-[var(--accent)]"
				/>

				<div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
					<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-400">
						{t("doctor.dehydratedBadge", { tokens: formatTok(skeletonTokens) })}
					</span>
				</div>
				<div className="mt-1 text-[10px] text-neutral-500">
					{t("doctor.skeletonExplanation")}
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
					{running ? t("doctor.diagnosing") : result ? t("doctor.rediagnose") : t("doctor.startDiagnosis")}
				</button>
				<div className="mt-1 text-center text-[10px] text-neutral-500">
					{t("doctor.tokenCostHintPre")}<span className="font-mono text-neutral-400">{doctorModel}</span>{t("doctor.tokenCostHintPost")}
				</div>
			</div>

			{/* Error */}
			{state?.status === "error" && (
				<div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
					<div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-red-400">
						<AlertCircle size={12} /> {t("doctor.diagnosisFailed")}
					</div>
					<pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] text-red-300/90">
						{state.error ?? t("doctor.unknownError")}
					</pre>
					<button
						type="button"
						onClick={start}
						disabled={!canStart}
						className="mt-2 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-[var(--bg-hover)] disabled:opacity-50"
					>
						{t("common.retry")}
					</button>
				</div>
			)}

			{/* Result */}
			{result && (
				<>
					<div className={CARD}>
						<div className="mb-1 flex items-center justify-between">
							<span className="text-[11.5px] font-medium text-neutral-200">{t("doctor.coreConclusion")}</span>
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
							<div className="mb-1 text-[11.5px] font-medium text-neutral-200">{t("doctor.evidence")}</div>
							<ul className="list-disc space-y-1 pl-4 text-[11px] text-neutral-300">
								{result.evidence.map((e, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static list per result
									<li key={i}>{e}</li>
								))}
							</ul>
						</div>
					)}

					<div className={CARD}>
						<div className="mb-1 text-[11.5px] font-medium text-neutral-200">{t("doctor.rootCause")}</div>
						<div className="text-[11px] leading-relaxed text-neutral-300">{result.rootCause}</div>
					</div>

					{result.prescriptions.length > 0 && (
						<div className="space-y-2">
							<div className="px-0.5 text-[11.5px] font-medium text-neutral-200">{t("doctor.promptDraftsTitle")}</div>
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
						<div className="mb-1.5 text-[11.5px] font-medium text-neutral-200">{t("doctor.followUpTitle")}</div>
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
									if (e.key === "Enter" && !e.shiftKey && !isComposing(e)) {
										e.preventDefault();
										sendFollowUp();
									}
								}}
								disabled={running}
								placeholder={running ? t("doctor.followUpPlaceholderRunning") : t("doctor.followUpPlaceholder")}
								className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-[var(--accent)] disabled:opacity-50"
							/>
							<button
								type="button"
								onClick={sendFollowUp}
								disabled={running || !followUp.trim()}
								className="rounded-lg border border-[var(--border)] p-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] disabled:opacity-40"
								title={t("doctor.send")}
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
					{t("doctor.doctorModePrefix")}{autoModeLabel(settings?.doctorAutoMode, settings?.doctorIdleMinutes, settings?.doctorScheduleTime)}
					{t("doctor.modelPrefix")}<span className="font-mono">{doctorModel}</span>
				</span>
				<button
					type="button"
					onClick={() => useUi.getState().openSettings("doctor")}
					className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-neutral-400 hover:bg-[var(--bg-hover)]"
					title={t("doctor.settingsTitle")}
				>
					<SettingsIcon size={11} /> {t("common.settings")}
				</button>
			</div>
		</div>
	);
}

function PrescriptionCard({ sessionId, prescription }: { sessionId: string; prescription: DiagnosticPrescription }) {
	const { t } = useT();
	const [text, setText] = useState(prescription.promptDraft);
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
				<CopyButton
					text={text}
					label={t("common.copy")}
					copiedLabel={t("common.copied")}
					hideIcon
					className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-[var(--bg-hover)]"
				/>
				<button
					type="button"
					onClick={() => {
						const c = useComposer.getState();
						c.setDraft(sessionId, text);
						c.focusComposer(sessionId);
					}}
					className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11px] text-white hover:opacity-90"
				>
					{t("doctor.fillComposer")}
				</button>
			</div>
		</div>
	);
}
