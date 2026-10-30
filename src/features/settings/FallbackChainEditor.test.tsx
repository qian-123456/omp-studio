// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelOption } from "../../lib/models";
import { ompConfigSet } from "../../lib/ipc";
import { useModelCatalog } from "../../stores/modelCatalog";
import { FallbackChainEditor } from "./FallbackChainEditor";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emit: vi.fn() }));
vi.mock("../../lib/ipc", () => ({
	ompConfigSet: vi.fn().mockResolvedValue(undefined),
	ompConfigList: vi.fn().mockResolvedValue([]),
}));

const MOCK_MODELS: ModelOption[] = [
	{
		provider: "sub2api-gpt-pro",
		id: "gpt-5.6-luna",
		name: "GPT 5.6 Luna",
		thinking: ["minimal", "low", "medium", "high", "xhigh", "max"],
	},
	{
		provider: "zzz-pro",
		id: "gpt-5.6-luna",
		name: "GPT 5.6 Luna",
		thinking: ["minimal", "low", "medium", "high", "xhigh", "max"],
	},
	{
		provider: "openai",
		id: "gpt-5",
		name: "GPT 5",
		thinking: ["low", "medium", "high"],
	},
];

// jsdom lacks ResizeObserver, which FloatingLayer uses for positioning.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const KEY = "CTAI-luna+plus/gpt-5.6-luna";

function renderEditor(items: string[], onSaved = vi.fn()) {
	useModelCatalog.setState({ loading: false, refresh: async () => {} });
	render(
		<FallbackChainEditor
			chainKey={KEY}
			chains={{ [KEY]: items }}
			models={MOCK_MODELS}
			roleIds={["default"]}
			onSaved={onSaved}
			onCollapse={vi.fn()}
			unsetTitle="未设置"
			emptyTitle="不回退"
		/>,
	);
}

const thinkingSelects = () =>
	(screen.getAllByRole("combobox") as HTMLSelectElement[]).filter((s) =>
		Array.from(s.options).some((o) => o.text === "沿用出错那一轮"),
	);

/** Open the grouped model picker of an entry row, search and pick the first hit with Enter. */
function pickInRow(currentLabel: string, query: string) {
	fireEvent.click(screen.getByRole("button", { name: currentLabel }));
	const box = screen.getByPlaceholderText(/搜索模型/);
	fireEvent.change(box, { target: { value: query } });
	fireEvent.keyDown(box, { key: "Enter" });
}

describe("FallbackChainEditor grouped model picker", () => {
	it("shows the selector on the picker button and keeps the thinking level in its own select", () => {
		renderEditor(["sub2api-gpt-pro/gpt-5.6-luna:xhigh", "zzz-pro/gpt-5.6-luna:xhigh"]);
		expect(screen.queryByPlaceholderText(/供应商\/模型/)).toBeNull();
		expect(screen.getByRole("button", { name: "sub2api-gpt-pro/gpt-5.6-luna" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "zzz-pro/gpt-5.6-luna" })).toBeTruthy();
		const selects = thinkingSelects();
		expect(selects).toHaveLength(2);
		expect(selects.map((s) => s.value)).toEqual(["xhigh", "xhigh"]);
	});

	it("changing the thinking dropdown serializes selector:level on apply", async () => {
		const onSaved = vi.fn();
		renderEditor(["sub2api-gpt-pro/gpt-5.6-luna:xhigh"], onSaved);
		fireEvent.change(screen.getByDisplayValue("xhigh"), { target: { value: "medium" } });
		fireEvent.click(screen.getByRole("button", { name: "应用" }));
		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		expect(ompConfigSet).toHaveBeenLastCalledWith(
			"retry.fallbackChains",
			JSON.stringify({ [KEY]: ["sub2api-gpt-pro/gpt-5.6-luna:medium"] }),
		);
	});

	it("picking another model in the grouped picker keeps the chosen thinking level", async () => {
		const onSaved = vi.fn();
		renderEditor(["sub2api-gpt-pro/gpt-5.6-luna:xhigh"], onSaved);
		pickInRow("sub2api-gpt-pro/gpt-5.6-luna", "zzz-pro");
		expect(screen.getByRole("button", { name: "zzz-pro/gpt-5.6-luna" })).toBeTruthy();
		expect(thinkingSelects()[0].value).toBe("xhigh");
		fireEvent.click(screen.getByRole("button", { name: "应用" }));
		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		expect(ompConfigSet).toHaveBeenLastCalledWith(
			"retry.fallbackChains",
			JSON.stringify({ [KEY]: ["zzz-pro/gpt-5.6-luna:xhigh"] }),
		);
	});

	it("offers the picked model's own catalog thinking levels", () => {
		renderEditor(["sub2api-gpt-pro/gpt-5.6-luna"]);
		pickInRow("sub2api-gpt-pro/gpt-5.6-luna", "openai/gpt-5");
		const levels = Array.from(thinkingSelects()[0].options).map((o) => o.value);
		expect(levels).toEqual(["", "off", "low", "medium", "high"]);
	});
});
