// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderKeyKind, ProviderRow } from "../../lib/contracts";

const ipc = vi.hoisted(() => ({
	providerRows: vi.fn(),
	providerEncrypt: vi.fn(),
	providerDecrypt: vi.fn(),
	providerEncryptAll: vi.fn(),
	providerSetEnabled: vi.fn(),
	providerSetKey: vi.fn(),
	providerUpsert: vi.fn(),
	providerDelete: vi.fn(),
	providerTest: vi.fn(),
	providerTestModel: vi.fn(),
	providerExportEnvText: vi.fn(),
	providerFetchModels: vi.fn(),
	providerReadEnvFile: vi.fn(),
	listModels: vi.fn(async () => []),
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
vi.mock("../settings/sections/ProviderBrandLogo", () => ({ ProviderBrandLogo: () => null }));
vi.mock("../settings/settingsNav", () => ({ useSettingsNav: () => ({ focusKey: null, focusRequest: 0 }) }));
vi.mock("../settings/settingsTargets", () => ({ openSettingsTarget: vi.fn() }));
vi.mock("./OauthLoginDialog", () => ({ OauthLoginDialog: () => <div>OAUTH_DIALOG</div> }));

import { ProviderDialog } from "./ProviderDialog";
import { ProviderPanel } from "./ProviderPanel";
import { useProviders } from "./store";

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
		...over,
	};
}

let data: ProviderRow[] = [];

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
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	useProviders.setState({ rows: [], loaded: false, error: null, tests: {}, modelTests: {} });
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

describe(".env import", () => {
	it("updates a row whose key is read from that env var", () => {
		useProviders.setState({ rows: [row("mycorp", "envVar", { key: { kind: "envVar", envVar: "MYCORP_KEY", envSet: false } })], loaded: true });
		render(<ProviderDialog target={{ mode: "import" }} onClose={() => {}} />);
		fireEvent.change(screen.getByLabelText("粘贴 .env 内容"), { target: { value: "MYCORP_KEY=sk-123" } });
		expect(screen.queryByText("未识别，跳过")).toBeNull();
		expect(screen.getByText("预览（1 个可导入）")).toBeTruthy();
	});
});
