// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefs } from "../../core/stores/prefs";
import { NotifySection } from "./sections";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => root.render(<NotifySection />));
	return { host, unmount: () => act(async () => root.unmount()) };
}

afterEach(() => {
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

describe("NotifySection", () => {
	it("disables push over insecure http but keeps the in-page fallbacks working", async () => {
		vi.stubGlobal("isSecureContext", false);
		const { host, unmount } = await mount();
		const push = host.querySelector<HTMLButtonElement>('[aria-label="推送通知"]')!;
		expect(push.disabled).toBe(true);
		expect(host.textContent).toContain("需要 https 连接");
		expect(host.textContent).not.toContain("发送测试通知");

		const sound = host.querySelector<HTMLButtonElement>('[aria-label="提示音"]')!;
		expect(sound.disabled).toBe(false);
		const before = usePrefs.getState().notifySound;
		await act(async () => sound.click());
		expect(usePrefs.getState().notifySound).toBe(!before);
		await unmount();
	});
});
