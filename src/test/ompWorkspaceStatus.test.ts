// @vitest-environment node
import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import statusExtension from "../../extension/omp-workspace-status";

const storage = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("node:fs", () => ({
	mkdirSync: vi.fn(),
	writeFileSync: (path: string, body: string) => storage.files.set(path, body),
	renameSync: (from: string, to: string) => {
		storage.files.set(to, storage.files.get(from)!);
		storage.files.delete(from);
	},
}));
vi.mock("node:os", () => ({ homedir: () => "/isolated-home" }));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "Thu Oct 29 08:00:00 2026\n") }));

type Api = Parameters<typeof statusExtension>[0];
type Handler = Parameters<Api["on"]>[1];
function fixture() {
	const handlers = new Map<string, Handler>();
	statusExtension({ on: (event, handler) => void handlers.set(event, handler) });
	return {
		fire(event: string, id: string, file?: string) {
			handlers.get(event)!({}, { sessionManager: { getSessionId: () => id, getSessionFile: () => file } });
		},
		read(id: string) {
			return JSON.parse(storage.files.get(`/isolated-home/.omp-workspace/status/${id}.json`)!);
		},
	};
}

beforeEach(() => storage.files.clear());
describe("status extension registered handlers", () => {
	it("samples process birth once at module load, not on status writes", () => {
		const samples = vi.mocked(execFileSync).mock.calls.length;
		expect(samples).toBe(1);
		for (const id of ["one", "two"]) {
			const f = fixture();
			f.fire("session_start", id, `/sessions/${id}.jsonl`);
			f.fire("agent_start", id);
			f.fire("agent_end", id);
			f.fire("session_shutdown", id);
		}
		expect(execFileSync).toHaveBeenCalledTimes(samples);
	});
	it("switch to fileless session never reuses previous sessionFile", () => {
		const f = fixture();
		f.fire("session_start", "old", "/sessions/old.jsonl");
		f.fire("session_switch", "new");
		expect(f.read("old")).toMatchObject({ state: "exited", sessionFile: "/sessions/old.jsonl" });
		expect(f.read("new")).toMatchObject({ state: "idle", sessionFile: null });
		f.fire("agent_start", "new");
		expect(f.read("new").sessionFile).toBeNull();
	});
	it("same-session partial context preserves its own file and birth identity", () => {
		const f = fixture();
		f.fire("session_start", "same", "/sessions/same.jsonl");
		f.fire("agent_start", "same");
		expect(f.read("same")).toMatchObject({ sessionFile: "/sessions/same.jsonl", state: "working", pid: process.pid, processStartedAt: "Thu Oct 29 08:00:00 2026" });
		f.fire("session_shutdown", "same");
		expect(f.read("same").state).toBe("exited");
	});
});
