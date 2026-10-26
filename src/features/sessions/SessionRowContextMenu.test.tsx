// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { SessionRow } from "./SessionRow";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};


const makeSession = (id: string, title?: string): SessionMeta =>
	({
		id,
		title: title ?? `Test session ${id}`,
		status: "idle",
		unread: false,
		workspaceId: "ws1",
		workspacePath: "/ws1",
		updatedAt: new Date().toISOString(),
	}) as unknown as SessionMeta;

describe("SessionRow right-click and context menu behavior", () => {
	beforeEach(() => {
		useSessions.setState({
			sessions: {
				s1: makeSession("s1", "Session 1"),
				s2: makeSession("s2", "Session 2"),
				s3: makeSession("s3", "Session 3"),
			},
			workspaces: [{ id: "ws1", name: "ws1", path: "/ws1", kind: "project", sort: 0, mode: "code" }],
		});
		useUi.setState({
			selectedSessionId: "s1",
			selectedIds: new Set(["s1"]),
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("right-clicking a session opens the menu without switching active session", () => {
		render(
			<SessionRow
				session={makeSession("s2", "Session 2")}
				workspaces={[]}
				onBatchAction={vi.fn()}
			/>,
		);

		expect(useUi.getState().selectedSessionId).toBe("s1");

		const row = screen.getByText("Session 2");
		fireEvent.contextMenu(row);

		// Context menu opens
		expect(screen.getByRole("menu")).toBeTruthy();
		// Active session was NOT switched to s2
		expect(useUi.getState().selectedSessionId).toBe("s1");
	});

	it("left-clicking a session switches the active session", () => {
		render(
			<SessionRow
				session={makeSession("s2", "Session 2")}
				workspaces={[]}
				onBatchAction={vi.fn()}
			/>,
		);

		expect(useUi.getState().selectedSessionId).toBe("s1");

		const row = screen.getByText("Session 2");
		fireEvent.click(row);

		// Active session switched to s2
		expect(useUi.getState().selectedSessionId).toBe("s2");
	});

	it("macOS Ctrl+click opens the menu without switching the active session", () => {
		const originalUserAgent = navigator.userAgent;
		Object.defineProperty(navigator, "userAgent", {
			value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
			configurable: true,
		});

		try {
			render(
				<SessionRow
					session={makeSession("s2", "Session 2")}
					workspaces={[]}
					onBatchAction={vi.fn()}
				/>,
			);

			expect(useUi.getState().selectedSessionId).toBe("s1");

			const row = screen.getByText("Session 2");
			// Ctrl+click in WebKit/macOS
			fireEvent.click(row, { ctrlKey: true, metaKey: false });

			expect(screen.getByRole("menu")).toBeTruthy();
			expect(useUi.getState().selectedSessionId).toBe("s1");
		} finally {
			Object.defineProperty(navigator, "userAgent", {
				value: originalUserAgent,
				configurable: true,
			});
		}
	});
	it("right-clicking an unselected session when multi-selection is active shows single session menu without switching session", () => {
		useUi.setState({
			selectedSessionId: "s1",
			selectedIds: new Set(["s1", "s2"]),
		});

		render(
			<SessionRow
				session={makeSession("s3", "Session 3")}
				workspaces={[]}
				onBatchAction={vi.fn()}
			/>,
		);

		const row = screen.getByText("Session 3");
		fireEvent.contextMenu(row);

		expect(screen.getByRole("menu")).toBeTruthy();
		// Active session remains s1
		expect(useUi.getState().selectedSessionId).toBe("s1");
		// Shows single session action, not batch action
		expect(screen.getByText("重命名")).toBeTruthy();
		expect(screen.queryByText(/批量/)).toBeNull();
	});

	it("right-clicking a selected session in multi-selection shows batch actions without switching session", () => {
		useUi.setState({
			selectedSessionId: "s1",
			selectedIds: new Set(["s1", "s2"]),
		});

		render(
			<SessionRow
				session={makeSession("s2", "Session 2")}
				workspaces={[]}
				onBatchAction={vi.fn()}
			/>,
		);

		const row = screen.getByText("Session 2");
		fireEvent.contextMenu(row);

		expect(screen.getByRole("menu")).toBeTruthy();
		expect(useUi.getState().selectedSessionId).toBe("s1");
		expect(screen.getByText("批量归档")).toBeTruthy();
	});
});
