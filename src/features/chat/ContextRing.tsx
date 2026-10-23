import clsx from "clsx";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { PromptComposition } from "../../lib/contracts";
import { promptCompositionProbe } from "../../lib/ipc";
import { openPromptComposition } from "../../stores/promptComposition";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import {
	buildContextSegments,
	type ContextSegment,
	computeRingArcs,
	estimateConversation,
	liveContextItems,
} from "./contextBreakdown";

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


/** Donut chart: used categories as colored arcs over a free-space track, usage % in the hole. */
function UsageDonut({
	segments,
	windowSize,
	pctInt,
}: {
	segments: ContextSegment[];
	windowSize: number;
	pctInt: number;
}) {
	const size = 112;
	const stroke = 12;
	const r = (size - stroke) / 2;
	const c = 2 * Math.PI * r;
	const arcs = computeRingArcs(segments, windowSize, c);
	return (
		<div className="relative shrink-0" style={{ width: size, height: size }}>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					strokeWidth={stroke}
					className="stroke-[var(--bg-selected)]"
				/>
				{arcs.map((a) => (
					<circle
						key={a.id}
						cx={size / 2}
						cy={size / 2}
						r={r}
						fill="none"
						strokeWidth={stroke}
						stroke={a.color}
						strokeDasharray={`${a.length} ${c}`}
						strokeDashoffset={-a.offset}
					>
						<title>{`${a.name} ${compactTokens(a.tokens)}`}</title>
					</circle>
				))}
			</svg>
			<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
				<span className="text-[18px] font-semibold leading-[22px] tabular-nums text-[var(--text)]">{pctInt}%</span>
				<span className="whitespace-nowrap text-[11px] leading-[14px] text-[var(--text-40)]">已用</span>
			</div>
		</div>
	);
}

type DetailRows = NonNullable<ContextSegment["details"]>;

/** CSS background for a group swatch: a conic pie of its parts, or the single part's color. */
function groupSwatch(parts: ContextSegment[]): string {
	if (parts.length === 1) return parts[0].color;
	const total = parts.reduce((a, s) => a + s.tokens, 0);
	let acc = 0;
	const stops = parts.map((s) => {
		const from = (acc / total) * 360;
		acc += s.tokens;
		return `${s.color} ${from}deg ${(acc / total) * 360}deg`;
	});
	return `conic-gradient(${stops.join(", ")})`;
}

/**
 * One legend row. `details` (per-tool, per-skill, …) are always listed beneath it.
 * With `onClick` the whole row is a button.
 */
