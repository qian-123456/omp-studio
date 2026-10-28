// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => mem.get(k) ?? null,
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
	key: () => null,
	get length() {
		return mem.size;
	},
} as Storage;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sendPrompt = vi.fn(async () => {});
vi.mock("./send", () => ({ sendPrompt: (...a: unknown[]) => sendPrompt(...(a as [])) }));
vi.mock("../settings/store", () => {
	const state = { settings: undefined as { queueAutoSend?: boolean } | undefined };
	return { useSettings: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state }) };
});

import { useLive } from "../../stores/live";
import { heldQueueItems, isHeldAutoSendPaused, pauseHeldAutoSend, resumeHeldAutoSend, useHeldItems, useHeldQueue } from "./heldQueue";
import { drainNext, useQueueAutoSend } from "./QueuedBar";

const SID = "s1";
const persisted = JSON.stringify([{ id: "h1", text: "排队一" }]);

function setSession(patch: {
	streaming?: boolean;
	alive?: boolean;
	flowNotices?: unknown[];
	state?: unknown;
}) {
	useLive.setState((s) => ({
		sessions: {
			...s.sessions,
			[SID]: { flowNotices: [], state: null, ...(s.sessions[SID] as object), ...patch } as never,
		},
	}));
}

beforeEach(() => {
	resumeHeldAutoSend(SID);
	mem.clear();
	sendPrompt.mockClear();
	useHeldQueue.setState({ queues: {}, dismissed: {} });
	useLive.setState({ sessions: {} });
});

describe("held queue hydration", () => {
	it("hydrates persisted items into the store for reactive readers", async () => {
		mem.set(`ompws-held:${SID}`, persisted);
		let seen: string[] = [];
		const C = () => {
			seen = useHeldItems(SID).map((i) => i.text);
			return null;
		};
		const root = createRoot(document.createElement("div"));
		await act(async () => root.render(createElement(C)));
		expect(seen).toEqual(["排队一"]);
		expect(useHeldQueue.getState().queues[SID]).toHaveLength(1);
		act(() => root.unmount());
	});
});

describe("held queue drain", () => {
	it("keeps stopped held items on remount and resume transitions", async () => {
		mem.set(`ompws-held:${SID}`, persisted);
		pauseHeldAutoSend(SID);
		setSession({ streaming: false, alive: true });
		const C = () => { useQueueAutoSend(SID, false); return null; };
		const root = createRoot(document.createElement("div"));
		await act(async () => root.render(createElement(C)));
		setSession({ alive: false });
		setSession({ alive: true });
		setSession({ state: { isCompacting: true } });
		setSession({ state: { isCompacting: false } });
		expect(sendPrompt).not.toHaveBeenCalled();
		expect(heldQueueItems(SID)).toHaveLength(1);
		act(() => root.unmount());
	});

	it("restores the paused latch from storage and clears it when a session is pruned", () => {
		mem.set(`ompws-held:${SID}:paused`, "1");
		expect(isHeldAutoSendPaused(SID)).toBe(true);
		useHeldQueue.getState().pruneSessions([SID]);
		expect(isHeldAutoSendPaused(SID)).toBe(false);
		expect(mem.has(`ompws-held:${SID}:paused`)).toBe(false);
	});
	it("drains for an unmounted session when its turn ends", async () => {
		mem.set(`ompws-held:${SID}`, persisted);
		setSession({ streaming: true, alive: true });
		setSession({ streaming: false });
		await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
		expect(heldQueueItems(SID)).toHaveLength(0);
	});
	it("sends every ready held item together when a turn ends", async () => {
		setSession({ streaming: true, alive: true });
		useHeldQueue.getState().push(SID, "[Image #1: /a.png] first", [
			{ id: "a", path: "/a.png", marker: "[Image #1]" },
		]);
		useHeldQueue.getState().push(SID, "[Image #1: /b.png] second", [
			{ id: "b", path: "/b.png", marker: "[Image #1]" },
		]);

		setSession({ streaming: false });

		await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
		expect(sendPrompt).toHaveBeenCalledWith(
			SID,
			"[Image #1: /a.png] first\n\n---\n\n[Image #2: /b.png] second",
			{
				images: [
					{ id: "a", path: "/a.png", marker: "[Image #1]" },
					{ id: "b", path: "/b.png", marker: "[Image #2]" },
				],
			},
		);
		expect(heldQueueItems(SID)).toEqual([]);
	});

	it("drains on mount when the session is idle with items", async () => {
		mem.set(`ompws-held:${SID}`, persisted);
		setSession({ streaming: false, alive: true });
		const C = () => {
			useQueueAutoSend(SID, false);
			return null;
		};
		const root = createRoot(document.createElement("div"));
		await act(async () => root.render(createElement(C)));
		await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
		act(() => root.unmount());
	});

	it("does not drain while compacting, then drains when it clears", async () => {
		mem.set(`ompws-held:${SID}`, persisted);
		setSession({ streaming: false, alive: true, state: { isCompacting: true } });
		expect(await drainNext(SID)).toBe(false);
		expect(sendPrompt).not.toHaveBeenCalled();
		expect(heldQueueItems(SID)).toHaveLength(1);
		setSession({ state: { isCompacting: false } });
		await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
		expect(heldQueueItems(SID)).toHaveLength(0);
	});
});
