// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendPrompt, toast } = vi.hoisted(() => ({
	sendPrompt: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("./send", () => ({ sendPrompt: (...args: unknown[]) => sendPrompt(...args) }));
vi.mock("../../lib/toast", () => ({ toast }));
vi.mock("../../lib/ipc", () => ({ rpcSend: vi.fn() }));
vi.mock("../settings/store", () => ({
	useSettings: Object.assign(() => false, { getState: () => ({ settings: { queueAutoSend: false } }) }),
}));

import { tNow } from "../../stores/language";
import { useLive } from "../../stores/live";
import { HeldQueueBar } from "./HeldQueueBar";
import { heldQueueItems, mergeHeldItems, useHeldQueue } from "./heldQueue";
import { type ReadyHeldBatch, releaseReadyHeldBatch, restoreReadyHeldBatch, takeReadyHeldBatch, useQueuedBusy } from "./QueuedBar";
import { deferred } from "./slash/compaction";
const SID = "held-bar-concurrent";
let root: Root;
let container: HTMLDivElement;

function click(label: string, index = 0) {
	const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
	const button = buttons.filter((candidate) => candidate.getAttribute("aria-label") === label)[index];
	expect(button).toBeDefined();
	act(() => button.click());
}

beforeEach(() => {
	localStorage.clear();
	sendPrompt.mockReset();
	vi.clearAllMocks();
	// React's act environment flag is a test-only global, absent from DOM typings.
	const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	useHeldQueue.setState({ queues: {}, dismissed: {} });
	useQueuedBusy.setState({ busy: {} });
	useLive.setState({ sessions: {} });
	container = document.createElement("div");
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	releaseReadyHeldBatch(SID);
});

describe("HeldQueueBar individual send versus Composer batch reservation", () => {
	it.each(["success", "failure"] as const)("excludes the clicked item and restores only reserved items on batch failure: individual %s", async (outcome) => {
		const individual = deferred<void>();
		sendPrompt.mockReturnValueOnce(individual.promise);
		const queue = useHeldQueue.getState();
		const busyImage = { id: "busy-image", path: "/busy.png", marker: "[Image #1]" };
		const readyImage = { id: "ready-image", path: "/ready.png", marker: "[Image #1]" };
		queue.push(SID, "first ready");
		queue.push(SID, "[Image #1: /busy.png] individual", [busyImage]);
		queue.push(SID, "[Image #1: /ready.png] last ready", [readyImage]);
		const original = heldQueueItems(SID).slice();
		const item = original[1];
		act(() => root.render(createElement(HeldQueueBar, { sessionId: SID, streaming: false })));
		click(tNow("chat.heldQueue.reviewOneByOne"));
		click(tNow("chat.heldQueue.sendThis"), 1);

		expect(sendPrompt).toHaveBeenCalledTimes(1);
		expect(sendPrompt).toHaveBeenCalledWith(SID, item.text, { steer: false, images: [busyImage] });
		expect(useQueuedBusy.getState().busy[item.id]).toBe(true);
		let reserved!: ReadyHeldBatch;
		act(() => {
			const batch = takeReadyHeldBatch(SID);
			expect(batch).not.toBeNull();
			if (batch) reserved = batch;
		});
		expect(reserved.items).toEqual([original[0], original[2]]);
		expect(heldQueueItems(SID)).toEqual([item]);
		expect(takeReadyHeldBatch(SID)).toBeNull();
		const typedImage = { id: "typed-image", path: "/typed.png", marker: "[Image #1]" };
		const merged = mergeHeldItems([
			{ id: "typed", text: "[Image #1: /typed.png] typed first", images: [typedImage] },
			...reserved.items,
		]);
		expect(merged.text).toBe("[Image #1: /typed.png] typed first\n\n---\n\nfirst ready\n\n---\n\n[Image #2: /ready.png] last ready");
		expect(merged.images).toEqual([typedImage, { ...readyImage, marker: "[Image #2]" }]);

		if (outcome === "success") {
			// Complete the individual send while the batch remains reserved; a later
			// batch failure must not resurrect this already-sent item.
			await act(async () => { individual.resolve(); await individual.promise; });
			expect(heldQueueItems(SID)).toEqual([]);
		} else {
			// A failed batch must leave the unreserved individual item in place,
			// including its busy state and attachment, until its own send settles.
			expect(useQueuedBusy.getState().busy[item.id]).toBe(true);
		}
		act(() => {
			restoreReadyHeldBatch(SID, reserved);
			restoreReadyHeldBatch(SID, reserved);
			releaseReadyHeldBatch(SID);
		});
		expect(heldQueueItems(SID)).toEqual(outcome === "success" ? [original[0], original[2]] : original);
		if (outcome === "failure") {
			expect(useQueuedBusy.getState().busy[item.id]).toBe(true);
			await act(async () => { individual.reject(new Error("individual failed")); await individual.promise.catch(() => {}); });
			expect(heldQueueItems(SID)).toEqual(original);
			expect(toast.error).toHaveBeenCalledTimes(1);
			expect(toast.success).not.toHaveBeenCalled();
		} else {
			expect(toast.success).toHaveBeenCalledTimes(1);
		}
		expect(useQueuedBusy.getState().busy[item.id]).toBeUndefined();
		expect(sendPrompt).toHaveBeenCalledTimes(1);
	});
});
