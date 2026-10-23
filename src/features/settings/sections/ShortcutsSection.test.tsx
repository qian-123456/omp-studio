// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceleratorOf, useShortcutBindings } from "../../shortcuts/bindingsStore";
import { inAppAccelerator, ShortcutsSection } from "./ShortcutsSection";

vi.mock("../useAppSettings", () => ({
	useAppSettings: () => ({ settings: { sendShortcut: "enter", quickCaptureShortcut: "" }, save: vi.fn() }),
}));
const confirmDialog = vi.fn();
vi.mock("../../../lib/dialogs", () => ({ confirmDialog: (...a: unknown[]) => confirmDialog(...a) }));

const key = (code: string, extra: Partial<KeyboardEventInit> = {}) =>
	fireEvent.keyDown(window, { code, ctrlKey: true, ...extra });
const capsule = (label: string) => screen.getByRole("button", { name: `修改「${label}」的快捷键` });

beforeEach(() => {
	useShortcutBindings.getState().resetAll();
	confirmDialog.mockReset();
});
afterEach(cleanup);

describe("inAppAccelerator", () => {
	it("requires a ⌘/⌃/⌥ modifier; bare and Shift-only combos are rejected", () => {
		const base = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
		expect(inAppAccelerator({ ...base, code: "KeyK" })).toBeNull();
		expect(inAppAccelerator({ ...base, code: "KeyK", shiftKey: true })).toBeNull();
		expect(inAppAccelerator({ ...base, code: "F5" })).toBeNull();
		expect(inAppAccelerator({ ...base, code: "KeyK", altKey: true })).toBe("Alt+K");
	});
});

describe("ShortcutsSection", () => {
	it("rejects an unmodified key and keeps recording", () => {
		render(<ShortcutsSection />);
		fireEvent.click(capsule("新建会话"));
		fireEvent.keyDown(window, { code: "KeyJ" });
		expect(acceleratorOf("session.new")).toBe("CommandOrControl+N");
		expect(capsule("新建会话").hasAttribute("data-shortcut-recording")).toBe(true);
	});

	it("Esc cancels recording without changes", () => {
		render(<ShortcutsSection />);
		fireEvent.click(capsule("新建会话"));
		fireEvent.keyDown(window, { code: "Escape" });
		expect(capsule("新建会话").hasAttribute("data-shortcut-recording")).toBe(false);
		expect(acceleratorOf("session.new")).toBe("CommandOrControl+N");
	});

	it("binds a free combo, then reset-one restores the default", () => {
		render(<ShortcutsSection />);
		fireEvent.click(capsule("新建会话"));
		key("KeyY");
		expect(acceleratorOf("session.new")).toBe("CommandOrControl+Y");
		fireEvent.click(screen.getByRole("button", { name: "恢复「新建会话」的默认快捷键" }));
		expect(acceleratorOf("session.new")).toBe("CommandOrControl+N");
		expect(screen.queryByRole("button", { name: "恢复「新建会话」的默认快捷键" })).toBeNull();
	});

	it("conflict: giving up changes nothing, taking over unbinds the other action", () => {
		render(<ShortcutsSection />);
		fireEvent.click(capsule("上一个会话"));
		key("KeyN", { shiftKey: false });
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(acceleratorOf("session.prev")).toBe("CommandOrControl+Shift+BracketLeft");
		fireEvent.click(screen.getByRole("button", { name: "放弃" }));
		expect(screen.queryByRole("alert")).toBeNull();
		expect(acceleratorOf("session.new")).toBe("CommandOrControl+N");

		fireEvent.click(capsule("上一个会话"));
		key("KeyN");
		fireEvent.click(screen.getByRole("button", { name: "改用这个，并取消另一个" }));
		expect(acceleratorOf("session.prev")).toBe("CommandOrControl+N");
		expect(acceleratorOf("session.new")).toBe("");
		expect(screen.getAllByText("未设置").length).toBeGreaterThan(0);
	});

	it("reset-default detects a conflict and requires takeover", () => {
		render(<ShortcutsSection />);
		fireEvent.click(capsule("上一个会话"));
		key("KeyN");
		fireEvent.click(screen.getByRole("button", { name: "改用这个，并取消另一个" }));
		expect(acceleratorOf("session.prev")).toBe("CommandOrControl+N");

		fireEvent.click(screen.getByRole("button", { name: "恢复「新建会话」的默认快捷键" }));
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(acceleratorOf("session.new")).toBe("");
		expect(acceleratorOf("session.prev")).toBe("CommandOrControl+N");

		fireEvent.click(screen.getByRole("button", { name: "改用这个，并取消另一个" }));
		expect(acceleratorOf("session.new")).toBe("CommandOrControl+N");
		expect(acceleratorOf("session.prev")).toBe("");
	});

	it("conflict with a fixed shortcut offers only giving up", () => {
		render(<ShortcutsSection />);
		fireEvent.click(capsule("新建会话"));
		key("KeyW");
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "改用这个，并取消另一个" })).toBeNull();
		expect(acceleratorOf("session.new")).toBe("CommandOrControl+N");
	});

	it("fixed rows are not editable", () => {
		render(<ShortcutsSection />);
		expect(screen.queryByRole("button", { name: "修改「关闭标签页」的快捷键" })).toBeNull();
		expect(screen.queryByRole("button", { name: "修改「放大界面」的快捷键" })).toBeNull();
	});

	it("reset all asks first and only when something changed", async () => {
		render(<ShortcutsSection />);
		const resetAll = screen.getByRole("button", { name: "全部恢复默认" }) as HTMLButtonElement;
		expect(resetAll.disabled).toBe(true);

		useShortcutBindings.getState().setBinding("session.new", "");
		await waitFor(() => expect(resetAll.disabled).toBe(false));

		confirmDialog.mockResolvedValueOnce(false);
		fireEvent.click(resetAll);
		await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
		expect(acceleratorOf("session.new")).toBe("");

		confirmDialog.mockResolvedValueOnce(true);
		fireEvent.click(resetAll);
		await waitFor(() => expect(acceleratorOf("session.new")).toBe("CommandOrControl+N"));
	});
});
