// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendPrompt, confirmDialog, toast } = vi.hoisted(() => ({
	sendPrompt: vi.fn(),
	confirmDialog: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("./send", () => ({ sendPrompt: (...args: unknown[]) => sendPrompt(...args) }));
vi.mock("../../lib/toast", () => ({ toast }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog, errMsg: String }));
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
	const button = buttons.filter((candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent === label)[index];
	expect(button).toBeDefined();
	act(() => button.click());
}

beforeEach(() => {
	localStorage.clear();
	sendPrompt.mockReset();
	confirmDialog.mockReset();
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

describe("held queue deferred mutations", () => {
	it.each(["success", "failure"] as const)("preserves a visible edit made during an individual %s and sends it on retry", async (outcome) => {
		const request = deferred<void>();
		sendPrompt.mockReturnValueOnce(request.promise);
		const image = { id: "image", path: "/held.png", marker: "[Image #1]" };
		useHeldQueue.getState().push(SID, "old payload", [image]);
		const original = heldQueueItems(SID)[0];
		act(() => root.render(createElement(HeldQueueBar, { sessionId: SID, streaming: false })));
		click(tNow("chat.heldQueue.reviewOneByOne"));
		click(tNow("chat.heldQueue.sendThis"));
		const textarea = container.querySelector("textarea")!;
		fireEvent.change(textarea, { target: { value: "new unsent payload" } });
		expect(textarea.value).toBe("new unsent payload");
		expect(sendPrompt).toHaveBeenCalledWith(SID, "old payload", { steer: false, images: [image] });
		await act(async () => {
			if (outcome === "success") request.resolve();
			else request.reject(new Error("delivery failed"));
			await request.promise.catch(() => {});
		});
		expect(heldQueueItems(SID)).toEqual([{ ...original, text: "new unsent payload" }]);
		expect(container.querySelector("textarea")?.value).toBe("new unsent payload");
		expect(useQueuedBusy.getState().busy[original.id]).toBeUndefined();
		if (outcome === "failure") {
			expect(toast.success).not.toHaveBeenCalled();
			expect(toast.error).toHaveBeenCalledTimes(1);
		}
		sendPrompt.mockResolvedValueOnce(undefined);
		await act(async () => { click(tNow("chat.heldQueue.sendThis")); });
		expect(sendPrompt).toHaveBeenLastCalledWith(SID, "new unsent payload", { steer: false, images: [image] });
		expect(heldQueueItems(SID)).toEqual([]);
		expect(container.querySelector("textarea")).toBeNull();
	});

	it.each([false, true])("never deletes C when B confirmation outlives A removal (B already removed: %s)", async (alreadyRemoved) => {
		const request = deferred<void>();
		const confirmation = deferred<boolean>();
		sendPrompt.mockReturnValueOnce(request.promise);
		confirmDialog.mockReturnValueOnce(confirmation.promise);
		for (const text of ["A", "B", "C"]) useHeldQueue.getState().push(SID, text);
		const original = heldQueueItems(SID).slice();
		act(() => root.render(createElement(HeldQueueBar, { sessionId: SID, streaming: false })));
		click(tNow("chat.heldQueue.reviewOneByOne"));
		click(tNow("chat.heldQueue.sendThis"));
		click(tNow("chat.heldQueue.deleteThis"), 1);
		expect(confirmDialog.mock.calls[0][0]).toContain("B");
		if (alreadyRemoved) act(() => useHeldQueue.getState().remove(SID, 1));
		await act(async () => { request.resolve(); await request.promise; });
		expect(Array.from(container.querySelectorAll("textarea"), (textarea) => textarea.value)).toEqual(alreadyRemoved ? ["C"] : ["B", "C"]);
		await act(async () => { confirmation.resolve(true); await confirmation.promise; });
		expect(heldQueueItems(SID)).toEqual([original[2]]);
		expect(Array.from(container.querySelectorAll("textarea"), (textarea) => textarea.value)).toEqual(["C"]);
		expect(toast.info).toHaveBeenCalledTimes(alreadyRemoved ? 0 : 1);
	});

	it.each(["individual", "merged"] as const)("refuses a cleared image item through the %s action and retains it for repair", async (mode) => {
		const image = { id: "image", path: "/held.png", marker: "[Image #1]" };
		useHeldQueue.getState().push(SID, "[Image #1: /held.png] old text", [image]);
		act(() => root.render(createElement(HeldQueueBar, { sessionId: SID, streaming: false })));
		click(tNow("chat.heldQueue.reviewOneByOne"));
		fireEvent.change(container.querySelector("textarea")!, { target: { value: "" } });
		expect(heldQueueItems(SID)[0].images).toEqual([image]);
		await act(async () => { click(tNow(mode === "individual" ? "chat.heldQueue.sendThis" : "chat.heldQueue.sendButton")); });
		expect(sendPrompt).not.toHaveBeenCalled();
		expect(heldQueueItems(SID)[0]).toMatchObject({ text: "", images: [image] });
		expect(toast.error).toHaveBeenCalledWith(tNow("chatView.pendingUi.inputCannotBeEmpty"));
		expect(toast.success).not.toHaveBeenCalled();
		fireEvent.change(container.querySelector("textarea")!, { target: { value: "[Image #1]" } });
		await act(async () => { click(tNow(mode === "individual" ? "chat.heldQueue.sendThis" : "chat.heldQueue.sendButton")); });
		expect(sendPrompt).toHaveBeenCalledWith(SID, "[Image #1]", mode === "individual" ? { steer: false, images: [image] } : { images: [image], onEchoed: expect.any(Function) });
		expect(heldQueueItems(SID)).toEqual([]);
		expect(container.querySelector("textarea")).toBeNull();
	});
});
