// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));

import { ThinkingPreview, livePreviewText } from "./ThinkingPreview";

afterEach(cleanup);

const LONG = "第一行\n第二行\n第三行\n第四行\n第五行";

describe("livePreviewText", () => {
	it("keeps the newest non-empty lines in order", () => {
		expect(livePreviewText(LONG)).toBe("第四行\n第五行");
	});
	it("drops blank lines and normalizes CRLF", () => {
		expect(livePreviewText("一\r\n\n二\n\n三\n")).toBe("二\n三");
	});
	it("falls back to the newest characters of a single long line", () => {
		const para = "思".repeat(500);
		expect(livePreviewText(para, 10)).toBe("…" + "思".repeat(10));
	});
	it("is empty for whitespace-only text", () => {
		expect(livePreviewText("\n \n")).toBe("");
	});
});

describe("ThinkingPreview", () => {
	it("collapsed: shows the head and toggles open", () => {
		let toggles = 0;
		render(
			<ThinkingPreview
				thinking={LONG}
				running={false}
				open={false}
				onToggle={() => {
					toggles += 1;
				}}
			/>,
		);
		const btn = screen.getByRole("button");
		expect(btn.getAttribute("aria-expanded")).toBe("false");
		expect(btn.textContent).toContain("第一行");
		fireEvent.click(btn);
		expect(toggles).toBe(1);
	});

	it("expanded: shows the full text and no toggle button", () => {
		const { container } = render(
			<ThinkingPreview
				thinking={LONG}
				running={false}
				open
				onToggle={() => {}}
			/>,
		);
		expect(screen.queryByRole("button")).toBeNull();
		expect(container.textContent).toContain("第一行");
		expect(container.textContent).toContain("第五行");
	});

	it("running: previews the newest words instead of the head", () => {
		render(<ThinkingPreview thinking={LONG} running open={false} onToggle={() => {}} />);
		expect(screen.getByRole("button").textContent).toBe("第四行\n第五行");
	});
});
