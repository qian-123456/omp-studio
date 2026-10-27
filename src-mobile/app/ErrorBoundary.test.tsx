// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(() => {
	cleanup();
});

function BuggyComponent({ shouldThrow }: { shouldThrow: boolean }) {
	if (shouldThrow) {
		throw new Error("Failed to fetch dynamically imported module: /chunks/quota.js");
	}
	return <div>页面正常渲染</div>;
}

describe("ErrorBoundary", () => {
	it("catches lazy chunk loading failures and allows retry", () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		let shouldThrow = true;
		const { rerender } = render(
			<ErrorBoundary>
				<BuggyComponent shouldThrow={shouldThrow} />
			</ErrorBoundary>,
		);

		// Error boundary displays failure message and hint
		expect(screen.getByText("页面加载失败")).not.toBeNull();
		expect(screen.getByText(/Failed to fetch dynamically imported module/)).not.toBeNull();

		// Retry button is available
		const retryBtn = screen.getByRole("button", { name: "重试" });
		expect(retryBtn).not.toBeNull();

		// Simulate chunk fetch succeeds on retry
		shouldThrow = false;
		rerender(
			<ErrorBoundary>
				<BuggyComponent shouldThrow={shouldThrow} />
			</ErrorBoundary>,
		);
		fireEvent.click(retryBtn);

		expect(screen.getByText("页面正常渲染")).not.toBeNull();
		expect(screen.queryByText("页面加载失败")).toBeNull();

		consoleSpy.mockRestore();
	});
});
