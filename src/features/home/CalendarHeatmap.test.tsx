// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CalendarHeatmap } from "./CalendarHeatmap";
import { useSessions } from "../../stores/sessions";
import { useLanguageStore } from "../../stores/language";
import type { SessionMeta } from "../../lib/contracts";

describe("CalendarHeatmap component & i18n", () => {
	beforeEach(() => {
		useLanguageStore.getState().setLocale("zh-CN");
		useSessions.setState({
			sessions: {
				s1: {
					id: "s1",
					tool: "omp",
					file: "/tmp/s1.jsonl",
					cwd: "/test",
					title: "测试任务标题",
					label: "#1",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					parentId: null,
					forkDepth: 0,
					status: "idle",
					unread: false,
					pending: null,
					live: false,
					externalPid: null,
					pinned: false,
					archived: false,
					workspaceId: null,
					repoRoot: null,
					git: { branch: "main", dirty: 3, worktree: null },
					result: null,
					lastAssistant: "done",
					model: "claude-3-5-sonnet",
					attention: null,
					mode: "code",
					groupId: null,
					createdByApp: true,
				} as SessionMeta,
			},
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("renders Chinese activity metadata and month axis", () => {
		useLanguageStore.getState().setLocale("zh-CN");
		const { container } = render(<CalendarHeatmap />);
		expect(screen.getByText("活动")).toBeTruthy();
		expect(screen.getByText(/tokens/i)).toBeTruthy();
		expect(screen.getByText(/次会话/i)).toBeTruthy();
		expect(screen.getByText(/过去 52 周/i)).toBeTruthy();

		const svg = container.querySelector("svg");
		expect(svg).toBeTruthy();
		const rects = container.querySelectorAll("rect");
		expect(rects.length).toBe(52 * 7);
	});

	it("renders English activity metadata and month axis when locale is en-US", () => {
		useLanguageStore.getState().setLocale("en-US");
		render(<CalendarHeatmap />);
		expect(screen.getByText("Activity")).toBeTruthy();
		expect(screen.getByText(/sessions/i)).toBeTruthy();
		expect(screen.getByText(/last 52 weeks/i)).toBeTruthy();
	});

	it("displays rich popover on mouseEnter with formatted details", () => {
		useLanguageStore.getState().setLocale("zh-CN");
		const { container } = render(<CalendarHeatmap />);
		const anyRect = container.querySelector("rect");
		expect(anyRect).toBeTruthy();

		if (anyRect) {
			fireEvent.mouseEnter(anyRect);
			expect(screen.getByText(/2026年|无模型调用|会话数量/i)).toBeTruthy();
		}
	});
});
