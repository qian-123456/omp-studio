import { describe, expect, it, vi } from "vitest";
import { useLive } from "../../../stores/live";
import {
	isCompacting,
	isNothingToCompact,
	runCompaction,
} from "./compaction";

const rows = (sid: string) => useLive.getState().sessions[sid]?.flowNotices ?? [];

describe("compaction", () => {
	it("recognises the nothing-to-compact errors", () => {
		expect(isNothingToCompact("Already compacted")).toBe(true);
		expect(isNothingToCompact("Nothing to compact")).toBe(true);
		expect(isNothingToCompact("network error")).toBe(false);
	});

	it("tracks in-flight state, rejects a concurrent run and refreshes state afterwards", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const sent: string[] = [];
		const rpcSend = vi.fn(async (c: Record<string, unknown>) => {
			sent.push(String(c.type));
			if (c.type === "compact") await gate;
			return {};
		});
		const deps = { sessionId: "s1", rpcSend, errorText: (e: unknown) => String(e) };
		const first = runCompaction(deps);
		await Promise.resolve();
		expect(isCompacting("s1")).toBe(true);
		expect(await runCompaction(deps)).toBe("busy");
		// One running divider; the busy second call adds none.
		expect(rows("s1").map((r) => r.status)).toEqual(["running"]);
		release();
		expect(await first).toBe("done");
		expect(rows("s1").map((r) => r.status)).toEqual(["done"]);
		expect(isCompacting("s1")).toBe(false);
		expect(sent).toEqual(["compact", "get_state"]);
	});

	it("maps already-compacted errors to 'nothing' and still resyncs", async () => {
		const sent: string[] = [];
		const rpcSend = async (c: Record<string, unknown>) => {
			sent.push(String(c.type));
			if (c.type === "compact") throw new Error("Already compacted");
			return {};
		};
		const out = await runCompaction({
			sessionId: "s2",
			rpcSend,
			errorText: (e) => (e as Error).message,
		});
		expect(out).toBe("nothing");
		expect(rows("s2")[0]).toMatchObject({ status: "done", detail: "当前上下文无需再压缩" });
		expect(sent).toEqual(["compact", "get_state"]);
	});

	it("turns a failure into one error divider", async () => {
		const out = await runCompaction({
			sessionId: "s3",
			rpcSend: async (c) => {
				if (c.type === "compact") throw new Error("boom");
				return {};
			},
			errorText: (e) => (e as Error).message,
		});
		expect(out).toBe("failed");
		expect(rows("s3")).toHaveLength(1);
		expect(rows("s3")[0]).toMatchObject({ status: "error", detail: "boom" });
	});

	it("drops the divider silently on a cancelled resume", async () => {
		await runCompaction({
			sessionId: "s4",
			rpcSend: async () => ({}),
			ensureAlive: async () => {
				throw new Error("cancel");
			},
			errorText: () => null,
		});
		expect(rows("s4")).toHaveLength(0);
	});

	it("records token numbers when they changed", async () => {
		const reads = [200_000, 40_000];
		await runCompaction({
			sessionId: "s5",
			rpcSend: async () => ({}),
			errorText: String,
			tokens: () => reads.shift() ?? null,
		});
		expect(rows("s5")[0]).toMatchObject({ status: "done", tokensBefore: 200_000, tokensAfter: 40_000 });
	});
});
