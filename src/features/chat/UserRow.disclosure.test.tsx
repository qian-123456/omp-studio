// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));
vi.mock("./imageTokens", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	getImageTokenPalette: () => ({ hex: "#888" }),
}));
vi.mock("../../lib/ipc", () => ({
	validatePath: vi.fn(),
	rpcSend: vi.fn(async () => ({})),
	privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "ok", nativeError: null })),
}));
vi.mock("../../lib/events", () => ({
	onPrivacyChanged: vi.fn(async () => () => {}),
}));
vi.mock("../privacy/SecretChip", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	PrivacyText: ({ text }: { text: string }) => <>{text}</>,
}));
vi.mock("../../lib/toast", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { UserRow } from "./MessageList";

let heights = { scroll: 40, client: 40 };

beforeEach(() => {
	heights = { scroll: 40, client: 40 };
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
		configurable: true,
		get: () => heights.scroll,
	});
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => heights.client,
	});
	const originalGetComputedStyle = window.getComputedStyle.bind(window);
	vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
		const style = originalGetComputedStyle(el, pseudo);
		return new Proxy(style, {
			get(target, prop) {
				if (prop === "lineHeight") return "20px";
				if (prop === "fontSize") return "14px";
				const val = Reflect.get(target, prop);
				return typeof val === "function" ? val.bind(target) : val;
			},
		});
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const userItem = (text: string): TranscriptItem => ({
	id: "u1",
	parentId: null,
	ts: "2026-10-27T12:00:00.000Z",
	kind: "user",
	text,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
});

describe("UserRow long message inline disclosure", () => {
	it("renders user message without disclosure control when text fits in 4 lines", () => {
		heights = { scroll: 60, client: 60 };
		render(<UserRow sessionId="s1" item={userItem("Short question")} />);

		expect(screen.getByText("Short question")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /查看更多|view more/i })).toBeNull();
	});

	it("renders ChatGPT-like inline disclosure (not a heavy capsule) and toggles expansion", () => {
		// 160px scrollHeight > 20px * (4 + 0.5) = 90px -> triggers overflow
		heights = { scroll: 160, client: 80 };
		const longText = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6";
		const { container } = render(<UserRow sessionId="s1" item={userItem(longText)} />);

		// Clamped initially
		const textEl = container.querySelector(".line-clamp-4");
		expect(textEl).toBeTruthy();
		expect(textEl?.textContent).toContain("Line 1");

		// Control is rendered
		const toggleBtn = screen.getByRole("button", { name: /查看更多|view more/i });
		expect(toggleBtn).toBeTruthy();
		expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");

		// Must NOT have the awkward capsule classes: rounded-full border border-[var(--line)] px-2.5 py-0.5
		expect(toggleBtn.className).not.toContain("rounded-full");
		expect(toggleBtn.className).not.toContain("border");
		expect(toggleBtn.className).not.toContain("px-2.5");

		// Must have integrated inline disclosure styling
		expect(toggleBtn.className).toContain("inline-flex");
		expect(toggleBtn.className).toContain("items-center");

		// Click to expand
		act(() => {
			fireEvent.click(toggleBtn);
		});

		// Now expanded
		expect(container.querySelector(".line-clamp-4")).toBeNull();
		const collapseBtn = screen.getByRole("button", { name: /收起|collapse/i });
		expect(collapseBtn).toBeTruthy();
		expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");

		// Click to collapse again
		act(() => {
			fireEvent.click(collapseBtn);
		});

		// Collapsed again
		expect(container.querySelector(".line-clamp-4")).toBeTruthy();
		expect(screen.getByRole("button", { name: /查看更多|view more/i })).toBeTruthy();
	});
});
