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

	it("keeps the form and footer constrained to the viewport", async () => {
		const root = createRoot(host);
		await act(async () => root.render(<ScheduleFormPage />));
		const scroller = host.querySelector(".overflow-y-auto")!;
		expect(scroller.className).toContain("min-w-0");
		expect(scroller.className).toContain("w-full");
		const footer = [...host.querySelectorAll("button")].find((b) => b.textContent === "保存")!.parentElement!;
		expect(footer.style.paddingBottom).toBe("max(12px, min(var(--m-safe-bottom), 34px))");
		await act(async () => root.unmount());
	});

	it("constrains date, time and interval inputs to the form width", async () => {
		const root = createRoot(host);
		await act(async () => root.render(<ScheduleFormPage />));
		const check = (selector: string) => {
			const input = host.querySelector<HTMLInputElement>(selector);
			expect(input).not.toBeNull();
			expect(input!.className).toContain("min-w-0");
			expect(input!.className).toContain("max-w-full");
			expect(input!.className).toContain("box-border");
			if (input!.type === "time" || input!.type === "datetime-local") {
				const frame = input!.closest("[data-date-input-frame]");
				expect(frame?.className).toContain("overflow-hidden");
				expect(frame?.className).toContain("rounded-[14px]");
				expect(input!.style.width).toBe("100%");
			}
		};
		check('input[type="time"]');
		check('input[type="datetime-local"]');
		const choose = async (label: string) => {
			const button = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === label)!;
			await act(async () => button.click());
		};
		await choose("仅一次");
		check('input[type="datetime-local"]');
		await choose("每月");
		check('input[type="time"]');
		await choose("间隔");
		check('input[type="number"]');
		await act(async () => root.unmount());
	});

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
