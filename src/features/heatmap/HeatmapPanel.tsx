/** [B] Right tab: transcript minimap — one ~10px cell per transcript message.
 * user=blue, assistant brightness ∝ log(tokens), tool result=grey, error=red.
 * Click scrolls the stream via stores/live scrollToItem (msg-<id> DOM ids). */

import clsx from "clsx";
import { Coins, Layers, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { TranscriptItem } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";

function cellClass(item: TranscriptItem): string {
	const error =
		item.toolResult?.isError === true || item.stopReason === "error";
	if (error) return "bg-red-500";
	switch (item.kind) {
		case "user":
			return "bg-sky-500";
		case "tool_result":
		case "bash":
			return "bg-neutral-600";
		case "assistant":
			return ""; // inline style — dynamic alpha can't be a Tailwind class
		default:
			return "bg-neutral-800";
	}
}

function cellStyle(item: TranscriptItem): React.CSSProperties | undefined {
	if (item.kind !== "assistant" || item.toolResult?.isError) return undefined;
	const tokens = item.usage?.totalTokens ?? 0;
	// Brightness ∝ log(tokens): 0→20% … 100k→100%.
	const t = Math.min(1, Math.log10(Math.max(1, tokens)) / 5);
	return { backgroundColor: `rgb(52 211 153 / ${0.2 + 0.8 * t})` };
}

function kindLabel(item: TranscriptItem): string {
	if (item.toolResult?.isError === true || item.stopReason === "error") {
		return "执行错误";
	}
	switch (item.kind) {
		case "user":
			return "用户消息";
		case "assistant":
			return "助手回答";
		case "tool_result":
			return "工具结果";
		case "bash":
			return "终端命令";
		default:
			return item.kind || "其他消息";
	}
}

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

const EMPTY_ITEMS: TranscriptItem[] = [];

export function HeatmapPanel() {
	const selectedId = useUi((s) => s.selectedSessionId);
	const items = useLive((s) =>
		selectedId ? (s.sessions[selectedId]?.items ?? EMPTY_ITEMS) : EMPTY_ITEMS,
	);
	const scrollToItem = useLive((s) => s.scrollToItem);

	const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
	const [hovered, setHovered] = useState<{
		item: TranscriptItem;
		x: number;
		y: number;
	} | null>(null);

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
			<div className="p-3 text-xs text-neutral-500">选择一个会话查看热力图</div>
		);
	}
	if (items.length === 0) {
		return <div className="p-3 text-xs text-neutral-500">暂无消息记录</div>;
	}

	const handleCellClick = (itemId: string) => {
		setSelectedItemId(itemId);
		if (selectedId) {
			scrollToItem(selectedId, itemId);
		}
	};

	const handleMouseEnter = (
		item: TranscriptItem,
		e: React.MouseEvent<HTMLButtonElement>,
	) => {
		const rect = e.currentTarget.getBoundingClientRect();
		setHovered({
			item,
			x: Math.min(Math.max(8, rect.left - 80), window.innerWidth - 260),
			y: Math.min(rect.bottom + 6, window.innerHeight - 150),
		});
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

			{/* Legend */}
			<div className="mb-3 flex flex-wrap gap-2.5 text-[10px] text-neutral-400">
				<span className="flex items-center gap-1">
					<i className="h-2 w-2 rounded-sm bg-sky-500" />
					用户
				</span>
				<span className="flex items-center gap-1">
					<i className="h-2 w-2 rounded-sm bg-emerald-400" />
					助手(亮度∝Token)
				</span>
				<span className="flex items-center gap-1">
					<i className="h-2 w-2 rounded-sm bg-neutral-600" />
					工具输出
				</span>
				<span className="flex items-center gap-1">
					<i className="h-2 w-2 rounded-sm bg-red-500" />
					执行错误
				</span>
			</div>

			{/* Grouped by rounds */}
			<div className="flex-1 space-y-3">
				{rounds.map((round) => {
					const pct =
						totalTokens > 0
							? Math.round((round.tokens / totalTokens) * 100)
							: 0;
					return (
						<div
							key={round.index}
							className="rounded-md border border-neutral-800/80 bg-neutral-900/30 p-2"
						>
							<div className="mb-1.5 flex items-center justify-between text-[11px] text-neutral-400">
								<span className="flex items-center gap-1 font-medium text-neutral-300">
									<Layers size={11} className="text-neutral-500" />第{" "}
									{round.index} 轮
								</span>
								<div className="flex items-center gap-2 font-mono text-[10px] text-neutral-500">
									<span>{round.items.length} 条消息</span>
									<span>{formatTokens(round.tokens)} tok</span>
									{pct > 0 && (
										<span className="text-neutral-400 font-medium">
											({pct}%)
										</span>
									)}
								</div>
							</div>
							<div className="flex flex-wrap gap-[3px]">
								{round.items.map((item) => {
									const isSelected = selectedItemId === item.id;
									return (
										<button
											key={item.id}
											type="button"
											tabIndex={-1}
											onClick={() => handleCellClick(item.id)}
											onMouseEnter={(e) => handleMouseEnter(item, e)}
											onMouseLeave={() => setHovered(null)}
											style={cellStyle(item)}
											className={clsx(
												"relative h-[11px] w-[11px] rounded-[2px] transition-all cursor-pointer",
												cellClass(item),
												isSelected
													? "ring-2 ring-indigo-400 ring-offset-1 ring-offset-neutral-900 scale-125 z-10"
													: "hover:scale-150 hover:z-10",
											)}
										/>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>

			{/* Instant Floating Tooltip */}
			{hovered && (
				<div
					style={{ left: hovered.x, top: hovered.y }}
					className="fixed z-50 pointer-events-none max-w-xs rounded-md border border-neutral-700 bg-neutral-900/95 p-2.5 text-xs shadow-2xl backdrop-blur-md transition-opacity"
				>
					<div className="flex items-center gap-1.5 font-medium">
						<span
							className={clsx(
								"h-2 w-2 rounded-full",
								cellClass(hovered.item) || "bg-emerald-400",
							)}
						/>
						<span className="text-neutral-200">
							{kindLabel(hovered.item)}
						</span>
						{hovered.item.ts && (
							<span className="ml-auto text-[10px] text-neutral-500">
								{relativeTime(hovered.item.ts)}
							</span>
						)}
					</div>
					{hovered.item.usage && (
						<div className="mt-1 flex gap-2 font-mono text-[10px] text-neutral-400">
							<span>
								消耗: {hovered.item.usage.totalTokens.toLocaleString()} tok
							</span>
							{hovered.item.usage.input > 0 && (
								<span>入: {hovered.item.usage.input.toLocaleString()}</span>
							)}
							{hovered.item.usage.output > 0 && (
								<span>出: {hovered.item.usage.output.toLocaleString()}</span>
							)}
						</div>
					)}
					{hovered.item.text && (
						<div className="mt-1.5 line-clamp-3 text-[11px] text-neutral-300 leading-relaxed break-all">
							{hovered.item.text.trim()}
						</div>
					)}
					{hovered.item.toolResult && !hovered.item.text && (
						<div className="mt-1.5 line-clamp-2 text-[11px] text-neutral-400">
							工具: {hovered.item.toolResult.toolName}{" "}
							{hovered.item.toolResult.isError ? "(执行报错)" : "(成功)"}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
