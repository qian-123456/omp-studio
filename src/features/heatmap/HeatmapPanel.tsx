/** Right tab: Token usage & cost panel.
 * Displays overall token/cost metrics and per-round horizontal stacked bars
 * showing the proportion of user messages, AI replies, tool outputs, and errors.
 * Clicking items scrolls the transcript stream via stores/live scrollToItem. */

import clsx from "clsx";
import { ChevronRight, Coins, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { TranscriptItem } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return n.toLocaleString();
}

function formatCost(c: number): string {
	if (c === 0) return "$0.00";
	if (c < 0.01) return `$${c.toFixed(4)}`;
	return `$${c.toFixed(2)}`;
}

function kindLabel(item: TranscriptItem): string {
	if (item.toolResult?.isError === true || item.stopReason === "error") {
		return "执行错误";
	}
	switch (item.kind) {
		case "user":
			return "你发的";
		case "assistant":
			return "AI 回复";
		case "tool_result":
			return "工具输出";
		case "bash":
			return "终端命令";
		default:
			return item.kind || "其他消息";
	}
}

function itemDotClass(item: TranscriptItem): string {
	if (item.toolResult?.isError === true || item.stopReason === "error") {
		return "bg-red-500";
	}
	switch (item.kind) {
		case "user":
			return "bg-sky-500";
		case "assistant":
			return "bg-emerald-500";
		case "tool_result":
		case "bash":
			return "bg-neutral-500";
		default:
			return "bg-neutral-600";
	}
}

interface Round {
	index: number;
	items: TranscriptItem[];
	tokens: number;
	hasError: boolean;
}

function groupIntoRounds(items: TranscriptItem[]): Round[] {
	const rounds: Round[] = [];
	let currentRound: TranscriptItem[] = [];

	for (const item of items) {
		if (item.kind === "user" && currentRound.length > 0) {
			const tokens = currentRound.reduce(
				(s, it) => s + (it.usage?.totalTokens ?? 0),
				0,
			);
			const hasError = currentRound.some(
				(it) => it.toolResult?.isError || it.stopReason === "error",
			);
			rounds.push({
				index: rounds.length + 1,
				items: currentRound,
				tokens,
				hasError,
			});
			currentRound = [item];
		} else {
			currentRound.push(item);
		}
	}

	if (currentRound.length > 0) {
		const tokens = currentRound.reduce(
			(s, it) => s + (it.usage?.totalTokens ?? 0),
			0,
		);
		const hasError = currentRound.some(
			(it) => it.toolResult?.isError || it.stopReason === "error",
		);
		rounds.push({
			index: rounds.length + 1,
			items: currentRound,
			tokens,
			hasError,
		});
	}

	return rounds;
}

export interface CategoryStats {
	key: "user" | "assistant" | "tool" | "error";
	label: string;
	count: number;
	tokens: number;
	rawWeight: number;
	colorClass: string;
	dotClass: string;
}

export interface RoundSegment extends CategoryStats {
	pct: number;
}

export interface RoundAnalysis {
	categories: CategoryStats[];
	segments: RoundSegment[];
}

