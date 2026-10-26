import type { CSSProperties } from "react";
import { FloatingLayer } from "../../../components/FloatingLayer";
import type { SubagentInfo } from "../../../stores/live";
import { useT } from "../../../stores/language";
import { formatTokens } from "../sessionStats";
import { formatShortModel } from "../turnGrouping";
import type { AgentRow } from "./merge";
import {
	type RowState,
	activityText,
	failureReason,
	formatClockTime,
	formatElapsed,
	subagentTitle,
} from "./subagentTree";

const STATE_LABEL_KEYS: Record<RowState, string> = {
	running: "subagents.runningState",
	done: "subagents.doneState",
	failed: "subagents.failedState",
	waiting: "subagents.waitingState",
};

const STATE_COLOR: Record<RowState, string> = {
	running: "text-[var(--status-info)]",
	done: "text-[var(--status-success)]",
	failed: "text-[var(--status-error)]",
	waiting: "text-[var(--status-warning)]",
};

/** Glass summary card shown beside the panel while a row is hovered. */
export function SubagentHoverCard({
	id,
	info,
	row,
	state,
	elapsed,
	parentName,
	anchor,
}: {
	id: string;
	info: SubagentInfo;
	row: AgentRow | undefined;
	state: RowState;
	elapsed: number | undefined;
	/** Name of the dispatching subagent; undefined = dispatched by the main conversation. */
	parentName: string | undefined;
	anchor: Element;
}) {
	const { t } = useT();
	const task = row?.task ?? info.task ?? info.assignment ?? "";
	const activity = activityText(info, row, state);
	const why = state === "failed" ? failureReason(info, row) : undefined;
	const p = info.progress;
	const model = row?.model ?? p?.resolvedModel;
	const thinking = row?.thinkingLevel ?? p?.resolvedThinkingLevel;
	const toolCount = row?.toolCount ?? p?.toolCount;
	const tokens = row?.tokens ?? p?.tokens;
	const ctxTokens = row?.contextTokens ?? p?.contextTokens;
	const ctxWindow = row?.contextWindow ?? p?.contextWindow;
	const progress = [
		toolCount ? t("subagents.toolCount", { count: toolCount }) : null,
		tokens ? formatTokens(tokens) : null,
		ctxTokens && ctxWindow ? t("subagents.contextUsage", { percent: Math.round((ctxTokens / ctxWindow) * 100) }) : null,
	]
		.filter(Boolean)
		.join(" · ");

	const startClock = formatClockTime(row?.startedAt);
	const endClock = formatClockTime(row?.endedAt);
	const timeField =
		state === "done" && endClock
			? [t("subagents.fieldCompletedAt"), startClock ? `${startClock} - ${endClock}` : endClock]
			: state === "running" && startClock
				? [t("subagents.fieldStartedAt"), startClock]
				: undefined;

	const fields: [string, string | undefined, boolean?][] = [
		[state === "running" ? t("subagents.fieldActive") : state === "failed" ? t("subagents.fieldReason") : "", state === "failed" ? why : activity.text, state === "failed"],
		[t("subagents.fieldModel"), model ? [formatShortModel(model), thinking].filter(Boolean).join(" · ") : undefined],
		[t("subagents.fieldProgress"), progress || undefined],
		[t("subagents.fieldElapsed"), elapsed === undefined || elapsed <= 0 ? undefined : formatElapsed(elapsed)],
		...(timeField ? [timeField as [string, string | undefined, boolean?]] : []),
	];

	return (
		<FloatingLayer
			anchor={anchor}
			placement="left-start"
			offset={10}
			layer="hovercard"
			className="liquid-glass pointer-events-none w-[300px] p-3 text-[12.5px] text-[var(--text)]"
			style={{ "--glass-radius": "18px" } as CSSProperties}
		>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span className="font-semibold">{subagentTitle(id, info, row)}</span>
				{info.agent && (
					<span className="rounded-md bg-[var(--ghost-hover)] px-[5px] text-[10.5px] text-[var(--text-60)]">
						{info.agent}
					</span>
				)}
				{model && (
					<span className="text-[11px] text-[var(--text-40)]">{formatShortModel(model)}</span>
				)}
				<span className={`text-[11px] ${STATE_COLOR[state]}`}>{t(STATE_LABEL_KEYS[state])}</span>
				<span className="ml-auto text-[11px] text-[var(--text-60)]">
					{parentName ? t("subagents.dispatchedByParent", { parent: parentName }) : t("subagents.dispatchedByMain")}
				</span>
			</div>
			{task && (
				<div className="mt-1.5 line-clamp-5 whitespace-pre-wrap break-words text-[var(--text-60)]">
					{task.replace(/^Complete assignment thoroughly:\s*/, "")}
				</div>
			)}
			<dl className="mt-2 grid grid-cols-[44px_1fr] gap-x-2 gap-y-1">
				{fields.map(([k, v, isErr]) =>
					k && v ? (
						<div key={k} className="contents">
							<dt className="text-[var(--text-40)]">{k}</dt>
							<dd className={`m-0 break-words ${isErr ? "text-[var(--status-error)]" : ""}`}>{v}</dd>
						</div>
					) : null,
				)}
			</dl>
			<div className="mt-2 text-[11px] text-[var(--text-40)]">{t("subagents.clickToViewProcess")}</div>
		</FloatingLayer>
	);
}
