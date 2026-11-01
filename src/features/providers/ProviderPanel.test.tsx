// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelKindEntry, ProviderKeyKind, ProviderRow } from "../../lib/contracts";

const ipc = vi.hoisted(() => ({
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
	modelKindCatalog: vi.fn(async (): Promise<ModelKindEntry[]> => []),
	ompInfo: vi.fn(async () => ({ agentDir: "/home/u/.omp/agent" })),
	readTextFile: vi.fn(async () => "providers: {}\n"),
	writeTextFile: vi.fn(async () => {}),
	ompConfigList: vi.fn(async () => ({ found: true, entries: [] })),
}));
const confirmDialog = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock("../../lib/ipc", () => ipc);
vi.mock("../../lib/dialogs", () => ({
	confirmDialog,
	copyText: vi.fn(),
	errMsg: (e: unknown) => String(e),
}));
vi.mock("../../lib/toast", () => ({ toast }));
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/home/u" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("../settings/sections/ProviderBrandLogo", () => ({ ProviderBrandLogo: () => null }));
vi.mock("../settings/settingsNav", () => ({ useSettingsNav: () => ({ focusKey: null, focusRequest: 0 }) }));
vi.mock("../settings/settingsTargets", () => ({ openSettingsTarget: vi.fn() }));
vi.mock("./OauthLoginDialog", () => ({ OauthLoginDialog: () => <div>OAUTH_DIALOG</div> }));

import { ProviderDialog } from "./ProviderDialog";
import { ProviderPanel } from "./ProviderPanel";
import { useProviders } from "./store";
import { useModelKindCatalog } from "../../stores/modelKinds";

function row(id: string, kind: ProviderKeyKind, over: Partial<ProviderRow> = {}): ProviderRow {
	return {
		id,
		displayName: null,
		slug: id,
		origin: "custom",
		sources: ["models.yml"],
		baseUrl: `https://${id}.example/v1`,
		api: "openai-completions",
		models: [],
		key: { kind, envVar: kind === "envVar" ? "MY_KEY" : null, envSet: kind === "envVar" ? false : null },
		enabled: true,
		testable: true,
		defaultBaseUrl: null,
		extraModels: [],
		authNone: false,
		...over,
	};
}

let data: ProviderRow[] = [];
let kindData: ModelKindEntry[] = [];

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

beforeEach(() => {
	ipc.providerRows.mockImplementation(async () => data);
	ipc.modelKindCatalog.mockImplementation(async () => kindData);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	useProviders.setState({ rows: [], loaded: false, error: null, tests: {}, modelTests: {} });
	useModelKindCatalog.setState({ entries: null, kindBySelector: new Map(), loading: false, error: null });
	kindData = [];
});

async function renderPanel(rows: ProviderRow[]) {
	data = rows;
	render(<ProviderPanel />);
	await screen.findByText("供应商（点名称看详情）");
}

