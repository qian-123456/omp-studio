import clsx from "clsx";
import { ArchiveRestore, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { PromptCategoryId, PromptComposition } from "../../lib/contracts";
import { promptCompositionProbe } from "../../lib/ipc";
import { openPromptComposition } from "../../stores/promptComposition";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { buildContextSegments } from "./contextBreakdown";

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

/** Claude app lists MCP tools, Skills and rules as collapsible rows with token count and item count. */
const DETAIL_SECTIONS: { id: PromptCategoryId; title: string }[] = [
	{ id: "mcp", title: "MCP 工具" },
	{ id: "skills", title: "Skills" },
	{ id: "rules", title: "规则文件" },
];

function CategoryRows({ comp }: { comp: PromptComposition | null }) {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	if (!comp) return null;
	const sections = DETAIL_SECTIONS.map((d) => ({
		...d,
		items: [...(comp.categories.find((c) => c.id === d.id)?.items ?? [])].sort((a, b) => b.tokens - a.tokens),
	})).filter((s) => s.items.length > 0);
	if (sections.length === 0) return null;

	return (
		<div className="mt-2.5 pt-1 space-y-1">
			{sections.map((s) => {
				const isExpanded = expanded.has(s.id);
				const totalTokens = s.items.reduce((acc, it) => acc + it.tokens, 0);
				return (
					<div key={s.id}>
						<button
							type="button"
							aria-expanded={isExpanded}
							onClick={() =>
								setExpanded((prev) => {
									const next = new Set(prev);
									if (next.has(s.id)) next.delete(s.id);
									else next.add(s.id);
									return next;
								})
							}
							className="flex w-full items-center justify-between text-[13px] py-0.5 hover:text-white transition-colors"
						>
							<div className="flex items-center gap-1.5 min-w-0">
								{isExpanded ? (
									<ChevronDown size={13} className="text-[#8a8985] shrink-0" />
								) : (
									<ChevronRight size={13} className="text-[#8a8985] shrink-0" />
								)}
								<span className="text-[#e2e1df] truncate">{s.title}</span>
							</div>
							<div className="flex items-center font-mono tabular-nums text-[13px]">
								<span className="w-16 text-right text-[#8a8985]">{compactTokens(totalTokens)}</span>
								<span className="w-14 text-right text-[#8a8985]">{s.items.length}</span>
							</div>
						</button>
						{isExpanded && (
							<div className="mt-1 mb-2 max-h-36 space-y-1 overflow-y-auto pl-5 pr-1">
								{s.items.map((it) => (
									<div key={it.id} className="flex items-center justify-between text-[11px] text-[#8a8985]">
										<span className="truncate pr-2">
											{it.title}
											{it.detail ? ` (${it.detail})` : ""}
										</span>
										<span className="shrink-0 font-mono">{compactTokens(it.tokens)}</span>
									</div>
								))}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
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

			{/* Claude App Style Popover */}
			{open && (
				<FloatingLayer
					anchor={btnRef.current}
					placement="top-start"
					offset={8}
					layer="popover"
					ignoreRefs={[btnRef]}
					onDismiss={() => setOpen(false)}
					style={{
						backgroundColor: "#20201f",
						width: 358,
					}}
					className="!border-[#373736] rounded-2xl p-4 !shadow-2xl text-[#e2e1df]"
				>
					{/* Header */}
					<div className="flex items-center justify-between">
						<span className="text-[13.5px] font-medium text-[#8a8985]">上下文窗口</span>
						<div className="flex items-center gap-1.5 text-[13.5px]">
							{typeof rawTokens === "number" && typeof rawWindow === "number" && rawWindow > 0 && (
								<span className="font-mono text-[#e2e1df]">
									{compactTokens(rawTokens)} / {compactTokens(rawWindow)} ({pctInt}%)
								</span>
							)}
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="text-[#8a8985] hover:text-[#e2e1df] p-0.5 rounded transition-colors ml-0.5"
								title="关闭"
							>
								<ChevronDown size={14} />
							</button>
						</div>
					</div>

					{/* Progress Bar & Categories */}
					{typeof rawTokens === "number" && typeof rawWindow === "number" && rawWindow > 0 ? (
						<>
							{/* Slim 4px segmented progress bar */}
							<div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#32312f] flex gap-[2px]">
								{segments
									.filter((s) => s.id !== "free" && s.tokens > 0)
									.map((s) => (
										<span
											key={s.id}
											style={{ width: `${(s.tokens / rawWindow) * 100}%`, background: s.color }}
											className="h-full first:rounded-l-full"
										/>
									))}
							</div>

							{/* Category Rows */}
							<div className="mt-3.5 space-y-2 text-[13px]">
								{segments
									.filter((s) => s.tokens > 0 || s.id === "free")
									.map((s) => (
										<div key={s.id} className="flex items-center justify-between">
											<div className="flex items-center gap-2.5 min-w-0">
												<span
													className="h-2.5 w-2.5 shrink-0 rounded-[2.5px]"
													style={{ background: s.color }}
												/>
												<span className="truncate text-[#e2e1df]">{s.label}</span>
											</div>
											<div className="flex items-center font-mono tabular-nums text-[13px]">
												<span className="w-16 text-right text-[#8a8985]">
													{compactTokens(s.tokens)}
												</span>
												<span className="w-14 text-right text-[#8a8985]">
													{((s.tokens / rawWindow) * 100).toFixed(1)}%
												</span>
											</div>
										</div>
									))}
							</div>
						</>
					) : (
						<>
							<div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#32312f]">
								<div
									style={{ width: `${Math.min(100, percentage)}%` }}
									className={clsx("h-full transition-all duration-300", barColor)}
								/>
							</div>
							{usageObj && (
								<div className="mt-3 space-y-1.5 text-xs text-[#8a8985]">
									{Object.entries(usageObj)
										.filter(([k]) => k !== "percent")
										.map(([k, v]) => (
											<div key={k} className="flex justify-between">
												<span>{k}</span>
												<span className="font-mono text-[#e2e1df]">{String(v)}</span>
											</div>
										))}
								</div>
							)}
						</>
					)}

					{/* Expandable sub-items tree (e.g. MCP tools, Skills, Rules) */}
					<CategoryRows comp={probe} />

					{/* Footer Divider & Actions */}
					<div className="mt-3.5 pt-3 border-t border-[#373736] flex items-center justify-between text-xs">
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								openPromptComposition(sessionCwd);
							}}
							className="text-[#8a8985] hover:text-[#e2e1df] transition-colors"
						>
							查看系统提示词构成
						</button>
						<div className="flex items-center gap-2.5 text-[#8a8985]">
							{totalTokensStr && (
								<span className="font-mono">累计 {totalTokensStr}</span>
							)}
							{onCompact && (
								<button
									type="button"
									disabled={compacting || compactDisabled}
									onClick={() => void onCompact()}
									title={compactDisabled ? "回合进行中，暂不能压缩" : "压缩上下文"}
									className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#373736] text-[#8a8985] hover:text-[#e2e1df] hover:border-[#52524e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
								>
									{compacting ? (
										<Loader2 size={11} className="animate-spin" />
									) : (
										<ArchiveRestore size={11} />
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
