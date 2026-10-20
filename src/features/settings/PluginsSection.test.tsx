// @vitest-environment jsdom
/**
 * Settings ▸ 插件 ▸ 扩展模块: every row has a 删除 icon button that asks first and
 * only then deletes that exact path; cancelling must not touch the disk.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { extensionDelete, confirm } = vi.hoisted(() => ({
	extensionDelete: vi.fn(),
	confirm: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("../../lib/dialogs", () => ({
	confirmDialog: confirm,
	errMsg: (e: unknown) => String(e),
}));
vi.mock("../../lib/ipc", () => ({
	pluginsList: vi.fn().mockResolvedValue({ roots: [], plugins: [] }),
	skillsList: vi.fn().mockResolvedValue({
		skills: [],
		extensions: [
			{ name: "alpha", path: "/h/.omp/agent/extensions/alpha.ts", source: "user", enabled: true },
			{ name: "beta", path: "/h/.omp/agent/extensions/beta.ts.disabled", source: "user", enabled: false },
		],
	}),
	extensionDelete,
	pluginSetEnabled: vi.fn(),
	ompConfigList: vi.fn(),
	ompConfigSet: vi.fn(),
}));
vi.mock("./OmpSettingsList", () => ({
	OmpSections: ({ page }: { page: string }) => <div data-testid="omp-sections" data-page={page} />,
}));

import { PluginsSection } from "./PluginsSection";

beforeEach(() => {
	extensionDelete.mockReset().mockResolvedValue(undefined);
	confirm.mockReset();
});
afterEach(cleanup);

describe("PluginsSection extension delete", () => {
	it("renders the plugins omp sections and the current project line", async () => {
		render(<PluginsSection cwd="/p" />);
		expect((await screen.findByTestId("omp-sections")).getAttribute("data-page")).toBe("plugins");
		expect(screen.getByText("当前项目：")).toBeDefined();
	});

	it("deletes the clicked extension's path after confirmation", async () => {
		confirm.mockResolvedValue(true);
		render(<PluginsSection cwd="/p" />);
		fireEvent.click(await screen.findByLabelText("删除扩展 beta"));
		await waitFor(() =>
			expect(extensionDelete).toHaveBeenCalledWith("/h/.omp/agent/extensions/beta.ts.disabled", "/p"),
		);
		expect(extensionDelete).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the confirmation is cancelled", async () => {
		confirm.mockResolvedValue(false);
		render(<PluginsSection cwd={null} />);
		fireEvent.click(await screen.findByLabelText("删除扩展 alpha"));
		await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
		expect(extensionDelete).not.toHaveBeenCalled();
	});
});
