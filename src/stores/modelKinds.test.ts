import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelKindEntry } from "../lib/contracts";
import {
	isLLMModelKind,
	isNonLLMModelKind,
	isServiceModelRole,
	modelRoleCompatibility,
	modelSupportsRole,
	type ServiceModelRole,
} from "./modelKinds";

const modelKindCatalog = vi.hoisted(() => vi.fn<() => Promise<ModelKindEntry[]>>());
vi.mock("../lib/ipc", () => ({ modelKindCatalog }));

const entry = (kind: string, selector = `registered/${kind}`): ModelKindEntry => ({
	selector,
	provider: "registered",
	kind,
	name: null,
	thinking: [],
});

async function loadStore() {
	// Each case must recreate closure-owned in-flight state, which a static import would share.
	vi.resetModules();
	return (await import("./modelKinds")).useModelKindCatalog;
}

beforeEach(() => modelKindCatalog.mockReset());

describe("runtime kind boundaries", () => {
	it("keeps every non-LLM kind, including kinds unknown to this UI", () => {
		for (const kind of ["image", "search", "judge", "tts", "stt", "embedding", "rerank", "video", "future-runner"]) {
			expect(isNonLLMModelKind(kind)).toBe(true);
			expect(isLLMModelKind(kind)).toBe(false);
		}
		for (const kind of ["chat", "tiny"]) {
			expect(isLLMModelKind(kind)).toBe(true);
			expect(isNonLLMModelKind(kind)).toBe(false);
		}
		expect(isNonLLMModelKind("")).toBe(false);
	});

	it.each<[ServiceModelRole, string[]]>([
		["image", ["image"]],
		["speech", ["tts"]],
		["dictation", ["stt"]],
		["web", ["search"]],
		["judge", ["chat", "tiny", "judge"]],
	])("offers only verified runtime kinds for %s", (role, kinds) => {
		const catalog = ["chat", "tiny", "image", "tts", "stt", "search", "judge", "embedding", "rerank", "video", "future-runner"].map((kind) => entry(kind));
		expect(catalog.filter((model) => modelSupportsRole(model, role)).map((model) => model.kind)).toEqual(kinds);
		expect(isServiceModelRole(role)).toBe(true);
	});

	it("does not infer execution capability from provider or model names", () => {
		expect(modelSupportsRole(entry("chat", "web/search-image-tts"), "web")).toBe(false);
		expect(modelSupportsRole(entry("chat", "image/generate"), "image")).toBe(false);
		expect(isServiceModelRole("tts")).toBe(false);
		expect(isServiceModelRole("dictation")).toBe(true);
	});

	it("preserves missing selectors, unknown kinds and chat web capabilities as unverified", () => {
		expect(modelRoleCompatibility(undefined, "image")).toBe("unverified");
		expect(modelRoleCompatibility(entry("future-runner"), "image")).toBe("unverified");
		expect(modelRoleCompatibility(entry("chat"), "web")).toBe("unverified");
		expect(modelRoleCompatibility(entry("tts"), "web")).toBe("incompatible");
		expect(modelRoleCompatibility(entry("image"), "speech")).toBe("incompatible");
		expect(modelRoleCompatibility(entry("search"), "web")).toBe("compatible");
	});
});

describe("shared all-kind catalog", () => {
	it("shares a load and keeps exact registered kinds and selectors without adding candidates", async () => {
		// The project's ES2021 library target does not provide Promise.withResolvers.
		let resolve!: (entries: ModelKindEntry[]) => void;
		modelKindCatalog.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
		const store = await loadStore();
		const first = store.getState().load();
		const second = store.getState().load();
		expect(first).toBe(second);
		expect(modelKindCatalog).toHaveBeenCalledTimes(1);
		const entries = [entry("embedding"), entry("future-runner", "custom/exact-id")];
		resolve(entries);
		await Promise.all([first, second]);
		expect(store.getState().entries).toEqual(entries);
		expect([...store.getState().kindBySelector]).toEqual(entries.map((model) => [model.selector, model.kind]));
		await store.getState().load();
		expect(modelKindCatalog).toHaveBeenCalledTimes(1);
	});

	it("does not let an in-flight pre-save result override a forced refresh", async () => {
		// The project's ES2021 library target does not provide Promise.withResolvers.
		let resolveOld!: (entries: ModelKindEntry[]) => void;
		let resolveFresh!: (entries: ModelKindEntry[]) => void;
		modelKindCatalog
			.mockReturnValueOnce(new Promise((done) => { resolveOld = done; }))
			.mockReturnValueOnce(new Promise((done) => { resolveFresh = done; }));
		const store = await loadStore();
		const first = store.getState().load();
		const afterSave = store.getState().load(true);
		resolveOld([entry("image", "deleted/image")]);
		await Promise.resolve();
		expect(modelKindCatalog).toHaveBeenCalledTimes(2);
		expect(store.getState().entries).toBeNull();
		expect(store.getState().loading).toBe(true);
		resolveFresh([entry("tts", "saved/speech")]);
		await Promise.all([first, afterSave]);
		expect(store.getState().entries).toEqual([entry("tts", "saved/speech")]);
		expect(store.getState().kindBySelector.has("deleted/image")).toBe(false);
		expect(store.getState().loading).toBe(false);
	});

	it("clears obsolete candidates on refresh failure and recovers on the next load", async () => {
		modelKindCatalog.mockResolvedValueOnce([entry("image")]).mockRejectedValueOnce(new Error("catalog unavailable"));
		const store = await loadStore();
		await store.getState().load();
		await store.getState().load(true);
		expect(store.getState().entries).toBeNull();
		expect(store.getState().kindBySelector.size).toBe(0);
		expect(store.getState().loading).toBe(false);
		expect(store.getState().error).toContain("catalog unavailable");
		modelKindCatalog.mockResolvedValueOnce([entry("search")]);
		await store.getState().load();
		expect(store.getState().entries).toEqual([entry("search")]);
		expect(store.getState().error).toBeNull();
	});

	it("accepts an authoritative empty list without reviving old candidates", async () => {
		modelKindCatalog.mockResolvedValueOnce([entry("image")]).mockResolvedValueOnce([]);
		const store = await loadStore();
		await store.getState().load();
		await store.getState().load(true);
		expect(store.getState().entries).toEqual([]);
		expect(store.getState().kindBySelector.size).toBe(0);
	});
});
