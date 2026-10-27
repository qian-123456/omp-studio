import { Check, ChevronRight, Copy, Download, Edit3, Ellipsis, Lightbulb } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../../../core/api";
import type { ImageRef, Item, ToolItem } from "../../../core/types";
import { Markdown, openImage, Spinner, toast } from "../../../ui";
import { useChat, useChatUi, type ChatUi } from "../ChatContext";
import { usePrefs } from "../../../core/stores/prefs";
import { foldLabel, type Step, type Turn } from "../lib/turns";
import { StatLine } from "./StatLine";
import { Thinking } from "./Thinking";
import { toolState, ToolCard } from "./ToolCard";
import { useLongPress } from "./useLongPress";

const foldOverride = new Map<string, boolean>();

/** 1 s ticker, mounted only while a turn is running. */
function RunningLabel({ turn }: { turn: Turn }) {
	const [first] = useState(() => Date.now());
	const [now, setNow] = useState(first);
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, []);
	return <>{foldLabel({ ...turn, start: turn.start || first }, true, now)}</>;
}

export function imageSrc(sessionId: string, img: ImageRef): string {
	return img.path ? apiUrl(`/sessions/${sessionId}/image?path=${encodeURIComponent(img.path)}`) : "";
}

function ImageThumb({ src, label }: { src: string; label: string }) {
	const [bad, setBad] = useState(!src);
	if (bad)
		return (
			<span className="inline-flex min-h-9 items-center whitespace-nowrap rounded-m-pill border border-m-border px-3 text-m-xs text-m-text-2">
				图片 {label}
			</span>
		);
	return (
		<button type="button" onClick={() => openImage(src)} className="block overflow-hidden rounded-m-md border border-m-border">
			<img src={src} alt={label} loading="lazy" onError={() => setBad(true)} className="max-h-48 max-w-full object-cover" />
		</button>
	);
}

export function Images({ sessionId, images }: { sessionId: string; images: readonly ImageRef[] }) {
	if (!images.length) return null;
	return (
		<div className="mt-2 flex flex-wrap gap-2" data-no-longpress>
			{images.map((img, i) => (
				<ImageThumb key={img.id || i} src={imageSrc(sessionId, img)} label={`#${i + 1}`} />
			))}
		</div>
	);
}

export const UserBubble = memo(function UserBubble({ item, sessionId }: { item: Item; sessionId: string }) {
	const { openActions } = useChatUi();
	const lp = useLongPress(() => openActions({ role: "user", text: item.text, entryId: item.id, canRetry: false }));
	if (!item.text && !item.images.length) return null;
	return (
		<div className="flex justify-end px-4 py-2">
			<div
				{...lp}
				className="m-msg m-selectable max-w-[85%] select-text whitespace-pre-wrap rounded-[var(--m-bubble-radius,20px)] bg-m-bubble-user-bg px-4 py-2.5 text-m-bubble-user-text"
			>
				{item.text}
				<Images sessionId={sessionId} images={item.images} />
			</div>
		</div>
	);
});

export const PendingBubble = memo(function PendingBubble({ text, imageUrls }: { text: string; imageUrls: string[] }) {
	return (
		<div className="flex justify-end px-4 py-2">
			<div className="m-msg max-w-[85%] whitespace-pre-wrap rounded-[var(--m-bubble-radius,20px)] bg-m-bubble-user-bg px-4 py-2.5 text-m-bubble-user-text opacity-70">
				{text}
				{imageUrls.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-2">
						{imageUrls.map((u) => (
							<img key={u} src={u} alt="" className="max-h-32 rounded-m-sm" />
						))}
					</div>
				)}
			</div>
		</div>
	);
});

