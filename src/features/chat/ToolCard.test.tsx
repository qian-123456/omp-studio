// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));

import { ToolCard, toolActivityLabel } from "./ToolCard";

afterEach(cleanup);

describe("wait tool", () => {
	it("reads as 等待 + its description, not a generic tool call", () => {
		expect(toolActivityLabel("wait", {}, "Wait for scout result", "running")).toEqual({
			verb: "正在等待",
			object: "Wait for scout result",
			objectIsCode: false,
		});
		expect(toolActivityLabel("wait", {}, null, "done").verb).toBe("已等待");
	});

	it("has no expandable args box for empty or wait args", () => {
		render(<ToolCard sessionId="s" name="wait" args={{}} intent="x" status="running" />);
		expect(screen.queryByRole("button")).toBeNull();
		cleanup();
		render(<ToolCard sessionId="s" name="wait" args={{ i: "x" }} intent="x" status="done" />);
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("an unrelated tool with empty args also shows no empty box", () => {
		render(<ToolCard sessionId="s" name="mystery" args={{}} status="done" />);
		expect(screen.queryByRole("button")).toBeNull();
	});
});
