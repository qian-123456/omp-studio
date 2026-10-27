// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffMs, EventBus, SseClient, type EventSourceLike } from "./sse";
import { useConnection } from "./stores/connection";

class FakeES implements EventSourceLike {
	static all: FakeES[] = [];
	readyState = 0;
	onerror: ((e: unknown) => void) | null = null;
	private l: Record<string, Array<(e: { data: string }) => void>> = {};
	constructor(public url: string) {
		FakeES.all.push(this);
	}
	addEventListener(t: string, fn: (e: { data: string }) => void) {
		(this.l[t] ??= []).push(fn);
	}
	emit(t: string, data: unknown) {
		for (const fn of this.l[t] ?? []) fn({ data: JSON.stringify(data) });
	}
	close() {
		this.readyState = 2;
	}
}

describe("backoffMs", () => {
	it("doubles 1,2,4,8 s then caps at 15 s with ±20% jitter", () => {
		const mid = () => 0.5; // zero jitter
		expect([0, 1, 2, 3, 4, 5, 10].map((a) => backoffMs(a, mid))).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
		expect(backoffMs(0, () => 0)).toBe(800);
		expect(backoffMs(0, () => 1)).toBe(1200);
		for (let i = 0; i < 50; i++) expect(backoffMs(9)).toBeLessThanOrEqual(15000);
	});
});

describe("EventBus", () => {
	it("isolates a throwing handler and supports unsubscribe", () => {
		const bus = new EventBus();
		const spy = vi.fn();
		vi.spyOn(console, "error").mockImplementation(() => {});
		bus.on("touch", () => {
			throw new Error("x");
		});
		const off = bus.on("touch", spy);
		bus.emit("touch", { sessionId: "a" });
		expect(spy).toHaveBeenCalledWith({ sessionId: "a" });
		off();
		bus.emit("touch", {});
		expect(spy).toHaveBeenCalledTimes(1);
	});
});

describe("SseClient", () => {
	let bus: EventBus;
	let probe: ReturnType<typeof vi.fn>;
	let client: SseClient;
	beforeEach(() => {
		vi.useFakeTimers();
		FakeES.all = [];
		bus = new EventBus();
		probe = vi.fn().mockResolvedValue(undefined);
		useConnection.setState({ phase: "idle", error: null });
		client = new SseClient({ create: (u) => new FakeES(u), probe, random: () => 0.5, bus });
	});
	afterEach(() => {
		client.stop();
		vi.useRealTimers();
	});

	it("probes first, opens one stream, marks open on hello and fans events out", async () => {
		const got: unknown[] = [];
		bus.on("rpc", (d) => got.push(d));
		client.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(FakeES.all).toHaveLength(1);
		expect(FakeES.all[0].url).toBe("/api/events");
		expect(useConnection.getState().phase).toBe("connecting");
		FakeES.all[0].emit("hello", {});
		expect(useConnection.getState().phase).toBe("open");
		FakeES.all[0].emit("rpc", { sessionId: "s", frame: { type: "agent_start" } });
		expect(got).toEqual([{ sessionId: "s", frame: { type: "agent_start" } }]);
	});

	it("reconnects with backoff after an error and resets the attempt on hello", async () => {
		client.start();
		await vi.advanceTimersByTimeAsync(0);
		FakeES.all[0].emit("hello", {});
		FakeES.all[0].onerror?.(null);
		expect(useConnection.getState().phase).toBe("closed");
		await vi.advanceTimersByTimeAsync(999);
		expect(FakeES.all).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(2);
		expect(FakeES.all).toHaveLength(2);
		// second consecutive failure without hello waits 2 s
		FakeES.all[1].onerror?.(null);
		await vi.advanceTimersByTimeAsync(1999);
		expect(FakeES.all).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(2);
		expect(FakeES.all).toHaveLength(3);
		FakeES.all[2].emit("hello", {});
		FakeES.all[2].onerror?.(null);
		await vi.advanceTimersByTimeAsync(1001);
		expect(FakeES.all).toHaveLength(4);
	});

	it("never retries after a 401 probe", async () => {
		probe.mockImplementation(async () => {
			useConnection.getState().setPhase("unauthorized");
			throw new Error("unauthorized");
		});
		client.start();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(FakeES.all).toHaveLength(0);
		expect(useConnection.getState().phase).toBe("unauthorized");
	});

	it("retries a failing probe with backoff and keeps the error text", async () => {
		probe.mockRejectedValueOnce(new Error("网络不可用")).mockResolvedValue(undefined);
		client.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(useConnection.getState()).toMatchObject({ phase: "closed", error: "网络不可用" });
		await vi.advanceTimersByTimeAsync(1001);
		expect(FakeES.all).toHaveLength(1);
	});

	it("resume() revives a dead stream and always emits a resync", async () => {
		const resyncs: unknown[] = [];
		bus.on("resync", (d) => resyncs.push(d));
		client.start();
		await vi.advanceTimersByTimeAsync(0);
		FakeES.all[0].readyState = 2; // iOS killed it silently, no onerror
		client.resume("visible");
		await vi.advanceTimersByTimeAsync(0);
		expect(FakeES.all).toHaveLength(2);
		expect(resyncs).toEqual([{ reason: "visible" }]);
		client.resume("visible"); // healthy stream: no extra connection
		await vi.advanceTimersByTimeAsync(0);
		expect(FakeES.all).toHaveLength(2);
	});
});