function StepView({ step, running, onStat }: { step: Step; running: boolean; onStat: ChatUi["openStat"] }) {
	switch (step.kind) {
		case "thinking":
			return <Thinking id={step.key} text={step.text} live={false} />;
		case "text":
			return <Markdown text={step.text} className="m-msg my-1.5" />;
		case "tool":
			return <ToolCard id={step.key} tool={step.tool} state={toolState(step.tool, running)} />;
		case "stat":
			return <StatLine stat={step.stat} onOpen={onStat} />;
		case "notice":
			return <div className="my-1 text-center text-m-xs text-m-text-3">{step.text}</div>;
	}
}

interface LiveParts {
	steps: Step[];
	liveText: string;
	liveThinking: string;
}

/** Persisted steps + the live row: unresolved persisted tools take the live status; new live tools append. */
export function mergeLive(turn: Turn, live: Item | null): LiveParts {
	if (!live) return { steps: turn.steps, liveText: "", liveThinking: "" };
	const liveById = new Map<string, ToolItem>();
	for (const t of live.tools) liveById.set(t.id, t);
	const seen = new Set<string>();
	const steps: Step[] = turn.steps.map((s) => {
		if (s.kind !== "tool") return s;
		seen.add(s.tool.id);
		const lt = liveById.get(s.tool.id);
		return lt && s.tool.status === "running" && lt.status !== "running" ? { ...s, tool: lt } : s;
	});
	for (const t of live.tools) if (!seen.has(t.id)) steps.push({ kind: "tool", key: `tc-${t.id}`, tool: t });
	return { steps, liveText: live.text, liveThinking: live.thinking };
}

