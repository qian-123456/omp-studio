// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelKindEntry, ProviderRow } from "../../lib/contracts";
import { tNow } from "../../stores/language";

const ipc = vi.hoisted(() => ({
	modelKindCatalog: vi.fn(),
	providerRows: vi.fn(),
	providerEncrypt: vi.fn(),
	providerDecrypt: vi.fn(),
	providerEncryptAll: vi.fn(),
	providerSetEnabled: vi.fn(),
	providerSetKey: vi.fn(),
	providerUpsert: vi.fn(),
	providerSaveBuiltin: vi.fn(),
	providerDelete: vi.fn(),
	providerTest: vi.fn(),
	providerTestModel: vi.fn(),
	providerExportEnvText: vi.fn(),
	providerFetchModels: vi.fn(),
	providerReadEnvFile: vi.fn(),
	listModels: vi.fn(async () => []),
	ompInfo: vi.fn(async () => ({ agentDir: "/home/u/.omp/agent" })),
	readTextFile: vi.fn(async () => "providers: {}\n"),
	writeTextFile: vi.fn(async () => {}),
	ompConfigList: vi.fn(async () => ({ found: true, entries: [] })),
}));

vi.mock("../../lib/ipc", () => ipc);
vi.mock("../../lib/dialogs", () => ({ confirmDialog: vi.fn(), copyText: vi.fn(), errMsg: (error: unknown) => String(error) }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/home/u" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("./ServiceConfigDialog", () => ({
	ServiceConfigDialog: ({ capability, selector, onClose }: { capability: { supplier: string; method: string }; selector: string; onClose: () => void }) => (
		<div role="dialog" aria-label="service-config" data-supplier={capability.supplier} data-method={capability.method}>
			<span>{selector}</span><button type="button" onClick={onClose}>close-service</button>
		</div>
	),
}));
vi.mock("./OauthLoginDialog", () => ({
	OauthLoginDialog: ({ onClose, initialProviderQuery }: { onClose: () => void; initialProviderQuery?: string }) => <div role="dialog" aria-label="account-management" data-supplier={initialProviderQuery}><button onClick={onClose}>close-account</button></div>,
}));
vi.mock("../settings/sections/RawFilesDialog", () => ({
	RawFilesDialog: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="advanced-config"><button onClick={onClose}>{tNow("common.cancel")}</button></div>,
}));

import { useModelKindCatalog } from "../../stores/modelKinds";
import { OtherModelsPanel } from "./OtherModelsPanel";
import { useProviders } from "./store";

const PAGE_SIZE = 8;
const KINDS = [
	["search", "providers.kindSearch"],
	["judge", "providers.kindJudge"],
	["image", "providers.kindImage"],
	["tts", "providers.kindTts"],
	["stt", "providers.kindStt"],
	["embedding", "providers.kindEmbedding"],
	["rerank", "providers.kindRerank"],
	["video", "providers.kindVideo"],
	["all", "providers.kindUnknown"],
] as const;
const PROVIDER_IDS = ["catalog-alpha", "catalog-beta", "omp-runner"] as const;
// Repeated names, repeated IDs across providers, and repeated provider display names
// deliberately make display-name-only identity insufficient.
const MODELS: ModelKindEntry[] = Array.from({ length: 366 }, (_, index) => {
	const provider = PROVIDER_IDS[index % PROVIDER_IDS.length];
	return {
		selector: `${provider}/model-${String(Math.floor(index / 3)).padStart(3, "0")}`,
		provider,
		kind: KINDS[Math.floor(index / 3) % KINDS.length][0],
		name: index < 3 ? "跨来源同名模型" : `完整模型名称 ${index} · 包含不可省略的用途、版本和部署区域说明 · final-suffix-${index}`,
		thinking: [],
	};
});
const EXCLUDED: ModelKindEntry[] = ["chat", "tiny", ""].map((kind, index) => ({
	selector: `catalog-alpha/excluded-${index}`,
	provider: "catalog-alpha",
	kind,
	name: `Excluded ${index}`,
	thinking: [],
}));
const CONNECTIONS: ProviderRow[] = PROVIDER_IDS.slice(0, 2).map((id, index): ProviderRow => ({
	id,
	displayName: "共享连接名称",
	slug: id,
	origin: "custom",
	sources: [`${id}/models.yml`, `${id}/overrides.yml`],
	baseUrl: `https://${id}.example/v1`,
	api: "openai-completions",
	models: ["model-000"],
	key: { kind: index === 0 ? "encrypted" : "plaintext", envVar: null, envSet: null },
	enabled: index === 0,
	testable: true,
	defaultBaseUrl: null,
	extraModels: [],
	authNone: false,
}));

