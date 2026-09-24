/** [B] Virtualized message stream: transcript items + in-flight assistant
 * message + live tool cards. Every row carries `id="msg-<itemId>"` so the
 * heatmap can scroll to it. */

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { ToolCall, TranscriptItem } from "../../lib/contracts";
import { useLive, type AgentMessage } from "../../stores/live";
import { Markdown } from "./markdown";
import { ToolCard } from "./ToolCard";

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/** Extract text parts from an AgentMessage content (string | parts array). */
export function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) => {
			const o = asObj(p);
			return o.type === "text" && typeof o.text === "string" ? o.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function messageThinking(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((p) => {
			const o = asObj(p);
			const t = o.type === "thinking" ? o.thinking : o.type === "thought" ? o.text : "";
			return typeof t === "string" ? t : "";
		})
		.filter(Boolean)
		.join("\n");
}

function messageToolCalls(content: unknown): ToolCall[] {
	if (!Array.isArray(content)) return [];
	return content
		.map((p) => {
			const o = asObj(p);
			if (o.type !== "toolCall") return null;
			return {
				id: typeof o.id === "string" ? o.id : "",
				name: typeof o.name === "string" ? o.name : "tool",
				args: o.arguments,
				intent:
					typeof o.intent === "string"
						? o.intent
						: typeof asObj(o.arguments).i === "string"
							? (asObj(o.arguments).i as string)
							: null,
			};
		})
		.filter((t): t is ToolCall => t !== null);
}

function Thinking({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	if (!text) return null;
	return (
		<button
			type="button"
			onClick={() => setOpen(!open)}
			className="mb-1 block w-full rounded border border-neutral-800/70 bg-neutral-900/40 px-2 py-1 text-left text-[11px] text-neutral-500"
		>
			{open ? text : `思考过程 (${text.length} 字) — 点击展开`}
		</button>
	);
}

function AssistantBody({
	sessionId,
	text,
	thinking,
	toolCalls,
	usage,
}: {
	sessionId: string;
	text: string;
	thinking: string | null;
	toolCalls: ToolCall[];
	usage?: { totalTokens: number } | null;
}) {
	const liveTools = useLive((s) => s.sessions[sessionId]?.tools ?? {});
	return (
		<div>
			{thinking && <Thinking text={thinking} />}
			{text && <Markdown text={text} />}
			{toolCalls.map((tc) => {
				const live = liveTools[tc.id];
				return (
					<ToolCard
						key={tc.id}
						sessionId={sessionId}
						name={live?.toolName ?? tc.name}
						args={live?.args ?? tc.args}
						intent={tc.intent ?? live?.intent ?? null}
						status={live?.status ?? "called"}
						output={live?.text}
						details={live?.details}
					/>
				);
			})}
			{usage && (
				<div className="mt-0.5 text-[10px] text-neutral-600">
					{usage.totalTokens.toLocaleString()} tokens
				</div>
			)}
		</div>
	);
}

function ItemRow({
	sessionId,
	item,
}: {
	sessionId: string;
	item: TranscriptItem;
}) {
	switch (item.kind) {
		case "user":
			return (
				<div className="flex justify-end">
					<div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-indigo-950/60 px-3 py-1.5 text-[13px] text-neutral-100">
						{item.text}
					</div>
				</div>
			);
		case "assistant":
			return (
				<AssistantBody
					sessionId={sessionId}
					text={item.text ?? ""}
					thinking={item.thinking}
					toolCalls={item.toolCalls}
					usage={item.usage}
				/>
			);
		case "tool_result":
		case "bash": {
			const r = item.toolResult;
			return (
				<ToolCard
					sessionId={sessionId}
					name={r?.toolName ?? item.kind}
					status={r?.isError ? "error" : "done"}
					output={r?.text ?? item.text ?? ""}
					details={r?.details}
				/>
			);
		}
		case "compaction":
		case "branch_summary":
		case "model_change":
		case "system":
		case "custom":
			return (
				<div className="py-0.5 text-center text-[11px] text-neutral-600">
					{item.text ?? item.kind}
				</div>
			);
		default:
			return item.text ? (
				<div className="text-[12px] text-neutral-500">{item.text}</div>
			) : null;
	}
}

function StreamingRow({
	sessionId,
	message,
}: {
	sessionId: string;
	message: AgentMessage;
}) {
	return (
		<div className="border-l-2 border-indigo-600/60 pl-2">
			<AssistantBody
				sessionId={sessionId}
				text={messageText(message.content)}
				thinking={messageThinking(message.content)}
				toolCalls={messageToolCalls(message.content)}
			/>
		</div>
	);
}

export function MessageList({
	sessionId,
	scrollRef,
}: {
	sessionId: string;
	scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
	const live = useLive((s) => s.sessions[sessionId]);
	const items = live?.items ?? [];
	const streamingMessage = live?.streamingMessage ?? null;
	const [showHidden, setShowHidden] = useState(false);

	const visible = showHidden ? items : items.filter((i) => !i.hidden);
	const rows: (TranscriptItem | "live")[] = streamingMessage
		? [...visible, "live"]
		: visible;
	const hiddenCount = items.length - visible.length;

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 90,
		overscan: 8,
	});

	// Keep pinned to bottom while content grows (user can scroll up freely —
	// virtualizer still renders; we only auto-scroll when near the bottom).
	const lastCount = useRef(0);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || rows.length === lastCount.current) return;
		lastCount.current = rows.length;
		const nearBottom =
			el.scrollHeight - el.scrollTop - el.clientHeight < 240;
		if (nearBottom) el.scrollTop = el.scrollHeight;
	}, [rows.length, scrollRef]);

	return (
		<div className="flex h-full flex-col">
			{hiddenCount > 0 && (
				<button
					type="button"
					onClick={() => setShowHidden((v) => !v)}
					className="mx-auto mt-1 shrink-0 rounded bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-500 hover:text-neutral-300"
				>
					{showHidden ? "隐藏系统消息" : `显示 ${hiddenCount} 条隐藏消息`}
				</button>
			)}
			<div className="relative min-h-0 flex-1">
				<div
					style={{ height: virtualizer.getTotalSize() }}
					className="relative w-full"
				>
					{virtualizer.getVirtualItems().map((row) => {
						const item = rows[row.index];
						return (
							<div
								key={row.key}
								data-index={row.index}
								ref={virtualizer.measureElement}
								style={{ transform: `translateY(${row.start}px)` }}
								className={clsx(
									"absolute left-0 top-0 w-full px-3 py-1",
									item === "live" && "opacity-90",
								)}
								id={
									item === "live" ? "msg-live" : `msg-${item.id}`
								}
							>
								{item === "live" ? (
									<StreamingRow
										sessionId={sessionId}
										message={streamingMessage!}
									/>
								) : (
									<ItemRow sessionId={sessionId} item={item} />
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
