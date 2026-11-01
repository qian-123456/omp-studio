// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelKindEntry, ProviderRow } from "../../lib/contracts";

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

import { useModelKindCatalog } from "../../stores/modelKinds";
import { OtherModelsPanel } from "./OtherModelsPanel";
import { useProviders } from "./store";

const PAGE_SIZE = 8;
const KINDS = [
	["search", "搜索"],
	["judge", "评估"],
	["image", "图像生成"],
	["tts", "语音合成"],
	["stt", "语音识别"],
	["embedding", "向量嵌入"],
	["rerank", "重排"],
	["video", "视频"],
	["all", "其他类型 · all"],
] as const;
const PROVIDER_IDS = ["catalog-alpha", "catalog-beta", "omp-runner"] as const;
// Repeated names, repeated IDs across providers, and repeated provider display names
// deliberately make display-name-only identity insufficient.
const MODELS: ModelKindEntry[] = Array.from({ length: 222 }, (_, index) => {
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
const BY_SELECTOR = new Map(MODELS.map((entry) => [entry.selector, entry]));
const SELECTORS = new Set(BY_SELECTOR.keys());
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
	await screen.findByRole("button", { name: "全部类型 (222)" });
}

function rows() {
	return within(screen.getByRole("region", { name: "模型列表" })).getAllByRole("listitem");
}

function pagination() {
	return screen.getByRole("navigation", { name: "模型分页" });
}

function changePage(page: number) {
	const select = within(pagination()).getByRole("combobox", { name: "跳转到页码" });
	const option = within(select).getByRole("option", { name: `第 ${page} 页` }) as HTMLOptionElement;
	fireEvent.change(select, { target: { value: option.value } });
}

function search(value: string) {
	fireEvent.change(screen.getByRole("textbox", { name: "搜索模型、类型或来源" }), { target: { value } });
}

function detailButton(row: HTMLElement) {
	return within(row).getByRole("button", { name: /^模型详情：/ });
}

function expectCollapsed() {
	for (const row of rows()) expect(detailButton(row).getAttribute("aria-expanded")).toBe("false");
}

function collectVisibleSelectors() {
	const visibleRows = rows();
	expect(visibleRows.length).toBeGreaterThan(0);
	expect(visibleRows.length).toBeLessThanOrEqual(PAGE_SIZE);
	return visibleRows.map((row) => {
		const button = detailButton(row);
		expect(button.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(button);
		expect(button.getAttribute("aria-expanded")).toBe("true");
		const selector = within(row).getByText((text) => SELECTORS.has(text)).textContent!;
		expect(within(row).getByText(BY_SELECTOR.get(selector)!.name!, { exact: true })).toBeTruthy();
		fireEvent.click(button);
		expect(within(row).queryByText(selector, { exact: true })).toBeNull();
		return selector;
	});
}

function collectPages(total: number) {
	const collected: string[] = [];
	const pages = Math.ceil(total / PAGE_SIZE);
	const nav = pagination();
	expect(screen.getByRole("region", { name: "模型列表" }).contains(nav)).toBe(false);
	expect(within(nav).getAllByRole("option")).toHaveLength(pages);
	for (let page = 1; page <= pages; page += 1) {
		const from = (page - 1) * PAGE_SIZE + 1;
		const to = Math.min(page * PAGE_SIZE, total);
		expect(within(nav).getByRole("status").textContent).toBe(`第 ${from}–${to} 项，共 ${total} 项 · 第 ${page}/${pages} 页`);
		expect((within(nav).getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled).toBe(page === 1);
		collected.push(...collectVisibleSelectors());
		const next = within(nav).getByRole("button", { name: "下一页" }) as HTMLButtonElement;
		expect(next.disabled).toBe(page === pages);
		if (page < pages) fireEvent.click(next);
	}
	expect(new Set(collected).size).toBe(total);
	return collected;
}

describe("other-model catalog navigation", () => {
	it("makes all 222 registered models reachable through bounded pages and every actual kind", async () => {
		await renderCatalog();
		const types = screen.getByRole("group", { name: "模型类型" });
		expect(within(types).getAllByRole("button", { pressed: true })).toHaveLength(1);
		expect(within(types).getByRole("button", { name: "全部类型 (222)", pressed: true })).toBeTruthy();
		expect(rows()).toHaveLength(PAGE_SIZE);
		expectCollapsed();
		expect(screen.queryByText("目录已注册 · 尚未验证调用可用性")).toBeNull();
		for (const excluded of EXCLUDED) expect(screen.queryByText(excluded.name!)).toBeNull();
		expect(new Set(collectPages(MODELS.length))).toEqual(SELECTORS);

		for (const [kind, label] of KINDS) {
			const expected = MODELS.filter((entry) => entry.kind === kind);
			fireEvent.click(within(types).getByRole("button", { name: `${label} (${expected.length})` }));
			expect(within(types).getAllByRole("button", { pressed: true })).toHaveLength(1);
			expect(within(types).getByRole("button", { name: `${label} (${expected.length})`, pressed: true })).toBeTruthy();
			expect(new Set(collectPages(expected.length))).toEqual(new Set(expected.map((entry) => entry.selector)));
		}
	}, 30_000);

	it("finds each exact selector even when names, model IDs and provider labels collide", async () => {
		await renderCatalog();
		const collisions = MODELS.slice(0, 3);
		search("跨来源同名模型");
		expect(rows()).toHaveLength(3);
		expect(new Set(collectVisibleSelectors())).toEqual(new Set(collisions.map((entry) => entry.selector)));
		for (const entry of collisions) {
			search(entry.selector);
			expect(rows()).toHaveLength(1);
			expectCollapsed();
			expect(within(rows()[0]).getByText(entry.name!, { exact: true })).toBeTruthy();
			expect(collectVisibleSelectors()).toEqual([entry.selector]);
		}
	}, 30_000);

	it("resets the page and closes details when search, type or page changes", async () => {
		await renderCatalog();
		changePage(3);
		fireEvent.click(detailButton(rows()[0]));
		expect(detailButton(rows()[0]).getAttribute("aria-expanded")).toBe("true");
		search("catalog-beta");
		expect(within(pagination()).getByRole("status").textContent).toBe("第 1–8 项，共 74 项 · 第 1/10 页");
		expectCollapsed();
		search("");
		changePage(3);
		fireEvent.click(detailButton(rows()[0]));
		fireEvent.click(screen.getByRole("button", { name: "其他类型 · all (24)" }));
		expect(within(pagination()).getByRole("status").textContent).toBe("第 1–8 项，共 24 项 · 第 1/3 页");
		expectCollapsed();
		fireEvent.click(detailButton(rows()[0]));
		fireEvent.click(within(pagination()).getByRole("button", { name: "下一页" }));
		expectCollapsed();
		fireEvent.click(within(pagination()).getByRole("button", { name: "上一页" }));
		expectCollapsed();
		fireEvent.click(screen.getByRole("button", { name: "全部类型 (222)" }));
		expect(within(pagination()).getByRole("status").textContent).toBe("第 1–8 项，共 222 项 · 第 1/28 页");
	});

	it("clamps a last-page selection after catalog shrink instead of displaying a false empty result", async () => {
		await renderCatalog();
		changePage(28);
		expect(rows()).toHaveLength(6);
		fireEvent.click(detailButton(rows()[0]));
		const remaining = MODELS.slice(0, 17);
		act(() => useModelKindCatalog.setState({ entries: remaining, kindBySelector: new Map(remaining.map((entry) => [entry.selector, entry.kind])) }));
		expect(within(pagination()).getByRole("status").textContent).toBe("第 17–17 项，共 17 项 · 第 3/3 页");
		expect(rows()).toHaveLength(1);
		expectCollapsed();
		expect(new Set(collectVisibleSelectors())).toEqual(new Set([remaining.slice().sort((a, b) => a.selector.localeCompare(b.selector))[16].selector]));
		expect(screen.queryByText("未找到匹配的其他类型模型。")).toBeNull();
		expect((within(pagination()).getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled).toBe(true);
	});

	it("falls back to all types when the selected registered kind disappears", async () => {
		await renderCatalog();
		fireEvent.click(screen.getByRole("button", { name: "其他类型 · all (24)" }));
		changePage(3);
		const remaining = MODELS.filter((entry) => entry.kind !== "all");
		act(() => useModelKindCatalog.setState({ entries: remaining, kindBySelector: new Map(remaining.map((entry) => [entry.selector, entry.kind])) }));
		expect(screen.getByRole("button", { name: "全部类型 (198)", pressed: true })).toBeTruthy();
		expect(within(pagination()).getByRole("status").textContent).toBe("第 1–8 项，共 198 项 · 第 1/25 页");
		expect(rows()).toHaveLength(PAGE_SIZE);
	});

	it("reveals exact metadata on demand and configures the correct colliding connection or managed runner", async () => {
		await renderCatalog();
		for (const [index, connection] of CONNECTIONS.entries()) {
			const entry = MODELS[index];
			search(entry.selector);
			const row = rows()[0];
			expect(within(row).getByText(entry.name!, { exact: true })).toBeTruthy();
			expect(within(row).queryByText(entry.selector, { exact: true })).toBeNull();
			expect(within(row).queryByText("目录已注册 · 尚未验证调用可用性")).toBeNull();
			expect(within(row).getByRole("button", { name: "编辑连接" })).toBeTruthy();
			fireEvent.click(detailButton(row));
			expect(within(row).getByText(entry.selector, { exact: true })).toBeTruthy();
			expect(within(row).getByText(`来源：共享连接名称 · ${connection.sources.join(", ")}`, { exact: true })).toBeTruthy();
			expect(within(row).getByText(index === 0 ? "连接已启用 · 已加密" : "连接已停用 · 明文", { exact: true })).toBeTruthy();
			expect(within(row).getByText("目录已注册 · 尚未验证调用可用性")).toBeTruthy();
			fireEvent.click(within(row).getByRole("button", { name: "编辑连接" }));
			const dialog = await screen.findByRole("dialog", { name: /编辑供应商/ });
			expect((within(dialog).getByLabelText("名称") as HTMLInputElement).value).toBe(connection.id);
			expect((within(dialog).getByLabelText("地址") as HTMLInputElement).value).toBe(connection.baseUrl);
			expect((within(dialog).getByLabelText("API 密钥") as HTMLInputElement).value).toBe("");
			fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		}

		const runner = MODELS[2];
		search(runner.selector);
		const row = rows()[0];
		expect(within(row).getByRole("button", { name: "编辑配置" })).toBeTruthy();
		fireEvent.click(detailButton(row));
		expect(within(row).getByText(runner.selector, { exact: true })).toBeTruthy();
		expect(within(row).getByText("来源：omp-runner · OMP 模型目录", { exact: true })).toBeTruthy();
		expect(within(row).getByText("由 OMP 管理；此处无对应的通用 API 连接配置")).toBeTruthy();
		fireEvent.click(within(row).getByRole("button", { name: "编辑配置" }));
		const raw = await screen.findByRole("dialog", { name: "编辑原始配置文件" });
		expect(await within(raw).findByText("/home/u/.omp/agent/models.yml", { exact: true })).toBeTruthy();
		const content = within(raw).getByRole("textbox", { name: "models.yml 内容" }) as HTMLTextAreaElement;
		await waitFor(() => expect(content.value).toBe("providers: {}\n"));
		expect(ipc.providerUpsert).not.toHaveBeenCalled();
		expect(ipc.providerTestModel).not.toHaveBeenCalled();
	});
});