beforeEach(() => {
	ipc.modelKindCatalog.mockResolvedValue([...MODELS, ...EXCLUDED]);
	ipc.providerRows.mockResolvedValue(CONNECTIONS);
	useModelKindCatalog.setState({ entries: null, kindBySelector: new Map(), loading: false, error: null });
	useProviders.setState({ rows: [], loaded: false, error: null, tests: {}, modelTests: {} });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	useModelKindCatalog.setState({ entries: null, kindBySelector: new Map(), loading: false, error: null });
	useProviders.setState({ rows: [], loaded: false, error: null, tests: {}, modelTests: {} });
});

async function renderCatalog() {
	render(<OtherModelsPanel />);
	await screen.findByRole("button", { name: tNow("providers.otherModelsSelectSupplier", { provider: "catalog-alpha" }) });
}

function supplier(id: string) {
	return screen.getByRole("button", { name: tNow("providers.otherModelsSelectSupplier", { provider: id }) });
}

function openSupplier(id: string) {
	const button = supplier(id);
	if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}

function modelRows() {
	return within(screen.getByRole("list", { name: "模型列表" })).getAllByRole("listitem");
}

function visibleSelectors(entries: ModelKindEntry[]) {
	const known = new Map(entries.map((entry) => [entry.selector, entry]));
	const rows = modelRows();
	expect(rows.length).toBeLessThanOrEqual(PAGE_SIZE);
	return rows.map((row) => {
		const selector = within(row).getByText((text) => known.has(text)).textContent!;
		expect(within(row).getByText(known.get(selector)!.name!, { exact: true })).toBeTruthy();
		const details = row.querySelector("details")!;
		expect(within(details).getByText(tNow("providers.registeredNotTested"))).toBeTruthy();
		return selector;
	});
}

function collectPages(entries: ModelKindEntry[]) {
	const seen: string[] = [];
	const nav = screen.getByRole("navigation", { name: "模型分页" });
	const options = within(nav).getAllByRole("option");
	expect(options).toHaveLength(Math.ceil(entries.length / PAGE_SIZE));
	for (let index = 0; index < options.length; index += 1) {
		fireEvent.change(within(nav).getByRole("combobox", { name: "跳转到页码" }), { target: { value: (options[index] as HTMLOptionElement).value } });
		seen.push(...visibleSelectors(entries));
	}
	expect(seen).toHaveLength(entries.length);
	expect(new Set(seen)).toEqual(new Set(entries.map((entry) => entry.selector)));
}

