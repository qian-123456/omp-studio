// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

import { claimEscape, isEscapeClaimed } from "./escapeClaim";
import { installEscapeGuard, resolveCloseTarget } from "./nativeShortcuts";

describe("resolveCloseTarget", () => {
	it("prefers an open layer, then the active tab, then hides", () => {
		expect(resolveCloseTarget({ layerOpen: true, rightOpen: true, rightTab: "git" })).toBe("layer");
		expect(resolveCloseTarget({ layerOpen: false, rightOpen: true, rightTab: "git" })).toBe("tab");
		expect(resolveCloseTarget({ layerOpen: false, rightOpen: false, rightTab: "git" })).toBe("hide");
		expect(resolveCloseTarget({ layerOpen: false, rightOpen: true, rightTab: null })).toBe("hide");
	});
});

describe("installEscapeGuard", () => {
	it("cancels every Esc but only claimEscape marks it as consumed", () => {
		const off = installEscapeGuard();
		const seen: { prevented: boolean; claimed: boolean }[] = [];
		const probe = (e: KeyboardEvent) => seen.push({ prevented: e.defaultPrevented, claimed: isEscapeClaimed(e) });
		const claim = (e: KeyboardEvent) => claimEscape(e);
		const fire = () =>
			document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }));

		window.addEventListener("keydown", probe);
		fire();
		window.addEventListener("keydown", claim, true);
		fire();
		window.removeEventListener("keydown", claim, true);
		window.removeEventListener("keydown", probe);
		off();
		expect(seen).toEqual([
			{ prevented: true, claimed: false },
			{ prevented: true, claimed: true },
		]);
	});

	it("a claim made through a React synthetic event is visible to window listeners", () => {
		const native = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
		claimEscape({ nativeEvent: native, preventDefault: () => native.preventDefault() });
		expect(isEscapeClaimed(native)).toBe(true);
		expect(native.defaultPrevented).toBe(true);
	});
});
