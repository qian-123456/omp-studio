import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALUE = "synthetic-secret-value-0001";
const PLACEHOLDER = "⟦SECRET_ab12⟧";
const CUTOFF = 1_800_000_000_000;
interface SnapshotEntry {
	placeholders: string[];
	current: string;
	value: string;
	track: boolean;
	wholeWord: boolean;
	cutoffs: Record<string, number>;
}
const entry = (track = true, cutoffs: Record<string, number> = {}): SnapshotEntry => ({
	placeholders: [PLACEHOLDER], current: PLACEHOLDER, value: VALUE,
	track, wholeWord: false, cutoffs,
});
type Handler = (event: Record<string, unknown>, ctx: { sessionManager?: { getSessionId?: () => string } }) => Promise<unknown>;
let dir: string;
let file: string;
let revision: number;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ompws-privacy-consumer-"));
	file = join(dir, "secrets.json");
	revision = CUTOFF;
	vi.stubEnv("OMPWS_PRIVACY_FILE", file);
	vi.resetModules();
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.resetModules();
});

function snapshot(entries: SnapshotEntry[], nativeHash: string) {
	writeFileSync(file, JSON.stringify({ entries, nativeHash }));
	const time = new Date(++revision);
	utimesSync(file, time, time);
}
async function hooks(spawnHash: string) {
	vi.stubEnv("OMPWS_PRIVACY_NATIVE_HASH", spawnHash);
	// Module loading is under test: its file path is captured from each fixture's env at import time.
	const extension = (await import("../../extension/omp-workspace-privacy")).default;
	const handlers: Record<string, Handler> = {};
	extension({ on: (name, handler) => { handlers[name] = handler; } });
	return handlers;
}

const session = { sessionManager: { getSessionId: () => "s1" } };
const history = () => [
	{ role: "tool", content: `old ${VALUE}`, timestamp: CUTOFF - 1 },
	{ role: "tool", content: `new ${VALUE}`, timestamp: CUTOFF + 1 },
];

describe("privacy extension remark contract (finding44)", () => {
	it("masks prior history after all clears the selected session cutoff", async () => {
		snapshot([entry(true, { s1: CUTOFF })], "");
		const h = await hooks("");
		const before = await h.context({ messages: history() }, session) as { messages: { content: string }[] };
		expect(before.messages.map((m) => m.content)).toEqual([`old ${VALUE}`, `new ${PLACEHOLDER}`]);
		expect(await h.session_before_compact({}, session)).toEqual({ cancel: true });
		// Rust mark(scope=all) publishes the same entry without this cutoff.
		snapshot([entry()], "covered-H");
		const after = await h.context({ messages: history() }, session) as { messages: { content: string }[] };
		expect(after.messages.map((m) => m.content)).toEqual([`old ${PLACEHOLDER}`, `new ${PLACEHOLDER}`]);
		// The live process still needs restart to load the newly native entry.
		expect(await h.session_before_compact({}, session)).toEqual({ cancel: true });
		const restarted = await hooks("covered-H");
		expect(await restarted.session_before_compact({}, session)).toBeUndefined();
	});

	it("resumes masking when a remark restores requested tracking", async () => {
		snapshot([entry(false)], "");
		const h = await hooks("");
		expect(await h.context({ messages: history() }, session)).toBeUndefined();
		snapshot([entry(true)], "covered-H");
		const result = await h.context({ messages: history() }, session) as { messages: { content: string }[] };
		expect(result.messages.map((m) => m.content)).toEqual([`old ${PLACEHOLDER}`, `new ${PLACEHOLDER}`]);
	});
});

describe("privacy extension startup coverage (finding45)", () => {
	it("rejects an unprotected spawn both before and after identical-content recovery", async () => {
		snapshot([entry()], "unprotected:H");
		const failedSpawn = await hooks("unprotected:H");
		expect(await failedSpawn.session_before_compact({}, session)).toEqual({ cancel: true });
		snapshot([entry()], "H");
		expect(await failedSpawn.session_before_compact({}, session)).toEqual({ cancel: true });
		const recoveredSpawn = await hooks("H");
		expect(await recoveredSpawn.session_before_compact({}, session)).toBeUndefined();
		// Registering a new consumer cannot upgrade the old process's captured coverage.
		expect(await failedSpawn.session_before_compact({}, session)).toEqual({ cancel: true });
	});

	it("rejects matching failed publication markers from a previously protected process", async () => {
		snapshot([entry()], "H");
		const h = await hooks("H");
		expect(await h.session_before_compact({}, session)).toBeUndefined();
		snapshot([entry()], "unprotected:H");
		expect(await h.session_before_compact({}, session)).toEqual({ cancel: true });
	});

	it("rejects native snapshots with a cutoff in any session", async () => {
		snapshot([entry(true, { another: CUTOFF })], "H");
		const h = await hooks("H");
		expect(await h.session_before_compact({}, session)).toEqual({ cancel: true });
	});

	it("cancels compaction when the privacy file disappears", async () => {
		snapshot([entry()], "H");
		const h = await hooks("H");
		unlinkSync(file);
		expect(await h.session_before_compact({}, session)).toEqual({ cancel: true });
	});

	it.each(["{", "{}", '{"nativeHash":"","entries":[{}]}'])(
		"cancels compaction for unreadable coverage metadata: %s",
		async (contents) => {
			writeFileSync(file, contents);
			const h = await hooks("");
			expect(await h.session_before_compact({}, session)).toEqual({ cancel: true });
		},
	);

	it("permits a valid empty snapshot without native tracked entries", async () => {
		snapshot([], "");
		const h = await hooks("");
		expect(await h.session_before_compact({}, session)).toBeUndefined();
	});
});
