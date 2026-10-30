// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLAN_OFF, type ApprovedPlan } from "../features/chat/plan/planStatus";
import { emptySessionLive, useLive } from "../stores/live";
import { useSideChatView } from "../features/sidechat/viewStore";
import { type RightTab, useUi } from "../stores/ui";
import { RightPanelEmptyState } from "./RightPanelEmptyState";

const badges: Record<RightTab, number> = {
	explorer: 0, sidechat: 0, heatmap: 0, git: 0, services: 0, terminal: 0, plan: 0, files: 0,
};

describe("RightPanelEmptyState 辅助对话", () => {
	afterEach(cleanup);
	beforeEach(() => {
		localStorage.clear();
		useUi.setState({ rightOpen: true, rightTab: null, openRightTabs: [], selectedSessionId: null });
		useSideChatView.setState({ openTabs: {}, openChild: {} });
	});

	it("opens a blank side-chat tab for the selected session and activates the group", () => {
		useUi.setState({ selectedSessionId: "s1" });
		render(<RightPanelEmptyState tabBadges={badges} />);
		fireEvent.click(screen.getByRole("button", { name: /辅助对话/ }));
		expect(useUi.getState().rightTab).toBe("sidechat");
		expect(useSideChatView.getState().openTabs.s1).toHaveLength(1);
	});

	it("is disabled with a reason when no session is selected", () => {
		render(<RightPanelEmptyState tabBadges={badges} />);
		const btn = screen.getByRole("button", { name: /辅助对话/ }) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(btn.title).toContain("请先选择");
	});
});

describe("RightPanelEmptyState 计划入口", () => {
	afterEach(cleanup);
	const approved: ApprovedPlan = {
		planFile: null, planUrl: null, title: "t", content: "# c", prevContent: null, version: 1, status: "failed", error: "error",
	};
	beforeEach(() => {
		useUi.setState({ rightOpen: true, rightTab: null, openRightTabs: [], selectedSessionId: "a" });
		useLive.setState({ sessions: {} });
	});

	it("opens 计划 with no live status loaded yet, without touching plan state", () => {
		render(<RightPanelEmptyState tabBadges={badges} />);
		fireEvent.click(screen.getByRole("button", { name: /计划/ }));
		expect(useUi.getState().rightTab).toBe("plan");
		expect(useLive.getState().sessions).toEqual({});
	});

	it("opens 计划 for an approved enabled=false session without enabling plan mode", () => {
		useLive.setState({ sessions: { a: { ...emptySessionLive(), plan: { ...PLAN_OFF, approved } } } });
		render(<RightPanelEmptyState tabBadges={badges} />);
		fireEvent.click(screen.getByRole("button", { name: /计划/ }));
		expect(useUi.getState().rightTab).toBe("plan");
		expect(useLive.getState().sessions.a.plan?.enabled).toBe(false);
	});
});
