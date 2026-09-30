import type { ToolCall, ToolResultInfo, TranscriptItem } from "../../lib/contracts";

export type TurnStep =
	| {
			id: string;
			kind: "thinking";
			item: TranscriptItem;
			thinking: string;
	  }
	| {
			id: string;
			kind: "tool";
			item: TranscriptItem;
			call: ToolCall;
			result?: ToolResultInfo;
	  }
	| {
			id: string;
			kind: "text";
			item: TranscriptItem;
			text: string;
	  };

export interface TurnBlock {
	type: "turn";
	id: string;
	userItem: TranscriptItem;
	intermediateSteps: TurnStep[];
	answerItem?: TranscriptItem;
	allItemIds: string[];
	durationMs?: number;
	stepCount: number;
}

export interface ProtocolBlock {
	type: "protocol";
	id: string;
	item: TranscriptItem;
	allItemIds: string[];
}

export type DisplayBlock = TurnBlock | ProtocolBlock;

/**
 * Format milliseconds into Chinese duration string:
 * e.g. "12 秒", "1 分 23 秒", "2 小时 5 分"
 */
export function formatDurationChinese(ms: number): string {
	if (ms <= 0) return "0 秒";
	const totalSec = Math.round(ms / 1000);
	if (totalSec < 60) {
		return `${Math.max(1, totalSec)} 秒`;
	}
	const minutes = Math.floor(totalSec / 60);
	const seconds = totalSec % 60;
	if (minutes < 60) {
		return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
	}
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0
		? `${hours} 小时 ${remainingMinutes} 分`
		: `${hours} 小时`;
}

/**
 * Formats a full model string (e.g. "anthropic/claude-3-5-sonnet-20241022" or "claude-3-7-sonnet")
 * into a clean, short display name (e.g. "Claude 3.5 Sonnet", "Claude 3.7 Sonnet").
 */
export function formatShortModel(model?: string | null): string {
	if (!model) return "";
	const raw = model.includes("/") ? model.split("/").pop()! : model;
	// Match common patterns
	const lower = raw.toLowerCase();
	if (lower.includes("claude-3-7-sonnet") || lower.includes("claude-3.7-sonnet"))
		return "Claude 3.7 Sonnet";
	if (lower.includes("claude-3-5-sonnet") || lower.includes("claude-3.5-sonnet"))
		return "Claude 3.5 Sonnet";
	if (lower.includes("claude-3-5-haiku") || lower.includes("claude-3.5-haiku"))
		return "Claude 3.5 Haiku";
	if (lower.includes("claude-3-opus") || lower.includes("claude-3.0-opus"))
		return "Claude 3 Opus";
	if (lower.includes("gpt-4o-mini")) return "GPT-4o mini";
	if (lower.includes("gpt-4o")) return "GPT-4o";
	if (lower.includes("o1-mini")) return "o1-mini";
	if (lower.includes("o1-preview")) return "o1-preview";
	if (lower.includes("o1")) return "o1";
	if (lower.includes("o3-mini")) return "o3-mini";
	if (lower.includes("deepseek-r1")) return "DeepSeek R1";
	if (lower.includes("deepseek-v3")) return "DeepSeek V3";
	if (lower.includes("gemini-2.0-flash")) return "Gemini 2.0 Flash";
	if (lower.includes("gemini-1.5-pro")) return "Gemini 1.5 Pro";
	return raw;
}

/**
 * Computes duration between start and end timestamps.
 */
export function computeDurationMs(
	start?: string | number | null,
	end?: string | number | null,
): number | undefined {
	if (!start || !end) return undefined;
	const s = typeof start === "number" ? start : new Date(start).getTime();
	const e = typeof end === "number" ? end : new Date(end).getTime();
	if (isNaN(s) || isNaN(e) || e < s) return undefined;
	return e - s;
}

/**
 * Groups a linear list of transcript items into DisplayBlocks (TurnBlocks and ProtocolBlocks).
 *
 * Rules:
 * 1. Protocol / system items (e.g. kind="model_change", "compaction", "system", "custom") become ProtocolBlocks.
 * 2. A "user" item begins a TurnBlock.
 * 3. Subsequent items belonging to the turn:
 *    - "assistant" items with thinking/toolCalls become intermediateSteps.
 *    - "tool_result" items pair with the corresponding toolCall in intermediateSteps (or become orphan tool steps).
 *    - Intermediate assistant items with text become text steps in intermediateSteps.
 *    - The final "assistant" item with text (or last assistant item) becomes the answerItem.
 *      If that final assistant item also had thinking, the thinking is captured as an intermediateStep!
 * 4. A new "user" item or a standalone protocol item ends the current TurnBlock.
 */
