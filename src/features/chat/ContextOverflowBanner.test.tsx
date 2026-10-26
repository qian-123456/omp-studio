// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelOption } from "../../lib/models";
import { ContextOverflowBanner } from "./ContextOverflowBanner";

describe("ContextOverflowBanner", () => {
	afterEach(cleanup);

	const models: ModelOption[] = [
		{ id: "small", provider: "test", name: "Small Model", contextWindow: 32_000 },
		{ id: "large", provider: "test", name: "Large Model", contextWindow: 200_000 },
	];

	it("renders overflow tokens and trigger action", () => {
		render(
			<ContextOverflowBanner
				sessionId="s1"
				currentTokens={150_000}
				contextWindow={32_000}
				currentModelKey="test/small"
				models={models}
				compacting={false}
				onCompactWithModel={vi.fn()}
				onCompactCurrent={vi.fn()}
			/>,
		);

		// Current tokens (150k) and window (32k) should be displayed
		expect(screen.getByText(/150k/)).toBeTruthy();
		expect(screen.getByText(/32k/)).toBeTruthy();
		// Action to switch to large model
		expect(screen.getByText(/Large Model/)).toBeTruthy();
		expect(screen.getByText("仍然压缩（当前模型）")).toBeTruthy();
	});

	it("triggers onCompactWithModel with candidate and switchBack option", async () => {
		const onCompactWithModel = vi.fn().mockResolvedValue(undefined);
		render(
			<ContextOverflowBanner
				sessionId="s1"
				currentTokens={150_000}
				contextWindow={32_000}
				currentModelKey="test/small"
				models={models}
				compacting={false}
				onCompactWithModel={onCompactWithModel}
				onCompactCurrent={vi.fn()}
			/>,
		);

		// Default checkbox is checked
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		expect(checkbox.checked).toBe(true);

		// Click the primary switch & compact button
		const compactBtn = screen.getByRole("button", { name: /切换到 Large Model 压缩/ });
		fireEvent.click(compactBtn);

		expect(onCompactWithModel).toHaveBeenCalledWith(
			expect.objectContaining({ id: "large" }),
			true,
		);
	});

	it("triggers onCompactCurrent when compacting with current model", () => {
		const onCompactCurrent = vi.fn().mockResolvedValue(undefined);
		render(
			<ContextOverflowBanner
				sessionId="s1"
				currentTokens={150_000}
				contextWindow={32_000}
				currentModelKey="test/small"
				models={models}
				compacting={false}
				onCompactWithModel={vi.fn()}
				onCompactCurrent={onCompactCurrent}
			/>,
		);

		const currentBtn = screen.getByRole("button", { name: "仍然压缩（当前模型）" });
		fireEvent.click(currentBtn);
		expect(onCompactCurrent).toHaveBeenCalledTimes(1);
	});
});
