// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CalendarHeatmap } from "./CalendarHeatmap";
import { useSessions } from "../../stores/sessions";
import { useLanguageStore } from "../../stores/language";
import { activityUsage } from "../../lib/ipc";
import type { ActivityUsage } from "../../lib/contracts";

vi.mock("../../lib/ipc", () => ({ activityUsage: vi.fn() }));

const fetchUsage = vi.mocked(activityUsage);
const day = (date: string, tokens: number | null, sessions = 1, turns = 2, topModel: string | null = "model-with-a-long-name", missingRequests = tokens === null ? 1 : 0) =>
	({ date, tokens, missingRequests, sessions, turns, topModel });

async function flush() {
	await act(async () => { await Promise.resolve(); });
}

function hover(container: HTMLElement, date: string) {
	const cell = container.querySelector(`[data-date="${date}"]`);
	expect(cell).not.toBeNull();
	fireEvent.mouseEnter(cell!);
}

describe("CalendarHeatmap", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 10, 5, 12));
		fetchUsage.mockReset();
		useLanguageStore.getState().setLocale("zh-CN");
		useSessions.setState({ sessions: {} });
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("shows historic usage and actual turns with a token unit and full model on hover", async () => {
		fetchUsage.mockResolvedValue({ days: [day("2026-07-01", 12500, 2, 7)] });
		const { container } = render(<CalendarHeatmap />);
		expect(screen.getByText("初始化活动统计")).toBeTruthy();
		await flush();
		expect(screen.getByText(/12\.5k tokens · 2 次会话 · 7 轮交互/)).toBeTruthy();
		expect(container.querySelectorAll("rect")).toHaveLength(52 * 7);
		hover(container, "2026-07-01");
		expect(screen.getByText("12.5k tokens")).toBeTruthy();
		expect(screen.getByText("model-with-a-long-name")).toBeTruthy();
	});

	it("distinguishes unknown usage from explicit zero", async () => {
		fetchUsage.mockResolvedValueOnce({ days: [day("2026-07-01", null)] })
			.mockResolvedValueOnce({ days: [day("2026-07-01", null), day("2026-07-02", 0)] });
		const { container } = render(<CalendarHeatmap />);
		await flush();
		expect(screen.getByText(/未知 tokens/)).toBeTruthy();
		hover(container, "2026-07-01");
		expect(screen.getByText("未知")).toBeTruthy();
		fireEvent.mouseLeave(container.querySelector('[data-date="2026-07-01"]')!);
		act(() => useSessions.setState({ sessions: {} }));
		await flush();
		expect(screen.getByText(/≥0 tokens/)).toBeTruthy();
		hover(container, "2026-07-02");
		expect(screen.getByText("0 tokens")).toBeTruthy();
	});

	it("preserves known usage when other requests have missing accounting", async () => {
		fetchUsage.mockResolvedValue({ days: [day("2026-07-01", 12500, 1, 2, null, 1), day("2026-07-02", null)] });
		const { container } = render(<CalendarHeatmap />);
		await flush();
		expect(screen.getByText(/≥12\.5k tokens/)).toBeTruthy();
		hover(container, "2026-07-01");
		expect(screen.getByText("≥12.5k tokens")).toBeTruthy();
	});

	it("excludes future and out-of-range days from totals", async () => {
		fetchUsage.mockResolvedValue({ days: [day("2025-01-01", 80000, 8, 8), day("2026-11-06", 90000, 9, 9), day("2026-11-05", 100, 1, 3)] });
		render(<CalendarHeatmap />);
		await flush();
		expect(screen.getByText(/100 tokens · 1 次会话 · 3 轮交互/)).toBeTruthy();
	});

	it("grades daily intensity relative to the visible peak, including quarter boundaries", async () => {
		fetchUsage.mockResolvedValue({ days: [
			day("2025-01-01", 100_000_000_000),
			day("2026-11-06", 100_000_000_000),
			day("2026-07-01", 100_000_000),
			day("2026-07-02", 200_000_000),
			day("2026-07-03", 300_000_000),
			day("2026-07-04", 400_000_000),
			day("2026-07-05", 0),
		] });
		const { container } = render(<CalendarHeatmap />);
		await flush();
		for (const [date, level] of [
			["2026-07-01", 1], ["2026-07-02", 2],
			["2026-07-03", 3], ["2026-07-04", 4],
		] as const) {
			hover(container, date);
			expect(screen.getByText(`Level ${level} 活跃`)).toBeTruthy();
			fireEvent.mouseLeave(container.querySelector(`[data-date="${date}"]`)!);
		}
		const fills = ["01", "02", "03", "04"].map((date) =>
			container.querySelector(`[data-date="2026-07-${date}"]`)!.getAttribute("fill"));
		expect(new Set(fills).size).toBe(4);
		expect(container.querySelector('[data-date="2026-07-05"]')!.getAttribute("fill"))
			.toBe(container.querySelector('[data-date="2026-06-30"]')!.getAttribute("fill"));
	});

	it("refreshes when sessions change and periodically without remounting", async () => {
		fetchUsage.mockResolvedValueOnce({ days: [day("2026-07-01", 100)] })
			.mockResolvedValueOnce({ days: [day("2026-07-01", 200)] })
			.mockResolvedValueOnce({ days: [day("2026-07-01", 300)] });
		render(<CalendarHeatmap />);
		await flush();
		expect(screen.getByText(/100 tokens/)).toBeTruthy();
		act(() => useSessions.setState({ sessions: { ...useSessions.getState().sessions } }));
		await flush();
		expect(screen.getByText(/200 tokens/)).toBeTruthy();
		await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); });
		expect(screen.getByText(/300 tokens/)).toBeTruthy();
	});

	it("shows backend errors instead of a fake zero total", async () => {
		fetchUsage.mockRejectedValue(new Error("disk unavailable"));
		render(<CalendarHeatmap />);
		await flush();
		expect(screen.getByText(/活动加载失败：Error: disk unavailable/)).toBeTruthy();
		expect(screen.queryByText(/0 tokens/)).toBeNull();
	});

	it("surfaces a failed scan while a catalog refresh is queued, then recovers", async () => {
		// The project's ES2021 Promise API does not expose withResolvers.
		let rejectFirst!: (reason: unknown) => void;
		let resolveNext!: (value: ActivityUsage) => void;
		fetchUsage.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
			.mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
		render(<CalendarHeatmap />);
		act(() => useSessions.setState({ sessions: {} }));
		await act(async () => { rejectFirst(new Error("scan unavailable")); await Promise.resolve(); });
		expect(screen.getByRole("alert").textContent).toContain("scan unavailable");
		await act(async () => { resolveNext({ days: [day("2026-07-01", 42000)] }); await Promise.resolve(); });
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.getByText(/42\.0k tokens/)).toBeTruthy();
	});

	it("formats billion-token historical usage in English with units", async () => {
		useLanguageStore.getState().setLocale("en-US");
		fetchUsage.mockResolvedValue({ days: [day("2026-07-01", 20500000000)] });
		const { container } = render(<CalendarHeatmap />);
		expect(screen.getByText("Initializing activity")).toBeTruthy();
		await flush();
		expect(screen.getByText(/20\.5B tokens · 1 sessions · 2 turns/)).toBeTruthy();
		hover(container, "2026-07-01");
		expect(screen.getByText("20.5B tokens")).toBeTruthy();
	});
});
