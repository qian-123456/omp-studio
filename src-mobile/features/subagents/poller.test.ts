// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_MS, createPoller } from "./poller";

describe("createPoller", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function setup(opts: { visible?: () => boolean } = {}) {
		const state = { running: true };
		const fetch = vi.fn(async () => {});
		const poller = createPoller({ fetch, isRunning: () => state.running, visible: opts.visible });
		return { state, fetch, poller };
	}

	it("fetches immediately on watch and re-polls every 15 s while running", async () => {
		const { fetch, poller } = setup();
		poller.watch("s");
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(POLL_MS - 1);
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetch).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("stops polling once nothing is running", async () => {
		const { fetch, poller, state } = setup();
		poller.watch("s");
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(fetch).toHaveBeenCalledTimes(2);
		state.running = false;
		// The already scheduled tick fetches once more; its result is terminal so nothing is re-armed.
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(fetch).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(POLL_MS * 4);
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(poller.isPolling("s")).toBe(false);
	});

	it("does not poll when the first load finds everything terminal", async () => {
		const { fetch, poller, state } = setup();
		state.running = false;
		poller.watch("s");
		await vi.advanceTimersByTimeAsync(POLL_MS * 3);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("stops when the last watcher leaves and shares one request between watchers", async () => {
		const { fetch, poller } = setup();
		const off1 = poller.watch("s");
		const off2 = poller.watch("s");
		expect(fetch).toHaveBeenCalledTimes(1);
		off1();
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(fetch).toHaveBeenCalledTimes(2);
		off2();
		off2();
		await vi.advanceTimersByTimeAsync(POLL_MS * 3);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("skips requests while hidden and resumes when visible", async () => {
		let visible = false;
		const { fetch, poller } = setup({ visible: () => visible });
		poller.watch("s");
		await vi.advanceTimersByTimeAsync(POLL_MS * 2);
		expect(fetch).toHaveBeenCalledTimes(1);
		visible = true;
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("refresh dedupes in-flight requests and ignores unwatched sessions", async () => {
		const { fetch, poller } = setup();
		await poller.refresh("other");
		expect(fetch).not.toHaveBeenCalled();
		poller.watch("s");
		void poller.refresh("s");
		void poller.refresh("s");
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(0);
		await poller.refresh("s");
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
