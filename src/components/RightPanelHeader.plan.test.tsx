// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_OFF, type ApprovedPlan } from "../features/chat/plan/planStatus";
import { emptySessionLive, useLive } from "../stores/live";
import { type RightTab, useUi } from "../stores/ui";
import { RightPanelHeader } from "./RightPanelHeader";

const badges: Record<RightTab, number> = {
	explorer: 0, sidechat: 0, heatmap: 0, git: 0, services: 0, terminal: 0, plan: 0, files: 0,
};
const approved: ApprovedPlan = {
	planFile: null, planUrl: null, title: "t", content: "# c", prevContent: null, version: 1, status: "failed", error: "error",
};
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "打开新标签页" }));

describe("RightPanelHeader 计划入口", () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});
	beforeEach(() => {
		// jsdom lacks ResizeObserver, which the tab strip measures with.
		vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
		localStorage.clear();
		useUi.setState({ rightOpen: true, rightTab: "git", openRightTabs: ["git"], selectedSessionId: "a" });
		useLive.setState({ sessions: {} });
	});

	it("opens 计划 from the + menu before any live status is loaded", () => {
		render(<RightPanelHeader activeTab="git" tabBadges={badges} />);
		openMenu();
		fireEvent.click(screen.getByRole("button", { name: /计划/ }));
		expect(useUi.getState().rightTab).toBe("plan");
		expect(useLive.getState().sessions).toEqual({});
	});

	it("opens 计划 for approved enabled=false state without enabling plan mode", () => {
		useLive.setState({ sessions: { a: { ...emptySessionLive(), plan: { ...PLAN_OFF, approved } } } });
		render(<RightPanelHeader activeTab="git" tabBadges={badges} />);
		openMenu();
		fireEvent.click(screen.getByRole("button", { name: /计划/ }));
		expect(useUi.getState().rightTab).toBe("plan");
		expect(useLive.getState().sessions.a.plan?.enabled).toBe(false);
	});
});