export function groupTurnBlocks(items: TranscriptItem[]): DisplayBlock[] {
	const blocks: DisplayBlock[] = [];

	let currentTurn: {
		userItem: TranscriptItem;
		intermediateSteps: TurnStep[];
		answerItem?: TranscriptItem;
		allItemIds: string[];
		startTime?: string;
		endTime?: string;
	} | null = null;

	const finalizeCurrentTurn = () => {
		if (!currentTurn) return;

		// Calculate stepCount
		const stepCount = currentTurn.intermediateSteps.length;

		// Calculate duration
		let durationMs: number | undefined;
		if (currentTurn.startTime && currentTurn.endTime) {
			durationMs = computeDurationMs(
				currentTurn.startTime,
				currentTurn.endTime,
			);
		}

		blocks.push({
			type: "turn",
			id: `turn-${currentTurn.userItem.id}`,
			userItem: currentTurn.userItem,
			intermediateSteps: currentTurn.intermediateSteps,
			answerItem: currentTurn.answerItem,
			allItemIds: currentTurn.allItemIds,
			durationMs,
			stepCount,
		});

		currentTurn = null;
	};

	// Helper to find a matching tool call in intermediateSteps to attach tool_result
	const attachToolResult = (resultInfo: ToolResultInfo) => {
		if (!currentTurn) return false;
		const callId = resultInfo.toolCallId;
		if (!callId) return false;

		for (let i = currentTurn.intermediateSteps.length - 1; i >= 0; i--) {
			const step = currentTurn.intermediateSteps[i];
			if (step.kind === "tool" && step.call.id === callId && !step.result) {
				step.result = resultInfo;
				return true;
			}
		}
		return false;
	};

	for (let i = 0; i < items.length; i++) {
		const item = items[i];

		// Hidden items are skipped
		if (item.hidden) {
			continue;
		}

		// User message starts a turn
		if (item.kind === "user") {
			finalizeCurrentTurn();
			currentTurn = {
				userItem: item,
				intermediateSteps: [],
				allItemIds: [item.id],
				startTime: item.ts,
				endTime: item.ts,
			};
			continue;
		}

		// If no active turn, check if it's protocol or orphan assistant/tool
		if (!currentTurn) {
			if (
				item.kind === "model_change" ||
				item.kind === "compaction" ||
				item.kind === "system" ||
				item.kind === "custom"
			) {
				blocks.push({
					type: "protocol",
					id: `protocol-${item.id}`,
					item,
					allItemIds: [item.id],
				});
			} else {
				// Orphan assistant or tool_result without a preceding user message
				// Wrap into a synthetic turn or protocol block
				blocks.push({
					type: "protocol",
					id: `orphan-${item.id}`,
					item,
					allItemIds: [item.id],
				});
			}
			continue;
		}

		// Active turn: check if item is protocol that breaks the turn
		if (
			item.kind === "model_change" ||
			item.kind === "compaction" ||
			item.kind === "system" ||
			item.kind === "custom"
		) {
			finalizeCurrentTurn();
			blocks.push({
				type: "protocol",
				id: `protocol-${item.id}`,
				item,
				allItemIds: [item.id],
			});
			continue;
		}

		// If tool result, attach to matching tool call in currentTurn
		if (item.kind === "tool_result" || item.toolResult) {
			currentTurn.allItemIds.push(item.id);
			if (item.ts) currentTurn.endTime = item.ts;

			const res = item.toolResult ?? {
				toolCallId: "",
				toolName: "tool",
				text: item.text ?? "",
				isError: false,
				details: null,
			};

			const attached = attachToolResult(res);
			if (!attached) {
				// Standalone tool result
				currentTurn.intermediateSteps.push({
					id: `orphan-result-${item.id}`,
					kind: "text",
					item,
					text: item.text || item.toolResult?.text || "[工具输出]",
				});
			}
			continue;
		}

		// Assistant message
		if (item.kind === "assistant") {
			currentTurn.allItemIds.push(item.id);
			if (item.ts) currentTurn.endTime = item.ts;

			// Lookahead: is there another assistant or user message following?
			let hasSubsequentAssistantOrUser = false;
			for (let j = i + 1; j < items.length; j++) {
				const next = items[j];
				if (next.hidden) continue;
				if (next.kind === "user") break;
				if (next.kind === "assistant") {
					hasSubsequentAssistantOrUser = true;
					break;
				}
			}

			const hasToolCalls = (item.toolCalls && item.toolCalls.length > 0) || false;
			const isIntermediate = hasSubsequentAssistantOrUser || hasToolCalls;

			// If it has thinking, extract thinking as a step
			if (item.thinking && item.thinking.trim().length > 0) {
				currentTurn.intermediateSteps.push({
					id: `thinking-${item.id}`,
					kind: "thinking",
					item,
					thinking: item.thinking,
				});
			}

			// If it has tool calls, each tool call becomes a step
			if (hasToolCalls && item.toolCalls) {
				// If there's also intermediate text before tool calls, add it as a text step
				if (item.text && item.text.trim().length > 0) {
					currentTurn.intermediateSteps.push({
						id: `text-${item.id}`,
						kind: "text",
						item,
						text: item.text,
					});
				}

				for (const call of item.toolCalls) {
					currentTurn.intermediateSteps.push({
						id: `call-${call.id}`,
						kind: "tool",
						item,
						call,
					});
				}
			} else if (isIntermediate) {
				// Intermediate assistant message with text (no tool calls, but followed by more assistant messages)
				if (item.text && item.text.trim().length > 0) {
					currentTurn.intermediateSteps.push({
						id: `text-${item.id}`,
						kind: "text",
						item,
						text: item.text,
					});
				}
			} else {
				// Final assistant message of the turn!
				currentTurn.answerItem = item;
			}
			continue;
		}

		// Fallback: any other item
		currentTurn.allItemIds.push(item.id);
	}

	finalizeCurrentTurn();

	return blocks;
}
