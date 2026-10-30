// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { SessionList } from "./SessionSidebar";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));

const make = (i: number): SessionMeta =>
	({
		id: `s${i}`,
		title: `Row ${i}`,
		status: "idle",
		unread: false,
		pending: null,
		workspaceId: "ws1",
		updatedAt: "2026-01-01T00:00:00.000Z",
	}) as unknown as SessionMeta;

function Harness({ count }: { count: number }) {
	const [expanded, setExpanded] = useState<Record<string, number>>({});
	return (
		<SessionList
			sessions={Array.from({ length: count }, (_, i) => make(i))}
			scopeKey="__global_today"
			expanded={expanded}
			onSetCount={(k, n) => setExpanded((p) => ({ ...p, [k]: n }))}
			workspaces={[]}
			onBatchAction={vi.fn()}
			large
		/>
	);
}

describe("SessionList default pagination (universal groups / time buckets)", () => {
	beforeEach(() => {
		// jsdom lacks ResizeObserver, which FloatingLayer (via SessionRow) uses.
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("shows only the default recent limit and offers expand", () => {
		const { container, queryByText } = render(<Harness count={12} />);
		expect(queryByText("Row 2")).not.toBeNull();
		expect(queryByText("Row 3")).toBeNull();
		expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
	});
	it("expand reveals more rows and then offers collapse", () => {
		const { container, queryByText } = render(<Harness count={12} />);
		const buttons = () => Array.from(container.querySelectorAll("button"));
		// Footer buttons render after all rows; with nothing expanded the last one is "expand".
		const all = buttons();
		const expand = all[all.length - 1];
		expect(expand).toBeTruthy();
		fireEvent.click(expand as HTMLElement);
		expect(queryByText("Row 7")).not.toBeNull();
		expect(queryByText("Row 8")).toBeNull();
		const collapse = buttons().find((b) => b.querySelector("svg.rotate-180"));
		expect(collapse).toBeTruthy();
		fireEvent.click(collapse as HTMLElement);
		expect(queryByText("Row 3")).toBeNull();
	});
});
