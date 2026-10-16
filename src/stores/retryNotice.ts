/**
 * Maps omp retry / model-fallback events (`auto_retry_*`, `retry_fallback_*`)
 * to inline transcript status rows. Pure; used by the live reducer.
 */

export interface RetryNotice {
	id: number;
	tone: "warn" | "ok" | "error";
	/** Simplified Chinese status line. */
	text: string;
	ts: number;
}

type Frame = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

/** Model refs arrive as "provider/id" strings or `{provider,id}` objects. */
function modelLabel(v: unknown): string {
	if (typeof v === "string") return v;
	if (typeof v === "object" && v !== null) {
		const o = v as Frame;
		const id = str(o.id);
		const provider = str(o.provider);
		return provider && id ? `${provider}/${id}` : id || provider;
	}
	return "";
}

const oneLine = (s: string, max = 160): string => {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max)}…` : t;
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
				tone: "warn",
				text: `请求失败${err ? `（${err}）` : ""}，${wait}自动重试${count ? `（${count}）` : ""}`,
				ts: now,
			};
		}
		case "auto_retry_end": {
			const attempt = num(frame.attempt);
			if (frame.success === true) {
				return {
					tone: "ok",
					text: `重试成功${attempt != null ? `（第 ${attempt} 次）` : ""}`,
					ts: now,
				};
			}
			const err = oneLine(str(frame.finalError));
			return {
				tone: "error",
				text: `重试失败${attempt != null ? `（共 ${attempt} 次）` : ""}${err ? `：${err}` : ""}`,
				ts: now,
			};
		}
		case "retry_fallback_applied": {
			const from = modelLabel(frame.from);
			const to = modelLabel(frame.to);
			return {
				tone: "warn",
				text: `${from || "当前模型"} 请求失败，已切换到备用模型 ${to || "（未知）"}`,
				ts: now,
			};
		}
		case "retry_fallback_succeeded": {
			const model = modelLabel(frame.model);
			return {
				tone: "ok",
				text: `备用模型${model ? ` ${model}` : ""} 请求成功`,
				ts: now,
			};
		}
		default:
			return null;
	}
}
