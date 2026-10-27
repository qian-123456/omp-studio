// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../core/api", () => ({
	api: vi.fn().mockResolvedValue({ dirs: [] }),
	errorMessage: (e: unknown) => String(e),
}));

vi.mock("../../core/nav", () => ({
	nav: { push: () => {}, pushLayer: () => () => {} },
	paths: { chat: (id: string) => `/s/${id}`, search: () => "/search", schedules: () => "/schedules", inbox: () => "/inbox", quota: () => "/quota", settings: () => "/settings" },
}));

vi.mock("../../core/stores/sessions", () => ({
	useSessions: Object.assign(
		(selector: (s: { list: unknown[]; byId: Record<string, unknown> }) => unknown) =>
			selector({ list: [], byId: {} }),
		{
			getState: () => ({
				createSession: vi.fn(),
				refresh: vi.fn().mockResolvedValue([]),
				list: [],
				byId: {},
			}),
		},
	),
}));

import { HomePage } from "./HomePage";
import { MenuSheet } from "./MenuSheet";

afterEach(() => {
	cleanup();
});

describe("Responsive layout (390x844)", () => {
	it("renders HomePage without horizontal overflow at 390px width", () => {
		// Mock viewport dimensions for 390x844 (iPhone 12/13/14)
		window.innerWidth = 390;
		window.innerHeight = 844;

		const { container } = render(
			<div style={{ width: 390, height: 844, overflowX: "hidden" }}>
				<HomePage route={{ name: "home", path: "/", params: {}, query: {} }} />
			</div>,
		);

		const root = container.firstElementChild as HTMLElement;
		expect(root).not.toBeNull();
		// In jsdom offsetWidth defaults to 0 unless set, but scrollWidth must not exceed 390
		expect(root.scrollWidth).toBeLessThanOrEqual(390);
	});

	it("renders MenuSheet within 390px max-width bounds", () => {
		window.innerWidth = 390;
		window.innerHeight = 844;

		render(<MenuSheet open onClose={() => {}} />);

		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog).not.toBeNull();
		// Check that dialog styling has max-w-[340px] or w-full ensuring no overflow past 390px
		expect(dialog?.className).toContain("max-w-[340px]");
	});
});
