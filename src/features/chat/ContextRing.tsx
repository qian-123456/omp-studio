import clsx from "clsx";
import { ArchiveRestore, Layers, Loader2, PieChart, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { PromptComposition } from "../../lib/contracts";
import { promptCompositionProbe } from "../../lib/ipc";
import { openPromptComposition } from "../../stores/promptComposition";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { allocateCells, buildContextSegments } from "./contextBreakdown";

const GRID_COLS = 20;
const GRID_ROWS = 5;

/** One probe per project for the app's lifetime; concurrent opens share the in-flight request. */
const compositionCache = new Map<string, Promise<PromptComposition>>();
function loadComposition(cwd: string): Promise<PromptComposition> {
	let p = compositionCache.get(cwd);
	if (!p) {
		p = promptCompositionProbe(cwd);
		compositionCache.set(cwd, p);
		p.catch(() => compositionCache.delete(cwd));
	}
	return p;
}

/** 78012 -> "78.0k", 1_000_000 -> "1.0M". */
function compactTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

interface ContextRingProps {
	/** Context percentage, typically 0.0 to 1.0 (can exceed 1.0 if overloaded). */
	percent?: number;
	/** Raw context usage object from OMP state. */
	usageObj?: Record<string, unknown> | null;
	/** Optional formatted usage string (e.g. "44.8k token"). */
	totalTokensStr?: string | null;
	onCompact?: () => Promise<void>;
	/** Disables the compact button (e.g. while a turn is streaming). */
	compactDisabled?: boolean;
	/** A compaction is running for this session (shared state, survives popover close). */
	compacting?: boolean;
	/** Controlled open state; falls back to internal state when undefined. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	className?: string;
	/** Show the 「53%」 text beside the ring (default); false = ring only, % stays in the tooltip. */
	showPercent?: boolean;
}

export function ContextRing({
	percent,
	usageObj,
	totalTokensStr,
	onCompact,
	compactDisabled,
	compacting = false,
	open: openProp,
	onOpenChange,
	className,
	showPercent = true,
}: ContextRingProps) {
	const [openInner, setOpenInner] = useState(false);
	const open = openProp ?? openInner;
	const setOpen = (v: boolean | ((p: boolean) => boolean)) =>
		onOpenChange ? onOpenChange(typeof v === "function" ? v(open) : v) : setOpenInner(v);
	const btnRef = useRef<HTMLButtonElement>(null);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const sessionCwd = useSessions((s) => (selectedSessionId ? (s.sessions[selectedSessionId]?.cwd ?? null) : null));


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

	// Claude Code style breakdown: probe the fixed prompt parts once per project, the rest is messages.
	const [probe, setProbe] = useState<PromptComposition | null>(null);
	const [probeState, setProbeState] = useState<"idle" | "loading" | "error">("idle");
	useEffect(() => {
		if (!open || !sessionCwd) return;
		let alive = true;
		setProbeState("loading");
		loadComposition(sessionCwd)
			.then((c) => {
				if (!alive) return;
				setProbe(c);
				setProbeState("idle");
			})
			.catch(() => {
				if (!alive) return;
				setProbe(null);
				setProbeState("error");
			});
		return () => {
			alive = false;
		};
	}, [open, sessionCwd]);
	const segments = buildContextSegments(rawTokens ?? 0, rawWindow ?? 0, probe);
	const segmentColor = new Map(segments.map((s) => [s.id, s.color]));
	const cells = allocateCells(segments, rawWindow ?? 0, GRID_COLS * GRID_ROWS);
	const strokeDashoffset = circumference * (1 - Math.min(1, fraction));

	return (
		<div className={clsx("relative inline-flex items-center", className)}>
			<button
				ref={btnRef}
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
				{showPercent && (
					<span className="font-mono text-[11px] text-[var(--text-40)] group-hover:text-[var(--text)]">
						{pctInt}%
					</span>
				)}
			</button>

			{/* Detail Popover */}
			{open && (
					<FloatingLayer
						anchor={btnRef.current}
						placement="top-start"
						offset={8}
						layer="popover"
						ignoreRefs={[btnRef]}
						onDismiss={() => setOpen(false)}
						style={{
							// --bg-panel is translucent in glass themes; layer it over solid --bg so nothing behind shows through.
							backgroundColor: "var(--bg)",
							backgroundImage: "linear-gradient(var(--bg-panel), var(--bg-panel))",
						}}
						className="w-72 !border-[var(--line)] p-3 !shadow-apple-card"
					>
						<div className="mb-2.5 flex items-center justify-between border-b border-[var(--line)] pb-2">
							<div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text)]">
								<PieChart size={13} className="text-[var(--text-60)]" />
								<span>上下文占用明细</span>
							</div>
							<div className="flex items-center gap-1">
								{onCompact && (
									<button
										type="button"
										disabled={compacting || compactDisabled}
										title={compactDisabled ? "回合进行中，暂不能压缩" : "压缩上下文"}
										onClick={() => void onCompact()}
										className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
									>
										{compacting ? (
											<Loader2 size={12} className="animate-spin" />
										) : (
											<ArchiveRestore size={12} />
										)}
										<span>{compacting ? "压缩中" : "压缩"}</span>
									</button>
								)}
								<button
									type="button"
									onClick={() => setOpen(false)}
									className="rounded-md p-1 text-[var(--text-40)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
								>
									<X size={12} />
								</button>
							</div>
						</div>

						<div className="space-y-2.5 text-xs">
							{typeof rawTokens === "number" && typeof rawWindow === "number" && rawWindow > 0 ? (
								<>
									<div className="flex items-baseline justify-between text-[11px]">
										<span className="font-mono text-[var(--text)]">
											{compactTokens(rawTokens)} / {compactTokens(rawWindow)} token
										</span>
										<span className="font-mono font-medium text-[var(--text)]">
											{percentage.toFixed(1)}%
										</span>
									</div>
									<div
										className="grid gap-[2px]"
										style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))` }}
										aria-hidden
									>
										{cells.map((id, i) => (
											<span
												key={i}
												className="aspect-square rounded-[2px]"
												style={{ background: segmentColor.get(id) }}
											/>
										))}
									</div>
									<div className="space-y-1 text-[11px]">
										{segments
											.filter((s) => s.tokens > 0 || s.id === "messages" || s.id === "free")
											.map((s) => (
												<div key={s.id} className="flex items-center gap-2">
													<span
														className="h-2 w-2 shrink-0 rounded-[2px]"
														style={{ background: s.color }}
													/>
													<span className="flex-1 text-[var(--text-60)]">{s.label}</span>
													<span className="font-mono text-[var(--text)]">{compactTokens(s.tokens)}</span>
													<span className="w-12 text-right font-mono text-[var(--text-40)]">
														{((s.tokens / rawWindow) * 100).toFixed(1)}%
													</span>
												</div>
											))}
									</div>
									{probeState === "loading" && (
										<div className="text-[10px] text-[var(--text-40)]">正在统计系统提示词、工具等固定部分…</div>
									)}
									{probeState === "error" && (
										<div className="text-[10px] text-[var(--text-40)]">
											固定部分统计失败，已用量全部算作对话消息
										</div>
									)}
								</>
							) : (
								<>
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
												className={clsx("h-full rounded-full transition-all duration-300", barColor)}
											/>
										</div>
									</div>
									{usageObj && (
										<div className="space-y-1 border-t border-[var(--line)] pt-2 text-[11px]">
											{Object.entries(usageObj)
												.filter(([k]) => k !== "percent")
												.map(([k, v]) => (
													<div key={k} className="flex justify-between">
														<span className="text-[var(--text-40)]">{k}</span>
														<span className="font-mono text-[var(--text-60)]">{String(v)}</span>
													</div>
												))}
										</div>
									)}
								</>
							)}

							{totalTokensStr && (
								<div className="flex justify-between border-t border-[var(--line)] pt-2 text-[11px]">
									<span className="text-[var(--text-40)]">累计 Token:</span>
									<span className="font-mono font-medium text-[var(--text)]">
										{totalTokensStr}
									</span>
								</div>
							)}

							<button
								type="button"
								onClick={() => {
									setOpen(false);
									openPromptComposition(sessionCwd);
								}}
								className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] px-2 py-1.5 text-[11px] font-medium text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
							>
								<Layers size={12} />
								<span>查看系统提示词构成</span>
							</button>
						</div>
					</FloatingLayer>
			)}
		</div>
	);
}
