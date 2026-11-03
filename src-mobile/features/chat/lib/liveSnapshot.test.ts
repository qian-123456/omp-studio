// @vitest-environment jsdom
/** Unit tests for the half-answer mirror: roundtrip, slot moves, corruption and eviction. */
import { beforeEach, describe, expect, it } from "vitest";
import { LIVE_SNAPSHOT_KEY, clearLiveMain, clearLiveStale, loadLiveEntry, saveLiveMain, stashLiveStale } from "./liveSnapshot";

/** Realistic timestamps: entries older than MAX_AGE are evicted on every write. */
const body = (text: string, at = Date.now()) => ({ text, thinking: "", tools: [], at });

beforeEach(() => {
	localStorage.clear();
});

describe("liveSnapshot", () => {
	it("roundtrips a saved mirror and reports absent slots as undefined", () => {
		expect(loadLiveEntry("s1")).toBeNull();
		saveLiveMain("s1", body("半句"));
		expect(loadLiveEntry("s1")?.main?.text).toBe("半句");
		expect(loadLiveEntry("s1")?.stale).toBeUndefined();
	});

	it("stashLiveStale moves the content out of the streaming slot; clearLiveStale drops the entry", () => {
		saveLiveMain("s1", body("半句"));
		stashLiveStale("s1", body("半句"));
		const e = loadLiveEntry("s1");
		expect(e?.main).toBeUndefined();
		expect(e?.stale?.text).toBe("半句");
		clearLiveStale("s1");
		expect(loadLiveEntry("s1")).toBeNull();
	});

	it("clearLiveMain keeps a stale slot alive and drops the entry when empty", () => {
		stashLiveStale("s1", body("旧内容"));
		saveLiveMain("s1", body("新半句"));
		clearLiveMain("s1");
		expect(loadLiveEntry("s1")?.stale?.text).toBe("旧内容");
		expect(loadLiveEntry("s1")?.main).toBeUndefined();
	});

	it("corrupted or non-object payloads are treated as absent", () => {
		localStorage.setItem(LIVE_SNAPSHOT_KEY, "{broken");
		expect(loadLiveEntry("s1")).toBeNull();
		localStorage.setItem(LIVE_SNAPSHOT_KEY, JSON.stringify({ s1: { main: 42 } }));
		expect(loadLiveEntry("s1")).toBeNull();
	});

	it("keeps at most 8 sessions, evicting the oldest", () => {
		for (let i = 0; i < 10; i++) saveLiveMain(`s${i}`, body(`t${i}`, 1000 + i));
		const raw = JSON.parse(localStorage.getItem(LIVE_SNAPSHOT_KEY) ?? "{}") as Record<string, unknown>;
		expect(Object.keys(raw).sort()).toEqual(["s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]);
	});
});