export const TurnView = memo(function TurnView({ turn, isLast, sessionId }: { turn: Turn; isLast: boolean; sessionId: string }) {
	const { openActions, openStat, controller } = useChatUi();
	const live = useChat((s) => (isLast ? s.live : null));
	const working = useChat((s) => (isLast ? s.working : false));
	const cstate = useChat((s) => s.cstate);
	const foldPref = usePrefs((s) => s.extra.foldOpen === true);
	const running = isLast && working;
	const parts = useMemo(() => mergeLive(turn, live), [turn, live]);
	// The previous answer row becomes a step once a newer message streams text.
	const steps = useMemo(() => {
		if (parts.liveText && turn.answer) {
			return [...parts.steps, { kind: "text", key: `tx-${turn.answer.id}`, text: turn.answer.text } as Step];
		}
		return parts.steps;
	}, [parts, turn.answer]);
	const [open, setOpen] = useState<boolean | undefined>(foldOverride.get(turn.id));
	const folded = open ?? (running || foldPref);
	const answerText = parts.liveText || turn.answer?.text || "";
	const answerStat = parts.liveText ? null : turn.answerStat;
	const lp = useLongPress(() => {
		if (answerText) openActions({ role: "assistant", text: answerText, entryId: turn.lastAssistantId, canRetry: isLast && !running });
	});
	const visibleSteps = steps.filter((s) => s.kind !== "stat");
	const nothingYet = running && !steps.length && !answerText && !parts.liveThinking;
	const showPlanCard = isLast && answerText && cstate?.planMode;

	const executePlan = async () => {
		try {
			await controller.patchState({ planMode: false });
			await controller.send("计划已确认。请按照上面的计划开始执行。", "followUp");
			toast("已确认并开始执行计划", { kind: "success" });
		} catch {
			toast("执行计划失败", { kind: "error" });
		}
	};

	const editPlan = () => {
		controller.focusComposer();
	};

	const copyPlan = async () => {
		try {
			await navigator.clipboard.writeText(answerText);
			toast("计划已复制到剪贴板", { kind: "success" });
		} catch {
			toast("复制失败", { kind: "error" });
		}
	};

	const downloadPlan = () => {
		try {
			const blob = new Blob([answerText], { type: "text/markdown;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `plan-${sessionId.slice(0, 8)}.md`;
			a.click();
			URL.revokeObjectURL(url);
			toast("计划已下载", { kind: "success" });
		} catch {
			toast("下载失败", { kind: "error" });
		}
	};

	return (
		<div>
			{turn.user && <UserBubble item={turn.user} sessionId={sessionId} />}
			{(steps.length > 0 || answerText || parts.liveThinking || nothingYet) && (
				<div className="px-4 py-2" {...lp}>
					{(steps.length > 0 || parts.liveThinking) && (
						<div className="mb-1">
							<button
								type="button"
								onClick={() => {
									foldOverride.set(turn.id, !folded);
									setOpen(!folded);
								}}
								aria-expanded={folded}
								className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-m-pill bg-m-surface px-3 text-m-xs text-m-text-2 active:bg-m-surface-hover"
							>
								<ChevronRight size={14} className={`transition-transform ${folded ? "rotate-90" : ""}`} />
								{running && <Spinner size={12} />}
								{running ? <RunningLabel turn={turn} /> : foldLabel({ ...turn, steps: visibleSteps }, false, 0)}
							</button>
							{folded && (
								<div className="mt-1 border-l border-m-border pl-3">
									{steps.map((s) => (
										<StepView key={s.key} step={s} running={running} onStat={openStat} />
									))}
									{parts.liveThinking && <Thinking id="th-live" text={parts.liveThinking} live={!parts.liveText} />}
								</div>
							)}
						</div>
					)}
					{answerText && (
						<div className="m-selectable">
							<Markdown text={answerText} className="m-msg" streaming={!!parts.liveText && running} />
						</div>
					)}
					{answerStat && <StatLine stat={answerStat.stat} onOpen={openStat} />}
					{nothingYet && (
						<div className="m-dots py-2" aria-label="正在回复">
							<i />
							<i />
							<i />
						</div>
					)}
					{showPlanCard && (
						<div className="mt-3 rounded-m-md border border-amber-500/30 bg-amber-500/5 p-3">
							<div className="mb-2 flex items-center justify-between">
								<span className="flex items-center gap-1.5 text-m-xs font-semibold text-amber-500">
									<Lightbulb size={14} />
									规划模式 · 生成的计划
								</span>
								<div className="flex items-center gap-1">
									<button
										type="button"
										aria-label="复制计划"
										onClick={() => void copyPlan()}
										className="flex h-8 items-center gap-1 rounded-m-pill border border-m-border bg-m-surface px-2.5 text-m-xs text-m-text-2 active:bg-m-surface-hover"
									>
										<Copy size={12} />
										复制
									</button>
									<button
										type="button"
										aria-label="下载计划"
										onClick={downloadPlan}
										className="flex h-8 items-center gap-1 rounded-m-pill border border-m-border bg-m-surface px-2.5 text-m-xs text-m-text-2 active:bg-m-surface-hover"
									>
										<Download size={12} />
										下载
									</button>
								</div>
							</div>
							<div className="flex items-center gap-2 pt-1">
								<button
									type="button"
									disabled={running}
									onClick={() => void executePlan()}
									className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-m-pill bg-m-accent px-4 text-m-sm font-medium text-m-accent-text active:opacity-80 disabled:opacity-50"
								>
									<Check size={16} />
									执行计划
								</button>
								<button
									type="button"
									disabled={running}
									onClick={editPlan}
									className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-m-pill border border-m-border bg-m-surface px-4 text-m-sm font-medium text-m-text active:bg-m-surface-hover disabled:opacity-50"
								>
									<Edit3 size={16} />
									修改计划
								</button>
							</div>
						</div>
					)}
					{answerText && !running && (
						<div className="mt-1 flex justify-end">
							<button
								type="button"
								aria-label="消息操作"
								onClick={() => openActions({ role: "assistant", text: answerText, entryId: turn.lastAssistantId, canRetry: isLast })}
								className="flex min-h-9 min-w-11 items-center justify-center rounded-m-pill border border-m-border text-m-text-3 active:bg-m-surface-hover"
							>
								<Ellipsis size={16} />
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
});
