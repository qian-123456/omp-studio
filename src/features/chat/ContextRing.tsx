import clsx from "clsx";
import { ArchiveRestore, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { PromptCategoryId, PromptComposition } from "../../lib/contracts";
import { promptCompositionProbe } from "../../lib/ipc";
import { openPromptComposition } from "../../stores/promptComposition";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { buildContextSegments, computeMeterSegments } from "./contextBreakdown";

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

/** Formats tokens to match Claude App's concise style (e.g. "2k", "12.7k", "200k", "1.0M"). */
function compactTokens(n: number): string {
	if (n >= 1_000_000) {
		const v = (n / 1_000_000).toFixed(1);
		return v.endsWith(".0") ? `${Math.round(n / 1_000_000)}M` : `${v}M`;
	}
	if (n >= 1000) {
		const v = (n / 1000).toFixed(1);
		return v.endsWith(".0") ? `${Math.round(n / 1000)}k` : `${v}k`;
	}
	return String(n);
}

/** Port of Claude App's collapsible sub-item row (`O` in ce96f5751), styled with theme variables. */
function SubItemSection({
	label,
	rows,
}: {
	label: string;
	rows: Array<{ name: string; tokens: number }>;
}) {
	const [expanded, setExpanded] = useState(false);
	const totalTokens = rows.reduce((acc, r) => acc + r.tokens, 0);

	return (
		<div className="flex flex-col gap-0.5 mt-2">
			<button
				type="button"
				className="flex items-center gap-1 text-[12px] leading-[15px] text-left cursor-pointer hover:text-[var(--text)] transition-colors"
				onClick={() => setExpanded((v) => !v)}
				aria-expanded={expanded}
			>
				<span className="size-[10px] shrink-0 flex items-center justify-center">
					<ChevronRight
						size={10}
						className={`text-[var(--text-40)] transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
					/>
				</span>
				<span className="text-[var(--text-60)] flex-1 truncate">{label}</span>
				<span className="text-[var(--text-40)] shrink-0 tabular-nums">{compactTokens(totalTokens)}</span>
				<span className="text-[var(--text-40)] shrink-0 tabular-nums w-[44px] text-right">
					{rows.length}
				</span>
			</button>
			{expanded && (
				<div
					className={`flex flex-col gap-0.5 mt-0.5 ${rows.length > 12 ? "max-h-[168px] overflow-y-auto overscroll-contain" : ""}`}
				>
					{rows.map((row, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: stable list
						<div key={`${row.name}-${i}`} className="flex items-center gap-1 text-[12px] leading-[15px]">
							<span className="size-[10px] shrink-0" aria-hidden="true" />
							<span className="text-[var(--text-40)] flex-1 truncate">{row.name}</span>
							<span className="text-[var(--text-40)] shrink-0 tabular-nums">{compactTokens(row.tokens)}</span>
							<span className="w-[44px] shrink-0" aria-hidden="true" />
						</div>
					))}
				</div>
			)}
		</div>
	);
}

const DETAIL_CATEGORIES: { id: PromptCategoryId; label: string }[] = [
	{ id: "mcp", label: "MCP 工具" },
	{ id: "skills", label: "Skills" },
	{ id: "rules", label: "规则文件" },
];

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
		percentage = Math.max(0, percent);
		fraction = percentage / 100;
	}

	const pctInt = Math.round(percentage);

	// Ring colour
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

	const [probe, setProbe] = useState<PromptComposition | null>(null);
	useEffect(() => {
		if (!open || !sessionCwd) return;
		let alive = true;
		loadComposition(sessionCwd)
			.then((c) => {
				if (!alive) return;
				setProbe(c);
			})
			.catch(() => {
				if (!alive) return;
				setProbe(null);
			});
		return () => {
			alive = false;
		};
	}, [open, sessionCwd]);

	const segments = buildContextSegments(rawTokens ?? 0, rawWindow ?? 0, probe);
	const meterSegments = computeMeterSegments(segments, rawWindow ?? 0, 4);
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

			{/* Claude App Style Popover, styled strictly with system theme CSS variables */}
			{open && (
				<FloatingLayer
					anchor={btnRef.current}
					placement="top-start"
					offset={8}
					layer="popover"
					ignoreRefs={[btnRef]}
					onDismiss={() => setOpen(false)}
					style={{
						// Layers over solid --bg to preserve opacity in glass themes.
						backgroundColor: "var(--bg)",
						backgroundImage: "linear-gradient(var(--bg-panel), var(--bg-panel))",
						width: 360,
					}}
					className="border border-[var(--line)] rounded-2xl py-2 shadow-apple-card text-[var(--text)] flex flex-col"
				>
					{/* Header Button (P in c2d611398) */}
					<div className="flex items-center justify-between px-3 py-1 min-h-[20px]">
						<span className="text-[12px] leading-[15px] text-[var(--text-40)]">上下文窗口</span>
						<div className="flex items-center gap-1.5">
							{typeof rawTokens === "number" && typeof rawWindow === "number" && rawWindow > 0 && (
								<span className="text-[12px] leading-[15px] text-[var(--text-40)] tabular-nums">
									{compactTokens(rawTokens)} / {compactTokens(rawWindow)} ({pctInt}%)
								</span>
							)}
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="text-[var(--text-40)] hover:text-[var(--text)] p-0.5 rounded transition-colors ml-0.5"
								title="收起"
							>
								<ChevronDown size={12} />
							</button>
						</div>
					</div>

					{/* Stacked Meter & Category Legend (D in ce96f5751) */}
					{typeof rawTokens === "number" && typeof rawWindow === "number" && rawWindow > 0 ? (
						<div className="mt-1 px-3 pb-1">
							{/* StackedMeter: 4px rounded-full with 1px seam, track colored via var(--bg-selected) */}
							<div className="relative w-full h-[4px] rounded-full overflow-hidden bg-[var(--bg-selected)]">
								{meterSegments.map((seg) => (
									<div
										key={seg.id}
										className="absolute inset-y-0"
										style={{
											insetInlineStart: `calc(${seg.startPct.toFixed(3)}% + ${seg.seam}px)`,
											width: `calc(${seg.widthPct.toFixed(3)}% - ${seg.seam}px)`,
											backgroundColor: seg.color,
											borderStartStartRadius: seg.radiusStart,
											borderEndStartRadius: seg.radiusStart,
											borderStartEndRadius: seg.radiusEnd,
											borderEndEndRadius: seg.radiusEnd,
										}}
									/>
								))}
							</div>

							{/* Category Rows: 10x10 swatch with 2px radius, theme-aware text & muted tokens */}
							<div className="flex flex-col mt-2">
								{segments.map((item, idx) => {
									const pct = (item.tokens / rawWindow) * 100;
									return (
										<div
											key={item.id}
											className={`flex items-center gap-1.5 text-[12px] leading-[15px] ${idx > 0 ? "mt-1" : ""}`}
										>
											<span
												className="shrink-0"
												style={{
													width: 10,
													height: 10,
													borderRadius: 2,
													background: item.color,
													display: "inline-block",
												}}
												aria-hidden="true"
											/>
											<span className="text-[var(--text)] flex-1 truncate">{item.name}</span>
											<span className="text-[var(--text-40)] shrink-0 tabular-nums">
												{compactTokens(item.tokens)}
											</span>
											<span className="text-[var(--text)] shrink-0 tabular-nums w-[44px] text-right">
												{pct.toFixed(1)}%
											</span>
										</div>
									);
								})}
							</div>

							{/* Collapsible Sub-item Sections */}
							{probe &&
								DETAIL_CATEGORIES.map((cat) => {
									const items = probe.categories.find((c) => c.id === cat.id)?.items ?? [];
									if (items.length === 0) return null;
									return (
										<SubItemSection
											key={cat.id}
											label={cat.label}
											rows={items.map((it) => ({
												name: it.detail ? `${it.detail} · ${it.title}` : it.title,
												tokens: it.tokens,
											}))}
										/>
									);
								})}
						</div>
					) : (
						<div className="mt-1 px-3 pb-1">
							<div className="relative w-full h-[4px] rounded-full overflow-hidden bg-[var(--bg-selected)]">
								<div
									style={{ width: `${Math.min(100, percentage)}%` }}
									className={clsx("h-full transition-all duration-300", barColor)}
								/>
							</div>
							{usageObj && (
								<div className="mt-2 space-y-1 text-[12px] leading-[15px] text-[var(--text-40)]">
									{Object.entries(usageObj)
										.filter(([k]) => k !== "percent")
										.map(([k, v]) => (
											<div key={k} className="flex justify-between">
												<span>{k}</span>
												<span className="font-mono text-[var(--text)]">{String(v)}</span>
											</div>
										))}
								</div>
							)}
						</div>
					)}

					{/* Divider line styled via var(--line) */}
					<div className="mx-3 my-1.5 h-px bg-[var(--line)]" />

					{/* Footer: See detailed breakdown link + token total + compress button */}
					<div className="flex items-center justify-between px-3 py-1 min-h-[20px] text-[12px] leading-[15px]">
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								openPromptComposition(sessionCwd);
							}}
							className="text-[var(--text-40)] hover:text-[var(--text)] transition-colors"
						>
							查看系统提示词构成
						</button>
						<div className="flex items-center gap-2 text-[var(--text-40)]">
							{totalTokensStr && <span className="tabular-nums">累计 {totalTokensStr}</span>}
							{onCompact && (
								<button
									type="button"
									disabled={compacting || compactDisabled}
									onClick={() => void onCompact()}
									title={compactDisabled ? "回合进行中，暂不能压缩" : "压缩上下文"}
									className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--line)] text-[var(--text-60)] hover:text-[var(--text)] hover:bg-[var(--ghost-hover)] hover:border-[var(--text-30)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
								>
									{compacting ? (
										<Loader2 size={10} className="animate-spin" />
									) : (
										<ArchiveRestore size={10} />
									)}
									<span>{compacting ? "压缩中" : "压缩"}</span>
								</button>
							)}
						</div>
					</div>
				</FloatingLayer>
			)}
		</div>
	);
}
