/** [B] Right tab: transcript minimap — one ~10px cell per transcript message.
 * user=blue, assistant brightness ∝ log(tokens), tool result=grey, error=red.
 * Click scrolls the stream via stores/live scrollToItem (msg-<id> DOM ids). */

import clsx from "clsx";
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

function tooltip(item: TranscriptItem): string {
	const parts: string[] = [item.kind];
	if (item.usage) parts.push(`${item.usage.totalTokens.toLocaleString()} tok`);
	if (item.ts) parts.push(relativeTime(item.ts));
	if (item.toolResult?.isError) parts.push("错误");
	return parts.join(" · ");
}

export function HeatmapPanel() {
	const selectedId = useUi((s) => s.selectedSessionId);
	const items = useLive((s) =>
		selectedId ? (s.sessions[selectedId]?.items ?? []) : [],
	);
	const scrollToItem = useLive((s) => s.scrollToItem);

	if (!selectedId) {
		return (
			<div className="p-3 text-xs text-neutral-500">选择一个会话查看热力图</div>
		);
	}
	if (items.length === 0) {
		return (
			<div className="p-3 text-xs text-neutral-500">暂无消息记录</div>
		);
	}

	return (
		<div className="p-3">
			<div className="mb-2 flex gap-3 text-[10px] text-neutral-500">
				<span>
					<i className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-500" />
					用户
				</span>
				<span>
					<i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />
					助手(亮度=token)
				</span>
				<span>
					<i className="mr-1 inline-block h-2 w-2 rounded-sm bg-neutral-600" />
					工具
				</span>
				<span>
					<i className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-500" />
					错误
				</span>
			</div>
			<div className="flex flex-wrap gap-[3px]">
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						title={tooltip(item)}
						onClick={() => scrollToItem(selectedId, item.id)}
						style={cellStyle(item)}
						className={clsx(
							"h-[10px] w-[10px] rounded-[2px] transition-transform hover:scale-150",
							cellClass(item),
						)}
					/>
				))}
			</div>
		</div>
	);
}
