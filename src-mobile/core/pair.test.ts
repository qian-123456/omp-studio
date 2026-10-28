// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairWithCode, takePairCode } from "./pair";
import { useConnection } from "./stores/connection";
import { reconnectEvents } from "./sse";

vi.mock("./sse", () => ({ reconnectEvents: vi.fn() }));

beforeEach(() => {
	vi.clearAllMocks();
	useConnection.setState({ phase: "unauthorized", error: "old failure" });
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("explicit pairing handshake", () => {
	it("does not mistake an existing readable session cookie for redemption of an invalid code", async () => {
		const fetcher = vi.fn(async (url: string) => ({ status: url === "/pair" ? 403 : 200 }));
		vi.stubGlobal("fetch", fetcher);
		expect(await pairWithCode("invalid")).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher).toHaveBeenCalledWith("/pair", expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "invalid" }), credentials: "same-origin" }));
		expect(reconnectEvents).not.toHaveBeenCalled();
		expect(useConnection.getState().phase).toBe("unauthorized");
	});

	it("only accepts the explicit 204 result and reconnects after resetting terminal unauthorized", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ status: 200 }).mockResolvedValueOnce({ status: 204 }));
		expect(await pairWithCode("unexpected-page")).toBe(false);
		expect(await pairWithCode("valid-code")).toBe(true);
		expect(useConnection.getState()).toMatchObject({ phase: "idle", error: null });
		expect(reconnectEvents).toHaveBeenCalledTimes(1);
	});

	it("aborts a timed-out handshake without claiming success or reconnecting", async () => {
		vi.useFakeTimers();
		let signal: AbortSignal | undefined;
		vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
			signal = init.signal as AbortSignal;
			let reject!: (reason: unknown) => void;
			const promise = new Promise<Response>((_resolve, no) => { reject = no; });
			signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			return promise;
		}));
		const result = pairWithCode("slow-code", 25);
		await vi.advanceTimersByTimeAsync(25);
		expect(await result).toBe(false);
		expect(signal?.aborted).toBe(true);
		expect(reconnectEvents).not.toHaveBeenCalled();
	});

	it("does not request an empty code", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		expect(await pairWithCode("")).toBe(false);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("removes only the pairing query before starting the handshake", () => {
		history.replaceState(null, "", "/?pair=secret&theme=dark#/s/a");
		expect(takePairCode()).toBe("secret");
		expect(location.search).toBe("?theme=dark");
		expect(location.hash).toBe("#/s/a");
	});
});
