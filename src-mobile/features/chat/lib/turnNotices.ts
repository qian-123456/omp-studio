/**
 * Turn-flow notices for the phone thread: model auto-retry / fallback lines and
 * auto-compaction progress, collapsed into one short history line when the turn
 * ends (desktop `retryNotice` semantics, simplified). Fed straight from the
 * `rpc` event bus — deliberately outside chatStore, whose streaming state is
 * owned elsewhere. Pure; rendered by components/TurnNotices.tsx.
 *
 * Payload shapes follow omp's wire events (packages/coding-agent
 * src/modes/rpc/wire/events.ts):
 * - auto_retry_start {attempt, maxAttempts, delayMs, errorMessage}
 * - auto_retry_end {success, attempt, finalError?}
 * - retry_fallback_applied {from, to, role, reason?}
 * - retry_fallback_succeeded {model, role}
 * - auto_compaction_start {reason, action}
 * - auto_compaction_end {action, result?, aborted, willRetry, errorMessage?, skipped?}
 */
import type { RpcFrame } from "../../../core/types";

export type NoticeTone = "warn" | "ok" | "error";

export interface TurnNotice {
	id: number;
	tone: NoticeTone;
	/** Plain Chinese status line; errors are kept in full (rows wrap, never clipped). */
	text: string;
}

export interface CompactionNotice {
	status: "running" | "done" | "error";
	text: string;
}

export interface TurnNoticeState {
	retries: TurnNotice[];
	compaction: CompactionNotice | null;
	/** One-line per-turn history (「本轮重试 2 次 · 已切换备用模型」), set when the turn ends. */
	summary: string | null;
	retryCount: number;
	hadFallback: boolean;
	hadFailure: boolean;
}

export const emptyTurnNotices: TurnNoticeState = {
	retries: [],
	compaction: null,
	summary: null,
	retryCount: 0,
	hadFallback: false,
	hadFailure: false,
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

/** Model refs arrive as "provider/id" strings or `{provider, id}` objects (omp wire). */
export function modelLabel(v: unknown): string {
	if (typeof v === "string") return v;
	if (typeof v === "object" && v !== null) {
		const o = v as Record<string, unknown>;
		const id = str(o.id);
		const provider = str(o.provider);
		return provider && id ? `${provider}/${id}` : id || provider;
	}
	return "";
}

/** Collapse whitespace; errors stay complete — the row wraps instead of clipping. */
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

let seq = 0;
const nextId = () => ++seq;

/** Collapse the finished turn's retry / fallback activity into one summary line. */
export function retrySummary(s: TurnNoticeState): string | null {
	const parts: string[] = [];
	if (s.retryCount > 0) parts.push(`本轮重试 ${s.retryCount} 次`);
	if (s.hadFallback) parts.push("已切换备用模型");
	if (s.hadFailure) parts.push("重试未成功");
	return parts.length > 0 ? parts.join(" · ") : null;
}

/** Returns the next notice state for a turn-flow frame; other frames return `state` unchanged. */
export function reduceTurnNotice(state: TurnNoticeState, frame: RpcFrame): TurnNoticeState {
	switch (frame.type) {
		// A new turn starts from a clean slate: the history line belongs to the previous turn.
		case "turn_start":
		case "agent_start":
			return emptyTurnNotices;
		case "auto_retry_start": {
			const attempt = num(frame.attempt);
			const max = num(frame.maxAttempts);
			const delayMs = num(frame.delayMs);
			const err = oneLine(str(frame.errorMessage));
			const detail: string[] = [];
			if (attempt != null) {
				detail.push(max != null ? `第 ${attempt} 次，最多 ${max} 次` : `第 ${attempt} 次`);
			}
			if (delayMs != null) {
				detail.push(`约 ${delayMs >= 1000 ? Math.round(delayMs / 1000) : "<1"} 秒后重试`);
			}
			const n: TurnNotice = {
				id: nextId(),
				tone: "warn",
				text: `模型请求失败，正在自动重试${detail.length ? `（${detail.join("，")}）` : ""}${err ? `：${err}` : ""}`,
			};
			return { ...state, retries: [n], retryCount: state.retryCount + 1 };
		}
		case "auto_retry_end": {
			const attempt = num(frame.attempt);
			if (frame.success === true) {
				const n: TurnNotice = {
					id: nextId(),
					tone: "ok",
					text: attempt != null ? `模型重试成功（共尝试 ${attempt} 次）` : "模型重试成功",
				};
				return { ...state, retries: [n] };
			}
			const err = oneLine(str(frame.finalError));
			const n: TurnNotice = {
				id: nextId(),
				tone: "error",
				text: `自动重试失败${attempt != null ? `（共尝试 ${attempt} 次）` : ""}${err ? `：${err}` : ""}`,
			};
			return { ...state, retries: [n], hadFailure: true };
		}
		case "retry_fallback_applied": {
			const from = modelLabel(frame.from) || "当前模型";
			const to = modelLabel(frame.to) || "备用模型";
			return {
				...state,
				retries: [...state.retries, { id: nextId(), tone: "warn", text: `已切换备用模型：${from} → ${to}` }],
				hadFallback: true,
			};
		}
		case "retry_fallback_succeeded": {
			const model = modelLabel(frame.model);
			return {
				...state,
				retries: [...state.retries, { id: nextId(), tone: "ok", text: model ? `备用模型请求成功：${model}` : "备用模型请求成功" }],
			};
		}
		case "auto_compaction_start":
			return {
				...state,
				compaction: { status: "running", text: str(frame.action) === "handoff" ? "正在整理上下文" : "正在压缩上下文" },
			};
		case "auto_compaction_end": {
			if (frame.skipped === true) return { ...state, compaction: null };
			const err = oneLine(str(frame.errorMessage));
			if (frame.aborted === true || err) {
				return { ...state, compaction: { status: "error", text: `上下文压缩失败：${err || "已中止"}` } };
			}
			return { ...state, compaction: { status: "done", text: "上下文压缩完成" } };
		}
		case "agent_end":
			// Terminal end: collapse the turn's activity into one short history line.
			if (frame.isTerminal !== false) {
				return { ...emptyTurnNotices, summary: retrySummary(state) };
			}
			return state;
		default:
			return state;
	}
}