function analyzeRound(round: Round): RoundAnalysis {
	let userCount = 0;
	let userChars = 0;
	let userTokens = 0;

	let assistantCount = 0;
	let assistantChars = 0;
	let assistantTokens = 0;

	let toolCount = 0;
	let toolChars = 0;
	let toolTokens = 0;

	let errorCount = 0;
	let errorChars = 0;
	let errorTokens = 0;

	for (const item of round.items) {
		const isErr =
			item.toolResult?.isError === true || item.stopReason === "error";
		const textLen =
			(item.text?.length ?? 0) + (item.toolResult?.text?.length ?? 0);

		if (isErr) {
			errorCount++;
			errorChars += textLen;
			errorTokens +=
				item.usage?.totalTokens ?? Math.max(10, Math.round(textLen / 3.5));
		} else if (item.kind === "user") {
			userCount++;
			userChars += textLen;
			userTokens +=
				item.usage?.totalTokens ?? Math.max(10, Math.round(textLen / 3.5));
		} else if (item.kind === "assistant") {
			assistantCount++;
			assistantChars += textLen;
			const tok =
				item.usage?.output ||
				item.usage?.totalTokens ||
				Math.max(10, Math.round(textLen / 3.5));
			assistantTokens += tok;
		} else {
			toolCount++;
			toolChars += textLen;
			toolTokens +=
				item.usage?.totalTokens ?? Math.max(10, Math.round(textLen / 3.5));
		}
	}

	const categories: CategoryStats[] = [
		{
			key: "user",
			label: "你发的",
			count: userCount,
			tokens: userTokens,
			rawWeight:
				userCount > 0
					? Math.max(userTokens, Math.round(userChars / 3.5), 10)
					: 0,
			colorClass: "bg-sky-500",
			dotClass: "bg-sky-500",
		},
		{
			key: "assistant",
			label: "AI 回复",
			count: assistantCount,
			tokens: assistantTokens,
			rawWeight:
				assistantCount > 0
					? Math.max(assistantTokens, Math.round(assistantChars / 3.5), 10)
					: 0,
			colorClass: "bg-emerald-500",
			dotClass: "bg-emerald-500",
		},
		{
			key: "tool",
			label: "工具输出",
			count: toolCount,
			tokens: toolTokens,
			rawWeight:
				toolCount > 0
					? Math.max(toolTokens, Math.round(toolChars / 3.5), 10)
					: 0,
			colorClass: "bg-neutral-500",
			dotClass: "bg-neutral-500",
		},
		{
			key: "error",
			label: "错误",
			count: errorCount,
			tokens: errorTokens,
			rawWeight:
				errorCount > 0
					? Math.max(errorTokens, Math.round(errorChars / 3.5), 10)
					: 0,
			colorClass: "bg-red-500",
			dotClass: "bg-red-500",
		},
	];

	const active = categories.filter((c) => c.count > 0);
	if (active.length === 0) {
		return { categories, segments: [] };
	}

	// Guarantee every active category has a minimum visible width
	const minPct = active.length > 1 ? 5 : 100;
	const totalWeight = active.reduce((acc, c) => acc + c.rawWeight, 0);

	let remainingPct = 100 - minPct * active.length;
	if (remainingPct < 0) remainingPct = 0;

	let accumulated = 0;
	const segments: RoundSegment[] = active.map((cat, idx) => {
		if (idx === active.length - 1) {
			return { ...cat, pct: Math.max(0, 100 - accumulated) };
		}
		const weightFraction =
			totalWeight > 0 ? cat.rawWeight / totalWeight : 1 / active.length;
		const pct = Math.round(minPct + remainingPct * weightFraction);
		accumulated += pct;
		return { ...cat, pct };
	});

	return { categories, segments };
}

interface HoverState {
	round: Round;
	rect: DOMRect;
	analysis: RoundAnalysis;
	pct: number;
}

const EMPTY_ITEMS: TranscriptItem[] = [];