describe("key column", () => {
	it("encrypts a plaintext key immediately, without confirmation", async () => {
		await renderPanel([row("p1", "plaintext")]);
		ipc.providerEncrypt.mockResolvedValue(row("p1", "encrypted"));
		fireEvent.click(screen.getByText("明文"));
		await waitFor(() => expect(ipc.providerEncrypt).toHaveBeenCalledWith("p1"));
		expect(confirmDialog).not.toHaveBeenCalled();
		await screen.findByText("已加密", { selector: "span" });
	});

	it("decrypts only after the user confirms", async () => {
		await renderPanel([row("p1", "encrypted")]);
		ipc.providerDecrypt.mockResolvedValue(row("p1", "plaintext"));
		confirmDialog.mockResolvedValueOnce(false);
		fireEvent.click(screen.getByText("已加密", { selector: "span" }));
		await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
		expect(confirmDialog.mock.calls[0][0]).toContain("~/.omp/agent/models.yml");
		expect(ipc.providerDecrypt).not.toHaveBeenCalled();

		confirmDialog.mockResolvedValueOnce(true);
		fireEvent.click(screen.getByText("已加密", { selector: "span" }));
		await waitFor(() => expect(ipc.providerDecrypt).toHaveBeenCalledWith("p1"));
	});

	it.each([
		["vaultMissing", "加密密钥丢失"],
		["envVar", "环境变量未设置"],
		["missing", "未配置密钥"],
	] as const)("%s opens the 设置密钥 dialog", async (kind, label) => {
		await renderPanel([row("p1", kind)]);
		fireEvent.click(screen.getByText(label));
		expect(await screen.findByRole("dialog", { name: /设置密钥/ })).toBeTruthy();
		expect(ipc.providerEncrypt).not.toHaveBeenCalled();
	});

	it("设置密钥 sends the typed key with the chosen mode (default 加密)", async () => {
		await renderPanel([row("p1", "missing")]);
		ipc.providerSetKey.mockResolvedValue(row("p1", "encrypted"));
		fireEvent.click(screen.getByText("未配置密钥"));
		fireEvent.change(await screen.findByLabelText("API 密钥"), { target: { value: "sk-abc" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(ipc.providerSetKey).toHaveBeenCalledWith("p1", "sk-abc", "encrypted"));
	});

	it("oauth opens account management; loginStored only explains", async () => {
		await renderPanel([row("o1", "oauth"), row("l1", "loginStored")]);
		fireEvent.click(screen.getByRole("button", { name: /^o1：OAuth 登录/ }));
		expect(await screen.findByText("OAUTH_DIALOG")).toBeTruthy();
		cleanup();
		await renderPanel([row("l1", "loginStored")]);
		fireEvent.click(screen.getByText("OMP 登录保存"));
		expect(screen.getByRole("note").textContent).toContain("暂不支持在这里加密");
		expect(ipc.providerEncrypt).not.toHaveBeenCalled();
	});

	it.each([
		["none", "无需密钥"],
		["command", "命令获取"],
	] as const)("%s is plain non-interactive text", async (kind, label) => {
		await renderPanel([row("p1", kind)]);
		const el = screen.getByText(label);
		expect(el.closest("button")).toBeNull();
	});
});

describe("encrypt-all menu", () => {
	it("shows the plaintext count and encrypts all on click", async () => {
		await renderPanel([row("a", "plaintext"), row("b", "plaintext"), row("c", "encrypted")]);
		ipc.providerEncryptAll.mockResolvedValue([
			{ id: "a", ok: true, error: null },
			{ id: "b", ok: true, error: null },
		]);
		fireEvent.click(screen.getByText("批量管理密钥"));
		fireEvent.click(await screen.findByText("全部加密（2 个明文）"));
		await waitFor(() => expect(ipc.providerEncryptAll).toHaveBeenCalledTimes(1));
	});

	it("is disabled and reads 已全部加密 when no plaintext key remains", async () => {
		await renderPanel([row("c", "encrypted"), row("d", "envVar")]);
		fireEvent.click(screen.getByText("批量管理密钥"));
		const item = (await screen.findByText("已全部加密")).closest("button");
		expect(item?.disabled).toBe(true);
	});
});

describe("enable switch", () => {
	it("rolls back and reports an error when the backend fails", async () => {
		await renderPanel([row("p1", "plaintext")]);
		ipc.providerSetEnabled.mockRejectedValue("写入失败");
		const sw = screen.getByRole("switch", { name: "启用 p1" });
		expect(sw.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(sw);
		await waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(ipc.providerSetEnabled).toHaveBeenCalledWith("p1", false);
		expect(screen.getByRole("switch", { name: "启用 p1" }).getAttribute("aria-checked")).toBe("true");
	});
});

describe("search", () => {
	it("matches object-form model ids and protocol", async () => {
		await renderPanel([
			row("alpha", "plaintext", { models: [{ id: "zeta-model-9", contextWindow: 1000 }] }),
			row("beta", "plaintext", { api: "anthropic-messages" }),
		]);
		const input = screen.getByLabelText("筛选供应商");
		fireEvent.change(input, { target: { value: "zeta-model" } });
		expect(screen.getByText("alpha")).toBeTruthy();
		expect(screen.queryByText("beta")).toBeNull();
		fireEvent.change(input, { target: { value: "anthropic-messages" } });
		expect(screen.getByText("beta")).toBeTruthy();
		expect(screen.queryByText("alpha")).toBeNull();
	});
});

describe("status groups", () => {
	it("folds disabled providers by default and reveals them on header click", async () => {
		await renderPanel([row("live", "plaintext"), row("needs", "missing"), row("off", "plaintext", { enabled: false })]);
		expect(screen.getByText("live")).toBeTruthy();
		expect(screen.getByText("needs")).toBeTruthy();
		expect(screen.queryByText("off")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /已停用/ }));
		expect(screen.getByText("off")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /已停用/ }));
		expect(screen.queryByText("off")).toBeNull();
	});

	it("renders provider models alphabetically without changing configured order", async () => {
		const provider = row("p1", "plaintext", { models: ["zeta", { id: "beta" }, { id: "Alpha" }] });
		await renderPanel([provider]);
		fireEvent.click(screen.getByTitle("点击展开查看模型与详情"));

		const modelIds = Array.from(document.querySelectorAll("#provider-row-p1 span.font-mono.font-medium"), (el) => el.textContent);
		expect(modelIds).toEqual(["Alpha", "beta", "zeta"]);
		expect(provider.models).toEqual(["zeta", { id: "beta" }, { id: "Alpha" }]);
	});
	it("shows all remaining rows with the exact count and can collapse", async () => {
		const many = Array.from({ length: 11 }, (_, i) => row(`p${String(i).padStart(2, "0")}`, "plaintext"));
		await renderPanel(many);
		expect(document.querySelectorAll('[data-field-id^="provider:"]')).toHaveLength(8);
		expect(screen.getByRole("button", { name: "展开剩余全部 3 条" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "展开剩余全部 3 条" }));
		expect(document.querySelectorAll('[data-field-id^="provider:"]')).toHaveLength(11);
		expect(screen.getByText("p10")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "收起" }));
		expect(document.querySelectorAll('[data-field-id^="provider:"]')).toHaveLength(8);
		expect(screen.queryByText("p08")).toBeNull();
	});

	it("search opens folded groups and shows every match", async () => {
		await renderPanel([row("live", "plaintext"), row("off-one", "plaintext", { enabled: false })]);
		fireEvent.change(screen.getByLabelText("筛选供应商"), { target: { value: "off-one" } });
		expect(screen.getByText("off-one")).toBeTruthy();
	});
});

