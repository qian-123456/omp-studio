// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "./sse";
import { useConnection } from "./stores/connection";
import { startViewingPresence } from "./presence";

let stop: (() => void) | undefined;
const ok = () => new Response("{}", { headers: { "content-type": "application/json" } });
beforeEach(() => {
	vi.useFakeTimers();
	useConnection.setState({ phase: "open", error: null });
	vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(async () => {
	stop?.();
	await vi.advanceTimersByTimeAsync(0);
	vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("visible mobile session presence", () => {
	it("publishes immediately, heartbeats, clears when hidden and republishes on hello", async () => {
		const fetcher = vi.fn().mockImplementation(async () => ok());
		vi.stubGlobal("fetch", fetcher);
		stop = startViewingPresence("s1");
		await vi.advanceTimersByTimeAsync(0);
		expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ sessionId: "s1", visible: true });
		await vi.advanceTimersByTimeAsync(15_000);
		expect(fetcher).toHaveBeenCalledTimes(2);
		vi.spyOn(document, "hidden", "get").mockReturnValue(true);
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.advanceTimersByTimeAsync(0);
		expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ sessionId: null, visible: false });
		await vi.advanceTimersByTimeAsync(15_000);
		expect(fetcher).toHaveBeenCalledTimes(3);
		vi.spyOn(document, "hidden", "get").mockReturnValue(false);
		events.emit("hello", {});
		await vi.advanceTimersByTimeAsync(0);
		expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual({ sessionId: "s1", visible: true });
	});

	it("serializes a new page behind the old request so old visibility cannot arrive last", async () => {
		let finish!: (r: Response) => void;
		const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockImplementation(async () => ok());
		vi.stubGlobal("fetch", fetcher);
		stop = startViewingPresence("old");
		await vi.advanceTimersByTimeAsync(0);
		stop();
		stop = startViewingPresence("new");
		await vi.advanceTimersByTimeAsync(0);
		expect(fetcher).toHaveBeenCalledTimes(1);
		finish(ok());
		await vi.advanceTimersByTimeAsync(0);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ sessionId: "new", visible: true });
	});

	it("does not retry presence after unauthorized", async () => {
		const fetcher = vi.fn().mockImplementation(async () => ok());
		vi.stubGlobal("fetch", fetcher);
		useConnection.setState({ phase: "unauthorized" });
		stop = startViewingPresence("s1");
		await vi.advanceTimersByTimeAsync(30_000);
		expect(fetcher).not.toHaveBeenCalled();
	});
});
