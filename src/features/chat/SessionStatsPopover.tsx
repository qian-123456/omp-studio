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
		stats.avgTtftMs > 0
			? stats.avgTtftMs < 1000
				? `${Math.round(stats.avgTtftMs)}ms`
				: `${(stats.avgTtftMs / 1000).toFixed(1)}秒`
			: "—";

	const tpsStr = stats.tps > 0 ? `${stats.tps} tok/s` : "—";

	return (
		<FloatingLayer
			anchor={open ? (anchor ?? null) : null}
			placement="top-start"
			offset={4}
			layer="popover"
			ignoreRefs={ignoreRefs}
			onDismiss={onClose}
			className={clsx(
				"w-72 p-3.5 text-neutral-200 select-none animate-in fade-in zoom-in-95 duration-100",
				className,
			)}
		>
			{/* Header */}
			<div className="mb-3 flex items-center justify-between border-b border-[var(--border-divider)] pb-2">
				<div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-100">
					<Gauge size={14} className="text-[#0A84FF]" />
					<span>会话统计</span>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
				>
					<X size={12} />
				</button>
			</div>

			{/* Primary metrics (matching Image 1) */}
			<div className="space-y-2 text-xs">
				<div className="flex items-center justify-between">
					<span className="text-neutral-400">模型用时</span>
					<span className="font-mono tabular-nums text-neutral-200">
						{stats.modelDurationMs > 0
							? formatDuration(stats.modelDurationMs)
							: "0秒"}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-neutral-400">工具调用用时</span>
					<span className="font-mono tabular-nums text-neutral-200">
						{stats.toolDurationMs > 0
							? formatDuration(stats.toolDurationMs)
							: "0秒"}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-neutral-400">首 token 平均 (TTFT)</span>
					<span className="font-mono tabular-nums text-neutral-200">{ttftStr}</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-neutral-400">输出速度 (TPS)</span>
					<span className="font-mono tabular-nums text-neutral-200">{tpsStr}</span>
				</div>
			</div>

			{/* Token & cache breakdown */}
			<div className="mt-3 border-t border-[var(--border-divider)] pt-2.5 space-y-1.5 text-[11px]">
				<div className="flex items-center justify-between">
					<span className="text-neutral-400">累计 Token:</span>
					<span className="font-mono tabular-nums font-medium text-neutral-200">
						{formatTokens(stats.totalTokens)}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-neutral-400">缓存命中率:</span>
					<span
						className={clsx(
							"font-mono tabular-nums font-medium",
							stats.cacheHitRate > 80
								? "text-emerald-400"
								: stats.cacheHitRate > 40
									? "text-amber-400"
									: "text-neutral-300",
						)}
					>
						{stats.cacheHitRate.toFixed(1)}%
					</span>
				</div>

				{stats.inputTokens > 0 && (
					<div className="flex items-center justify-between text-neutral-400">
						<span>输入 / 输出:</span>
						<span className="font-mono tabular-nums">
							{formatTokens(stats.inputTokens)} / {formatTokens(stats.outputTokens)}
						</span>
					</div>
				)}

				{stats.cacheRead > 0 && (
					<div className="flex items-center justify-between text-neutral-400">
						<span>缓存读取:</span>
						<span className="font-mono tabular-nums text-emerald-400/90">
							{formatTokens(stats.cacheRead)}
						</span>
					</div>
				)}
			</div>
		</FloatingLayer>
	);
}
