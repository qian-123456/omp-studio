import { ChevronRight, Ellipsis } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../../../core/api";
import type { ImageRef, Item, ToolItem } from "../../../core/types";
import { Markdown, openImage, Spinner } from "../../../ui";
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
	const { openActions, openStat } = useChatUi();
	const live = useChat((s) => (isLast ? s.live : null));
	const working = useChat((s) => (isLast ? s.working : false));
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
