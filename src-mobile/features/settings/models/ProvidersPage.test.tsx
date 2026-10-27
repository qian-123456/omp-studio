// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
vi.mock("../../../core/api", () => ({
	api: (...args: unknown[]) => apiMock(...args),
	errorMessage: (e: unknown) => (e instanceof Error ? e.message : "失败"),
}));

import { SettingsProvidersPage } from "./ProvidersPage";

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
		fireEvent.click(await screen.findByText("mine"));
		const keyInput = screen.getByPlaceholderText("请输入 API Key") as HTMLInputElement;
		expect(keyInput.type).toBe("password");
		fireEvent.change(keyInput, { target: { value: "sk-secret-123" } });
		fireEvent.click(screen.getByLabelText("显示密钥"));
		expect(keyInput.type).toBe("text");
		fireEvent.click(screen.getByText("保存更改"));
		const sheet = screen.getByRole("dialog");
		expect(sheet.textContent).toContain("••••••••");
		expect(sheet.textContent).not.toContain("sk-secret-123");
		await act(async () => {
			fireEvent.click(screen.getByText("确认保存"));
		});
		expect(apiMock).toHaveBeenCalledWith("POST", "/left/providers/save", { id: "mine", api_key: "sk-secret-123" });
		expect(screen.getByRole("alert").textContent).toContain("vault locked: details line 1\nline 2");
	});
});
