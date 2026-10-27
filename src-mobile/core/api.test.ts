// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiUrl, ApiError, errorMessage, NETWORK_ERROR, upload } from "./api";
import { useConnection } from "./stores/connection";

const json = (status: number, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
	new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
	useConnection.setState({ phase: "open", error: null });
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("apiUrl", () => {
	it("prefixes /api once", () => {
		expect(apiUrl("/sessions")).toBe("/api/sessions");
		expect(apiUrl("sessions")).toBe("/api/sessions");
		expect(apiUrl("/api/sessions?x=1")).toBe("/api/sessions?x=1");
	});
});

describe("api", () => {
	it("sends JSON bodies with cookies and parses JSON", async () => {
		fetchMock.mockResolvedValue(json(200, { ok: true }));
		await expect(api("POST", "/sessions/a/slash", { name: "compact" })).resolves.toEqual({ ok: true });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/sessions/a/slash");
		expect(init).toMatchObject({ method: "POST", credentials: "same-origin", body: '{"name":"compact"}' });
		expect(init.headers["content-type"]).toBe("application/json");
	});

	it("a 401 marks the connection unauthorized and throws ApiError(401)", async () => {
		fetchMock.mockResolvedValue(json(401, { error: "nope" }));
		await expect(api("GET", "/sessions")).rejects.toMatchObject({ status: 401 });
		expect(useConnection.getState().phase).toBe("unauthorized");
	});

	it("normalizes server errors to the body's error text, falling back to the status", async () => {
		fetchMock.mockResolvedValueOnce(json(400, { error: "不支持的图片格式" }));
		await expect(api("POST", "/x")).rejects.toMatchObject({ status: 400, message: "不支持的图片格式" });
		fetchMock.mockResolvedValueOnce(new Response("", { status: 500, statusText: "Internal Server Error" }));
		await expect(api("GET", "/x")).rejects.toMatchObject({ status: 500, message: "Internal Server Error" });
	});

	it("turns a network failure into a friendly ApiError(0) and shows it on the banner state", async () => {
		fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
		await expect(api("GET", "/sessions")).rejects.toMatchObject({ status: 0, message: NETWORK_ERROR });
		expect(useConnection.getState().error).toBe(NETWORK_ERROR);
	});

	it("any 2xx clears a stale error", async () => {
		useConnection.setState({ error: "old" });
		fetchMock.mockResolvedValue(json(200, []));
		await api("GET", "/sessions");
		expect(useConnection.getState().error).toBeNull();
	});

	it("times out after timeoutMs (408) and honours a caller abort without wrapping it", async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
		const p = api("POST", "/slow", {}, { timeoutMs: 1000 });
		const assertion = expect(p).rejects.toMatchObject({ status: 408, message: "请求超时" });
		await vi.advanceTimersByTimeAsync(1001);
		await assertion;

		const ctl = new AbortController();
		const q = api("GET", "/x", undefined, { signal: ctl.signal, timeoutMs: 0 });
		const aborted = expect(q).rejects.toMatchObject({ name: "AbortError" });
		ctl.abort();
		await aborted;
	});

	it("204 resolves null", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
		await expect(api("DELETE", "/x")).resolves.toBeNull();
	});
});

describe("upload", () => {
	it("POSTs the raw body with ?name= and the file's content type", async () => {
		fetchMock.mockResolvedValue(json(200, { path: "/tmp/u/a.txt", name: "a.txt", size: 3 }));
		const file = new File(["abc"], "a b.txt", { type: "text/plain" });
		await expect(upload("/sessions/s1/upload", file)).resolves.toMatchObject({ size: 3 });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/sessions/s1/upload?name=a%20b.txt");
		expect(init.body).toBe(file);
		expect(init.headers["content-type"]).toBe("text/plain");
		await upload("/sessions/s1/upload", new Blob(["x"]), { name: "override.bin" });
		expect(fetchMock.mock.calls[1][0]).toContain("name=override.bin");
	});
});

describe("errorMessage", () => {
	it("extracts readable text", () => {
		expect(errorMessage(new ApiError(400, "bad"))).toBe("bad");
		expect(errorMessage(new Error("x"))).toBe("x");
		expect(errorMessage(42, "fallback")).toBe("fallback");
	});
});
