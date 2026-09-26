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

	// Ring color based on thresholds (percentage: 0 - 100%)
	const ringColor =
		percentage > 80
			? "stroke-rose-500 text-rose-400"
			: percentage > 50
				? "stroke-amber-500 text-amber-400"
				: percentage > 20
					? "stroke-sky-400 text-sky-400"
					: "stroke-emerald-400 text-emerald-400";

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
				className="group flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800/80 hover:text-neutral-200"
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
							className="stroke-neutral-800"
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
				<span className="font-mono text-[11px] text-neutral-400 group-hover:text-neutral-200">
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
						className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-xl border border-neutral-700/80 bg-neutral-900/95 p-3 shadow-2xl backdrop-blur-md"
					>
						<div className="mb-2.5 flex items-center justify-between border-b border-neutral-800 pb-2">
							<div className="flex items-center gap-1.5 text-xs font-medium text-neutral-200">
								<PieChart size={13} className="text-indigo-400" />
								<span>上下文占用明细</span>
							</div>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
							>
								<X size={12} />
							</button>
						</div>

						<div className="space-y-2.5 text-xs">
							<div>
								<div className="mb-1 flex justify-between text-[11px] text-neutral-400">
									<span>窗口容量占比</span>
									<span className="font-mono font-medium text-neutral-200">
										{percentage.toFixed(1)}%
									</span>
								</div>
								<div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
									<div
										style={{ width: `${Math.min(100, percentage)}%` }}
										className={clsx(
											"h-full rounded-full transition-all duration-300",
											percentage > 80
												? "bg-rose-500"
												: percentage > 50
													? "bg-amber-500"
													: "bg-emerald-500",
										)}
									/>
								</div>
							</div>

							{typeof rawTokens === "number" && typeof rawWindow === "number" ? (
								<div className="space-y-1.5 border-t border-neutral-800/80 pt-2 text-[11px]">
									<div className="flex justify-between">
										<span className="text-neutral-500">已使用 Token:</span>
										<span className="font-mono text-neutral-200">
											{formatTokens(rawTokens)}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-neutral-500">窗口总量上限:</span>
										<span className="font-mono text-neutral-400">
											{formatTokens(rawWindow)}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-neutral-500">剩余可用容量:</span>
										<span className="font-mono text-emerald-400/90">
											{formatTokens(Math.max(0, rawWindow - rawTokens))}
										</span>
									</div>
								</div>
							) : usageObj ? (
								<div className="space-y-1 border-t border-neutral-800/80 pt-2 text-[11px]">
									{Object.entries(usageObj)
										.filter(([k]) => k !== "percent")
										.map(([k, v]) => (
											<div key={k} className="flex justify-between">
												<span className="text-neutral-500">{k}</span>
												<span className="font-mono text-neutral-300">
													{String(v)}
												</span>
											</div>
										))}
								</div>
							) : null}

							{totalTokensStr && (
								<div className="flex justify-between border-t border-neutral-800/80 pt-2 text-[11px]">
									<span className="text-neutral-500">累计 Token:</span>
									<span className="font-mono font-medium text-neutral-200">
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
