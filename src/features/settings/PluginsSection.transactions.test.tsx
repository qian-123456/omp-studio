// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	list: vi.fn(), set: vi.fn(), plugins: vi.fn(), skills: vi.fn(), error: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("../../lib/ipc", () => ({
	ompConfigList: h.list, ompConfigSet: h.set, pluginsList: h.plugins, skillsList: h.skills,
	pluginSetEnabled: vi.fn(), extensionDelete: vi.fn(),
}));
vi.mock("../../lib/dialogs", () => ({ confirmDialog: vi.fn(), errMsg: (e: unknown) => String(e) }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: h.error } }));
vi.mock("./OmpSettingsList", () => ({ OmpSections: () => null }));

import { updateOmpListSetting } from "../skills/ompListSetting";
import { PluginsSection } from "./PluginsSection";

beforeEach(() => {
	vi.clearAllMocks();
	h.list.mockReset();
	h.set.mockReset().mockResolvedValue(undefined);
	h.plugins.mockResolvedValue({ plugins: [], roots: [] });
	h.skills.mockResolvedValue({ skills: [], extensions: [{ name: "extension-a", path: "/test/extension-a.ts", source: "user", enabled: true }] });
});
afterEach(cleanup);

describe("79: plugin extension config transactions", () => {
	it.each(["found=false", "rejected"] as const)("does not write or change the rendered toggle after a %s config read", async (failure) => {
		if (failure === "found=false") h.list.mockResolvedValue({ found: false, entries: [], error: "unreadable config" });
		else h.list.mockRejectedValue(new Error("unreadable config"));
		render(<PluginsSection cwd={null} />);
		const toggle = await screen.findByRole("switch");
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(toggle);
		await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
		expect(h.set).not.toHaveBeenCalled();
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect((toggle as HTMLButtonElement).disabled).toBe(false);
	});

	it("waits for a skills-list transaction before reading and preserves both pages' entries", async () => {
		// ES2021 does not expose Promise.withResolvers.
		let release!: () => void;
		const firstWrite = new Promise<void>((resolve) => { release = resolve; });
		let persisted = ["unrelated"];
		h.list.mockImplementation(async () => ({ found: true, entries: [{ key: "disabledExtensions", value: [...persisted] }] }));
		h.set.mockImplementation(async (_key: string, value: string) => {
			if (h.set.mock.calls.length === 1) await firstWrite;
			persisted = JSON.parse(value) as string[];
		});
		const skillsWrite = updateOmpListSetting("disabledExtensions", (current) => [...current, "skill:one"]);
		await waitFor(() => expect(h.set).toHaveBeenCalledTimes(1));
		render(<PluginsSection cwd={null} />);
		const toggle = await screen.findByRole("switch");
		fireEvent.click(toggle);
		expect((toggle as HTMLButtonElement).disabled).toBe(true);
		expect(h.list).toHaveBeenCalledTimes(1);
		expect(h.set).toHaveBeenCalledTimes(1);
		await act(async () => { release(); await skillsWrite; });
		await waitFor(() => expect(h.set).toHaveBeenCalledTimes(2));
		expect(h.set).toHaveBeenLastCalledWith("disabledExtensions", JSON.stringify(["unrelated", "skill:one", "extension-a"]));
		expect(persisted).toEqual(["unrelated", "skill:one", "extension-a"]);
		await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
		expect(h.error).not.toHaveBeenCalled();
	});
});
