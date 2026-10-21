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
vi.mock("../../lib/ipc", () => ({ rpcSend: vi.fn() }));
vi.mock("../settings/store", () => ({
	useSettings: Object.assign(() => undefined, { getState: () => ({ settings: null }) }),
}));

import { emptySessionLive, useLive } from "../../stores/live";
import { useHeldQueue } from "./heldQueue";
import { sendQueuedNow } from "./QueuedBar";

const SID = "q1";

beforeEach(() => {
	sendPrompt.mockReset().mockResolvedValue(undefined);
	mem.clear();
	useHeldQueue.setState({ queues: {}, dismissed: {} });
	useLive.setState({ sessions: {} });
});

describe("held queue drain", () => {
	it("drains when the session becomes alive while idle", async () => {
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: false } } });
		useHeldQueue.getState().push(SID, "queued one");
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true } } });
		await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
		expect(sendPrompt.mock.calls[0][1]).toBe("queued one");
	});

	it("send-now twice in a row sends once", async () => {
		useHeldQueue.getState().push(SID, "now");
		const item = useHeldQueue.getState().queues[SID][0];
		await Promise.all([sendQueuedNow(SID, item, false), sendQueuedNow(SID, item, false)]);
		expect(sendPrompt).toHaveBeenCalledTimes(1);
	});
});