function LegendRow({
	name,
	tokens,
	pct,
	background,
	details,
	onClick,
}: {
	name: string;
	tokens: number;
	pct: number;
	background: string;
	details?: DetailRows;
	onClick?: () => void;
}) {
	const head = (
		<>
			<span
				className={clsx("size-[10px] shrink-0", onClick ? "rounded-full" : "rounded-[2px]")}
				style={{ background }}
				aria-hidden="true"
			/>
			<span className="min-w-0 flex-1 whitespace-nowrap text-[var(--text)]">{name}</span>
			<span className="shrink-0 tabular-nums text-[var(--text-40)]">{compactTokens(tokens)}</span>
			<span className="w-[40px] shrink-0 text-right tabular-nums text-[var(--text)]">{pct.toFixed(1)}%</span>
		</>
	);
	const rowCls = "flex w-full items-center gap-1.5 rounded-md px-1 py-[3px] text-left text-[12px] leading-[15px]";
	return (
		<div className="flex flex-col">
			{onClick ? (
				<button
					type="button"
					onClick={onClick}
					title="打开系统提示词设置"
					className={clsx(rowCls, "cursor-pointer transition-colors hover:bg-[var(--ghost-hover)]")}
				>
					{head}
				</button>
			) : (
				<div className={rowCls}>{head}</div>
			)}
			{details && details.length > 0 && (
				<div
					className={clsx(
						"ml-[17px] mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2",
						details.length > 10 && "max-h-[170px] overflow-y-auto overscroll-contain",
					)}
				>
					{details.map((row, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: stable list
						<div key={`${row.name}-${i}`} className="flex items-start gap-1.5 text-[11px] leading-[14px]">
							<span className="min-w-0 flex-1 break-words text-[var(--text-60)]">{row.name}</span>
							<span className="shrink-0 tabular-nums text-[var(--text-40)]">{compactTokens(row.tokens)}</span>
						</div>
					))}
				</div>
			)}
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

	// Conversation estimates only while the popover is open (walks the whole live transcript).
	const items = useLive((s) => (open && selectedSessionId ? s.sessions[selectedSessionId]?.items : undefined));
	const chatEstimate = useMemo(() => (items ? estimateConversation(liveContextItems(items)) : null), [items]);
	const segments = buildContextSegments(rawTokens ?? 0, rawWindow ?? 0, probe, chatEstimate);
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
						width: 380,
					}}
					className="border border-[var(--line)] rounded-2xl py-2 shadow-apple-card text-[var(--text)] flex flex-col"
				>
					{/* Header: usage numbers + compact action (outside click dismisses the popover). */}
					<div className="flex min-h-[24px] items-center gap-2 px-3 py-0.5">
						<span className="whitespace-nowrap text-[12px] leading-[15px] text-[var(--text-40)]">上下文窗口</span>
						{typeof rawTokens === "number" && typeof rawWindow === "number" && rawWindow > 0 && (
							<span className="whitespace-nowrap text-[12px] leading-[15px] tabular-nums text-[var(--text-60)]">
								{compactTokens(rawTokens)} / {compactTokens(rawWindow)}
							</span>
						)}
						{onCompact && (
							<button
								type="button"
								disabled={compacting || compactDisabled}
								onClick={() => void onCompact()}
								title={compactDisabled ? "回合进行中，暂不能压缩" : "压缩上下文"}
								className="ml-auto flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[12px] leading-[15px] text-[var(--text-60)] transition-colors hover:border-[var(--text-30)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
							>
								{compacting ? <Loader2 size={11} className="animate-spin" /> : <ArchiveRestore size={11} />}
								<span>{compacting ? "压缩中" : "压缩"}</span>
							</button>
						)}
					</div>

					{/* Donut + legend: chat, the system-prompt group (expands into its parts), free space. */}
					{typeof rawTokens === "number" && typeof rawWindow === "number" && rawWindow > 0 ? (
						<div className="mt-1 flex items-center gap-4 px-3 pb-1">
							<div className="flex shrink-0 flex-col items-center gap-1.5">
								<UsageDonut segments={segments} windowSize={rawWindow} pctInt={pctInt} />
								{totalTokensStr && (
									<span
										className="whitespace-nowrap text-[11px] leading-[14px] tabular-nums text-[var(--text-40)]"
										title="本会话累计消耗的 token"
									>
										累计 {totalTokensStr}
									</span>
								)}
							</div>
							<div className="flex min-w-0 flex-1 flex-col">
								{(() => {
									const prompt = segments.filter((s) => s.group === "prompt");
									const chat = segments.filter((s) => s.group === "chat");
									const free = segments.find((s) => s.group === "free");
									const sumOf = (parts: ContextSegment[]) => parts.reduce((a, s) => a + s.tokens, 0);
									const pctOf = (tokens: number) => (tokens / rawWindow) * 100;
									// 对话: a header row, then every part listed beneath it (no expanding).
									const chatBlock =
										chat.length > 0 ? (
											<>
												<LegendRow
													name="对话"
													tokens={sumOf(chat)}
													pct={pctOf(sumOf(chat))}
													background={groupSwatch(chat)}
												/>
												<div className="mb-1 ml-[9px] flex flex-col border-l border-[var(--line)] pl-1">
													{chat.map((s) => (
														<LegendRow
															key={s.id}
															name={s.name}
															tokens={s.tokens}
															pct={pctOf(s.tokens)}
															background={s.color}
															details={s.details}
														/>
													))}
												</div>
											</>
										) : null;
									// 系统提示词: one row; clicking it opens the settings page.
									const promptRow =
										prompt.length > 0 ? (
											<LegendRow
												name="系统提示词"
												tokens={sumOf(prompt)}
												pct={pctOf(sumOf(prompt))}
												background={groupSwatch(prompt)}
												onClick={() => {
													setOpen(false);
													openPromptComposition(sessionCwd);
												}}
											/>
										) : null;
									// buildContextSegments already ordered the larger group first.
									const chatFirst = segments[0]?.group === "chat";
									return (
										<>
											{chatFirst ? chatBlock : promptRow}
											{chatFirst ? promptRow : chatBlock}
											{free && <LegendRow name={free.name} tokens={free.tokens} pct={pctOf(free.tokens)} background={free.color} />}
										</>
									);
								})()}
							</div>
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
							{totalTokensStr && (
								<div className="mt-2 whitespace-nowrap text-[11px] leading-[14px] tabular-nums text-[var(--text-40)]">
									累计 {totalTokensStr}
								</div>
							)}
						</div>
					)}
				</FloatingLayer>
			)}
		</div>
	);
}
