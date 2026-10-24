/**
 * Maps omp retry / model-fallback events (`auto_retry_*`, `retry_fallback_*`)
 * to inline transcript status rows. Pure; used by the live reducer.
 */
import { tNow, useLanguageStore } from "./language";

export type RetryKind = "retry" | "retry_end" | "fallback" | "fallback_ok";

export interface RetryNotice {
	id: number;
	kind: RetryKind;
	tone: "warn" | "ok" | "error";
	/** Simplified Chinese status line (error text in full). */
	text: string;
	ts: number;
	/** Live turn: how many model requests had finished when the row was raised,
	 * so the row renders at that point of the step flow instead of the tail. */
	anchor?: number;
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
	if (retries > 0) parts.push(tNow("shell.retryRoundCount", { count: retries }));
	if (fallback || notices.some((n) => n.kind === "fallback")) {
		parts.push(retries > 0 ? tNow("shell.retrySwitchedFallback") : tNow("shell.retrySwitchedFallbackThisRound"));
	}
	if (failed) parts.push(tNow("shell.retryFinalFailed"));
	return parts.length > 0 ? parts.join(" · ") : tNow("shell.retryOccurred");
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
	return t.length > max ? `${t.slice(0, max)} ${tNow("shell.retryTruncated")}` : t;
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
			const count = attempt != null
				? (max != null ? tNow("shell.retryAttemptOfMax", { attempt, max }) : tNow("shell.retryAttemptCount", { attempt }))
				: "";
			const wait =
				delay != null ? tNow("shell.retryWaitSeconds", { seconds: delay >= 1000 ? Math.round(delay / 1000) : "<1" }) : "";
			const isEn = useLanguageStore.getState().locale === "en-US";
			const errFmt = err ? (isEn ? ` (${err})` : `（${err}）`) : "";
			return {
				kind: "retry",
				tone: "warn",
				text: tNow("shell.retryRequestFailedRetryWait", { error: errFmt, wait, count }),
				ts: now,
			};
		}
		case "auto_retry_end": {
			const attempt = num(frame.attempt);
			if (frame.success === true) {
				const count = attempt != null ? tNow("shell.retryAttemptCount", { attempt }) : "";
				return {
					kind: "retry_end",
					tone: "ok",
					text: tNow("shell.retrySuccessNotice", { count }),
					ts: now,
				};
			}
			const err = oneLine(str(frame.finalError));
			const count = attempt != null ? tNow("shell.retryTotalCount", { count: attempt }) : "";
			const isEn = useLanguageStore.getState().locale === "en-US";
			const errFmt = err ? (isEn ? `: ${err}` : `：${err}`) : "";
			return {
				kind: "retry_end",
				tone: "error",
				text: tNow("shell.retryFailedNotice", { count, error: errFmt }),
				ts: now,
			};
		}
		case "retry_fallback_applied": {
			const from = modelLabel(frame.from) || tNow("shell.retryCurrentModel");
			const to = modelLabel(frame.to) || tNow("shell.retryUnknown");
			return {
				kind: "fallback",
				tone: "warn",
				text: tNow("shell.retrySwitchedFallbackNotice", { from, to }),
				ts: now,
			};
		}
		case "retry_fallback_succeeded": {
			const model = modelLabel(frame.model);
			return {
				kind: "fallback_ok",
				tone: "ok",
				text: tNow("shell.retryFallbackSuccessNotice", { model: model ? ` ${model}` : "" }),
				ts: now,
			};
		}
		default:
			return null;
	}
}