describe("add dialog", () => {
	it("sends provider_upsert with the chosen key mode", async () => {
		data = [row("existing", "plaintext")];
		useProviders.setState({ rows: data, loaded: true });
		ipc.providerUpsert.mockResolvedValue(row("gw", "encrypted"));
		const onClose = vi.fn();
		render(<ProviderDialog target={{ mode: "add" }} onClose={onClose} />);
		fireEvent.change(screen.getByLabelText("名称"), { target: { value: "gw" } });
		fireEvent.change(screen.getByLabelText("地址"), { target: { value: "https://gw.example/v1" } });
		fireEvent.change(screen.getByLabelText("API 密钥"), { target: { value: "sk-1" } });
		fireEvent.change(screen.getByLabelText("第 1 个模型 ID"), { target: { value: "m1" } });
		fireEvent.click(screen.getByLabelText(/加密保存/));
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(ipc.providerUpsert).toHaveBeenCalledTimes(1));
		const [input, key, mode] = ipc.providerUpsert.mock.calls[0];
		expect(input).toMatchObject({
			originalId: null,
			id: "gw",
			baseUrl: "https://gw.example/v1",
			api: "openai-completions",
			models: ["m1"],
		});
		expect(key).toBe("sk-1");
		expect(mode).toBe("encrypted");
	});

	it("defaults to plaintext and rejects a duplicate name", async () => {
		useProviders.setState({ rows: [row("taken", "plaintext")], loaded: true });
		render(<ProviderDialog target={{ mode: "add" }} onClose={() => {}} />);
		expect((screen.getByLabelText(/明文写入 OMP 配置/) as HTMLInputElement).checked).toBe(true);
		fireEvent.change(screen.getByLabelText("名称"), { target: { value: "taken" } });
		fireEvent.change(screen.getByLabelText("地址"), { target: { value: "https://x/v1" } });
		fireEvent.change(screen.getByLabelText("第 1 个模型 ID"), { target: { value: "m" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		expect((await screen.findByRole("alert")).textContent).toContain("taken");
		expect(ipc.providerUpsert).not.toHaveBeenCalled();
	});
});

describe("edit dialog", () => {
	const builtin = (over: Partial<ProviderRow> = {}) =>
		row("ollama", "none", {
			origin: "builtin",
			sources: ["builtin"],
			baseUrl: "http://127.0.0.1:11434",
			defaultBaseUrl: "http://127.0.0.1:11434",
			api: "ollama",
			models: [{ id: "llama3" }, { id: "qwen" }],
			authNone: true,
			...over,
		});

	async function openEdit(r: ProviderRow) {
		await renderPanel([r]);
		fireEvent.click(screen.getByText(r.id));
		fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
		return screen.findByRole("dialog", { name: /编辑供应商/ });
	}

	it.each([
		["custom", "encrypted", "plaintext"],
		["custom", "plaintext", "encrypted"],
		["builtin", "encrypted", "plaintext"],
		["builtin", "plaintext", "encrypted"],
	] as const)("saves %s blank-key mode change from %s to %s", async (origin, kind, mode) => {
		const r = row("synthetic", kind, { origin, models: ["m1"] });
		useProviders.setState({ rows: [r], loaded: true });
		const onClose = vi.fn();
		const save = origin === "builtin" ? ipc.providerSaveBuiltin : ipc.providerUpsert;
		save.mockResolvedValueOnce({ ...r, key: { ...r.key, kind: mode } });
		render(<ProviderDialog target={{ mode: "edit", row: r }} onClose={onClose} />);
		fireEvent.click(screen.getByLabelText(mode === "encrypted" ? /加密保存/ : /明文写入 OMP 配置/));
		expect((screen.getByLabelText("API 密钥") as HTMLInputElement).value).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: r.id }), null, mode);
	});

	it("treats a blank-key storage-mode change as unsaved work", async () => {
		const r = row("synthetic", "encrypted", { models: ["m1"] });
		const onClose = vi.fn();
		render(<ProviderDialog target={{ mode: "edit", row: r }} onClose={onClose} />);
		confirmDialog.mockResolvedValueOnce(false);
		fireEvent.click(screen.getByLabelText(/明文写入 OMP 配置/));
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
		expect(onClose).not.toHaveBeenCalled();
	});

	it("does not mark the original storage-mode selection as unsaved work", async () => {
		const r = row("synthetic", "encrypted", { models: ["m1"] });
		const onClose = vi.fn();
		render(<ProviderDialog target={{ mode: "edit", row: r }} onClose={onClose} />);
		fireEvent.click(screen.getByLabelText(/明文写入 OMP 配置/));
		fireEvent.click(screen.getByLabelText(/加密保存/));
		fireEvent.click(screen.getByRole("button", { name: "取消" }));
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect(confirmDialog).not.toHaveBeenCalled();
	});

	it("keeps missing-vault references in encrypted mode initially", () => {
		const r = row("synthetic", "vaultMissing", { models: ["m1"] });
		render(<ProviderDialog target={{ mode: "edit", row: r }} onClose={vi.fn()} />);
		expect((screen.getByLabelText(/加密保存/) as HTMLInputElement).checked).toBe(true);
	});

	it("keeps the dialog open when blank-key mode conversion fails", async () => {
		const r = row("synthetic", "encrypted", { models: ["m1"] });
		useProviders.setState({ rows: [r], loaded: true });
		const onClose = vi.fn();
		ipc.providerUpsert.mockRejectedValueOnce("injected vault cleanup failure");
		render(<ProviderDialog target={{ mode: "edit", row: r }} onClose={onClose} />);
		fireEvent.click(screen.getByLabelText(/明文写入 OMP 配置/));
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		expect((await screen.findByRole("alert")).textContent).toContain("injected vault cleanup failure");
		expect(onClose).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("shows the 无密钥 badge for authNone rows", async () => {
		await renderPanel([builtin()]);
		expect(screen.getByText("无密钥")).toBeTruthy();
	});

	it("builtin row: read-only name, default address placeholder, keyless checkbox, extra models editor", async () => {
		await openEdit(builtin());
		const name = screen.getByLabelText("名称") as HTMLInputElement;
		expect(name.readOnly).toBe(true);
		expect(name.value).toBe("ollama");
		const url = screen.getByLabelText("地址") as HTMLInputElement;
		expect(url.placeholder).toBe("http://127.0.0.1:11434");
		expect(url.value).toBe("");
		expect((screen.getByLabelText(/这个服务不需要密钥/) as HTMLInputElement).checked).toBe(true);
		expect(screen.getByText("额外添加的模型")).toBeTruthy();
		expect(screen.getByText(/OMP 自带的 2 个模型会保留/)).toBeTruthy();
		expect(screen.queryByLabelText("API 密钥")).toBeNull();
		expect(screen.queryByRole("button", { name: /删除|恢复 OMP 默认/ })).toBeNull();
	});

	it("saves a builtin through providerSaveBuiltin with null key and the chosen mode", async () => {
		const r = builtin({ authNone: false, key: { kind: "missing", envVar: null, envSet: null } });
		await openEdit(r);
		ipc.providerSaveBuiltin.mockResolvedValue(r);
		fireEvent.change(screen.getByLabelText("地址"), { target: { value: "http://gpu:11434" } });
		fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
		fireEvent.change(screen.getByLabelText("第 1 个模型 ID"), { target: { value: "extra-1" } });
		fireEvent.click(screen.getByLabelText(/加密保存/));
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(ipc.providerSaveBuiltin).toHaveBeenCalledTimes(1));
		const [input, key, mode] = ipc.providerSaveBuiltin.mock.calls[0];
		expect(input).toMatchObject({
			id: "ollama",
			baseUrl: "http://gpu:11434",
			authNone: false,
			extraModels: ["extra-1"],
		});
		expect(key).toBeNull();
		expect(mode).toBe("encrypted");
	});

	it("sends the typed key for a builtin", async () => {
		const r = builtin({ authNone: false, key: { kind: "missing", envVar: null, envSet: null } });
		await openEdit(r);
		ipc.providerSaveBuiltin.mockResolvedValue(r);
		fireEvent.change(screen.getByLabelText("API 密钥"), { target: { value: "sk-9" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(ipc.providerSaveBuiltin).toHaveBeenCalledTimes(1));
		expect(ipc.providerSaveBuiltin.mock.calls[0][1]).toBe("sk-9");
		expect(ipc.providerSaveBuiltin.mock.calls[0][0]).toMatchObject({ baseUrl: null, extraModels: [] });
	});

	it("refuses extra models when there is no address and no default", async () => {
		await openEdit(builtin({ baseUrl: null, defaultBaseUrl: null }));
		fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
		fireEvent.change(screen.getByLabelText("第 1 个模型 ID"), { target: { value: "x" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		expect((await screen.findByRole("alert")).textContent).toContain("添加模型需要先填写地址");
		expect(ipc.providerSaveBuiltin).not.toHaveBeenCalled();
	});

	it("恢复 OMP 默认 confirms, then deletes the override", async () => {
		await openEdit(builtin({ origin: "override", baseUrl: "http://gpu:11434" }));
		ipc.providerDelete.mockResolvedValue(undefined);
		confirmDialog.mockResolvedValueOnce(false);
		fireEvent.click(screen.getByRole("button", { name: /恢复 OMP 默认/ }));
		await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
		expect(confirmDialog.mock.calls[0][0]).toContain("包括密钥");
		expect(ipc.providerDelete).not.toHaveBeenCalled();
		confirmDialog.mockResolvedValueOnce(true);
		fireEvent.click(screen.getByRole("button", { name: /恢复 OMP 默认/ }));
		await waitFor(() => expect(ipc.providerDelete).toHaveBeenCalledWith("ollama"));
	});

	it("custom rows save through providerUpsert with authNone", async () => {
		const r = row("gw", "plaintext", { models: [{ id: "m1" }] });
		await openEdit(r);
		ipc.providerUpsert.mockResolvedValue(r);
		fireEvent.click(screen.getByLabelText(/这个服务不需要密钥/));
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(ipc.providerUpsert).toHaveBeenCalledTimes(1));
		const [input, key] = ipc.providerUpsert.mock.calls[0];
		expect(input).toMatchObject({ originalId: "gw", id: "gw", authNone: true });
		expect(key).toBeNull();
	});
});

describe(".env import", () => {
	it("updates a row whose key is read from that env var", () => {
		useProviders.setState({ rows: [row("mycorp", "envVar", { key: { kind: "envVar", envVar: "MYCORP_KEY", envSet: false } })], loaded: true });
		render(<ProviderDialog target={{ mode: "import" }} onClose={() => {}} />);
		fireEvent.change(screen.getByLabelText("粘贴 .env 内容"), { target: { value: "MYCORP_KEY=sk-123" } });
		expect(screen.queryByText("未识别，跳过")).toBeNull();
		expect(screen.getByText("预览（1 个可导入）")).toBeTruthy();
	});
});

describe("other model catalog", () => {
	const entry = (selector: string, kind: string, name: string): ModelKindEntry => ({
		selector, kind, name, provider: selector.split("/")[0], thinking: [],
	});

	it("shows every registered non-LLM kind including runners without provider rows", async () => {
		data = [row("chat-connection", "plaintext", { models: ["voice-looking-name"] })];
		kindData = [
			entry("chat-connection/voice-looking-name", "chat", "Chat only"),
			entry("tiny/small", "tiny", "Tiny LLM"),
			...["search", "judge", "image", "tts", "stt", "embedding", "rerank", "video", "future-kind"].map((kind) => entry(`runner-${kind}/plain-id`, kind, `Registered ${kind}`)),
		];
		render(<ProviderPanel category="other" />);
		await screen.findByText("显示 9 / 9 个已注册的其他类型模型");
		for (const model of kindData.slice(2)) expect(screen.getByText(model.name!)).toBeTruthy();
		expect(screen.getByRole("heading", { name: "其他类型 · future-kind" })).toBeTruthy();
		expect(screen.queryByText("Chat only")).toBeNull();
		expect(screen.queryByText("Tiny LLM")).toBeNull();
		expect(screen.queryByText("chat-connection")).toBeNull();
		expect(screen.queryByText("按型号批量设置各模型的上下文窗口与自动压缩，到「上下文窗口」页。")).toBeNull();
		expect(screen.queryByRole("button", { name: "批量管理密钥" })).toBeNull();
		expect(screen.getAllByText("目录已注册 · 尚未验证调用可用性")).toHaveLength(9);
		expect(screen.getAllByText("由 OMP 管理；此处无对应的通用 API 连接配置")).toHaveLength(9);
		expect(ipc.providerTestModel).not.toHaveBeenCalled();
	});

	it("searches actual kind and source and counts only this category", async () => {
		data = [row("shared", "missing", { models: ["chat-a", "chat-b", "image-a"], sources: ["models.yml"] })];
		kindData = [entry("shared/image-a", "image", "Picture runner"), entry("web/search-a", "search", "Search runner"), entry("shared/chat-a", "chat", "Chat runner")];
		render(<ProviderPanel category="other" />);
		await screen.findByText("显示 2 / 2 个已注册的其他类型模型");
		fireEvent.change(screen.getByLabelText("搜索模型、类型或来源"), { target: { value: "models.yml" } });
		expect(screen.getByText("Picture runner")).toBeTruthy();
		expect(screen.queryByText("Search runner")).toBeNull();
		expect(screen.getByText("显示 1 / 2 个已注册的其他类型模型")).toBeTruthy();
		expect(screen.getByText("连接已启用 · 未配置密钥")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("搜索模型、类型或来源"), { target: { value: "search" } });
		expect(screen.getByText("Search runner")).toBeTruthy();
		expect(screen.queryByText("Picture runner")).toBeNull();
		fireEvent.change(screen.getByLabelText("搜索模型、类型或来源"), { target: { value: "not-found" } });
		expect(screen.getByText("未找到匹配的其他类型模型。")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
		expect(screen.getByText("显示 2 / 2 个已注册的其他类型模型")).toBeTruthy();
	});

	it("edits a connection with no other models without duplicating credentials or clearing search", async () => {
		const existing = row("existing", "encrypted", { models: ["chat-only"] });
		data = [existing];
		kindData = [entry("web/search-a", "search", "Search runner")];
		ipc.providerUpsert.mockResolvedValueOnce({ ...existing, baseUrl: "https://changed.example/v1" });
		render(<ProviderPanel category="other" />);
		await screen.findByText("Search runner");
		fireEvent.change(screen.getByLabelText("搜索模型、类型或来源"), { target: { value: "search" } });
		fireEvent.click(screen.getByRole("button", { name: "管理连接" }));
		fireEvent.click(await screen.findByRole("button", { name: /existing/ }));
		await screen.findByRole("dialog", { name: /编辑供应商/ });
		expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("existing");
		expect((screen.getByLabelText("API 密钥") as HTMLInputElement).value).toBe("");
		fireEvent.change(screen.getByLabelText("地址"), { target: { value: "https://changed.example/v1" } });
		kindData = [entry("web/search-a", "search", "Updated search")];
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(ipc.providerUpsert).toHaveBeenCalledWith(expect.objectContaining({ originalId: "existing", id: "existing", models: ["chat-only"] }), null, "encrypted");
		expect((screen.getByLabelText("搜索模型、类型或来源") as HTMLInputElement).value).toBe("search");
		expect(screen.getByRole("heading", { name: "其他类型模型" })).toBeTruthy();
		expect(await screen.findByText("Updated search")).toBeTruthy();
	});

	it("keeps the existing add-connection path reachable in an empty catalog", async () => {
		data = [];
		kindData = [];
		render(<ProviderPanel category="other" />);
		await screen.findByText("OMP 目录中暂无已注册的其他类型模型。可管理现有连接或编辑配置后刷新。");
		fireEvent.click(screen.getAllByRole("button", { name: "管理连接" })[0]);
		fireEvent.click(await screen.findByRole("button", { name: "添加供应商" }));
		expect(await screen.findByRole("dialog", { name: /添加供应商/ })).toBeTruthy();
	});

	it("shows catalog failures and retries without presenting them as an empty catalog", async () => {
		data = [];
		ipc.modelKindCatalog.mockRejectedValueOnce(new Error("catalog offline"));
		render(<ProviderPanel category="other" />);
		expect((await screen.findByRole("alert")).textContent).toContain("catalog offline");
		expect(screen.queryByText(/OMP 目录中暂无/)).toBeNull();
		kindData = [entry("web/search-a", "search", "Recovered search")];
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		expect(await screen.findByText("Recovered search")).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("does not hide registered runners when reading connection configuration fails", async () => {
		ipc.providerRows.mockRejectedValueOnce(new Error("config unreadable"));
		kindData = [entry("web/search-a", "search", "Independent search")];
		render(<ProviderPanel category="other" />);
		expect(await screen.findByText("Independent search")).toBeTruthy();
		expect((await screen.findByRole("alert")).textContent).toContain("config unreadable");
		expect(screen.getByText("连接配置状态未知")).toBeTruthy();
		expect(screen.queryByText("由 OMP 管理；此处无对应的通用 API 连接配置")).toBeNull();
	});
});

describe("other model runner configuration", () => {
	it("saves real configuration and refreshes runners without clearing the model search", async () => {
		data = [];
		kindData = [{ selector: "web/runner", kind: "search", provider: "web", name: "Initial runner", thinking: [] }];
		render(<ProviderPanel category="other" />);
		await screen.findByText("Initial runner");
		fireEvent.change(screen.getByLabelText("搜索模型、类型或来源"), { target: { value: "web" } });
		fireEvent.click(screen.getByRole("button", { name: "编辑配置" }));
		const dialog = await screen.findByRole("dialog", { name: "编辑原始配置文件" });
		const content = await within(dialog).findByLabelText("models.yml 内容");
		await waitFor(() => expect((content as HTMLTextAreaElement).value).toBe("providers: {}\n"));
		fireEvent.change(content, { target: { value: "providers: {}\n# edited connection configuration\n" } });
		kindData = [{ selector: "web/runner", kind: "search", provider: "web", name: "Refreshed runner", thinking: [] }];
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
		await waitFor(() => expect(ipc.writeTextFile).toHaveBeenCalledWith("/home/u/.omp/agent/models.yml", "providers: {}\n# edited connection configuration\n"));
		expect(await screen.findByText("Refreshed runner")).toBeTruthy();
		const closeButtons = within(dialog).getAllByRole("button", { name: "关闭" });
		fireEvent.click(closeButtons[closeButtons.length - 1]);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect((screen.getByLabelText("搜索模型、类型或来源") as HTMLInputElement).value).toBe("web");
		expect(screen.getByRole("heading", { name: "其他类型模型" })).toBeTruthy();
	});

	it("shows catalog loading until registered entries arrive", async () => {
		data = [];
		// The project's ES2021 library target does not expose Promise.withResolvers.
		let complete!: (models: ModelKindEntry[]) => void;
		ipc.modelKindCatalog.mockImplementationOnce(() => new Promise<ModelKindEntry[]>((resolve) => { complete = resolve; }));
		render(<ProviderPanel category="other" />);
		expect(screen.getByRole("status").textContent).toContain("正在读取所有类型的模型目录");
		expect(screen.queryByText(/OMP 目录中暂无/)).toBeNull();
		complete([{ selector: "custom/runner", kind: "future-kind", provider: "custom", name: "Delayed runner", thinking: [] }]);
		expect(await screen.findByText("Delayed runner")).toBeTruthy();
		expect(screen.queryByRole("status")).toBeNull();
	});
});
