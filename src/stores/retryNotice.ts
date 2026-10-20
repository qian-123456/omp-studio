/**
 * Maps omp retry / model-fallback events (`auto_retry_*`, `retry_fallback_*`)
 * to inline transcript status rows. Pure; used by the live reducer.
 */

export type RetryKind = "retry" | "retry_end" | "fallback" | "fallback_ok";

export interface RetryNotice {
	id: number;
	kind: RetryKind;
	tone: "warn" | "ok" | "error";
	/** Simplified Chinese status line (error text in full). */
	text: string;
	ts: number;
}

/** A model switch made by omp's fallback chain, kept so the user can undo it. */
export interface FallbackInfo {
	id: string;
	/** Original model ("provider/id"). */
	from: string;
	/** Fallback model ("provider/id"). */
	to: string;
	/** Thinking level in effect before the switch. */
	thinking?: string;
	undone?: boolean;
}

/** One finished turn's retry / fallback history, shown as a collapsed entry. */
export interface RetryEpisode {
	id: string;
	endedAt: number;
	notices: RetryNotice[];
	fallback?: FallbackInfo;
}

export const MAX_RETRY_EPISODES = 30;

/** Chip text: 「本轮重试 2 次 · 已切换备用模型」. */
export function retrySummary(
	notices: readonly RetryNotice[],
	fallback?: FallbackInfo,
): string {
	const retries = notices.filter((n) => n.kind === "retry").length;
	const failed = notices.some((n) => n.tone === "error");
	const parts: string[] = [];
	if (retries > 0) parts.push(`本轮重试 ${retries} 次`);
	if (fallback || notices.some((n) => n.kind === "fallback")) {
		parts.push(retries > 0 ? "已切换备用模型" : "本轮已切换备用模型");
	}
	if (failed) parts.push("最终失败");
	return parts.length > 0 ? parts.join(" · ") : "本轮出现请求重试";
}

const storageKey = (sessionId: string): string => `omp.retryHistory.${sessionId}`;

export function loadRetryHistory(sessionId: string): RetryEpisode[] {
	try {
		const raw = globalThis.localStorage?.getItem(storageKey(sessionId));
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as RetryEpisode[]).slice(-MAX_RETRY_EPISODES) : [];
	} catch {
		return [];
	}
}

export function saveRetryHistory(sessionId: string, list: readonly RetryEpisode[]): void {
	try {
		globalThis.localStorage?.setItem(
			storageKey(sessionId),
			JSON.stringify(list.slice(-MAX_RETRY_EPISODES)),
		);
	} catch {
		/* storage unavailable or full: history stays in memory only */
	}
}

type Frame = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

/** Model refs arrive as "provider/id" strings or `{provider,id}` objects. */
export function modelLabel(v: unknown): string {
	if (typeof v === "string") return v;
	if (typeof v === "object" && v !== null) {
		const o = v as Frame;
		const id = str(o.id);
		const provider = str(o.provider);
		return provider && id ? `${provider}/${id}` : id || provider;
	}
	return "";
}

/** Collapse whitespace; long errors stay complete (rows wrap). */
const oneLine = (s: string, max = 2000): string => {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max)} [已截断]` : t;
};

/** Returns the notice (sans id) for a retry/fallback frame, else null. */
export function retryNoticeFromFrame(
	frame: Frame,
	now: number = Date.now(),
): Omit<RetryNotice, "id"> | null {
	switch (frame.type) {
		case "auto_retry_start": {
			const attempt = num(frame.attempt);
			const max = num(frame.maxAttempts);
			const delay = num(frame.delayMs);
			const err = oneLine(str(frame.errorMessage));
			const count = attempt != null ? `第 ${attempt}${max != null ? `/${max}` : ""} 次` : "";
			const wait =
				delay != null ? `${delay >= 1000 ? Math.round(delay / 1000) : "<1"} 秒后` : "";
			return {
				kind: "retry",
				tone: "warn",
				text: `请求失败${err ? `（${err}）` : ""}，${wait}自动重试${count ? `（${count}）` : ""}`,
				ts: now,
			};
		}
		case "auto_retry_end": {
			const attempt = num(frame.attempt);
			if (frame.success === true) {
				return {
					kind: "retry_end",
					tone: "ok",
					text: `重试成功${attempt != null ? `（第 ${attempt} 次）` : ""}`,
					ts: now,
				};
			}
			const err = oneLine(str(frame.finalError));
			return {
				kind: "retry_end",
				tone: "error",
				text: `重试失败${attempt != null ? `（共 ${attempt} 次）` : ""}${err ? `：${err}` : ""}`,
				ts: now,
			};
		}
		case "retry_fallback_applied": {
			const from = modelLabel(frame.from);
			const to = modelLabel(frame.to);
			return {
				kind: "fallback",
				tone: "warn",
				text: `${from || "当前模型"} 请求失败，已切换到备用模型 ${to || "（未知）"}`,
				ts: now,
			};
		}
		case "retry_fallback_succeeded": {
			const model = modelLabel(frame.model);
			return {
				kind: "fallback_ok",
				tone: "ok",
				text: `备用模型${model ? ` ${model}` : ""} 请求成功`,
				ts: now,
			};
		}
		default:
			return null;
	}
}
