// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const models = Array.from({ length: 24 }, (_, i) => ({ provider: `p${i}`, id: "m", name: `M${i}` }));
const response = (models: unknown[]) => new Response(JSON.stringify({ models, catalogSource: "cli", catalogCompleteness: "unverified" }), { headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();

beforeEach(() => {
	vi.resetModules();
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function client() {
	// Intentional module-loading boundary: each client starts without an in-memory baseline.
	return (await import("./api")).api;
}

it("shares the last-known baseline across mobile session and settings reads, rejecting successful shrink", async () => {
	const api = await client();
	fetchMock.mockResolvedValueOnce(response(models)).mockResolvedValueOnce(response(models.slice(0, 4))).mockResolvedValueOnce(response(models));
	await api("GET", "/sessions/s/models");
	await expect(api("GET", "/left/roles")).rejects.toThrow("缺少既有模型");
	await expect(api<{ models: unknown[] }>("GET", "/left/roles")).resolves.toMatchObject({ models });
});

it("permits initial loaded empty and treats backend read failure as an error without fallback", async () => {
	const api = await client();
	fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "MODEL_CATALOG_EXIT_FAILED" }), { status: 502, headers: { "content-type": "application/json" } })).mockResolvedValueOnce(response([]));
	await expect(api("GET", "/left/roles")).rejects.toThrow("MODEL_CATALOG_EXIT_FAILED");
	await expect(api("GET", "/left/roles")).resolves.toMatchObject({ models: [] });
});

it("rejects an old catalog response after a successful provider save and permits the new provider list", async () => {
	const api = await client();
	fetchMock.mockResolvedValueOnce(response(models));
	await api("GET", "/left/roles");
	// ES2021 does not expose Promise.withResolvers.
	let finishOld!: (value: Response) => void;
	fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finishOld = resolve; }));
	const old = api("GET", "/left/roles");
	const rejected = expect(old).rejects.toThrow("配置已更新");
	fetchMock.mockResolvedValueOnce(new Response("{}", { headers: { "content-type": "application/json" } }));
	await api("POST", "/left/providers/save", { id: "p0", base_url: "https://example.invalid" });
	finishOld(response(models));
	await rejected;
	fetchMock.mockResolvedValueOnce(response(models.slice(1)));
	await expect(api("GET", "/left/roles")).resolves.toMatchObject({ models: models.slice(1) });
});
