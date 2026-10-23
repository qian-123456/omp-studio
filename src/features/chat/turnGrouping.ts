import { splitThinkTags } from "../../lib/thinkTags";
import type {
	ToolCall,
	ToolResultInfo,
	TranscriptItem,
	TranscriptKind,
} from "../../lib/contracts";
import { flowNoticeText, isFlowItem, persistedCompactionText } from "./flowNotice";
import { isLocalRowItem } from "./localRows";

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
	  }
	/**
	 * A model request that failed (stopReason "error") and was retried: it has no
	 * tool rows or prose of its own, only its failure line, rendered in place.
	 * id = `failed-${item.id}`.
	 */
	| {
			id: string;
			kind: "request-failed";
			item: TranscriptItem;
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
	/** Epoch ms of the turn's last transcript item (the parent's own end). */
	endedAtMs?: number;
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
 * Element anchor (rendered as `msg-<anchor>`) of the newest user request: the
 * last turn's latest steer, else its user message. null when the last turn has
 * no visible request of its own.
 */
export function latestRequestAnchor(blocks: readonly DisplayBlock[]): string | null {
	for (let i = blocks.length - 1; i >= 0; i--) {
		const b = blocks[i];
		if (b.type !== "turn") continue;
		for (let j = b.intermediateSteps.length - 1; j >= 0; j--) {
			const step = b.intermediateSteps[j];
			if (step.kind === "steer") return step.id;
		}
		return b.userItem?.id ?? null;
	}
	return null;
}
/**
 * Format a chat message time; absent or invalid timestamps stay hidden.
 * Today: "HH:mm"; earlier this year: "M月D日 HH:mm"; other years: "YYYY年M月D日 HH:mm".
 */
export function formatMessageTimestamp(
	timestamp?: string | number | null,
	now: Date = new Date(),
): string {
	if (timestamp == null || timestamp === "") return "";
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "";
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const time = `${hours}:${minutes}`;
	if (date.getFullYear() !== now.getFullYear()) {
		return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
	}
	if (date.getMonth() !== now.getMonth() || date.getDate() !== now.getDate()) {
		return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
	}
	return time;
}

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
	const geminiMatch = lower.match(/gemini[_-]?(\d+(?:\.\d+)?)?[_-]?(flash|pro)?/);
	if (geminiMatch && (geminiMatch[1] || geminiMatch[2])) {
		const ver = geminiMatch[1] ?? "";
		const kind = geminiMatch[2] ? geminiMatch[2].charAt(0).toUpperCase() + geminiMatch[2].slice(1) : "";
		return `Gemini ${ver} ${kind}`.trim();
	}
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
			return isFlowItem(item) ? flowNoticeText(item.flow) : persistedCompactionText(item);
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
 * Reasoning a provider put inside the reply text (`<think>…</think>`) moves
 * into the item's thinking, so it groups as a thinking step instead of prose.
 * Items without tags are returned as-is.
 */
function splitItemThinkTags(item: TranscriptItem): TranscriptItem {
	if (item.kind !== "assistant" || !item.text) return item;
	const split = splitThinkTags(item.text);
	if (split.thinking === "" && split.text === item.text) return item;
	const thinking = [item.thinking, split.thinking]
		.filter((t): t is string => !!t?.trim())
		.join("\n\n");
	return { ...item, text: split.text || null, thinking: thinking || null };
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
export function groupTurnBlocks(rawItems: TranscriptItem[]): DisplayBlock[] {
	const items = rawItems.map(splitItemThinkTags);
	const blocks: DisplayBlock[] = [];

	let currentTurn: {
		userItem: TranscriptItem | null;
		intermediateSteps: TurnStep[];
		answerItem?: TranscriptItem;
		allItemIds: string[];
		startTime?: string;
		endTime?: string;
		/** Wall time the agent sat idle (finished, waiting for a wake-up) inside this turn. */
		idleMs?: number;
		/** The last item ended the agent's run (assistant message without tool calls). */
		lastIdle?: boolean;
	} | null = null;

	// Advance the turn end. A gap after a finished assistant message is idle time
	// (e.g. a background-job notice waking the agent a day later), not work.
	const bump = (
		turn: NonNullable<typeof currentTurn>,
		item: TranscriptItem,
	) => {
		if (!item.ts) return;
		if (turn.lastIdle && turn.endTime) {
			turn.idleMs =
				(turn.idleMs ?? 0) + (computeDurationMs(turn.endTime, item.ts) ?? 0);
		}
		turn.endTime = item.ts;
		turn.lastIdle = item.kind === "assistant" && !item.toolCalls?.length;
	};

	const finalizeCurrentTurn = () => {
		if (!currentTurn) return;

		// Calculate stepCount
		const stepCount = currentTurn.intermediateSteps.length;

		// Calculate duration
		let durationMs: number | undefined;
		if (currentTurn.startTime && currentTurn.endTime) {
			const wall = computeDurationMs(currentTurn.startTime, currentTurn.endTime);
			if (wall !== undefined) durationMs = Math.max(0, wall - (currentTurn.idleMs ?? 0));
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
			endedAtMs: currentTurn.endTime ? Date.parse(currentTurn.endTime) || undefined : undefined,
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

		// App-local row (slash echo / result card): a standalone row that splits
		// the turn, so output written after it groups below instead of above.
		if (isLocalRowItem(item)) {
			finalizeCurrentTurn();
			blocks.push({
				type: "protocol",
				id: `protocol-${item.id}`,
				item,
				allItemIds: [item.id],
			});
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
				bump(currentTurn, item);
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
				bump(currentTurn, item);
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
			bump(currentTurn, item);

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
			bump(currentTurn, item);

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
			} else if (isIntermediate && item.stopReason === "error") {
				// Failed request (retried by omp): its text is the error message,
				// not prose. Render only the failure line, in order.
				currentTurn.intermediateSteps.push({
					id: `failed-${item.id}`,
					kind: "request-failed",
					item,
				});
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

const PATH_ARG_KEYS = ["path", "file", "filePath", "target_file"];
/** Hashline edit header: `[path#HASH]` on its own line. */
const HASHLINE_HEADER_RE = /^\[(.+)#[0-9A-Za-z]{2,8}\][ \t]*$/;

/**
 * Files a tool call targets. Plain tools carry `path`/`file`; omp's default
 * hashline edit mode has only `{input: "[src/x.ts#HASH]\n…"}` with one
 * `[path#hash]` header per file section, so those are parsed out of `input`.
 */
export function toolFilePaths(args: unknown): string[] {
	if (typeof args !== "object" || args === null) return [];
	const o = args as Record<string, unknown>;
	for (const k of PATH_ARG_KEYS) {
		const v = o[k];
		if (typeof v === "string" && v) return [v];
	}
	if (typeof o.input !== "string") return [];
	const out: string[] = [];
	for (const line of o.input.split("\n")) {
		const m = HASHLINE_HEADER_RE.exec(line);
		if (m && !out.includes(m[1])) out.push(m[1]);
	}
	return out;
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
			steps.flatMap((s) => {
				const found = toolFilePaths(s.call.args);
				return found.length > 0 ? found : [s.call.name];
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
	T extends { kind: string; call?: { name: string }; running?: boolean },
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

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
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
		// Settled reasoning inside a run is absorbed into the group, but only
		// when the run continues with the same kind afterwards. Running
		// reasoning is never absorbed (it is the live row), and reasoning that
		// leads into a different tool or text stays a visible row.
		if (
			step.kind === "thinking" &&
			pending.length > 0 &&
			!step.running &&
			continuesRun(steps, i, pendingKind)
		) {
			continue;
		}
		flush();
		units.push({ kind: "step", step });
	}
	flush();
	return units;
}

/** True when the first non-thinking step after `from` is a tool of `kind`. */
function continuesRun<T extends { kind: string; call?: { name: string } }>(
	steps: T[],
	from: number,
	kind: ActivityGroupKind | undefined,
): boolean {
	for (let j = from + 1; j < steps.length; j++) {
		const next = steps[j];
		if (next.kind === "thinking") continue;
		return (
			next.kind === "tool" && !!next.call && activityGroupKind(next.call.name) === kind
		);
	}
	return false;
}

// ---- per-request stats line placement -----------------------------------

/** Structural view of a rendered row; TurnStep and live pseudo-steps both fit. */
export type PlacedStep = {
	id: string;
	kind: string;
	call?: { id: string };
	item?: TranscriptItem | null;
	/** Live rows have no transcript item; the completed request id stands in. */
	requestId?: string;
};

/**
 * The row each request's stats line hangs under: the LAST of that request's
 * tool rows, so parallel tool calls (one request, several rows) collapse into
 * a single line under the last one. A request without tool calls hangs under
 * its last own thinking/prose row, so it keeps its chronological place. A
 * request with no row at all maps to null — the caller renders its line after
 * the whole list. A failed-request row renders its own line and is no anchor.
 */
export function requestAnchors(
	rows: PlacedStep[],
	requests: { id: string; toolCallIds: string[] }[],
): Map<string, string | null> {
	const out = new Map<string, string | null>();
	for (const req of requests) {
		const ids = new Set(req.toolCallIds);
		let anchor: string | null = null;
		for (const row of rows) {
			if (row.kind === "tool" && row.call && ids.has(row.call.id)) anchor = row.id;
		}
		if (!anchor && ids.size === 0) {
			for (const row of rows) {
				if (row.kind === "tool" || row.kind === "request-failed") continue;
				if ((row.requestId ?? row.item?.id) === req.id) anchor = row.id;
			}
		}
		out.set(req.id, anchor);
	}
	return out;
}

/** Where a row sits inside its parallel run (the thin right-hand bracket). */
export interface ParallelRunMark {
	first: boolean;
	last: boolean;
}

/**
 * Marks the runs of ≥2 rows one model request issued together (parallel tool
 * calls), so the renderer can join them with a thin bracket. Runs never span
 * units: each unit is its own contiguous container.
 */
export function parallelToolRuns(
	unitSteps: PlacedStep[][],
): Map<string, ParallelRunMark> {
	const out = new Map<string, ParallelRunMark>();
	for (const unit of unitSteps) {
		let run: PlacedStep[] = [];
		let runOwner: string | null = null;
		const flush = () => {
			if (run.length > 1) {
				const last = run.length - 1;
				run.forEach((row, i) => {
					out.set(row.id, { first: i === 0, last: i === last });
				});
			}
			run = [];
			runOwner = null;
		};
		for (const row of unit) {
			const owner = row.kind === "tool" ? (row.requestId ?? row.item?.id ?? null) : null;
			if (owner && owner === runOwner) {
				run.push(row);
				continue;
			}
			flush();
			runOwner = owner;
			if (owner) run.push(row);
		}
		flush();
	}
	return out;
}

/**
 * The assistant items behind a turn's rendered rows — one entry per model
 * request, in first-appearance order (the answer last). Feeds the per-request
 * stats lines and the turn totals of the 「已处理」 divider.
 */
export function turnRequestItems(
	steps: PlacedStep[],
	answerItem?: TranscriptItem | null,
): TranscriptItem[] {
	const seen = new Set<string>();
	const out: TranscriptItem[] = [];
	const push = (item?: TranscriptItem | null) => {
		if (!item || item.kind !== "assistant" || seen.has(item.id)) return;
		seen.add(item.id);
		out.push(item);
	};
	for (const step of steps) push(step.item);
	push(answerItem);
	return out;
}


/**
 * Splits a finished turn's steps into the part folded behind the 「已处理」
 * disclosure and the interim assistant prose that must stay visible. Prose
 * the assistant wrote between tool calls was readable while it streamed; it
 * must not vanish into the fold once the turn commits. Tool-result fallbacks
 * (`orphan-result-*`, not assistant prose) stay folded.
 */
export function splitInterimProse<
	T extends { kind: string; item?: TranscriptItem },
>(steps: T[]): { folded: T[]; prose: T[] } {
	const folded: T[] = [];
	const prose: T[] = [];
	for (const step of steps) {
		if (step.kind === "text" && step.item?.kind === "assistant") prose.push(step);
		else folded.push(step);
	}
	return { folded, prose };
}

/** One chronological piece of a turn: activity (folded) with the interim
 *  prose written in that stretch, or a steer delivered between stretches. */
export type SteerSegment<T> =
	| { type: "steps"; folded: T[]; prose: T[] }
	| { type: "steer"; step: T };

/**
 * Like `splitInterimProse`, but per steer-delimited segment: each segment's
 * interim prose renders right after its own fold and before the steer that
 * followed it, so a steer never appears above the prose that prompted it.
 * Segments with neither folded steps nor prose are dropped.
 */
export function splitInterimProseBySteer<
	T extends { kind: string; item?: TranscriptItem },
>(steps: T[]): Array<SteerSegment<T>> {
	const out: Array<SteerSegment<T>> = [];
	for (const seg of splitAroundSteers(steps)) {
		if (seg.type === "steer") {
			out.push(seg);
			continue;
		}
		const { folded, prose } = splitInterimProse(seg.steps);
		if (folded.length > 0 || prose.length > 0) out.push({ type: "steps", folded, prose });
	}
	return out;
}

/**
 * Splits a turn's folded steps around in-turn user messages (steers) so each
 * steer renders at the transcript's top level in chronological position while
 * the surrounding activity stays in its own collapsed group(s).
 */
export function splitAroundSteers<T extends { kind: string }>(
	steps: T[],
): Array<{ type: "steps"; steps: T[] } | { type: "steer"; step: T }> {
	const out: Array<{ type: "steps"; steps: T[] } | { type: "steer"; step: T }> = [];
	let run: T[] = [];
	for (const step of steps) {
		if (step.kind === "steer") {
			if (run.length > 0) out.push({ type: "steps", steps: run });
			run = [];
			out.push({ type: "steer", step });
		} else {
			run.push(step);
		}
	}
	if (run.length > 0) out.push({ type: "steps", steps: run });
	return out;
}

/**
 * Layout of an in-flight turn once its final answer has started streaming —
 * the same shape a committed turn renders: activity folded behind the
 * disclosure, interim prose on the thread column, then the answer.
 */
export interface LiveTurnLayout<T> {
	/** Everything except assistant prose: thinking, tools, notices, steers. */
	activity: T[];
	/** Assistant prose written before the answer. */
	prose: T[];
	/** The answer being written; null while the turn is still working. */
	answer: T | null;
}

/**
 * The step the model is writing as its (possible) final answer: the turn's
 * trailing step when it is non-empty assistant prose. A tool call or reasoning
 * arriving after it proves it was interim prose, so it stops being a candidate.
 */
export function liveAnswerCandidate<T extends { kind: string; text?: string }>(
	steps: T[],
): T | null {
	const last = steps[steps.length - 1];
	return last && last.kind === "text" && (last.text ?? "").trim() !== "" ? last : null;
}

/**
 * Splits live steps into the committed-turn layout. Before the answer starts
 * (`answerStarted` false) everything stays in `activity` in arrival order.
 */
export function splitLiveTurn<T extends { kind: string; text?: string }>(
	steps: T[],
	answerStarted: boolean,
): LiveTurnLayout<T> {
	const answer = answerStarted ? liveAnswerCandidate(steps) : null;
	if (!answer) return { activity: steps, prose: [], answer: null };
	const activity: T[] = [];
	const prose: T[] = [];
	for (const step of steps) {
		if (step === answer) continue;
		if (step.kind === "text") prose.push(step);
		else activity.push(step);
	}
	return { activity, prose, answer };
}
