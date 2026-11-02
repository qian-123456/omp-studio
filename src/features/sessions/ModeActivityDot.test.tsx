// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../stores/language", () => ({
	useT: () => ({ t: (key: string, args?: Record<string, unknown>) => `${key}:${args?.count ?? ""}` }),
}));

import { ModeActivityDot } from "./ModeActivityDot";

describe("ModeActivityDot", () => {
	it("shows a spinner and keeps the attention count while running", () => {
		const { container, getByTitle } = render(<ModeActivityDot activity={{ running: 2, badge: 3 }} />);
		expect(container.querySelector("svg.animate-spin")).toBeTruthy();
		expect(container.textContent).toContain("3");
		expect(getByTitle("sessions.sessionsNeedAttention:3")).toBeTruthy();
	});

	it("shows the running spinner for the top-bar dot variant", () => {
		const { container } = render(<ModeActivityDot activity={{ running: 1, badge: 4 }} variant="dot" />);
		expect(container.querySelector("svg.animate-spin")).toBeTruthy();
		expect(container.textContent).toBe("");
	});
});
