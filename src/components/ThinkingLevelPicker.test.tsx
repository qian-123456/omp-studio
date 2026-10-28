// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThinkingLevelStrip } from "./ThinkingLevelPicker";

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
});
afterEach(cleanup);

const LEVELS = ["auto", "off", "low", "medium", "high", "xhigh", "max"];

const status = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const items = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
const slider = () => document.querySelector<HTMLElement>('[role="slider"]')!;

describe("ThinkingLevelStrip control", () => {
	it("shows the capitalized current level with no list until the status button is clicked", () => {
		const onSelect = vi.fn();
		render(<ThinkingLevelStrip levels={LEVELS} value="high" onSelect={onSelect} />);
		expect(status().textContent).toBe("High");
		expect(items()).toHaveLength(0);
		fireEvent.click(status());
		expect(items().map((b) => b.querySelector(".font-medium")?.textContent)).toEqual(LEVELS);
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("list pick commits the raw level once and closes only the list", () => {
		const onSelect = vi.fn();
		render(<ThinkingLevelStrip levels={LEVELS} value="high" onSelect={onSelect} />);
		fireEvent.click(status());
		fireEvent.click(items().find((b) => b.querySelector(".font-medium")?.textContent === "auto")!);
		expect(onSelect).toHaveBeenCalledExactlyOnceWith("auto");
		expect(items()).toHaveLength(0);
		expect(slider()).toBeTruthy();
	});

	it("picking the saved level only closes the list", () => {
		const onSelect = vi.fn();
		render(<ThinkingLevelStrip levels={LEVELS} value="high" onSelect={onSelect} />);
		fireEvent.click(status());
		fireEvent.click(items().find((b) => b.getAttribute("aria-checked") === "true")!);
		expect(onSelect).not.toHaveBeenCalled();
		expect(items()).toHaveLength(0);
	});

	it("slider keys commit the neighbouring concrete level; auto is not a stop", () => {
		const onSelect = vi.fn();
		render(<ThinkingLevelStrip levels={LEVELS} value="high" onSelect={onSelect} />);
		fireEvent.keyDown(slider(), { key: "ArrowRight" });
		expect(onSelect).toHaveBeenLastCalledWith("xhigh");
		fireEvent.keyDown(slider(), { key: "Home" });
		expect(onSelect).toHaveBeenLastCalledWith("off");
	});

	it("keeps an unknown saved level verbatim", () => {
		render(<ThinkingLevelStrip levels={["low", "weird"]} value="weird" onSelect={() => {}} />);
		expect(status().textContent).toBe("weird");
	});

	it("a single concrete stop is a disabled slider that never commits", () => {
		const onSelect = vi.fn();
		render(<ThinkingLevelStrip levels={["auto", "high"]} value="high" onSelect={onSelect} />);
		expect(slider().getAttribute("aria-disabled")).toBe("true");
		fireEvent.keyDown(slider(), { key: "ArrowLeft" });
		expect(onSelect).not.toHaveBeenCalled();
	});
});
