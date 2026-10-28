// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefs } from "../../core/stores/prefs";
import { NotifySheet } from "./sheets/NotifySheet";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("NotifySheet", () => {
	it("disables push over insecure http but keeps the in-page fallbacks working", async () => {
		vi.stubGlobal("isSecureContext", false);
		await act(async () => {
			render(<NotifySheet open onClose={() => {}} />);
		});
		const push = screen.getByRole("switch", { name: "推送通知" }) as HTMLButtonElement;
		expect(push.disabled).toBe(true);
		expect(screen.getByText("需要 https 连接")).toBeDefined();
		expect(screen.queryByText("发送测试通知")).toBeNull();

		const sound = screen.getByRole("switch", { name: "提示音" }) as HTMLButtonElement;
		expect(sound.disabled).toBe(false);
		const before = usePrefs.getState().notifySound;
		fireEvent.click(sound);
		expect(usePrefs.getState().notifySound).toBe(!before);
	});
});
