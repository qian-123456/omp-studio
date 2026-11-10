// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import type * as EnsureLiveModule from "../../lib/ensureLive";
import type * as TauriCoreModule from "@tauri-apps/api/core";

const h = vi.hoisted(() => ({
	rpcSend: vi.fn(),
	imageContentsFromPaths: vi.fn(),
	toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../../lib/ipc", async (original) => ({
	...(await original<typeof IpcModule>()),
	rpcSend: (...args: unknown[]) => h.rpcSend(...args),
	imageContentsFromPaths: (...args: unknown[]) => h.imageContentsFromPaths(...args),
	privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "ok", nativeError: null })),
	localRowsGet: vi.fn(async () => "[]"),
	localRowsSave: vi.fn(async () => {}),
}));
vi.mock("../../lib/events", async (original) => ({
	...(await original<typeof EventsModule>()),
	onPrivacyChanged: vi.fn(async () => () => {}),
}));
vi.mock("../../lib/ensureLive", async (original) => ({
	...(await original<typeof EnsureLiveModule>()),
	ensureLive: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../lib/toast", () => ({ toast: h.toast }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (original) => ({
	...(await original<typeof TauriCoreModule>()),
	convertFileSrc: (path: string) => path,
}));

import { tNow } from "../../stores/language";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { DEFAULT_SETTINGS, useSettings } from "../settings/store";
import { HeldQueueBar } from "./HeldQueueBar";
import { heldQueueItems, useHeldQueue } from "./heldQueue";
import { MessageList } from "./MessageList";
import { releaseReadyHeldBatch, useQueuedBusy } from "./QueuedBar";
import { deferred } from "./slash/compaction";

const SID = "held-native-image-delivery";
const IMAGE_PATH = "/clip/queued-image.png";
const PNG = readFileSync("src-tauri/icons/128x128.png").toString("base64");
// The persisted blob may contain transformed bytes; correlation uses retained text/marker origin.
const BLOB_PATH = `/Users/test/.omp/agent/blobs/${"b".repeat(64)}.webp`;
const NATIVE_IMAGES = [{ type: "image" as const, data: PNG, mimeType: "image/png" }];

function mountQueueThread() {
	const scrollRef = createRef<HTMLDivElement>();
	return render(
		<>
			<div ref={scrollRef}><MessageList sessionId={SID} scrollRef={scrollRef} /></div>
			<HeldQueueBar sessionId={SID} streaming={false} />
		</>,
	);
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
	localStorage.clear();
	h.rpcSend.mockReset().mockResolvedValue({});
	h.imageContentsFromPaths.mockReset().mockResolvedValue(NATIVE_IMAGES);
	for (const toast of Object.values(h.toast)) toast.mockReset();
	useSettings.setState({ settings: { ...DEFAULT_SETTINGS, queueAutoSend: false } });
	useHeldQueue.setState({ queues: {}, dismissed: {} });
	useQueuedBusy.setState({ busy: {} });
	useSessions.setState({ sessions: {} });
	useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, localRowsLoaded: true } } });
});

