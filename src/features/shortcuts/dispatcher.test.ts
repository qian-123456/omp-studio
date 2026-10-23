// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	focusSidebarSearch: vi.fn(),
	openThreadFind: vi.fn(() => false),
	startNewSession: vi.fn(async () => {}),
}));
vi.mock("../sessions/sidebarShortcuts", () => ({ focusSidebarSearch: mocks.focusSidebarSearch }));
vi.mock("../chat/find/openThreadFind", () => ({ openThreadFind: mocks.openThreadFind }));
vi.mock("../sessions/newSession", () => ({ startNewSession: mocks.startNewSession }));

import { useUi } from "../../stores/ui";
import { useShortcutBindings } from "./bindingsStore";
import { installShortcutDispatcher } from "./dispatcher";

const press = (
	init: KeyboardEventInit & { key: string },
	target: EventTarget = document.body,
): KeyboardEvent => {
	const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
	target.dispatchEvent(ev);
	return ev;
};
// jsdom is not macOS, so CommandOrControl resolves to Ctrl here.
const mod = (key: string, code: string, extra: KeyboardEventInit = {}) =>
	({ key, code, ctrlKey: true, ...extra }) as KeyboardEventInit & { key: string };

describe("shortcut dispatcher", () => {
	let off: () => void;
	beforeEach(() => {
		useShortcutBindings.setState({ overrides: {} });
		useUi.setState({ centerView: "session", selectedSessionId: "s1", lastSessionId: "s1", previousCenterView: null });
		mocks.focusSidebarSearch.mockClear();
		mocks.openThreadFind.mockReset().mockReturnValue(false);
		mocks.startNewSession.mockClear();
		off = installShortcutDispatcher();
	});
	afterEach(() => {
		off();
		document.body.innerHTML = "";
	});

	it("⌘, toggles settings, and still closes it when the overlay stops propagation (capture)", () => {
		expect(press(mod(",", "Comma")).defaultPrevented).toBe(true);
		expect(useUi.getState().centerView).toBe("settings");
		const overlay = document.createElement("div");
		overlay.addEventListener("keydown", (e) => e.stopPropagation());
		document.body.appendChild(overlay);
		press(mod(",", "Comma"), overlay);
		expect(useUi.getState().centerView).toBe("session");
	});

	it("⌘1 toggles the inbox and returns to the session", () => {
		press(mod("1", "Digit1"));
		expect(useUi.getState().centerView).toBe("inbox");
		press(mod("1", "Digit1"));
		expect(useUi.getState().centerView).toBe("session");
	});

	it("rebinding moves the chord: new fires, old stops", () => {
		useShortcutBindings.getState().setBinding("view.inbox", "CommandOrControl+Shift+KeyY");
		press(mod("1", "Digit1"));
		expect(useUi.getState().centerView).toBe("session");
		press(mod("y", "KeyY", { shiftKey: true }));
		expect(useUi.getState().centerView).toBe("inbox");
	});

	it("an unbound shortcut never fires", () => {
		useShortcutBindings.getState().setBinding("view.inbox", "");
		expect(press(mod("1", "Digit1")).defaultPrevented).toBe(false);
		expect(useUi.getState().centerView).toBe("session");
	});

	it("while settings is open only settings.toggle and shortcuts.show act", () => {
		useUi.getState().openSettings();
		expect(press(mod("2", "Digit2")).defaultPrevented).toBe(false);
		expect(press(mod("b", "KeyB")).defaultPrevented).toBe(false);
		expect(useUi.getState().centerView).toBe("settings");
		press(mod("/", "Slash"));
		expect(useUi.getState().centerView).toBe("settings");
	});

	it("a modal blocks view shortcuts but not ⌘N or ⌘B", () => {
		const modal = document.createElement("div");
		modal.setAttribute("aria-modal", "true");
		document.body.appendChild(modal);
		expect(press(mod("1", "Digit1")).defaultPrevented).toBe(false);
		expect(useUi.getState().centerView).toBe("session");
		press(mod("n", "KeyN"));
		expect(mocks.startNewSession).toHaveBeenCalledTimes(1);
		const before = useUi.getState().sidebarOpen;
		press(mod("b", "KeyB"));
		expect(useUi.getState().sidebarOpen).toBe(!before);
	});

	it("ignores IME composition", () => {
		expect(press({ ...mod("1", "Digit1"), isComposing: true }).defaultPrevented).toBe(false);
		expect(press(mod("1", "Digit1"), document.body).defaultPrevented).toBe(true);
	});

	it("does nothing while Settings is recording a combo", () => {
		const cap = document.createElement("div");
		cap.setAttribute("data-shortcut-recording", "");
		document.body.appendChild(cap);
		expect(press(mod("1", "Digit1")).defaultPrevented).toBe(false);
		expect(useUi.getState().centerView).toBe("session");
	});

	it("⌘F falls back to session search without a chat, and bypasses editors/terminals", () => {
		expect(press(mod("f", "KeyF")).defaultPrevented).toBe(true);
		expect(mocks.focusSidebarSearch).toHaveBeenCalledTimes(1);

		const term = document.createElement("div");
		term.className = "xterm";
		const inner = document.createElement("textarea");
		term.appendChild(inner);
		document.body.appendChild(term);
		mocks.focusSidebarSearch.mockClear();
		expect(press(mod("f", "KeyF"), inner).defaultPrevented).toBe(false);
		expect(mocks.focusSidebarSearch).not.toHaveBeenCalled();
	});

	it("⌘F opens thread find when a chat is visible, and re-focuses it from inside the find bar", () => {
		mocks.openThreadFind.mockReturnValue(true);
		press(mod("f", "KeyF"));
		expect(mocks.openThreadFind).toHaveBeenCalledTimes(1);
		expect(mocks.focusSidebarSearch).not.toHaveBeenCalled();

		const bar = document.createElement("div");
		bar.setAttribute("data-own-find", "");
		const input = document.createElement("input");
		bar.appendChild(input);
		document.body.appendChild(bar);
		press(mod("f", "KeyF"), input);
		expect(mocks.openThreadFind).toHaveBeenCalledTimes(2);
	});
});
