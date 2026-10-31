// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
vi.mock("../../../core/api", () => ({
	api: (...args: unknown[]) => apiMock(...args),
	errorMessage: (e: unknown) => (e instanceof Error ? e.message : "失败"),
}));

import { SettingsProvidersPage } from "./ProvidersPage";
import { ToastHost } from "../../../ui/Toast";

afterEach(() => {
	cleanup();
	apiMock.mockReset();
});

describe("SettingsProvidersPage", () => {
	it("masks the typed key in the confirmation, saves it, and shows save errors in full", async () => {
		apiMock.mockImplementation(async (method: string, path: string) => {
			if (method === "GET") {
				return {
					providers: [
						{ id: "mine", origin: "custom", baseUrl: "https://a/v1", api: "openai", models: [], key: { kind: "missing" } },
					],
				};
			}
			if (path === "/left/providers/save") throw new Error("vault locked: details line 1\nline 2");
			return {};
		});
		render(<SettingsProvidersPage />);
		await act(async () => {});
		expect((await screen.findByText("· 0 个模型")).classList.contains("whitespace-nowrap")).toBe(true);
		fireEvent.click(await screen.findByText("mine"));
		const keyInput = screen.getByPlaceholderText("请输入 API Key") as HTMLInputElement;
		expect(keyInput.type).toBe("password");
		fireEvent.change(keyInput, { target: { value: "sk-secret-123" } });
		fireEvent.click(screen.getByLabelText("显示密钥"));
		expect(keyInput.type).toBe("text");
		fireEvent.click(screen.getByText("保存更改"));
		const dialogs = screen.getAllByRole("dialog");
		const sheet = dialogs[dialogs.length - 1];
		expect(sheet.textContent).toContain("••••••••");
		expect(sheet.textContent).not.toContain("sk-secret-123");
		await act(async () => {
			fireEvent.click(screen.getByText("确认保存"));
		});
		expect(apiMock).toHaveBeenCalledWith("POST", "/left/providers/save", { id: "mine", api_key: "sk-secret-123" });
		expect(screen.getByRole("alert").textContent).toContain("vault locked: details line 1\nline 2");
	});

	it.each([false, true])("persists URL-only changes and prevents stale undo after newer edit %s", async (newer) => {
		let url = "https://old.example/v1";
		const id = newer ? "provider-newer" : "provider-undo";
		const row = () => ({ id, origin: "custom", baseUrl: url, api: "openai", models: [], key: { kind: "missing" } });
		apiMock.mockImplementation(async (method: string, _path: string, body?: { base_url?: string }) => {
			if (method === "GET") return { providers: [row()] };
			if (body?.base_url) url = body.base_url;
			return { provider: row() };
		});
		render(<><SettingsProvidersPage /><ToastHost /></>);
		fireEvent.click(await screen.findByText(id));
		fireEvent.change(screen.getByPlaceholderText("https://api.example.com/v1"), { target: { value: "https://new.example/v1" } });
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "保存更改" })));
		expect(url).toBe("https://new.example/v1");
		expect(screen.queryByRole("button", { name: "确认保存" })).toBeNull();
		if (newer) {
			fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${id}.*openai`) }));
			fireEvent.change(screen.getByPlaceholderText("https://api.example.com/v1"), { target: { value: "https://latest.example/v1" } });
		}
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "撤销" })));
		if (newer) {
			expect(url).toBe("https://new.example/v1");
			expect(await screen.findByText(/已有更新的修改/)).toBeTruthy();
			expect(apiMock.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
		} else {
			await waitFor(() => expect(url).toBe("https://old.example/v1"));
			expect(apiMock).toHaveBeenLastCalledWith("GET", "/left/providers");
			expect(apiMock).toHaveBeenCalledWith("POST", "/left/providers/save", { id, base_url: "https://old.example/v1" });
		}
	});
});
