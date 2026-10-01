import clsx from "clsx";
import { PieChart, X } from "lucide-react";
import { useRef, useState } from "react";
import { useEscapeKey } from "../../lib/hooks";
import { formatTokens } from "./sessionStats";

interface ContextRingProps {
	/** Context percentage, typically 0.0 to 1.0 (can exceed 1.0 if overloaded). */
	percent?: number;
	/** Raw context usage object from OMP state. */
	usageObj?: Record<string, unknown> | null;
	/** Optional formatted usage string (e.g. "44.8k tok"). */
	totalTokensStr?: string | null;
	className?: string;
}

export function ContextRing({
	percent,
	usageObj,
	totalTokensStr,
	className,
}: ContextRingProps) {
	const [open, setOpen] = useState(false);
	const popoverRef = useRef<HTMLDivElement>(null);

	useEscapeKey(() => {
		if (open) setOpen(false);
	}, open);

	// Determine normalized fraction (0.0 to 1.0) and display percentage (0 to 100)
	let fraction = 0;
	let percentage = 0;

	const rawTokens =
		usageObj && typeof usageObj.tokens === "number" ? usageObj.tokens : undefined;
	const rawWindow =
		usageObj && typeof usageObj.contextWindow === "number"
			? usageObj.contextWindow
			: undefined;

	if (typeof rawTokens === "number" && typeof rawWindow === "number" && rawWindow > 0) {
		fraction = Math.max(0, rawTokens / rawWindow);
		percentage = fraction * 100;
	} else if (typeof percent === "number" && !Number.isNaN(percent)) {
		// OMP reports percent as 0..100 (e.g. 8.55 for 8.55%).
		percentage = Math.max(0, percent);
		fraction = percentage / 100;
	}

	const pctInt = Math.round(percentage);

	// Ring colour: neutral --text-60 normally; status hues only near limits.
	const ringColor =
		percentage >= 85
			? "stroke-[var(--status-error)]"
			: percentage >= 70
				? "stroke-[var(--status-warning)]"
				: "stroke-[var(--text-60)]";
	const barColor =
		percentage >= 85
			? "bg-[var(--status-error)]"
			: percentage >= 70
				? "bg-[var(--status-warning)]"
				: "bg-[var(--text-60)]";

	// SVG circle parameters
	const size = 18;
	const strokeWidth = 2;
	const center = size / 2;
	const radius = center - strokeWidth;
	const circumference = 2 * Math.PI * radius;
	const strokeDashoffset = circumference * (1 - Math.min(1, fraction));

	return (
		<div className={clsx("relative inline-flex items-center", className)}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				title={`上下文占用: ${pctInt}%${totalTokensStr ? ` (${totalTokensStr})` : ""}`}
				className="group flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[11px] text-[var(--text-40)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
			>
				{/* Circular Progress Ring */}
				<div className="relative flex h-[18px] w-[18px] items-center justify-center">
					<svg
						width={size}
						height={size}
						viewBox={`0 0 ${size} ${size}`}
						className="shrink-0 -rotate-90"
					>
						{/* Background Track */}
						<circle
							cx={center}
							cy={center}
							r={radius}
							fill="none"
							strokeWidth={strokeWidth}
							className="stroke-[var(--bg-selected)]"
						/>
						{/* Progress Arc */}
						<circle
							cx={center}
							cy={center}
							r={radius}
							fill="none"
							strokeWidth={strokeWidth}
							strokeDasharray={circumference}
							strokeDashoffset={strokeDashoffset}
							strokeLinecap="round"
							className={clsx("transition-all duration-300", ringColor)}
						/>
					</svg>
				</div>
				<span className="font-mono text-[11px] text-[var(--text-40)] group-hover:text-[var(--text)]">
					{pctInt}%
				</span>
			</button>

			{/* Detail Popover */}
			{open && (
				<>
					<div
						className="fixed inset-0 z-30"
						onMouseDown={(e) => {
							if (e.target === e.currentTarget) {
								setOpen(false);
							}
						}}
					/>
					<div
						ref={popoverRef}
						onClick={(e) => e.stopPropagation()}
						className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-3 shadow-apple-card"
					>
						<div className="mb-2.5 flex items-center justify-between border-b border-[var(--line)] pb-2">
							<div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text)]">
								<PieChart size={13} className="text-[var(--text-60)]" />
								<span>上下文占用明细</span>
							</div>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="rounded-md p-1 text-[var(--text-40)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
							>
								<X size={12} />
							</button>
						</div>

						<div className="space-y-2.5 text-xs">
							<div>
								<div className="mb-1 flex justify-between text-[11px] text-[var(--text-40)]">
									<span>窗口容量占比</span>
									<span className="font-mono font-medium text-[var(--text)]">
										{percentage.toFixed(1)}%
									</span>
								</div>
								<div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-selected)]">
									<div
										style={{ width: `${Math.min(100, percentage)}%` }}
										className={clsx(
											"h-full rounded-full transition-all duration-300",
											barColor,
										)}
									/>
								</div>
							</div>

							{typeof rawTokens === "number" && typeof rawWindow === "number" ? (
								<div className="space-y-1.5 border-t border-[var(--line)] pt-2 text-[11px]">
									<div className="flex justify-between">
										<span className="text-[var(--text-40)]">已使用 Token:</span>
										<span className="font-mono text-[var(--text)]">
											{formatTokens(rawTokens)}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-[var(--text-40)]">窗口总量上限:</span>
										<span className="font-mono text-[var(--text-60)]">
											{formatTokens(rawWindow)}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-[var(--text-40)]">剩余可用容量:</span>
										<span className="font-mono text-[var(--text-60)]">
											{formatTokens(Math.max(0, rawWindow - rawTokens))}
										</span>
									</div>
								</div>
							) : usageObj ? (
								<div className="space-y-1 border-t border-[var(--line)] pt-2 text-[11px]">
									{Object.entries(usageObj)
										.filter(([k]) => k !== "percent")
										.map(([k, v]) => (
											<div key={k} className="flex justify-between">
												<span className="text-[var(--text-40)]">{k}</span>
												<span className="font-mono text-[var(--text-60)]">
													{String(v)}
												</span>
											</div>
										))}
								</div>
							) : null}

							{totalTokensStr && (
								<div className="flex justify-between border-t border-[var(--line)] pt-2 text-[11px]">
									<span className="text-[var(--text-40)]">累计 Token:</span>
									<span className="font-mono font-medium text-[var(--text)]">
										{totalTokensStr}
									</span>
								</div>
							)}
						</div>
					</div>
				</>
			)}
		</div>
	);
}