afterEach(() => {
	cleanup();
	releaseReadyHeldBatch(SID);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("HeldQueueBar validated image delivery to MessageList", () => {
	it.each([
		["individual", "marker"], ["individual", "body"], ["merged", "marker"], ["merged", "body"],
	] as const)("refuses a blank %s item, then keeps one image through repaired %s acceptance and history handoff", async (mode, repair) => {
		const image = { id: "held-original-image", path: IMAGE_PATH, marker: "[Image #1]" };
		useHeldQueue.getState().push(SID, `[Image #1: ${IMAGE_PATH}] old body`, [image]);
		const conversion = deferred<typeof NATIVE_IMAGES>();
		h.imageContentsFromPaths.mockReturnValueOnce(conversion.promise);
		const { container } = mountQueueThread();
		fireEvent.click(screen.getByRole("button", { name: tNow("chat.heldQueue.reviewOneByOne") }));
		fireEvent.change(container.querySelector("textarea")!, { target: { value: "" } });
		const cleared = heldQueueItems(SID)[0];
		const send = screen.getByRole("button", { name: tNow(mode === "individual" ? "chat.heldQueue.sendThis" : "chat.heldQueue.sendButton") });
		expect(container.querySelectorAll("img")).toHaveLength(1);
		expect(container.querySelector("img")?.getAttribute("src")).toBe(IMAGE_PATH);
		await act(async () => { fireEvent.click(send); });
		expect(h.rpcSend).not.toHaveBeenCalled();
		expect(h.imageContentsFromPaths).not.toHaveBeenCalled();
		expect(heldQueueItems(SID)).toEqual([cleared]);
		expect(useLive.getState().sessions[SID].pendingUserEchoes).toEqual([]);
		expect(h.toast.error).toHaveBeenCalledWith(tNow("chatView.pendingUi.inputCannotBeEmpty"));
		expect(h.toast.success).not.toHaveBeenCalled();
		expect(container.querySelectorAll("img")).toHaveLength(1);
		expect(send.hasAttribute("disabled")).toBe(false);

		const repaired = repair === "marker" ? `[Image #1: ${IMAGE_PATH}]` : "repaired body";
		fireEvent.change(container.querySelector("textarea")!, { target: { value: repaired } });
		fireEvent.click(send);
		expect(h.rpcSend).not.toHaveBeenCalled();
		// Conversion is still pending: the held thumbnail must not disappear.
		expect(container.querySelectorAll("img")).toHaveLength(1);
		await act(async () => { conversion.resolve(NATIVE_IMAGES); await conversion.promise; });
		await waitFor(() => expect(heldQueueItems(SID)).toEqual([]));
		expect(h.rpcSend).toHaveBeenCalledWith(SID, { type: "prompt", message: repaired, images: NATIVE_IMAGES });
		expect(useLive.getState().sessions[SID].items).toEqual([]);
		expect(useLive.getState().sessions[SID].pendingUserEchoes).toHaveLength(1);
		expect(container.querySelectorAll("img")).toHaveLength(1);
		expect(container.querySelector("img")?.getAttribute("src")).toBe(IMAGE_PATH);
		expect(container.querySelector("[data-queued-message]")).toBeNull();

		// Rust rewrites native ids/blob paths but preserves a textual full-path marker.
		const persisted: TranscriptItem = {
			id: "native-history-user", parentId: null, ts: new Date().toISOString(), kind: "user", text: repaired,
			thinking: null, toolCalls: [], toolResult: null, usage: null, model: null, stopReason: null, hidden: false,
			images: [{ id: "img-1", path: BLOB_PATH, marker: repair === "marker" ? repaired : "[图片 #1]", mimeType: "image/webp" }],
		};
		act(() => useLive.getState().appendItems(SID, [persisted], 1));
		expect(useLive.getState().sessions[SID].pendingUserEchoes).toEqual([]);
		expect(container.querySelectorAll("img")).toHaveLength(1);
		expect(container.querySelector("img")?.getAttribute("src")).toBe(BLOB_PATH);
		expect(container.querySelector("#msg-native-history-user")).not.toBeNull();
		act(() => useLive.getState().setItems(SID, [persisted], 1));
		expect(container.querySelectorAll("img")).toHaveLength(1);
		expect(h.toast.error).toHaveBeenCalledTimes(1);
	});

	it("keeps a missing-path image item visible and retryable when the real sender refuses it", async () => {
		const image = { id: "missing-path-image", path: null, marker: "[Image #1]" };
		useHeldQueue.getState().push(SID, "[Image #1]", [image]);
		useHeldQueue.getState().update(SID, 0, "");
		const original = heldQueueItems(SID)[0];
		const { container } = mountQueueThread();
		fireEvent.click(screen.getByRole("button", { name: tNow("chat.heldQueue.reviewOneByOne") }));
		const send = screen.getByRole("button", { name: tNow("chat.heldQueue.sendThis") });
		await act(async () => { fireEvent.click(send); });
		expect(h.rpcSend).not.toHaveBeenCalled();
		expect(h.imageContentsFromPaths).not.toHaveBeenCalled();
		expect(heldQueueItems(SID)).toEqual([original]);
		expect(useLive.getState().sessions[SID].pendingUserEchoes).toEqual([]);
		expect(container.querySelector("[data-queued-message]")?.textContent).toContain(tNow("chatView.queue.attachmentPlaceholder"));
		expect(h.toast.error).toHaveBeenCalledWith(tNow("chatView.pendingUi.inputCannotBeEmpty"));
		expect(h.toast.success).not.toHaveBeenCalled();
		expect(send.hasAttribute("disabled")).toBe(false);
	});
});
