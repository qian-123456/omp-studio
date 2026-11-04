// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerToolbar } from "./ComposerToolbar";

afterEach(() => {
	cleanup();
});

describe("ComposerToolbar", () => {
	it("renders model name, thinking level, and context usage in liquid glass buttons", () => {
		const onModel = vi.fn();
		const onThinking = vi.fn();
		const onContext = vi.fn();

		render(
			<ComposerToolbar
				model="openai/gpt-5-turbo"
				thinking="high"
				onModel={onModel}
				onThinking={onThinking}
				contextText="15%"
				onContext={onContext}
			/>,
		);

		const modelBtn = screen.getByRole("button", { name: /当前模型/ });
		expect(modelBtn.textContent).toContain("gpt-5-turbo");
		fireEvent.click(modelBtn);
		expect(onModel).toHaveBeenCalledTimes(1);

		const thinkingBtn = screen.getByRole("button", { name: /当前思考强度/ });
		expect(thinkingBtn.textContent).toContain("高");
		fireEvent.click(thinkingBtn);
		expect(onThinking).toHaveBeenCalledTimes(1);

		const contextBtn = screen.getByRole("button", { name: /上下文用量/ });
		expect(contextBtn.textContent).toContain("上下文 15%");
		fireEvent.click(contextBtn);
		expect(onContext).toHaveBeenCalledTimes(1);
	});

	it("hides completely when hidden is true (screen keyboard open)", () => {
		render(
			<ComposerToolbar
				model="gemini-flash"
				thinking="auto"
				contextText="5%"
				hidden={true}
			/>,
		);

		expect(screen.queryByRole("button", { name: /当前模型/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /当前思考强度/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /上下文用量/ })).toBeNull();
	});
});
