import { ChevronRight, ClipboardList, Copy, Download, Ellipsis, RotateCcw } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../../../core/api";
import { copyText } from "../../../core/lib/format";
import { usePrefs } from "../../../core/stores/prefs";
import type { ImageRef, Item, ToolItem } from "../../../core/types";
import { Button, IconButton, Markdown, openImage, toast } from "../../../ui";
import { useChat, useChatUi, type ChatUi } from "../ChatContext";
import { foldLabel, type Step, type Turn } from "../lib/turns";
import { StatLine } from "./StatLine";
import { Thinking } from "./Thinking";
import { toolState, ToolCard } from "./ToolCard";
import { useLongPress } from "./useLongPress";

/** Per-turn expand override; survives window paging remounts. */
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
			<span className="inline-flex min-h-9 items-center whitespace-nowrap rounded-m-pill bg-m-surface px-3 text-m-xs text-m-text-2">
				图片 {label}
			</span>
		);
	return (
		<button type="button" onClick={() => openImage(src)} className="block min-h-11 min-w-11 max-w-full overflow-hidden rounded-m-md">
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

const BUBBLE =
	"m-selectable max-w-[85%] whitespace-pre-wrap break-words rounded-[var(--m-bubble-radius)] bg-m-bubble-user-bg px-[18px] py-3 text-m-md leading-6 text-m-bubble-user-text [overflow-wrap:anywhere]";

export const UserBubble = memo(function UserBubble({ item, sessionId }: { item: Item; sessionId: string }) {
	const { openActions } = useChatUi();
	const lp = useLongPress(() => openActions({ role: "user", text: item.text, entryId: item.id, canRetry: false }));
	if (!item.text && !item.images.length) return null;
	return (
		<div className="flex justify-end px-5 pt-4 pb-2">
			<div {...lp} className={BUBBLE}>
				{item.text}
				<Images sessionId={sessionId} images={item.images} />
			</div>
		</div>
	);
});

export const PendingBubble = memo(function PendingBubble({ text, imageUrls }: { text: string; imageUrls: string[] }) {
	return (
		<div className="flex justify-end px-5 pt-4 pb-2">
			<div className={`${BUBBLE} opacity-70`}>
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
			return <Thinking id={step.key} text={step.text} live={false} ms={step.ms} />;
		case "text":
			return (
				<div className="m-selectable py-1">
					<Markdown text={step.text} className="m-md-quiet" />
				</div>
			);
		case "tool":
			return <ToolCard id={step.key} tool={step.tool} state={toolState(step.tool, running)} />;
		case "stat":
			return (
				<div className="-mx-2">
					<StatLine stat={step.stat} onOpen={onStat} />
				</div>
			);
		case "notice":
			return <div className="py-2 text-m-xs text-m-text-3">{step.text}</div>;
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

/**
 * The machine work of a turn as one quiet line (「已运行 6 个步骤 · 57 秒 ›」). Collapsed while running it still
 * shows the current activity (latest tool row or live thinking) under the line.
 */
function ProcessFold({
	turn,
	steps,
	liveThinking,
	liveThinkingActive,
	running,
}: {
	turn: Turn;
	steps: Step[];
	liveThinking: string;
	liveThinkingActive: boolean;
	running: boolean;
}) {
	const { openStat } = useChatUi();
	const foldPref = usePrefs((s) => s.extra.foldOpen === true);
	const [override, setOverride] = useState<boolean | undefined>(foldOverride.get(turn.id));
	const open = override ?? foldPref;
	const live = liveThinking ? <Thinking id={`th-live-${turn.id}`} text={liveThinking} live={liveThinkingActive} /> : null;

	// Only reasoning happened (no tools, no in-between text): thinking lines stand on their own.
	if (steps.every((s) => s.kind === "thinking" || s.kind === "stat")) {
		return (
			<div className="mb-1">
				{steps.map((s) => (s.kind === "thinking" ? <StepView key={s.key} step={s} running={running} onStat={openStat} /> : null))}
				{live}
			</div>
		);
	}

	const current = running && !open ? (liveThinking ? null : [...steps].reverse().find((s) => s.kind === "tool")) : null;
	return (
		<div className="mb-1">
			<button
				type="button"
				onClick={() => {
					foldOverride.set(turn.id, !open);
					setOverride(!open);
				}}
				aria-expanded={open}
				className="-mx-2 inline-flex min-h-11 items-center gap-1 rounded-m-pill px-2 text-left text-m-sm text-m-text-3 active:bg-m-surface-hover"
			>
				<span className={running ? "m-shimmer whitespace-nowrap" : "whitespace-nowrap"}>
					{running ? <RunningLabel turn={turn} /> : foldLabel({ ...turn, steps }, false, 0)}
				</span>
				<ChevronRight
					size={16}
					strokeWidth={1.75}
					aria-hidden
					className={`shrink-0 transition-transform duration-(--m-dur-fast) ${open ? "rotate-90" : ""}`}
				/>
			</button>
			{open && (
				<div className="pb-1">
					{steps.map((s) => (
						<StepView key={s.key} step={s} running={running} onStat={openStat} />
					))}
					{live}
				</div>
			)}
			{!open && running && (live ?? (current && <StepView step={current} running={running} onStat={openStat} />))}
		</div>
	);
}

function PlanCard({ text, sessionId, running }: { text: string; sessionId: string; running: boolean }) {
	const { controller } = useChatUi();
	const [busy, setBusy] = useState(false);

	const execute = async () => {
		setBusy(true);
		try {
			controller.patchState({ planMode: false });
			const ok = await controller.send("/plan-action approve keep", "followUp");
			if (ok) toast("已开始执行计划", { kind: "success" });
		} finally {
			setBusy(false);
		}
	};

	const copy = async () => {
		const ok = await copyText(text);
		toast(ok ? "计划已复制" : "复制失败", { kind: ok ? "success" : "error" });
	};

	const download = () => {
		const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = `plan-${sessionId.slice(0, 8)}.md`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	return (
		<div className="mt-4 rounded-m-lg bg-m-surface p-4" data-no-longpress>
			<div className="flex items-center gap-3">
				<ClipboardList size={22} strokeWidth={1.75} aria-hidden className="shrink-0 text-m-text-2" />
				<div className="min-w-0 flex-1">
					<div className="text-m-md font-medium">计划已生成</div>
					<div className="text-m-xs text-m-text-3">执行，或继续补充要求后再生成</div>
				</div>
				<IconButton size="sm" icon={<Copy size={20} strokeWidth={1.75} />} label="复制计划" onClick={() => void copy()} />
				<IconButton size="sm" icon={<Download size={20} strokeWidth={1.75} />} label="下载 .md 文件" onClick={download} />
			</div>
			<div className="mt-4 flex gap-2">
				<Button variant="tonal" className="flex-1" disabled={running || busy} onClick={() => controller.focusComposer()}>
					修改计划
				</Button>
				<Button variant="primary" className="flex-1" busy={busy} disabled={running} onClick={() => void execute()}>
					执行计划
				</Button>
			</div>
		</div>
	);
}

export const TurnView = memo(function TurnView({ turn, isLast, sessionId }: { turn: Turn; isLast: boolean; sessionId: string }) {
	const { openActions, openStat, controller } = useChatUi();
	const live = useChat((s) => (isLast ? s.live : null));
	const working = useChat((s) => (isLast ? s.working : false));
	const planMode = useChat((s) => (isLast ? s.cstate?.planMode === true : false));
	const running = isLast && working;
	const parts = useMemo(() => mergeLive(turn, live), [turn, live]);
	// The previous answer row becomes a step once a newer message streams text.
	const steps = useMemo(() => {
		if (parts.liveText && turn.answer) {
			return [...parts.steps, { kind: "text", key: `tx-${turn.answer.id}`, text: turn.answer.text } as Step];
		}
		return parts.steps;
	}, [parts, turn.answer]);
	const answerText = parts.liveText || turn.answer?.text || "";
	const answerStat = parts.liveText ? null : turn.answerStat;
	const target = { role: "assistant" as const, text: answerText, entryId: turn.lastAssistantId, canRetry: isLast && !running };
	const lp = useLongPress(() => {
		if (answerText) openActions(target);
	});
	const nothingYet = running && !steps.length && !answerText && !parts.liveThinking;
	const hasProcess = steps.some((s) => s.kind !== "stat") || !!parts.liveThinking;

	const copyAnswer = async () => {
		const ok = await copyText(answerText);
		toast(ok ? "已复制" : "复制失败", { kind: ok ? "success" : "error" });
	};

	return (
		<div>
			{turn.user && <UserBubble item={turn.user} sessionId={sessionId} />}
			{(hasProcess || answerText || nothingYet) && (
				<div className="px-5 pt-2 pb-3">
					{hasProcess && (
						<ProcessFold
							turn={turn}
							steps={steps}
							liveThinking={parts.liveThinking}
							liveThinkingActive={running && !parts.liveText}
							running={running}
						/>
					)}
					{answerText && (
						<div className="m-selectable" {...lp}>
							<Markdown text={answerText} className="m-msg" streaming={!!parts.liveText && running} />
							{turn.answer && !parts.liveText && <Images sessionId={sessionId} images={turn.answer.images} />}
						</div>
					)}
					{nothingYet && (
						<div className="flex min-h-11 items-center text-m-sm" aria-label="正在回复">
							<span className="m-shimmer">思考中</span>
						</div>
					)}
					{planMode && answerText && !parts.liveText && <PlanCard text={answerText} sessionId={sessionId} running={running} />}
					{answerText && !running && (
						<div className="-ml-3 mt-1 flex flex-wrap items-center">
							<IconButton
								size="sm"
								icon={<Copy size={18} strokeWidth={1.75} className="text-m-text-3" />}
								label="复制"
								onClick={() => void copyAnswer()}
							/>
							{isLast && (
								<IconButton
									size="sm"
									icon={<RotateCcw size={18} strokeWidth={1.75} className="text-m-text-3" />}
									label="重新生成"
									onClick={() => controller.retry()}
								/>
							)}
							<IconButton
								size="sm"
								icon={<Ellipsis size={18} strokeWidth={1.75} className="text-m-text-3" />}
								label="更多操作"
								onClick={() => openActions(target)}
							/>
							{answerStat && <StatLine stat={answerStat.stat} onOpen={openStat} />}
						</div>
					)}
				</div>
			)}
		</div>
	);
});
