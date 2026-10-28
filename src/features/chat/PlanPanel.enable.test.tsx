// @vitest-environment jsdom
/** The plan panel's enable button sends the explicit silent `/plan-action enable`. */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import { emptySessionLive, useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import { PlanPanel } from "./PlanPanel";

const h = vi.hoisted(() => ({ rpcSend: vi.fn(async (_id: string, _cmd: unknown) => ({})) }));
vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof IpcModule>()),
	rpcSend: h.rpcSend,
}));

const SID = "plan-enable-1";

describe("PlanPanel enable", () => {
	afterEach(() => {
		cleanup();
		act(() => useLive.setState({ sessions: {} }));
	});

	it("sends /plan-action enable, not /plan", async () => {
		act(() => {
			useUi.setState({ selectedSessionId: SID });
			useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, plan: { enabled: false, version: 0 } } } as never });
		});
		render(<PlanPanel />);
		h.rpcSend.mockClear();
		fireEvent.click(screen.getByText("开启规划模式"));
		await act(async () => {});
		expect(h.rpcSend.mock.calls).toEqual([[SID, { type: "prompt", message: "/plan-action enable" }]]);
	});
});
