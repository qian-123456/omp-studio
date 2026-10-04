import type {
	ToolCall,
	ToolResultInfo,
	TranscriptItem,
	TranscriptKind,
} from "../../lib/contracts";

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
	  }
	/**
	 * Protocol/system item that arrived mid-run; id = `notice-${item.id}`.
	 */
	| {
			id: string;
			kind: "notice";
			item: TranscriptItem;
	  }
	/**
	 * Human message injected mid-run (steer) while the agent was still
	 * executing tools; kept in chronological order inside the turn.
	 */
	| {
			id: string;
			kind: "steer";
			item: TranscriptItem;
			text: string;
	  };

export interface TurnBlock {
	type: "turn";
	/** `turn-${userItem.id}`, or `turn-${first item id}` when userItem is null. */
	id: string;
	/** null = agent activity with no preceding visible user message (render no user bubble). */
	userItem: TranscriptItem | null;
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
 * Compact Chinese duration for the turn-activity rows: "2分3秒" / "5秒" / "1小时4分".
 */
export function formatDurationCompact(ms: number): string {
	if (ms <= 0) return "0秒";
	const totalSec = Math.round(ms / 1000);
	if (totalSec < 60) return `${Math.max(1, totalSec)}秒`;
	const minutes = Math.floor(totalSec / 60);
	const seconds = totalSec % 60;
	if (minutes < 60) {
		return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
	}
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0
		? `${hours}小时${remainingMinutes}分`
		: `${hours}小时`;
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
 * True for kinds that form protocol rows between turns / notice steps mid-run:
 * model_change | compaction | system | custom.
 */
export function isProtocolKind(kind: TranscriptKind): boolean {
	return (
		kind === "model_change" ||
		kind === "compaction" ||
		kind === "system" ||
		kind === "custom"
	);
}

/**
 * Short Chinese label for a protocol/notice item; never the raw kind.
 */
export function noticeLabel(item: TranscriptItem): string {
	switch (item.kind) {
		case "model_change":
			return `模型切换 → ${
				formatShortModel(item.model ?? item.text) ||
				(item.model ?? item.text ?? "?")
			}`;
		case "compaction":
			return "上下文压缩已完成";
		case "branch_summary":
			return "分支总结";
		case "thinking_level_change":
			return `思考等级 → ${item.text ?? "?"}`;
		default:
			return "系统通知";
	}
}

/**
 * Item text with one outer `<system-notice>` / `<system-reminder>` wrapper removed.
 */
export function noticeBody(item: TranscriptItem): string {
	const text = item.text?.trim() ?? "";
	if (!text) return "";
	const m = text.match(/^<system-(notice|reminder)>([\s\S]*)<\/system-\1>$/);
	return m ? m[2].trim() : text;
}

/**
 * One-line summary: first non-empty line of the notice body for generic notices;
 * "" when the label already says everything (model_change, compaction, …).
 */
export function noticeSummary(item: TranscriptItem): string {
	if (noticeLabel(item) !== "系统通知") return "";
	return (
		noticeBody(item)
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? ""
	);
}

/**
 * Groups a linear list of transcript items into DisplayBlocks (TurnBlocks and ProtocolBlocks).
 *
 * Rules:
 * 1. A "user" item begins a TurnBlock; agent activity (assistant/tool_result) with no
 *    preceding visible user message opens a TurnBlock whose userItem is null.
 * 2. Items belonging to the turn:
 *    - "assistant" items with thinking/toolCalls become intermediateSteps.
 *    - "tool_result" items pair with the corresponding toolCall in intermediateSteps
 *      (or become orphan-result text steps).
 *    - Assistant items followed by another assistant item in the turn: text becomes a text step.
 *    - The last assistant item becomes the answerItem; when it carries toolCalls (e.g. `ask`)
 *      it is the answer only if it has text, and its calls still become tool steps.
 *      If that final assistant item also had thinking, the thinking is captured as an intermediateStep!
 *    - Protocol items (isProtocolKind) that arrive mid-run — i.e. assistant/tool activity
 *      follows before the next user message — become "notice" steps in intermediateSteps.
 *    - A "user" item that interrupts tool execution (previous visible item is a tool call /
 *      tool result and the agent keeps working after it) is a steer: it becomes a "steer"
 *      step in chronological order instead of splitting the turn (omp-tui behavior).
 * 3. Any other new "user" item ends the current TurnBlock.
 * 4. Protocol items outside a running turn (or with no agent activity after them), and any
 *    other kind with no active turn, form standalone ProtocolBlocks.
 */
export function groupTurnBlocks(items: TranscriptItem[]): DisplayBlock[] {
	const blocks: DisplayBlock[] = [];

	let currentTurn: {
		userItem: TranscriptItem | null;
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
			id: currentTurn.userItem
				? `turn-${currentTurn.userItem.id}`
				: `turn-${currentTurn.allItemIds[0]}`,
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

	// True when the agent keeps working after index i: scan forward skipping
	// hidden items; true at the first assistant/tool_result, false at user/end.
	const hasAgentActivityAfter = (i: number): boolean => {
		for (let j = i + 1; j < items.length; j++) {
			const next = items[j];
			if (next.hidden) continue;
			if (next.kind === "user") return isSteer(j);
			if (next.kind === "assistant" || next.kind === "tool_result")
				return true;
		}
		return false;
	};

	// A user item at index i is a mid-run steer when the agent was executing
	// tools right before it and continues working after it.
	const isSteer = (i: number): boolean => {
		let prev: TranscriptItem | undefined;
		for (let j = i - 1; j >= 0; j--) {
			const p = items[j];
			if (p.hidden || isProtocolKind(p.kind)) continue;
			prev = p;
			break;
		}
		if (!prev) return false;
		const midTools =
			prev.kind === "tool_result" ||
			Boolean(prev.toolResult) ||
			(prev.kind === "assistant" && (prev.toolCalls?.length ?? 0) > 0);
		return midTools && hasAgentActivityAfter(i);
	};

	for (let i = 0; i < items.length; i++) {
		const item = items[i];

		// Hidden items are skipped
		if (item.hidden) {
			continue;
		}

		// User message starts a turn
		if (item.kind === "user") {
			if (currentTurn && isSteer(i)) {
				currentTurn.intermediateSteps.push({
					id: `steer-${item.id}`,
					kind: "steer",
					item,
					text: item.text ?? "",
				});
				currentTurn.allItemIds.push(item.id);
				if (item.ts) currentTurn.endTime = item.ts;
				continue;
			}
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

		// Protocol item: mid-run it becomes a notice step inside the turn;
		// otherwise it is a standalone ProtocolBlock between turns.
		if (isProtocolKind(item.kind)) {
			if (currentTurn && hasAgentActivityAfter(i)) {
				currentTurn.intermediateSteps.push({
					id: `notice-${item.id}`,
					kind: "notice",
					item,
				});
				currentTurn.allItemIds.push(item.id);
				if (item.ts) currentTurn.endTime = item.ts;
				continue;
			}
			finalizeCurrentTurn();
			blocks.push({
				type: "protocol",
				id: `protocol-${item.id}`,
				item,
				allItemIds: [item.id],
			});
			continue;
		}

		if (!currentTurn) {
			if (item.kind === "assistant" || item.kind === "tool_result") {
				// Agent activity with no preceding visible user message: open a
				// userless turn, then handle the item normally below.
				currentTurn = {
					userItem: null,
					intermediateSteps: [],
					allItemIds: [],
					startTime: item.ts,
					endTime: item.ts,
				};
			} else {
				// Any other kind without a turn: standalone protocol row.
				blocks.push({
					type: "protocol",
					id: `protocol-${item.id}`,
					item,
					allItemIds: [item.id],
				});
				continue;
			}
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
				if (next.kind === "user") {
					if (isSteer(j)) continue;
					break;
				}
				if (next.kind === "assistant") {
					hasSubsequentAssistantOrUser = true;
					break;
				}
			}

			const hasToolCalls = (item.toolCalls && item.toolCalls.length > 0) || false;
			const hasText = (item.text?.trim().length ?? 0) > 0;
			// Only a later assistant item demotes this one to a step. The last
			// assistant item's prose is the answer even when it also carries tool
			// calls (e.g. the `ask` call that hands the turn to the human).
			const isIntermediate = hasSubsequentAssistantOrUser;

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
				if (hasText) {
					if (isIntermediate) {
						currentTurn.intermediateSteps.push({
							id: `text-${item.id}`,
							kind: "text",
							item,
							text: item.text ?? "",
						});
					} else {
						currentTurn.answerItem = item;
					}
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

// ---- Codex-style activity grouping ---------------------------------------

/** Row families that fold into one summary row (Codex agent-activity-units). */
export type ActivityGroupKind = "exploration" | "commands" | "edits";

const GROUP_KIND: Record<string, ActivityGroupKind> = {
	read: "exploration",
	read_file: "exploration",
	list: "exploration",
	ls: "exploration",
	list_files: "exploration",
	find: "exploration",
	fd: "exploration",
	grep: "exploration",
	search: "exploration",
	search_files: "exploration",
	rg: "exploration",
	glob: "exploration",
	bash: "commands",
	shell: "commands",
	exec: "commands",
	run: "commands",
	command: "commands",
	edit: "edits",
	edit_file: "edits",
	ast_edit: "edits",
	write: "edits",
	write_file: "edits",
};

const SEARCH_TOOLS: Record<string, true> = {
	grep: true,
	search: true,
	search_files: true,
	rg: true,
	glob: true,
};

/** Group bucket for a tool name, undefined when the tool never folds. */
export function activityGroupKind(name: string): ActivityGroupKind | undefined {
	return GROUP_KIND[name.toLowerCase()];
}

/**
 * Chinese summary for a folded run:
 * exploration "已浏览 3 个文件、2 次搜索", commands "已运行 3 条命令",
 * edits "已编辑 2 个文件" (distinct paths); running → "正在浏览…" etc.
 */
export function activityGroupSummary(
	kind: ActivityGroupKind,
	steps: { call: { name: string; args: unknown } }[],
	running: boolean,
): string {
	if (kind === "commands") {
		return running ? "正在运行命令…" : `已运行 ${steps.length} 条命令`;
	}
	if (kind === "edits") {
		if (running) return "正在编辑…";
		const paths = new Set(
			steps.map((s) => {
				const a = s.call.args as Record<string, unknown> | null;
				const p = a?.path ?? a?.file ?? a?.filePath;
				return typeof p === "string" ? p : s.call.name;
			}),
		);
		return `已编辑 ${paths.size} 个文件`;
	}
	if (running) return "正在浏览…";
	const searches = steps.filter(
		(s) => SEARCH_TOOLS[s.call.name.toLowerCase()],
	).length;
	const files = steps.length - searches;
	const parts: string[] = [];
	if (files > 0) parts.push(`${files} 个文件`);
	if (searches > 0) parts.push(`${searches} 次搜索`);
	return `已浏览 ${parts.join("、")}`;
}

/** One row in the rendered activity list. */
export type ActivityUnit<T extends { kind: string }> =
	| { kind: "step"; step: T }
	| {
			kind: "group";
			group: ActivityGroupKind;
			steps: Extract<T, { kind: "tool" }>[];
	  };

/**
 * Folds consecutive tool steps of the same group kind (exploration /
 * commands / edits) into one summary row; reasoning inside a run is
 * absorbed. Two or more consecutive same-kind tools form a group — a lone
 * one stays a row. Works on TurnStep and on live pseudo-steps.
 */
export function groupActivityUnits<
	T extends { kind: string; call?: { name: string } },
>(steps: T[]): ActivityUnit<T>[] {
	const units: ActivityUnit<T>[] = [];
	let pending: T[] = [];
	let pendingKind: ActivityGroupKind | undefined;

	const flush = () => {
		if (pending.length === 1) {
			units.push({ kind: "step", step: pending[0] });
		} else if (pending.length > 1 && pendingKind) {
			units.push({
				kind: "group",
				group: pendingKind,
				steps: pending as Extract<T, { kind: "tool" }>[],
			});
		}
		pending = [];
		pendingKind = undefined;
	};

	for (const step of steps) {
		const group =
			step.kind === "tool" && step.call
				? activityGroupKind(step.call.name)
				: undefined;
		if (group) {
			if (group !== pendingKind) flush();
			pending.push(step);
			pendingKind = group;
			continue;
		}
		// Reasoning inside a foldable run is absorbed into the group.
		if (step.kind === "thinking" && pending.length > 0) {
			continue;
		}
		flush();
		units.push({ kind: "step", step });
	}
	flush();
	return units;
}
