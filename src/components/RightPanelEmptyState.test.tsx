// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSideChatView } from "../features/sidechat/viewStore";
import { useUi } from "../stores/ui";
import { RightPanelEmptyState } from "./RightPanelEmptyState";

const badges = {} as Record<never, number>;

describe("RightPanelEmptyState 辅助对话", () => {
	afterEach(cleanup);
	beforeEach(() => {
		localStorage.clear();
		useUi.setState({ rightOpen: true, rightTab: null, openRightTabs: [], selectedSessionId: null });
		useSideChatView.setState({ openTabs: {}, openChild: {} });
	});

	it("opens a blank side-chat tab for the selected session and activates the group", () => {
		useUi.setState({ selectedSessionId: "s1" });
		render(<RightPanelEmptyState tabBadges={badges as never} />);
		fireEvent.click(screen.getByRole("button", { name: /辅助对话/ }));
		expect(useUi.getState().rightTab).toBe("sidechat");
		expect(useSideChatView.getState().openTabs.s1).toHaveLength(1);
	});

	it("is disabled with a reason when no session is selected", () => {
		render(<RightPanelEmptyState tabBadges={badges as never} />);
		const btn = screen.getByRole("button", { name: /辅助对话/ }) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(btn.title).toContain("请先选择");
	});
});