export function HeatmapPanel() {
	const selectedId = useUi((s) => s.selectedSessionId);
	const items = useLive((s) =>
		selectedId ? (s.sessions[selectedId]?.items ?? EMPTY_ITEMS) : EMPTY_ITEMS,
	);
	const scrollToItem = useLive((s) => s.scrollToItem);

	const [expandedRounds, setExpandedRounds] = useState<Record<number, boolean>>({});
	const [hovered, setHovered] = useState<HoverState | null>(null);

	// Group into rounds and calculate overall token/cost usage
	const { rounds, totalTokens, inputTokens, outputTokens, cacheTokens, totalCost } =
		useMemo(() => {
			let totalTok = 0;
			let inTok = 0;
			let outTok = 0;
			let cacheTok = 0;
			let cost = 0;

			for (const it of items) {
				if (it.usage) {
					totalTok += it.usage.totalTokens ?? 0;
					inTok += it.usage.input ?? 0;
					outTok += it.usage.output ?? 0;
					cacheTok += (it.usage.cacheRead ?? 0) + (it.usage.cacheWrite ?? 0);
					cost += it.usage.cost ?? 0;
				}
			}

			return {
				rounds: groupIntoRounds(items),
				totalTokens: totalTok,
				inputTokens: inTok,
				outputTokens: outTok,
				cacheTokens: cacheTok,
				totalCost: cost,
			};
		}, [items]);

	if (!selectedId) {
		return (
			<div className="p-3 text-xs text-neutral-500">选择一个会话查看 Token 用量</div>
		);
	}
	if (items.length === 0) {
		return <div className="p-3 text-xs text-neutral-500">暂无消息记录</div>;
	}

	const toggleRound = (roundIndex: number) => {
		setExpandedRounds((prev) => ({
			...prev,
			[roundIndex]: !prev[roundIndex],
		}));
	};

	return (
		<div className="flex h-full flex-col overflow-y-auto p-3 text-xs">
			{/* Token Usage & Cost Overview Card */}
			<div className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5">
				<div className="mb-2 flex items-center justify-between text-neutral-400">
					<span className="flex items-center gap-1.5 font-medium text-neutral-200">
						<Sparkles size={13} className="text-amber-400" />
						Token 用量与成本概览
					</span>
					<span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400 font-medium">
						<Coins size={12} />
						{formatCost(totalCost)}
					</span>
				</div>
				<div className="grid grid-cols-2 gap-2 text-[11px]">
					<div className="rounded bg-neutral-950/40 px-2 py-1">
						<div className="text-[10px] text-neutral-500">总 Token 消耗</div>
						<div className="font-mono text-neutral-200 font-medium">
							{formatTokens(totalTokens)}
						</div>
					</div>
					<div className="rounded bg-neutral-950/40 px-2 py-1">
						<div className="text-[10px] text-neutral-500">输入 / 输出</div>
						<div className="font-mono text-neutral-300">
							{formatTokens(inputTokens)} / {formatTokens(outputTokens)}
						</div>
					</div>
					{cacheTokens > 0 && (
						<div className="col-span-2 rounded bg-neutral-950/40 px-2 py-1 flex items-center justify-between text-[10px]">
							<span className="text-neutral-500">缓存命中 / 写入</span>
							<span className="font-mono text-indigo-400">
								{formatTokens(cacheTokens)}
							</span>
						</div>
					)}
				</div>
			</div>

			{/* Direct Legend */}
			<div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border border-neutral-800/60 bg-neutral-900/40 px-2.5 py-1.5 text-[10.5px] text-neutral-400">
				<span className="flex items-center gap-1.5">
					<span className="h-2 w-2 rounded-full bg-sky-500" />
					<span>蓝色 = 你发的</span>
				</span>
				<span className="text-neutral-700">·</span>
				<span className="flex items-center gap-1.5">
					<span className="h-2 w-2 rounded-full bg-emerald-500" />
					<span>绿色 = AI 回复</span>
				</span>
				<span className="text-neutral-700">·</span>
				<span className="flex items-center gap-1.5">
					<span className="h-2 w-2 rounded-full bg-neutral-500" />
					<span>灰 = 工具输出</span>
				</span>
				<span className="text-neutral-700">·</span>
				<span className="flex items-center gap-1.5">
					<span className="h-2 w-2 rounded-full bg-red-500" />
					<span>红 = 错误</span>
				</span>
			</div>

			{/* Rounds Section Header with explanation */}
			<div className="mb-2 flex items-center justify-between px-0.5 text-[11px]">
				<span className="font-medium text-neutral-300">各轮 Token 消耗明细</span>
				<span className="text-[10.5px] text-neutral-500">每一轮 = 一次提问到回复完成</span>
			</div>

			{/* Grouped by rounds as horizontal stacked bars */}
			<div className="flex-1 space-y-1.5">
				{rounds.map((round) => {
					const pct =
						totalTokens > 0
							? Math.round((round.tokens / totalTokens) * 100)
							: 0;
					const analysis = analyzeRound(round);
					const isExpanded = Boolean(expandedRounds[round.index]);

					return (
						<div
							key={round.index}
							className="group rounded-md border border-neutral-800/80 bg-neutral-900/30 transition-colors hover:border-neutral-700/80 hover:bg-neutral-900/50"
						>
							{/* Round row: Label + Stacked Bar + Token/pct */}
							<div
								className="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer select-none"
								onClick={() => toggleRound(round.index)}
								onMouseEnter={(e) => {
									const rect = e.currentTarget.getBoundingClientRect();
									setHovered({ round, rect, analysis, pct });
								}}
								onMouseLeave={() => setHovered(null)}
							>
								{/* Left: Round label */}
								<div className="flex items-center gap-1 shrink-0 text-[11.5px] font-medium text-neutral-300 w-16">
									<ChevronRight
										size={12}
										className={clsx(
											"text-neutral-500 transition-transform duration-150 shrink-0",
											isExpanded && "rotate-90 text-neutral-300",
										)}
									/>
									<span>第 {round.index} 轮</span>
								</div>

								{/* Center: Stacked Horizontal Bar */}
								<div className="relative flex-1 h-2.5 rounded-full bg-neutral-800/80 overflow-hidden flex min-w-0">
									{analysis.segments.map((seg, idx) => (
										<div
											key={seg.key}
											style={{ width: `${seg.pct}%` }}
											className={clsx(
												"h-full relative transition-all",
												seg.colorClass,
												idx > 0 && "border-l border-neutral-900/50",
											)}
										/>
									))}
								</div>

								{/* Right: Tokens & Percentage */}
								<div className="shrink-0 flex items-center justify-end gap-1.5 font-mono text-[10.5px] text-neutral-400 w-24 text-right">
									<span>{formatTokens(round.tokens)} tok</span>
									<span className="text-neutral-600">·</span>
									<span className="text-neutral-300 font-medium">{pct}%</span>
								</div>
							</div>

							{/* Expanded message breakdown */}
							{isExpanded && (
								<div className="border-t border-neutral-800/60 px-2 py-1.5 space-y-1 bg-neutral-950/40">
									{round.items.map((item) => (
										<button
											key={item.id}
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												if (selectedId) scrollToItem(selectedId, item.id);
											}}
											className="group/item flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] hover:bg-neutral-800/60 transition-colors"
											title="点击在会话中跳转到该消息"
										>
											<span
												className={clsx(
													"h-1.5 w-1.5 rounded-full shrink-0",
													itemDotClass(item),
												)}
											/>
											<span className="w-14 shrink-0 text-[10.5px] font-medium text-neutral-400 group-hover/item:text-neutral-200">
												{kindLabel(item)}
											</span>
											<span className="flex-1 min-w-0 truncate text-[10.5px] text-neutral-400 group-hover/item:text-neutral-300">
												{item.text?.trim() ||
													(item.toolResult
														? `${item.toolResult.toolName} 输出`
														: "空消息")}
											</span>
											<span className="shrink-0 font-mono text-[10px] text-neutral-500">
												{item.usage?.totalTokens
													? `${formatTokens(item.usage.totalTokens)} tok`
													: item.ts
														? relativeTime(item.ts)
														: ""}
											</span>
										</button>
									))}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Floating Tooltip displaying round token decomposition */}
			<FloatingLayer
				anchor={hovered ? hovered.rect : null}
				layer="hovercard"
				placement="bottom-start"
				offset={6}
				className="pointer-events-none w-64 p-2.5 text-xs shadow-apple-modal"
			>
				{hovered && (
					<>
						<div className="flex items-center justify-between border-b border-[var(--border-divider)] pb-1.5 text-[11px] font-medium text-[var(--text)]">
							<span className="flex items-center gap-1.5">
								<Coins size={12} className="text-amber-400" />第{" "}
								{hovered.round.index} 轮分解
							</span>
							<span className="font-mono text-neutral-400">
								{formatTokens(hovered.round.tokens)} tok · {hovered.pct}%
							</span>
						</div>

						<div className="mt-2 space-y-1.5 text-[11px]">
							{hovered.analysis.categories.map((cat) => (
								<div
									key={cat.key}
									className={clsx(
										"flex items-center justify-between",
										cat.count > 0 ? "text-neutral-300" : "text-neutral-500",
									)}
								>
									<span className="flex items-center gap-1.5">
										<span className={clsx("h-2 w-2 rounded-full", cat.dotClass)} />
										<span>{cat.label}</span>
									</span>
									<span className="font-mono text-[10.5px]">
										{cat.count > 0 ? (
											<span>
												{cat.count} 条
												{cat.tokens > 0
													? ` · ${formatTokens(cat.tokens)} tok`
													: ""}
											</span>
										) : (
											"无"
										)}
									</span>
								</div>
							))}
						</div>

						<div className="mt-2 border-t border-[var(--border-divider)] pt-1.5 flex items-center justify-between text-[10px] text-neutral-500">
							<span>共 {hovered.round.items.length} 条消息</span>
							<span>点击展开消息明细</span>
						</div>
					</>
				)}
			</FloatingLayer>
		</div>
	);
}
