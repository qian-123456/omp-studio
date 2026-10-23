// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelOption } from "../../lib/models";
import { FallbackChainEditor } from "./FallbackChainEditor";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emit: vi.fn() }));
vi.mock("../../lib/ipc", () => ({
	ompConfigSet: vi.fn().mockResolvedValue(undefined),
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

afterEach(cleanup);

describe("FallbackChainEditor thinking level display", () => {
	it("shows only the model selector in the input box, leaving thinking level to the select", () => {
		const chains = {
			"CTAI-luna+plus/gpt-5.6-luna": [
				"sub2api-gpt-pro/gpt-5.6-luna:xhigh",
				"zzz-pro/gpt-5.6-luna:xhigh",
			],
		};

		render(
			<FallbackChainEditor
				chainKey="CTAI-luna+plus/gpt-5.6-luna"
				chains={chains}
				models={MOCK_MODELS}
				roleIds={["default"]}
				onSaved={vi.fn()}
				onCollapse={vi.fn()}
				unsetTitle="未设置"
				emptyTitle="不回退"
			/>,
		);

		const inputs = screen.getAllByPlaceholderText("供应商/模型，或 @角色") as HTMLInputElement[];
		expect(inputs).toHaveLength(2);

		// The input should display ONLY the model selector, NOT ":xhigh"
		expect(inputs[0].value).toBe("sub2api-gpt-pro/gpt-5.6-luna");
		expect(inputs[1].value).toBe("zzz-pro/gpt-5.6-luna");

		// The thinking level dropdowns should display "xhigh"
		const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
		const thinkingSelects = selects.filter((s) =>
			Array.from(s.options).some((o) => o.text === "沿用出错那一轮"),
		);
		expect(thinkingSelects).toHaveLength(2);
		expect(thinkingSelects[0].value).toBe("xhigh");
		expect(thinkingSelects[1].value).toBe("xhigh");

		// Input and thinking level select should be placed on the same row
		expect(inputs[0].parentElement!.contains(thinkingSelects[0])).toBe(true);
		expect(inputs[1].parentElement!.contains(thinkingSelects[1])).toBe(true);
	});

	it("updates the entry format when thinking level dropdown changes", () => {
		const chains = {
			"CTAI-luna+plus/gpt-5.6-luna": ["sub2api-gpt-pro/gpt-5.6-luna:xhigh"],
		};

		render(
			<FallbackChainEditor
				chainKey="CTAI-luna+plus/gpt-5.6-luna"
				chains={chains}
				models={MOCK_MODELS}
				roleIds={["default"]}
				onSaved={vi.fn()}
				onCollapse={vi.fn()}
				unsetTitle="未设置"
				emptyTitle="不回退"
			/>,
		);

		const input = screen.getByPlaceholderText("供应商/模型，或 @角色") as HTMLInputElement;
		expect(input.value).toBe("sub2api-gpt-pro/gpt-5.6-luna");

		const select = screen.getByDisplayValue("xhigh") as HTMLSelectElement;
		fireEvent.change(select, { target: { value: "medium" } });

		expect(input.value).toBe("sub2api-gpt-pro/gpt-5.6-luna");
		expect(select.value).toBe("medium");
	});

	it("preserves chosen thinking level when model selector is edited in the text input", () => {
		const chains = {
			"CTAI-luna+plus/gpt-5.6-luna": ["sub2api-gpt-pro/gpt-5.6-luna:xhigh"],
		};

		render(
			<FallbackChainEditor
				chainKey="CTAI-luna+plus/gpt-5.6-luna"
				chains={chains}
				models={MOCK_MODELS}
				roleIds={["default"]}
				onSaved={vi.fn()}
				onCollapse={vi.fn()}
				unsetTitle="未设置"
				emptyTitle="不回退"
			/>,
		);

		const input = screen.getByPlaceholderText("供应商/模型，或 @角色") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "zzz-pro/gpt-5.6-luna" } });

		expect(input.value).toBe("zzz-pro/gpt-5.6-luna");
		const select = screen.getByDisplayValue("xhigh") as HTMLSelectElement;
		expect(select.value).toBe("xhigh");
	});

	it("splits pasted entry with thinking suffix into selector and dropdown", () => {
		const chains = {
			"CTAI-luna+plus/gpt-5.6-luna": ["sub2api-gpt-pro/gpt-5.6-luna"],
		};

		render(
			<FallbackChainEditor
				chainKey="CTAI-luna+plus/gpt-5.6-luna"
				chains={chains}
				models={MOCK_MODELS}
				roleIds={["default"]}
				onSaved={vi.fn()}
				onCollapse={vi.fn()}
				unsetTitle="未设置"
				emptyTitle="不回退"
			/>,
		);

		const input = screen.getByPlaceholderText("供应商/模型，或 @角色") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "openai/gpt-5:high" } });

		expect(input.value).toBe("openai/gpt-5");
		const select = screen.getByDisplayValue("high") as HTMLSelectElement;
		expect(select.value).toBe("high");
	});
});
