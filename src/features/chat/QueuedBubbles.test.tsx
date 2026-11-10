// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	rpcSend: vi.fn(),
	imageContentsFromPaths: vi.fn(),
	toastError: vi.fn(),
}));
vi.mock("../../lib/ipc", () => ({
	rpcSend: (...args: unknown[]) => h.rpcSend(...args),
	imageContentsFromPaths: (...args: unknown[]) => h.imageContentsFromPaths(...args),
	validatePath: vi.fn(),
	takeoverExternal: vi.fn(),
	privacyClassify: vi.fn(),
	privacyMark: vi.fn(),
}));
vi.mock("../../lib/toast", () => ({ toast: { error: (...args: unknown[]) => h.toastError(...args) } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
vi.mock("../../lib/ensureLive", async (original) => ({
	...(await original<Record<string, unknown>>()),
	ensureLive: vi.fn().mockResolvedValue({}),
}));
vi.mock("../settings/store", () => ({
	useSettings: Object.assign(() => false, { getState: () => ({ settings: { queueAutoSend: false } }) }),
}));

import { tNow } from "../../stores/language";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { heldQueueItems, useHeldQueue } from "./heldQueue";
import { useQueuedBusy } from "./QueuedBar";
import { QueuedBubbles } from "./QueuedBubbles";
import { deferred } from "./slash/compaction";

const SID = "queued-bubble-image-only";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
	// React's test-only act flag is not part of the DOM global type.
	const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	localStorage.clear();
	h.rpcSend.mockReset().mockResolvedValue(undefined);
	h.imageContentsFromPaths.mockReset().mockResolvedValue([{ type: "image", data: "AAAA", mimeType: "image/png" }]);
	h.toastError.mockReset();
	useHeldQueue.setState({ queues: {}, dismissed: {} });
	useQueuedBusy.setState({ busy: {} });
	useSessions.setState({ sessions: {} });
	useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true } } });
	container = document.createElement("div");
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
});

describe("QueuedBubbles image-only send-now", () => {
	it("refuses a cleared image visibly, then sends its restored marker and retains a failed attempt for retry", async () => {
		const image = { id: "queued-image", path: "/queued.png", marker: "[Image #1]" };
		const queue = useHeldQueue.getState();
		queue.push(SID, "[Image #1: /queued.png] old text", [image]);
		queue.update(SID, 0, "");
		const item = heldQueueItems(SID)[0];
		const request = deferred<void>();
		h.rpcSend.mockReturnValueOnce(request.promise);
		act(() => root.render(createElement(QueuedBubbles, { sessionId: SID })));
		expect(container.querySelector("img")?.getAttribute("src")).toBe("/queued.png");
		expect(container.textContent).toContain(tNow("chatView.queue.attachmentPlaceholder"));
		const sendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === tNow("chatView.queue.sendNow"))!;
		await act(async () => { sendButton.click(); });
		expect(h.rpcSend).not.toHaveBeenCalled();
		expect(h.imageContentsFromPaths).not.toHaveBeenCalled();
		expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining(tNow("chatView.pendingUi.inputCannotBeEmpty")));
		expect(heldQueueItems(SID)).toEqual([item]);
		const marker = "[Image #1: /queued.png]";
		act(() => queue.update(SID, 0, marker));
		await act(async () => { sendButton.click(); });
		expect(h.imageContentsFromPaths).toHaveBeenCalledWith(["/queued.png"]);
		expect(h.rpcSend).toHaveBeenCalledWith(SID, { type: "prompt", message: marker, images: [{ type: "image", data: "AAAA", mimeType: "image/png" }] });
		expect(sendButton.disabled).toBe(true);
		expect(container.querySelector("img")).not.toBeNull();
		await act(async () => { request.reject(new Error("delivery failed")); await request.promise.catch(() => {}); });
		expect(heldQueueItems(SID)).toEqual([{ ...item, text: marker }]);
		expect(container.querySelector("img")?.getAttribute("src")).toBe("/queued.png");
		expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("delivery failed"));
		expect(sendButton.disabled).toBe(false);
		await act(async () => { sendButton.click(); });
		expect(h.rpcSend).toHaveBeenCalledTimes(2);
		expect(heldQueueItems(SID)).toEqual([]);
		expect(container.querySelector("[data-queued-message]")).toBeNull();
		expect(useLive.getState().sessions[SID].pendingUserEchoes).toMatchObject([{ text: marker, images: [image] }]);
	});
});
