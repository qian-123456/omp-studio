/**
 * HTTP transport of the phone app. Same-origin, cookie auth, `/api` prefix.
 * - 401 → connection store `unauthorized` (banner + no retries anywhere).
 * - Any other failure becomes an `ApiError{status,message}` with a user-facing message.
 * - Any 2xx clears a stale error banner.
 */
import { useConnection } from "./stores/connection";

export class ApiError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

export interface ApiOptions {
	signal?: AbortSignal;
	/** Abort after this many ms (default 30 s). `0` disables the timeout. */
	timeoutMs?: number;
	headers?: Record<string, string>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
/** For slow server work such as `/compact` (15 minutes). */
export const LONG_TIMEOUT_MS = 15 * 60_000;
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;

export const NETWORK_ERROR = "网络不可用，请检查与电脑的连接";
export const UNAUTHORIZED_ERROR = "配对已失效或被撤销，请在电脑上重新生成二维码配对。";

/** `/sessions` → `/api/sessions`; paths already starting with `/api/` are kept. */
export function apiUrl(path: string): string {
	if (path === "/api" || path.startsWith("/api/") || path.startsWith("/api?")) return path;
	return `/api${path.startsWith("/") ? "" : "/"}${path}`;
}

function markUnauthorized(): ApiError {
	useConnection.getState().setPhase("unauthorized", UNAUTHORIZED_ERROR);
	return new ApiError(401, "unauthorized");
}

async function send(url: string, init: RequestInit, opts: ApiOptions | undefined): Promise<Response> {
	const ctl = new AbortController();
	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let timedOut = false;
	const timer = timeoutMs > 0 ? setTimeout(() => ((timedOut = true), ctl.abort()), timeoutMs) : 0;
	const outer = opts?.signal;
	const onAbort = () => ctl.abort();
	if (outer) {
		if (outer.aborted) ctl.abort();
		else outer.addEventListener("abort", onAbort, { once: true });
	}
	try {
		return await fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: ctl.signal });
	} catch (e) {
		if (outer?.aborted) throw e; // caller cancelled: let the AbortError through untouched
		const err = new ApiError(timedOut ? 408 : 0, timedOut ? "请求超时" : NETWORK_ERROR);
		useConnection.getState().setError(err.message);
		throw err;
	} finally {
		clearTimeout(timer);
		outer?.removeEventListener("abort", onAbort);
	}
}

async function readBody(res: Response): Promise<unknown> {
	if (res.status === 204) return null;
	const type = res.headers.get("content-type") || "";
	try {
		return type.includes("json") ? await res.json() : await res.text();
	} catch {
		return null;
	}
}

async function finish<T>(res: Response): Promise<T> {
	if (res.status === 401) throw markUnauthorized();
	const data = await readBody(res);
	if (!res.ok) {
		const fromBody = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
		const text = typeof data === "string" && data.length < 200 ? data.trim() : "";
		throw new ApiError(res.status, (typeof fromBody === "string" && fromBody) || text || res.statusText || `HTTP ${res.status}`);
	}
	if (useConnection.getState().error) useConnection.getState().setError(null);
	return data as T;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts?: ApiOptions): Promise<T> {
	const headers: Record<string, string> = { ...opts?.headers };
	const init: RequestInit = { method, headers };
	if (body !== undefined) {
		headers["content-type"] = "application/json";
		init.body = JSON.stringify(body);
	}
	return finish<T>(await send(apiUrl(path), init, opts));
}

export interface UploadOptions extends ApiOptions {
	/** File name sent as `?name=`; defaults to the File's own name. */
	name?: string;
}

/** Raw-body upload (`POST /sessions/{id}/upload?name=` ≤ 20 MiB); resolves `{path,name,size}`. */
export async function upload<T = { path: string; name: string; size: number }>(
	path: string,
	file: Blob,
	opts: UploadOptions = {},
): Promise<T> {
	const name = opts.name || (file as File).name || "file";
	const sep = path.includes("?") ? "&" : "?";
	const url = `${apiUrl(path)}${sep}name=${encodeURIComponent(name)}`;
	return finish<T>(
		await send(
			url,
			{ method: "POST", headers: { "content-type": file.type || "application/octet-stream", ...opts.headers }, body: file },
			{ ...opts, timeoutMs: opts.timeoutMs ?? UPLOAD_TIMEOUT_MS },
		),
	);
}

/** True for a 401 (or the "unauthorized" sentinel) so callers can skip their own error UI. */
export const isUnauthorizedError = (e: unknown): boolean => e instanceof ApiError && e.status === 401;

/** User-facing text of any thrown value. */
export function errorMessage(e: unknown, fallback = "操作失败"): string {
	if (e instanceof ApiError) return e.status === 401 ? UNAUTHORIZED_ERROR : e.message || fallback;
	if (e instanceof Error) return e.message || fallback;
	return fallback;
}
