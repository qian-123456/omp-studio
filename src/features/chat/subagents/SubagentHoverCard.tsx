import type { CSSProperties } from "react";
import { FloatingLayer } from "../../../components/FloatingLayer";
import type { SubagentInfo } from "../../../stores/live";
import { formatTokens } from "../sessionStats";
import { formatShortModel } from "../turnGrouping";
import type { AgentRow } from "./merge";
import {
	type RowState,
	activityText,
	failureReason,
	formatElapsed,
	subagentTitle,
} from "./subagentTree";

const STATE_LABEL: Record<RowState, string> = {
	running: "运行中",
	done: "已完成",
	failed: "已失败",
	waiting: "等待中",
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
		toolCount ? `${toolCount} 次工具` : null,
		tokens ? `${formatTokens(tokens)} tok` : null,
		ctxTokens && ctxWindow ? `上下文 ${Math.round((ctxTokens / ctxWindow) * 100)}%` : null,
	]
		.filter(Boolean)
		.join(" · ");

	const fields: [string, string | undefined, boolean?][] = [
		[state === "running" ? "正在" : state === "failed" ? "原因" : "", state === "failed" ? why : activity.text, state === "failed"],
		["模型", model ? [formatShortModel(model), thinking].filter(Boolean).join(" · ") : undefined],
		["进度", progress || undefined],
		["用时", elapsed === undefined ? undefined : formatElapsed(elapsed)],
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
				<span className={`text-[11px] ${STATE_COLOR[state]}`}>{STATE_LABEL[state]}</span>
				<span className="ml-auto text-[11px] text-[var(--text-60)]">
					{parentName ? `↳ 由 ${parentName} 派发` : "↳ 由主对话派发"}
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
			<div className="mt-2 text-[11px] text-[var(--text-40)]">点击查看完整过程</div>
		</FloatingLayer>
	);
}
