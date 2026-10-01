import clsx from "clsx";
import { Bell, ChevronRight, Cpu, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ToolResultInfo } from "../../lib/contracts";
import { useLive } from "../../stores/live";
import { Markdown } from "./markdown";
import { ToolCard } from "./ToolCard";
import {
	formatDurationChinese,
	noticeBody,
	noticeLabel,
	noticeSummary,
	type TurnStep,
} from "./turnGrouping";

export function ExecutionDisclosure({
	sessionId,
	steps,
	durationMs,
	isStreaming,
	forceExpanded,
	toolResultsByCallId,
}: {
	sessionId: string;
	steps: TurnStep[];
	durationMs?: number;
	isStreaming?: boolean;
	forceExpanded?: boolean | null;
	toolResultsByCallId?: Map<string, ToolResultInfo>;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const expanded = forceExpanded !== null && forceExpanded !== undefined ? forceExpanded : isOpen;

	if (steps.length === 0) {
		return null;
	}

	const onlyThinking = steps.length === 1 && steps[0].kind === "thinking";
	const durationLabel = durationMs ? formatDurationChinese(durationMs) : "";

	let titleText = "";
	if (isStreaming) {
		titleText = `正在处理… · ${steps.length} 步`;
	} else if (onlyThinking) {
		titleText = durationLabel ? `深度思考 · ${durationLabel}` : "深度思考";
	} else {
		titleText = durationLabel
			? `已处理 ${durationLabel} · ${steps.length} 步`
			: `已处理 · ${steps.length} 步`;
	}

	return (
		<div className="my-1.5 flex flex-col items-start text-xs">
			<button
				type="button"
				onClick={() => setIsOpen((prev) => !prev)}
				className={clsx(
					"press-scale group/disc flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-all",
					"hairline bg-[var(--bg-active-fill)] hover:bg-[var(--bg-hover)] text-neutral-400 hover:text-neutral-200",
					isStreaming && "border-indigo-500/30 bg-indigo-500/5 text-indigo-300",
				)}
				title={expanded ? "收起执行步骤" : "展开查看执行步骤与工具调用"}
			>
				{isStreaming ? (
					<Loader2 size={12} className="animate-spin text-indigo-400" />
				) : onlyThinking ? (
					<Sparkles size={12} className="text-amber-400/80" />
				) : (
					<Cpu size={12} className="text-neutral-400 group-hover/disc:text-neutral-200" />
				)}

				<span className="font-medium text-[11px] tracking-tight">{titleText}</span>

				<ChevronRight
					size={12}
					className={clsx(
						"transition-transform duration-200",
						expanded ? "rotate-90 text-neutral-300" : "text-neutral-500",
					)}
				/>
			</button>

			{expanded && (
				<div className="mt-2 w-full max-w-3xl space-y-2 border-l-2 border-neutral-800/80 pl-3 pt-0.5">
					{steps.map((step) => {
						if (step.kind === "thinking") {
							return (
								<div
									key={step.id}
									id={`msg-${step.id}`}
									className="rounded-xl hairline bg-[var(--bg-panel)] p-3 text-neutral-300"
								>
									<div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-amber-400/80">
										<Sparkles size={11} />
										<span>思考过程</span>
									</div>
									<div className="text-[12px] leading-relaxed text-neutral-400 italic">
										<Markdown text={step.thinking} />
									</div>
								</div>
							);
						}

						if (step.kind === "text") {
							return (
								<div
									key={step.id}
									id={`msg-${step.id}`}
									className="rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-[12px] text-neutral-400"
								>
									<Markdown text={step.text} />
								</div>
							);
						}

						if (step.kind === "notice") {
							return (
								<NoticeStep
									key={step.id}
									step={step}
									forceExpanded={forceExpanded}
								/>
							);
						}

						if (step.kind === "tool") {
							const call = step.call;
							const res = step.result ?? toolResultsByCallId?.get(call.id);
							const liveSession = useLive.getState().sessions[sessionId];
							const liveTool = liveSession?.tools?.[call.id];

							const isError = res?.isError === true;
							const status = isError ? "error" : "done";
							const output = res?.text ?? "";

							return (
								<div key={step.id} id={`msg-${step.id}`}>
									<ToolCard
										sessionId={sessionId}
										name={call.name}
										args={call.args}
										status={status}
										output={output}
										details={res?.details}
										expanded={forceExpanded ?? undefined}
										startedAt={liveTool?.startedAt}
										endedAt={liveTool?.endedAt}
									/>
								</div>
							);
						}

						return null;
					})}
				</div>
			)}
		</div>
	);
}

/**
 * Quiet single-line row for a mid-run system notice. Expands to the full
 * notice body only when there is more text than the one-line summary shows.
 */
function NoticeStep({
	step,
	forceExpanded,
}: {
	step: Extract<TurnStep, { kind: "notice" }>;
	forceExpanded?: boolean | null;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const expanded =
		forceExpanded !== null && forceExpanded !== undefined
			? forceExpanded
			: isOpen;

	const label = noticeLabel(step.item);
	const summary = noticeSummary(step.item);
	const body = noticeBody(step.item);
	const expandable = body !== "" && body !== summary;

	const inner = (
		<>
			<Bell size={11} className="shrink-0 text-neutral-500" />
			<span className="shrink-0 font-medium">{label}</span>
			{summary && (
				<span className="truncate text-neutral-500" title={summary}>
					{summary}
				</span>
			)}
			{expandable && (
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 transition-transform duration-200",
						expanded ? "rotate-90 text-neutral-300" : "text-neutral-500",
					)}
				/>
			)}
		</>
	);

	return (
		<div id={`msg-${step.id}`}>
			{expandable ? (
				<button
					type="button"
					onClick={() => setIsOpen((prev) => !prev)}
					className="flex w-full items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-[12px] text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
					title={expanded ? "收起通知详情" : "展开通知详情"}
				>
					{inner}
				</button>
			) : (
				<div className="flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-[12px] text-neutral-400">
					{inner}
				</div>
			)}
			{expandable && expanded && (
				<pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--bg)] hairline px-2.5 py-2 font-mono text-[11px] text-neutral-300">
					{body}
				</pre>
			)}
		</div>
	);
}
