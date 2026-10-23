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

const sendPrompt = vi.fn();
vi.mock("./send", () => ({ sendPrompt: (...a: unknown[]) => sendPrompt(...a) }));
vi.mock("../settings/store", () => ({
	useSettings: Object.assign(() => undefined, { getState: () => ({ settings: undefined }) }),
}));

import { ResumeCancelledError } from "../../lib/ensureLive";
import { heldQueueItems, useHeldQueue } from "./heldQueue";
import { drainNext, sendQueuedNow } from "./QueuedBar";

const SID = "s1";

beforeEach(() => {
	mem.clear();
	sendPrompt.mockReset();
	useHeldQueue.setState({ queues: {}, dismissed: {} });
});

describe("cancelled send restores the queued item", () => {
	it("drainNext puts the item back at the front", async () => {
		useHeldQueue.getState().push(SID, "排队一");
		useHeldQueue.getState().push(SID, "排队二");
		sendPrompt.mockRejectedValueOnce(new ResumeCancelledError());
		expect(await drainNext(SID)).toBe(false);
		expect(heldQueueItems(SID).map((i) => i.text)).toEqual(["排队一", "排队二"]);
	});

	it("sendQueuedNow keeps the item when cancelled", async () => {
		useHeldQueue.getState().push(SID, "排队一");
		const item = heldQueueItems(SID)[0]!;
		sendPrompt.mockRejectedValueOnce(new ResumeCancelledError());
		await sendQueuedNow(SID, item, true);
		expect(heldQueueItems(SID)).toHaveLength(1);
	});
});
