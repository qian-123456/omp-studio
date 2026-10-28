// @vitest-environment jsdom
// Replays for ProviderKeys / OauthLogin. Mocks only the Tauri IPC/event boundary. Synthetic keys only.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
	const ipc = {
		providerRows: vi.fn(), providerEncrypt: vi.fn(), providerDecrypt: vi.fn(), providerEncryptAll: vi.fn(),
		providerSetEnabled: vi.fn(), providerSetKey: vi.fn(), providerUpsert: vi.fn(), providerSaveBuiltin: vi.fn(),
		providerDelete: vi.fn(), providerTest: vi.fn(), providerTestModel: vi.fn(), providerExportEnvText: vi.fn(),
		providerFetchModels: vi.fn(), providerReadEnvFile: vi.fn(), listModels: vi.fn(async () => []),
		oauthLoginCancel: vi.fn(), oauthLoginOpenUrl: vi.fn(), oauthLoginProviders: vi.fn(), oauthLoginRespond: vi.fn(),
		oauthLoginStart: vi.fn(), oauthLoginStatus: vi.fn(async () => null),
	};
	const listeners = new Set<(e: Record<string, unknown>) => void>();
	const events = {
		onProvidersOauth: vi.fn(async (cb: (e: Record<string, unknown>) => void) => {
			listeners.add(cb);
			return () => { listeners.delete(cb); };
		}),
	};
	return { ipc, events, listeners, toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, confirmDialog: vi.fn() };
});
vi.mock("<repo>/src/lib/ipc", () => h.ipc);
vi.mock("<repo>/src/lib/events", () => h.events);
vi.mock("<repo>/src/lib/dialogs", () => ({ confirmDialog: h.confirmDialog, copyText: vi.fn(), errMsg: (e: unknown) => String(e) }));
vi.mock("<repo>/src/lib/toast", () => ({ toast: h.toast }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/home/u" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("<repo>/src/features/settings/sections/ProviderBrandLogo", () => ({ ProviderBrandLogo: () => null }));
vi.mock("<repo>/src/features/settings/settingsNav", () => ({ useSettingsNav: () => ({ focusKey: null, focusRequest: 0 }) }));
vi.mock("<repo>/src/features/settings/settingsTargets", () => ({ openSettingsTarget: vi.fn() }));


import { ProviderDialog } from "<repo>/src/features/providers/ProviderDialog";
import { OauthLoginDialog } from "<repo>/src/features/providers/OauthLoginDialog";
import { useProviders } from "<repo>/src/features/providers/store";

afterEach(() => {
	cleanup();
	h.listeners.clear();
	vi.clearAllMocks();
	useProviders.setState({ rows: [], loaded: false, error: null, tests: {}, modelTests: {} });
});

const encryptedRow = {
	id: "gw", displayName: null, slug: "gw", origin: "custom", sources: ["models.yml"],
	baseUrl: "https://gw.example/v1", api: "openai-completions", models: [{ id: "m1" }],
	key: { kind: "encrypted", envVar: null, envSet: null }, enabled: true, testable: true,
	defaultBaseUrl: null, extraModels: [], authNone: false,
};

describe("ProviderKeys: radio without a typed key", () => {
	it("save with plaintext chosen and no key typed sends key=null and still reports success", async () => {
		useProviders.setState({ rows: [encryptedRow as never], loaded: true });
		h.ipc.providerUpsert.mockResolvedValue(encryptedRow); // fake backend returns the row it still holds (ops.rs ignores the mode without a key)
		const onClose = vi.fn();
		render(<ProviderDialog target={{ mode: "edit", row: encryptedRow as never }} onClose={onClose} />);
		expect((screen.getByLabelText(/加密保存/) as HTMLInputElement).checked).toBe(true);
		fireEvent.click(screen.getByLabelText(/明文写入 OMP 配置/));
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(h.ipc.providerUpsert).toHaveBeenCalledTimes(1));
		const [, key, mode] = h.ipc.providerUpsert.mock.calls[0];
		expect(key).toBeNull();
		expect(mode).toBe("plaintext");
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(h.toast.success).toHaveBeenCalledTimes(1);
	});
});

describe("OauthLogin: dialog listener lifecycle", () => {
	async function openFlow() {
		h.ipc.oauthLoginProviders.mockResolvedValue([{ id: "p1", name: "Provider One", available: true }]);
		h.ipc.providerRows.mockResolvedValue([]);
		const view = render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(h.events.onProvidersOauth).toHaveBeenCalled());
		return view;
	}

	it("control: a success event while listening reloads the provider panel", async () => {
		h.ipc.oauthLoginStart.mockResolvedValue(undefined);
		await openFlow();
		await waitFor(() => expect(h.ipc.oauthLoginStart).toHaveBeenCalled());
		await act(async () => { h.listeners.forEach((l) => l({ kind: "completed", providerId: "p1", ok: true })); });
		await waitFor(() => expect(h.ipc.providerRows).toHaveBeenCalledTimes(1));
	});

	it("上一步 then a late success event: the credential is saved but the provider panel is never reloaded", async () => {
		h.ipc.oauthLoginStart.mockResolvedValue(undefined);
		let finishCancel: () => void = () => {};
		h.ipc.oauthLoginCancel.mockReturnValue(new Promise<void>((r) => { finishCancel = r; }));
		await openFlow();
		await waitFor(() => expect(h.ipc.oauthLoginStart).toHaveBeenCalled());
		fireEvent.click(await screen.findByText("上一步"));
		expect(h.listeners.size).toBe(0); // unlistened before the cancel call settles
		await act(async () => { h.listeners.forEach((l) => l({ kind: "completed", providerId: "p1", ok: true })); }); // backend success lands in the gap: nobody listens
		await act(async () => { finishCancel(); });
		expect(h.ipc.oauthLoginCancel).toHaveBeenCalledTimes(1);
		// REPRODUCTION EVIDENCE: no provider reload happened although the (fake) backend reported ok.
		expect(h.ipc.providerRows).not.toHaveBeenCalled();
	});

	it("closing while the start command is still unresolved sends the cancel command before start settles", async () => {
		let resolveStart: () => void = () => {};
		h.ipc.oauthLoginStart.mockReturnValue(new Promise<void>((r) => { resolveStart = r; }));
		h.ipc.oauthLoginCancel.mockResolvedValue(undefined);
		const view = await openFlow();
		await waitFor(() => expect(h.ipc.oauthLoginStart).toHaveBeenCalled());
		view.unmount(); // parent removes the dialog (effect cleanup)
		expect(h.ipc.oauthLoginCancel).toHaveBeenCalledTimes(1); // issued while start has not resolved
		const order = [h.ipc.oauthLoginStart.mock.invocationCallOrder[0], h.ipc.oauthLoginCancel.mock.invocationCallOrder[0]];
		expect(order[0]).toBeLessThan(order[1]);
		resolveStart();
	});
});
