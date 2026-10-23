// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { SessionRow } from "./SessionRow";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));

const makeSession = (id: string): SessionMeta =>
	({
		id,
		title: `Test session ${id}`,
		status: "idle",
		unread: false,
		workspaceId: "ws1",
		workspacePath: "/ws1",
		updatedAt: new Date().toISOString(),
	}) as SessionMeta;

describe("SessionRow tree line styling (withSpine)", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders no tree spine element when withSpine is false", () => {
		const { container } = render(
			<SessionRow
				session={makeSession("s1")}
				workspaces={[]}
				onBatchAction={vi.fn()}
			/>,
		);
		expect(container.querySelector("[aria-hidden].-left-\\[8px\\]")).toBeNull();
	});

	it("renders a branch elbow (├─) for intermediate items", () => {
		const { container } = render(
			<SessionRow
				session={makeSession("s1")}
				withSpine
				spineFirst={false}
				spineLast={false}
				workspaces={[]}
				onBatchAction={vi.fn()}
			/>,
		);
		const spine = container.querySelector("[aria-hidden].-left-\\[8px\\]");
		expect(spine).not.toBeNull();
		// Non-last item has the horizontal branch line (border-t)
		expect(spine?.querySelector(".border-t")).not.toBeNull();
		// Non-last item does not have rounded bottom-left elbow
		expect(spine?.querySelector(".rounded-bl-\\[6px\\]")).toBeNull();
	});

	it("renders a curved corner elbow (└─) for the last item", () => {
		const { container } = render(
			<SessionRow
				session={makeSession("s2")}
				withSpine
				spineFirst={false}
				spineLast
				workspaces={[]}
				onBatchAction={vi.fn()}
			/>,
		);
		const spine = container.querySelector("[aria-hidden].-left-\\[8px\\]");
		expect(spine).not.toBeNull();
		// Last item has the rounded-bl-[6px] with border-b
		expect(spine?.querySelector(".rounded-bl-\\[6px\\]")).not.toBeNull();
		expect(spine?.querySelector(".border-b")).not.toBeNull();
		// Last item does not have separate border-t span
		expect(spine?.querySelector(".border-t")).toBeNull();
	});

	it("extends upward (-6px) when spineFirst is true", () => {
		const { container } = render(
			<SessionRow
				session={makeSession("s3")}
				withSpine
				spineFirst
				spineLast={false}
				workspaces={[]}
				onBatchAction={vi.fn()}
			/>,
		);
		const spine = container.querySelector<HTMLElement>("[aria-hidden].-left-\\[8px\\]");
		expect(spine?.style.top).toBe("-6px");
	});
});
