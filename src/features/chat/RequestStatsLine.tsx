/** [B] Per-request model stats: one dim TUI-style line under the last row of
 * every assistant message, its hover/tap explanation card (field meanings +
 * 等第一个字 / 生成 split), and the whole-turn summary rows of the 「已处理」 area.
 * Values come from omp's own per-request metrics via `requestStats.ts`. */

import clsx from "clsx";
import { useCallback, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { useDisplayPrefs } from "../../stores/displayPrefs";
import {
	REQUEST_STAT_FIELDS,
	aggregateRequestStats,
	formatRequestStat,
	formatStatTokens,
	type RequestStat,
} from "./requestStats";
import { formatDurationCompact } from "./turnGrouping";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 「今天 12:47:23」/「10月17日 12:47:23」/「2025年3月4日 12:47:23」. */
function statDateTime(epochMs: number): string {
	const d = new Date(epochMs);
	const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
	const now = new Date();
	if (
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate()
	) {
		return `今天 ${clock}`;
	}
	const md = `${d.getMonth() + 1}月${d.getDate()}日`;
	const prefix = d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
	return `${prefix} ${clock}`;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Hover / tap plumbing shared by the request card and the turn totals card:
 * a dwell-delayed open, a close that survives the gap between the trigger and
 * the portaled card, and a lazily measured anchor rect.
 */
function useHoverCard() {
	const [open, setOpen] = useState(false);
	const [anchor, setAnchor] = useState<DOMRect | null>(null);
	const openTimer = useRef<number | undefined>(undefined);
	const closeTimer = useRef<number | undefined>(undefined);

	const enter = useCallback((target: HTMLElement) => {
		clearTimeout(closeTimer.current);
		clearTimeout(openTimer.current);
		openTimer.current = window.setTimeout(() => {
			// Measure on open: the row may have scrolled during the dwell.
			setAnchor(target.getBoundingClientRect());
			setOpen(true);
		}, 600);
	}, []);

	// The short close delay lets the pointer travel from the line to the card
	// (a different DOM subtree: the card is portaled) without a flicker.
	const leave = useCallback(() => {
		clearTimeout(openTimer.current);
		closeTimer.current = window.setTimeout(() => {
			setOpen(false);
			setAnchor(null);
		}, 180);
	}, []);

	// Tapping (touch / trackpad click) opens or closes immediately.
	const toggle = useCallback(
		(target: HTMLElement) => {
			if (open) {
				leave();
				return;
			}
			clearTimeout(openTimer.current);
			clearTimeout(closeTimer.current);
			setAnchor(target.getBoundingClientRect());
			setOpen(true);
		},
		[open, leave],
	);

	const enterProps = (e: React.MouseEvent<HTMLElement>) => enter(e.currentTarget);
	const clickProps = (e: React.MouseEvent<HTMLElement>) => toggle(e.currentTarget);

	const cardProps = {
		onMouseEnter: () => clearTimeout(closeTimer.current),
		onMouseLeave: leave,
	};
	return { open, anchor, enterProps, clickProps, cardProps };
}

/** One explained value: label + number, with the Chinese meaning underneath. */
function FieldRow({
	glyph = "",
	label,
	value,
	description,
}: {
	glyph?: string;
	label: string;
	value: string;
	description: string;
}) {
	return (
		<div className="flex flex-col">
			<div className="flex items-baseline justify-between gap-3">
				<span className="min-w-0 text-[12px] text-[var(--text-60)]">
					{glyph && <span className="me-1 text-[var(--text-40)]">{glyph}</span>}
					{label}
				</span>
				<span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-40)]">
					{value}
				</span>
			</div>
			<span className="text-[11px] leading-4 text-[var(--text-30)]">{description}</span>
		</div>
	);
}

/** ttft vs. the rest of the request: where the wall time of one call went. */
function TimeSplit({ stat }: { stat: RequestStat }) {
	const duration = stat.durationMs;
	const known = duration != null && duration > 0;
	const ttft = stat.ttftMs;
	if (!known) return <div className="h-1 w-full rounded-full bg-[var(--line)]" />;
	const wait = Math.max(0, Math.min(duration, ttft ?? 0));
	const gen = Math.max(0, duration - wait);
	return (
		<div>
			<div className="flex h-1 w-full overflow-hidden rounded-full bg-[var(--line)]">
				<span
					className="bg-[var(--text-30)]"
					style={{ width: `${(wait / duration) * 100}%` }}
				/>
				<span className="flex-1 bg-[var(--text-60)]" />
			</div>
			<div className="mt-1 flex justify-between text-[11px] text-[var(--text-30)]">
				<span>等第一个字 {ttft == null ? "—" : seconds(ttft)}</span>
				<span>生成 {seconds(gen)}</span>
			</div>
		</div>
	);
}

