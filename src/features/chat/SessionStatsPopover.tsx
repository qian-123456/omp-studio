import clsx from "clsx";
import { Gauge, X } from "lucide-react";
import type { RefObject } from "react";
import { type Anchor, FloatingLayer } from "../../components/FloatingLayer";
import {
	type ComputedSessionStats,
	formatDuration,
	formatTokens,
} from "./sessionStats";
import { useT } from "../../stores/language";

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
	const { t } = useT();
	if (!open) return null;

	const ttftStr =
		stats.avgTtftMs != null && stats.avgTtftMs > 0
			? stats.avgTtftMs < 1000
				? `${Math.round(stats.avgTtftMs)}ms`
				: t("chatView.sessionStats.avgTtftSeconds", { seconds: (stats.avgTtftMs / 1000).toFixed(1) })
			: "—";

	// 「—」when no request of the session recorded a duration.
	const tpsStr = stats.tps != null ? `${stats.tps.toFixed(1)} token/s` : "—";

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
					<span>{t("chatView.sessionStats.title")}</span>
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
					<span className="text-[var(--text-40)]">{t("chatView.sessionStats.modelDuration")}</span>
					<span className="font-mono tabular-nums text-[var(--text)]">
						{stats.modelDurationMs > 0
							? formatDuration(stats.modelDurationMs)
							: t("chatView.sessionStats.durationZero")}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">{t("chatView.sessionStats.toolDuration")}</span>
					<span className="font-mono tabular-nums text-[var(--text)]">
						{stats.toolDurationMs > 0
							? formatDuration(stats.toolDurationMs)
							: t("chatView.sessionStats.durationZero")}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">{t("chatView.sessionStats.avgTtft")}</span>
					<span className="font-mono tabular-nums text-[var(--text)]">{ttftStr}</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">{t("chatView.sessionStats.tps")}</span>
					<span className="font-mono tabular-nums text-[var(--text)]">{tpsStr}</span>
				</div>
			</div>

			{/* Token & cache breakdown */}
			<div className="mt-3 border-t border-[var(--line)] pt-2.5 space-y-1.5 text-[11px]">
				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">{t("chatView.sessionStats.totalTokens")}</span>
					<span className="font-mono tabular-nums font-medium text-[var(--text)]">
						{formatTokens(stats.totalTokens)}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<span className="text-[var(--text-40)]">{t("chatView.sessionStats.cacheHitRate")}</span>
					<span className="font-mono tabular-nums font-medium text-[var(--text)]">
						{stats.cacheHitRate.toFixed(1)}%
					</span>
				</div>

				{stats.inputTokens > 0 && (
					<div className="flex items-center justify-between text-[var(--text-40)]">
						<span>{t("chatView.sessionStats.inputOutput")}</span>
						<span className="font-mono tabular-nums">
							{formatTokens(stats.inputTokens)} / {formatTokens(stats.outputTokens)}
						</span>
					</div>
				)}

				{stats.cacheRead > 0 && (
					<div className="flex items-center justify-between text-[var(--text-40)]">
						<span>{t("chatView.sessionStats.cacheRead")}</span>
						<span className="font-mono tabular-nums text-[var(--text-60)]">
							{formatTokens(stats.cacheRead)}
						</span>
					</div>
				)}
			</div>
		</FloatingLayer>
	);
}
