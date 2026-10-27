// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
vi.mock("../../core/api", async (orig) => {
	const real = await orig<typeof import("../../core/api")>();
	return {
		...real,
		api: vi.fn(async (method: string, path: string, body?: unknown) => {
			calls.push({ method, path, body });
			if (path === "/left/dirs") return { dirs: [{ path: "/w", label: "w" }] };
			return {};
		}),
	};
});

import { ScheduleFormPage } from "./ScheduleFormPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ScheduleFormPage", () => {
	let host: HTMLDivElement;
	beforeEach(() => {
		calls.length = 0;
		host = document.createElement("div");
		document.body.appendChild(host);
	});
	afterEach(() => host.remove());

	it("shows full inline validation errors and does not submit an invalid form", async () => {
		const root = createRoot(host);
		await act(async () => root.render(<ScheduleFormPage />));
		const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "保存") as HTMLButtonElement;
		await act(async () => save.click());
		const alerts = [...host.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
		expect(alerts).toContain("请填写任务名称");
		expect(alerts.some((t) => t?.includes("请填写提示词"))).toBe(true);
		expect(calls.some((c) => c.method === "POST")).toBe(false);
		await act(async () => root.unmount());
	});
});