/** The explanation card body for one model request. */
function RequestCard({ stat }: { stat: RequestStat }) {
	const fields = useDisplayPrefs((s) => s.requestStatFields);
	const parts = useMemo(() => formatRequestStat(stat, fields), [stat, fields]);
	const when = stat.startedAt ?? stat.completedAt;
	return (
		<div className="flex w-[290px] flex-col gap-1.5 p-3">
			<div className="text-[12px] text-[var(--text-60)]">
				模型请求
				{when != null && (
					<span className="ms-1.5 font-mono text-[11px] tabular-nums text-[var(--text-40)]">
						{statDateTime(when)}
					</span>
				)}
			</div>
			{parts.map((p) => {
				const meta = REQUEST_STAT_FIELDS[p.field];
				return (
					<FieldRow
						key={p.field}
						glyph={meta.glyph}
						label={meta.label}
						value={p.text}
						description={meta.description}
					/>
				);
			})}
			{/* 总耗时 doubles as the bar's denominator, so always explain it. */}
			{!fields.duration && (
				<FieldRow
					glyph={REQUEST_STAT_FIELDS.duration.glyph}
					label="总耗时"
					value={stat.durationMs == null ? "—" : seconds(stat.durationMs)}
					description="这次请求从发出到结束的时间"
				/>
			)}
			<TimeSplit stat={stat} />
		</div>
	);
}

/**
 * One request's stats line: `12:47:23 ↘1.3K ↗774 💾51K ⏱2.2s ⚡71.4/s`.
 * Renders nothing when the setting is off or no field is enabled.
 */
export function RequestStatsLine({
	stat,
	className,
	omitTime,
}: {
	stat: RequestStat;
	/** Extra row classes (indent, spacing) supplied by the owning list. */
	className?: string;
	/** Drop the clock field when a neighbouring row already shows the time
	 * (the answer footer); the hover card still lists it. */
	omitTime?: boolean;
}) {
	const enabled = useDisplayPrefs((s) => s.requestStats);
	const fields = useDisplayPrefs((s) => s.requestStatFields);
	const parts = useMemo(
		() =>
			enabled
				? formatRequestStat(stat, omitTime ? { ...fields, time: false } : fields)
				: [],
		[enabled, stat, fields, omitTime],
	);
	const { open, anchor, enterProps, clickProps, cardProps } = useHoverCard();
	if (parts.length === 0) return null;

	return (
		<>
			<div
				className={clsx(
					"flex w-fit max-w-full flex-wrap items-baseline gap-x-2 font-mono text-[11px] leading-5 tabular-nums",
					className,
				)}
				onMouseEnter={enterProps}
				onMouseLeave={cardProps.onMouseLeave}
				onClick={clickProps}
				role="button"
				tabIndex={0}
				aria-label="查看这次模型请求的统计说明"
			>
				{parts.map((p) => (
					<span
						key={p.field}
						className={
							p.field === "time" ? "text-[var(--text-30)]" : "text-[var(--text-40)]"
						}
					>
						{p.glyph}
						{p.text}
					</span>
				))}
			</div>
			{open && anchor && (
				<FloatingLayer
					anchor={anchor}
					placement="top-start"
					offset={6}
					layer="hovercard"
					{...cardProps}
				>
					<RequestCard stat={stat} />
				</FloatingLayer>
			)}
		</>
	);
}

/**
 * Whole-turn summary shown as the first rows of the expanded 「已处理」 area:
 * duration, request count, total input/output, average speed (and cost when
 * enabled), one label/value pair per row. Plain inline content, no popup.
 */
export function TurnSummaryRows({
	stats,
	durationMs,
}: {
	stats: RequestStat[];
	durationMs?: number;
}) {
	const withCost = useDisplayPrefs((s) => s.requestStatFields.cost);
	const totals = useMemo(() => aggregateRequestStats(stats), [stats]);
	const rows: { label: string; value: string }[] = [];
	if (durationMs) rows.push({ label: "总用时", value: formatDurationCompact(durationMs) });
	if (totals.count > 0) {
		rows.push({ label: "请求次数", value: `${totals.count} 次` });
		rows.push({
			label: "总输入",
			value: `${REQUEST_STAT_FIELDS.input.glyph}${formatStatTokens(totals.input)}`,
		});
		rows.push({
			label: "总输出",
			value: `${REQUEST_STAT_FIELDS.output.glyph}${formatStatTokens(totals.output)}`,
		});
		rows.push({
			label: "缓存命中",
			value: `${REQUEST_STAT_FIELDS.cache.glyph}${formatStatTokens(totals.cacheRead)}`,
		});
		rows.push({
			label: "平均速度",
			value:
				totals.avgTps == null
					? "—"
					: `${REQUEST_STAT_FIELDS.tps.glyph}${totals.avgTps.toFixed(1)}/s`,
		});
		if (withCost) {
			rows.push({
				label: "总费用",
				value: `$${totals.cost.toFixed(totals.cost < 1 ? 3 : 2)}`,
			});
		}
	}
	if (rows.length === 0) return null;
	return (
		<dl className="mb-1 grid w-fit grid-cols-[repeat(3,max-content)] gap-x-5 gap-y-0.5 text-[11px] leading-4">
			{rows.map((r) => (
				<div key={r.label} className="flex items-baseline gap-1.5 whitespace-nowrap">
					<dt className="text-[var(--text-40)]">{r.label}</dt>
					<dd className="m-0 font-mono tabular-nums text-[var(--text-60)]">{r.value}</dd>
				</div>
			))}
		</dl>
	);
}