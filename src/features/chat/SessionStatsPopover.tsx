import clsx from "clsx";
import { Gauge, X } from "lucide-react";
import { useRef } from "react";
import { useEscapeKey } from "../../lib/hooks";
import {
	type ComputedSessionStats,
	formatDuration,
	formatTokens,
} from "./sessionStats";

interface SessionStatsPopoverProps {
	stats: ComputedSessionStats;
	open: boolean;
	onClose: () => void;
	className?: string;
}

export function SessionStatsPopover({
	stats,
	open,
	onClose,
	className,
}: SessionStatsPopoverProps) {
	const ref = useRef<HTMLDivElement>(null);

	useEscapeKey(() => {
		if (open) onClose();
	}, open);

	if (!open) return null;

	const ttftStr =
		stats.avgTtftMs > 0
			? stats.avgTtftMs < 1000
				? `${Math.round(stats.avgTtftMs)}ms`
				: `${(stats.avgTtftMs / 1000).toFixed(1)}秒`
			: "—";

	const tpsStr = stats.tps > 0 ? `${stats.tps} tok/s` : "—";

	return (
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 z-40 bg-black/20"
				onMouseDown={(e) => {
					if (e.target === e.currentTarget) {
						onClose();
					}
				}}
			/>

			{/* Floating Stats Card matching dsh (Image 1) */}
			<div
				ref={ref}
				onClick={(e) => e.stopPropagation()}
				className={clsx(
					"absolute z-50 w-72 rounded-xl border border-neutral-700/80 bg-neutral-900/95 p-3.5 shadow-2xl backdrop-blur-md text-neutral-200 select-none",
					className,
				)}
			>
				{/* Header */}
				<div className="mb-3 flex items-center justify-between border-b border-neutral-800 pb-2">
					<div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-100">
						<Gauge size={14} className="text-indigo-400" />
						<span>会话统计</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 transition-colors"
					>
						<X size={12} />
					</button>
				</div>

				{/* Primary metrics (matching Image 1) */}
				<div className="space-y-2 text-xs">
					<div className="flex items-center justify-between">
						<span className="text-neutral-400">模型用时</span>
						<span className="font-mono text-neutral-200">
							{stats.modelDurationMs > 0
								? formatDuration(stats.modelDurationMs)
								: "0秒"}
						</span>
					</div>

					<div className="flex items-center justify-between">
						<span className="text-neutral-400">工具调用用时</span>
						<span className="font-mono text-neutral-200">
							{stats.toolDurationMs > 0
								? formatDuration(stats.toolDurationMs)
								: "0秒"}
						</span>
					</div>

					<div className="flex items-center justify-between">
						<span className="text-neutral-400">首 token 平均 (TTFT)</span>
						<span className="font-mono text-neutral-200">{ttftStr}</span>
					</div>

					<div className="flex items-center justify-between">
						<span className="text-neutral-400">输出速度 (TPS)</span>
						<span className="font-mono text-neutral-200">{tpsStr}</span>
					</div>
				</div>

				{/* Token & cache breakdown */}
				<div className="mt-3 border-t border-neutral-800 pt-2.5 space-y-1.5 text-[11px]">
					<div className="flex items-center justify-between">
						<span className="text-neutral-500">累计 Token:</span>
						<span className="font-mono font-medium text-neutral-200">
							{formatTokens(stats.totalTokens)}
						</span>
					</div>

					<div className="flex items-center justify-between">
						<span className="text-neutral-500">缓存命中率:</span>
						<span
							className={clsx(
								"font-mono font-medium",
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
						<div className="flex items-center justify-between text-neutral-500">
							<span>输入 / 输出:</span>
							<span className="font-mono">
								{formatTokens(stats.inputTokens)} / {formatTokens(stats.outputTokens)}
							</span>
						</div>
					)}

					{stats.cacheRead > 0 && (
						<div className="flex items-center justify-between text-neutral-500">
							<span>缓存读取:</span>
							<span className="font-mono text-emerald-400/90">
								{formatTokens(stats.cacheRead)}
							</span>
						</div>
					)}
				</div>
			</div>
		</>
	);
}
