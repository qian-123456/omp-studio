// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
	useModelCatalog.setState({ loading: false, status: "idle", error: null, refresh: async () => {} });
});
afterEach(cleanup);

describe("ModelMenuContent groups", () => {
	it("shows a failed no-cache read instead of an endless loading indicator", () => {
		useModelCatalog.setState({ status: "failed", error: "模型目录刷新失败：MODEL_CATALOG_EXIT_FAILED" });
		render(<ModelMenuContent models={null} onSelect={() => {}} />);
		expect(screen.getByRole("alert").textContent).toContain("MODEL_CATALOG_EXIT_FAILED");
		expect(screen.queryByText("加载模型列表中…")).toBeNull();
	});

	it("labels retained picker options as last-known and unconfirmed", () => {
		useModelCatalog.setState({ status: "stale", error: "缺少既有条目，已保留上次列表" });
		render(<ModelMenuContent models={MODELS} onSelect={() => {}} />);
		expect(screen.getByRole("status").textContent).toContain("已保留上次列表");
		expect(screen.getByRole("button", { name: /anthropic/ })).toBeTruthy();
	});
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

describe("ModelMenuContent complete readable catalog", () => {
	it("keeps every provider reachable and displays the full configured name and ID", () => {
		const models = Array.from({ length: 45 }, (_, i) => ({
			...model(`long-configured-provider-${i}`, `opaque-model-id-${i}`),
			name: `Complete configured model name ${i}`,
		}));
		const onSelect = vi.fn();
		const { container } = render(<ModelMenuContent models={models} onSelect={onSelect} />);
		expect(container.querySelectorAll("[data-model-group]")).toHaveLength(models.length);
		for (const entry of models) {
			const providerButton = screen.getByText(entry.provider, { exact: true }).closest("button");
			expect(providerButton).not.toBeNull();
			fireEvent.click(providerButton!);
			expect(screen.getByText(entry.name)).toBeTruthy();
			expect(screen.getByText(entry.id)).toBeTruthy();
		}
		fireEvent.click(screen.getByRole("button", { name: "Complete configured model name 44 opaque-model-id-44" }));
		expect(onSelect).toHaveBeenLastCalledWith("long-configured-provider-44/opaque-model-id-44");
	});

	it("searches full provider, display name and model ID without dropping entries", () => {
		const models = Array.from({ length: 45 }, (_, i) => ({
			...model("custom-provider", `opaque-model-${i}`),
			name: `Readable model name ${i}`,
		}));
		const onSelect = vi.fn();
		const { container } = render(<ModelMenuContent models={models} onSelect={onSelect} />);
		const search = screen.getByRole("textbox");
		fireEvent.change(search, { target: { value: "custom-provider" } });
		expect(container.querySelectorAll("[data-model-key]")).toHaveLength(models.length);
		fireEvent.change(search, { target: { value: "Readable model name 44" } });
		expect(screen.getByText("opaque-model-44")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Readable model name 44 opaque-model-44 custom-provider" }));
		expect(onSelect).toHaveBeenLastCalledWith("custom-provider/opaque-model-44");
		fireEvent.change(search, { target: { value: "opaque-model-0" } });
		expect(screen.getByText("Readable model name 0")).toBeTruthy();
	});
});

describe("ModelMenuContent selection persistence", () => {
    it("opens a favorite current model in its true provider group", () => {
        useModelSelectPrefs.setState({ recent: ["openai/gpt-5"] });
        const { container } = render(
            <ModelMenuContent models={MODELS} currentValue="openai/gpt-5" onSelect={() => {}} />,
        );
        const provider = container.querySelector('[data-model-group="p:openai"]');
        expect(provider?.className).toContain("bg-[var(--bg-active-fill)]");
        expect(container.querySelector('[data-model-key="openai/gpt-5"]')).toBeTruthy();
    });

    it("keeps a hand-selected provider when the catalog refreshes", () => {
        const { container, rerender } = render(
            <ModelMenuContent models={MODELS} currentValue="anthropic/claude-opus" onSelect={() => {}} />,
        );
        fireEvent.click(container.querySelector('[data-model-group="p:deepseek"]') as HTMLElement);
        rerender(
            <ModelMenuContent
                models={[...MODELS, model("zeta", "new-model")]}
                currentValue="anthropic/claude-opus"
                onSelect={() => {}}
            />,
        );
        expect(container.querySelector('[data-model-key="deepseek/deepseek-flash"]')).toBeTruthy();
    });
  });

it("keeps the search input and caption stable across catalog loading", () => {
    render(
        <ModelMenuContent models={MODELS} caption="模型" onSelect={() => {}} />,
    );
    const input = screen.getByPlaceholderText(/搜索模型/);
    fireEvent.change(input, { target: { value: "gpt" } });
    act(() => useModelCatalog.setState({ loading: true }));
    expect(screen.getByText("模型")).toBeTruthy();
    const spinner = screen.getByLabelText(/刷新模型/);
    expect(spinner.parentElement?.parentElement?.querySelector("input")).toBe(input);
    expect(screen.getByPlaceholderText(/搜索模型/)).toBe(input);
    expect((input as HTMLInputElement).value).toBe("gpt");
    act(() => useModelCatalog.setState({ loading: false }));
    expect(screen.getByPlaceholderText(/搜索模型/)).toBe(input);
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