describe("grouped other-model suppliers", () => {
	it("makes every unconfigured registered model discoverable and browsable without adding a fake connection", async () => {
		await renderCatalog();
		expect(screen.queryByRole("button", { name: tNow("providers.otherModelsSelectSupplier", { provider: "omp-runner" }) })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: tNow("providers.addService") }));
		const dialog = await screen.findByRole("dialog", { name: tNow("providers.addService") });
		fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "omp-runner" } });
		expect(within(dialog).queryByRole("button", { name: tNow("providers.otherModelsSelectSupplier", { provider: "catalog-alpha" }) })).toBeNull();
		openSupplier("omp-runner");
		collectPages(MODELS.filter((entry) => entry.provider === "omp-runner"));
		expect(ipc.providerUpsert).not.toHaveBeenCalled();
		expect(ipc.providerSetKey).not.toHaveBeenCalled();
	}, 30_000);

	it("keeps mixed capabilities in one connection row and exposes every one of 122 models through bounded pages", async () => {
		await renderCatalog();
		for (const id of PROVIDER_IDS.slice(0, 2)) {
			expect(screen.getAllByRole("button", { name: tNow("providers.otherModelsSelectSupplier", { provider: id }) })).toHaveLength(1);
			openSupplier(id);
			collectPages(MODELS.filter((entry) => entry.provider === id));
			fireEvent.click(supplier(id));
		}
		expect(screen.queryByText("Excluded 0")).toBeNull();
		expect(screen.queryByText("Excluded 1")).toBeNull();
		expect(ipc.providerTestModel).not.toHaveBeenCalled();
	}, 30_000);

	it("searches full selectors and names inside a large provider and keeps every actual kind accessible", async () => {
		await renderCatalog();
		openSupplier("catalog-alpha");
		const region = screen.getByRole("list", { name: "模型列表" });
		const search = screen.getAllByRole("textbox").find((input) => region.parentElement?.contains(input));
		expect(search).toBeTruthy();
		const target = MODELS.find((entry) => entry.provider === "catalog-alpha" && entry.name!.includes("final-suffix"))!;
		fireEvent.change(search!, { target: { value: target.selector } });
		expect(visibleSelectors([target])).toEqual([target.selector]);
		fireEvent.change(search!, { target: { value: target.name } });
		expect(visibleSelectors([target])).toEqual([target.selector]);
		fireEvent.change(search!, { target: { value: "" } });
		for (const [kind, label] of KINDS) {
			const entries = MODELS.filter((entry) => entry.provider === "catalog-alpha" && entry.kind === kind);
			fireEvent.click(screen.getByRole("button", { name: tNow(label, { kind }) }));
			collectPages(entries);
		}
	}, 30_000);

	it("does not classify empty custom connections as non-chat and retains advanced configuration access", async () => {
		const empty = { ...CONNECTIONS[0], id: "empty-manual", displayName: "Empty manual", models: [] };
		ipc.providerRows.mockResolvedValue([...CONNECTIONS, empty]);
		await renderCatalog();
		expect(screen.queryByRole("button", { name: tNow("providers.otherModelsSelectSupplier", { provider: empty.id }) })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: tNow("providers.addService") }));
		const dialog = await screen.findByRole("dialog", { name: tNow("providers.addService") });
		expect(within(dialog).queryByText(empty.displayName)).toBeNull();
		expect(within(dialog).getByRole("button", { name: tNow("providers.addProviderBtn") })).toBeTruthy();
		expect(ipc.providerSetKey).not.toHaveBeenCalled();
		expect(ipc.providerUpsert).not.toHaveBeenCalled();
	});

	it("excludes empty OAuth and config-only chat suppliers while keeping mixed and explicit service suppliers", async () => {
		const row = (id: string, models: ProviderRow["models"] = []): ProviderRow => ({ ...CONNECTIONS[0], id, displayName: id, models });
		ipc.providerRows.mockResolvedValue([
			...CONNECTIONS,
			{ ...row("anthropic"), key: { kind: "oauth", envVar: null, envSet: null } },
			row("chat-config"),
			row("chat-only", ["chat"]),
			row("uncatalogued", ["unclassified"]),
			row("mixed", ["chat", "image"]),
			row("explicit-service", [{ id: "custom-image", kind: "image" }]),
			row("unknown-kind", ["future"]),
		]);
		ipc.modelKindCatalog.mockResolvedValue([
			...MODELS,
			...["anthropic", "chat-config", "chat-only", "mixed"].map((provider): ModelKindEntry => ({ provider, selector: `${provider}/chat`, kind: "chat", name: "Chat", thinking: [] })),
			{ provider: "mixed", selector: "mixed/image", kind: "image", name: "Image", thinking: [] },
			{ provider: "unknown-kind", selector: "unknown-kind/future", kind: "future-service", name: "Future", thinking: [] },
		]);
		await renderCatalog();
		for (const id of ["anthropic", "chat-config", "chat-only", "uncatalogued"]) {
			expect(screen.queryByRole("button", { name: tNow("providers.otherModelsSelectSupplier", { provider: id }) })).toBeNull();
		}
		for (const id of ["mixed", "explicit-service", "unknown-kind"]) expect(supplier(id)).toBeTruthy();
		openSupplier("mixed");
		expect(screen.getByText("mixed/image")).toBeTruthy();
		expect(screen.queryByText("mixed/chat")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: tNow("providers.addService") }));
		const discovery = await screen.findByRole("dialog", { name: tNow("providers.addService") });
		expect(within(discovery).queryByText("anthropic")).toBeNull();
		expect(ipc.providerUpsert).not.toHaveBeenCalled();
	});

	it("keeps explicit service configuration but never infers non-chat support from an unavailable catalog", async () => {
		ipc.modelKindCatalog.mockRejectedValue(new Error("catalog unavailable"));
		ipc.providerRows.mockResolvedValue([
			{ ...CONNECTIONS[0], id: "anthropic", models: [], key: { kind: "oauth", envVar: null, envSet: null } },
			{ ...CONNECTIONS[0], id: "unknown-model", models: ["unclassified"] },
			{ ...CONNECTIONS[0], id: "explicit-service", models: [{ id: "custom-image", kind: "image" }] },
		]);
		render(<OtherModelsPanel />);
		await screen.findByRole("button", { name: tNow("providers.otherModelsSelectSupplier", { provider: "explicit-service" }) });
		await screen.findByRole("alert");
		for (const id of ["anthropic", "unknown-model"]) {
			expect(screen.queryByRole("button", { name: tNow("providers.otherModelsSelectSupplier", { provider: id }) })).toBeNull();
		}
		fireEvent.click(screen.getByRole("button", { name: tNow("providers.supplierActionFor", { action: tNow("common.edit"), provider: "explicit-service" }) }));
		expect(await screen.findByRole("dialog", { name: /编辑供应商/ })).toBeTruthy();
		expect(ipc.providerUpsert).not.toHaveBeenCalled();
	});

	it("routes an OAuth-only supplier with a missing builtin key to login instead of the generic key editor", async () => {
		ipc.modelKindCatalog.mockResolvedValue([{ selector: "google-antigravity/image", provider: "google-antigravity", kind: "image", name: "Account image", thinking: [] }]);
		ipc.providerRows.mockResolvedValue([{ ...CONNECTIONS[0], id: "google-antigravity", origin: "builtin", key: { kind: "missing", envVar: null, envSet: null } }]);
		render(<OtherModelsPanel />);
		await screen.findByText(tNow("providers.otherModelsEmpty"));
		fireEvent.click(screen.getByRole("button", { name: tNow("providers.addService") }));
		const discovery = await screen.findByRole("dialog", { name: tNow("providers.addService") });
		fireEvent.click(within(discovery).getByRole("button", { name: tNow("providers.supplierActionFor", { action: tNow("common.edit"), provider: "google-antigravity" }) }));
		const dialog = await screen.findByRole("dialog", { name: "account-management" });
		expect(dialog.getAttribute("data-supplier")).toBe("google-antigravity");
		expect(screen.queryByLabelText("API 密钥")).toBeNull();
		expect(ipc.providerSetKey).not.toHaveBeenCalled();
	});

	it("targets existing OAuth accounts through the uniform edit action rather than replacing their key", async () => {
		ipc.providerRows.mockResolvedValue([{ ...CONNECTIONS[0], key: { kind: "oauth", envVar: null, envSet: null } }]);
		await renderCatalog();
		fireEvent.click(screen.getByRole("button", { name: tNow("providers.supplierActionFor", { action: tNow("common.edit"), provider: "catalog-alpha" }) }));
		const dialog = await screen.findByRole("dialog", { name: "account-management" });
		expect(dialog.getAttribute("data-supplier")).toBe("catalog-alpha");
		expect(screen.queryByLabelText("API 密钥")).toBeNull();
		expect(ipc.providerSetKey).not.toHaveBeenCalled();
	});
});
