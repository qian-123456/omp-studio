// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelOption } from "../lib/models";
import { useModelCatalog } from "../stores/modelCatalog";
import { ModelMenuContent, ModelSelect } from "./ModelSelect";
import { useModelSelectPrefs } from "./modelSelectPrefs";

const model = (provider: string, id: string): ModelOption => ({
	provider,
	id,
	name: id,
	thinking: [],
	contextWindow: null,
});
const MODELS = [
	model("anthropic", "claude-opus"),
	model("anthropic", "claude-sonnet"),
	model("openai", "gpt-5"),
	model("openai", "gpt-5-mini"),
	model("deepseek", "deepseek-flash"),
	model("deepseek", "deepseek-pro"),
];
const ROLE_EXTRAS = [
	{ value: "default", label: "主力模型" },
	{ value: "slow", label: "深度模型" },
];

beforeEach(() => {
	localStorage.clear();
	useModelSelectPrefs.setState({ recent: [], dismissedGuides: [] });
	useModelCatalog.setState({ loading: false, refresh: async () => {} });
});
afterEach(cleanup);

describe("ModelMenuContent groups", () => {
	it("lists role extras under their own 角色 tab, not under 常用", () => {
		const onSelect = vi.fn();
		render(
			<ModelMenuContent
				models={MODELS}
				onSelect={onSelect}
				extras={[{ value: "", label: "使用默认模型" }, ...ROLE_EXTRAS]}
				roles={{ default: "anthropic/claude-opus:high" }}
			/>,
		);
		// 常用 holds the plain extra only.
		expect(screen.getByText("使用默认模型")).toBeTruthy();
		expect(screen.queryByText(/主力模型/)).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /^角色/ }));
		fireEvent.click(screen.getByRole("button", { name: /主力模型/ }));
		expect(onSelect).toHaveBeenCalledWith("default");
	});

	it("has no 角色 tab when the caller passes no role extras", () => {
		render(<ModelMenuContent models={MODELS} onSelect={() => {}} />);
		expect(screen.queryByRole("button", { name: /^角色/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /常用/ })).toBeNull();
	});

	it("opens on the role tab when the current value is a role", () => {
		render(
			<ModelMenuContent
				models={MODELS}
				currentValue="slow"
				onSelect={() => {}}
				extras={ROLE_EXTRAS}
				roles={{ default: "anthropic/claude-opus", slow: "openai/gpt-5" }}
			/>,
		);
		expect(screen.getByRole("button", { name: /深度模型/ })).toBeTruthy();
	});
});

describe("ModelMenuContent keyboard", () => {
	it("moves the highlight with arrows and picks with Enter", () => {
		const onSelect = vi.fn();
		render(<ModelMenuContent models={MODELS} onSelect={onSelect} />);
		const box = screen.getByPlaceholderText(/搜索模型/);
		fireEvent.change(box, { target: { value: "gpt" } });
		fireEvent.keyDown(box, { key: "ArrowDown" });
		fireEvent.keyDown(box, { key: "Enter" });
		expect(onSelect).toHaveBeenCalledWith("openai/gpt-5-mini");
	});

	it("Enter in search picks the first hit without arrow keys", () => {
		const onSelect = vi.fn();
		render(<ModelMenuContent models={MODELS} onSelect={onSelect} />);
		const box = screen.getByPlaceholderText(/搜索模型/);
		fireEvent.change(box, { target: { value: "deepseek" } });
		fireEvent.keyDown(box, { key: "Enter" });
		expect(onSelect).toHaveBeenCalledWith("deepseek/deepseek-flash");
	});

	it("ArrowRight switches to the next group", () => {
		render(<ModelMenuContent models={MODELS} onSelect={() => {}} />);
		const box = screen.getByPlaceholderText(/搜索模型/);
		// First provider group is anthropic; step to openai.
		fireEvent.keyDown(box, { key: "ArrowRight" });
		expect(screen.getByRole("button", { name: "gpt-5-mini" })).toBeTruthy();
	});
});

describe("ModelMenuContent recent", () => {
	it("removes a recent entry immediately and restores it on undo", () => {
		useModelSelectPrefs.setState({ recent: ["openai/gpt-5", "anthropic/claude-opus"] });
		render(<ModelMenuContent models={MODELS} onSelect={() => {}} />);
		fireEvent.click(screen.getAllByRole("button", { name: "移出最近使用" })[0]);
		expect(useModelSelectPrefs.getState().recent).toEqual(["anthropic/claude-opus"]);

		fireEvent.click(screen.getByRole("button", { name: "撤销" }));
		expect(useModelSelectPrefs.getState().recent).toEqual(["openai/gpt-5", "anthropic/claude-opus"]);
	});
});

describe("ModelSelect thinking pill and level separation", () => {
	it("strips level suffix from the model button and displays level on thinking chip", () => {
		const onSelect = vi.fn();
		const models: ModelOption[] = [
			{
				provider: "tiancai-smart",
				id: "gpt-6.1-sol",
				name: "GPT 6.1 Sol",
				thinking: ["low", "high", "xhigh"],
				contextWindow: null,
			},
		];
		render(
			<ModelSelect
				models={models}
				label="tiancai-smart/gpt-6.1-sol:xhigh"
				currentValue="tiancai-smart/gpt-6.1-sol:xhigh"
				thinking
				onSelect={onSelect}
			/>,
		);
		expect(screen.getByRole("button", { name: "tiancai-smart/gpt-6.1-sol" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /:xhigh/ })).toBeNull();
		expect(screen.getByText("xhigh")).toBeTruthy();
	});
});
