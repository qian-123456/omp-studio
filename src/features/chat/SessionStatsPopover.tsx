import clsx from "clsx";
import { Gauge, X } from "lucide-react";
import type { RefObject } from "react";
import { type Anchor, FloatingLayer } from "../../components/FloatingLayer";
import {
	type ComputedSessionStats,
	formatDuration,
	formatTokens,
} from "./sessionStats";

export interface SessionStatsPopoverProps {
	anchor?: Anchor | null;
	stats: ComputedSessionStats;
	open: boolean;
	onClose: () => void;
	ignoreRefs?: RefObject<HTMLElement | null>[];
	className?: string;
}

export function SessionStatsPopover({
	anchor,
	stats,
	open,
	onClose,
	ignoreRefs,
	className,
}: SessionStatsPopoverProps) {
	if (!open) return null;

	const ttftStr =
		stats.avgTtftMs != null && stats.avgTtftMs > 0
			? stats.avgTtftMs < 1000
				? `${Math.round(stats.avgTtftMs)}ms`
				: `${(stats.avgTtftMs / 1000).toFixed(1)}秒`
			: "—";

	// 「—」when no request of the session recorded a duration.
	const tpsStr = stats.tps != null ? `${stats.tps.toFixed(1)} tok/s` : "—";

	return (
		<FloatingLayer
			anchor={open ? (anchor ?? null) : null}
			placement="top-start"
			offset={4}
			layer="popover"
			ignoreRefs={ignoreRefs}
			onDismiss={onClose}
			className={clsx(
				"w-72 p-3.5 text-[var(--text)] select-none animate-in fade-in zoom-in-95 duration-100",
				className,
			)}
		>
			{/* Header */}
			<div className="mb-3 flex items-center justify-between border-b border-[var(--line)] pb-2">
				<div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
					<Gauge size={14} className="text-[var(--text-60)]" />
					<span>会话统计</span>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md p-1 text-[var(--text-40)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] active:scale-95 transition-all"
				>
					<X size={12} />
				</button>
			</div>

			{/* Primary metrics (matching Image 1) */}
			<div className="space-y-2 text-xs">
				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">模型用时</span>
					<span className="font-mono tabular-nums text-[var(--text)]">
						{stats.modelDurationMs > 0
							? formatDuration(stats.modelDurationMs)
							: "0秒"}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">工具调用用时</span>
					<span className="font-mono tabular-nums text-[var(--text)]">
						{stats.toolDurationMs > 0
							? formatDuration(stats.toolDurationMs)
							: "0秒"}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">首 token 平均 (TTFT)</span>
					<span className="font-mono tabular-nums text-[var(--text)]">{ttftStr}</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">输出速度 (TPS)</span>
					<span className="font-mono tabular-nums text-[var(--text)]">{tpsStr}</span>
				</div>
			</div>

			{/* Token & cache breakdown */}
			<div className="mt-3 border-t border-[var(--line)] pt-2.5 space-y-1.5 text-[11px]">
				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">累计 Token:</span>
					<span className="font-mono tabular-nums font-medium text-[var(--text)]">
						{formatTokens(stats.totalTokens)}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">缓存命中率:</span>
					<span className="font-mono tabular-nums font-medium text-[var(--text)]">
						{stats.cacheHitRate.toFixed(1)}%
					</span>
				</div>

				{stats.inputTokens > 0 && (
					<div className="flex items-center justify-between text-[var(--text-40)]">
						<span>输入 / 输出:</span>
						<span className="font-mono tabular-nums">
							{formatTokens(stats.inputTokens)} / {formatTokens(stats.outputTokens)}
						</span>
					</div>
				)}

				{stats.cacheRead > 0 && (
					<div className="flex items-center justify-between text-[var(--text-40)]">
						<span>缓存读取:</span>
						<span className="font-mono tabular-nums text-[var(--text-60)]">
							{formatTokens(stats.cacheRead)}
						</span>
					</div>
				)}
			</div>
		</FloatingLayer>
	);
}
