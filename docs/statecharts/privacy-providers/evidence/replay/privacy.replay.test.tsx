// @vitest-environment jsdom
// Replays for the privacy-providers statechart audit. Mocks only external I/O boundaries (Tauri IPC).
// SYNTHETIC secrets only.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const REPO = "<repo>";
const ipc = vi.hoisted(() => ({
	privacyClassify: vi.fn(),
	privacyMark: vi.fn(),
}));
vi.mock("<repo>/src/lib/ipc", () => ipc);

import { MarkSecretPopover } from "<repo>/src/features/chat/privacy/MarkSecretPopover";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(cleanup);

const VALUE = "synthetic-secret-value-0001";
const entry = {
	id: "e1", value: VALUE, label: null, placeholder: "⟦SECRET_ab12⟧", aliases: [], risk: "safe", track: true,
	inLibrary: false, libraryPrompted: false, createdAt: "2026-01-01T00:00:00Z", sessionCount: 1,
};

type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
async function loadExtension(file: string, nativeHash: string) {
	process.env.OMPWS_PRIVACY_FILE = file;
	process.env.OMPWS_PRIVACY_NATIVE_HASH = nativeHash;
	vi.resetModules();
	const mod = (await import(`${REPO}/extension/omp-workspace-privacy.ts`)) as {
		default: (pi: { on: (n: string, h: Handler) => void }) => void;
	};
	const handlers: Record<string, Handler> = {};
	mod.default({ on: (n, h) => { handlers[n] = h; } });
	return handlers;
}
function writeSecrets(entries: unknown[], nativeHash: string) {
	const dir = mkdtempSync(join(tmpdir(), "privacy-replay-"));
	const file = join(dir, "secrets.json");
	writeFileSync(file, JSON.stringify({ nativeHash, entries }));
	return file;
}

describe("PrivacyScope: 同时替换旧历史 after 仅保护后续内容", () => {
	it("popover sends scope=all but the real extension still leaves pre-cutoff messages unmasked", async () => {
		// Step 1-2 of bug-1: the user first chose future-only; the backend (store.rs link_session) recorded cutoff T.
		const T = 1_800_000_000_000;
		ipc.privacyClassify.mockResolvedValue({ level: "safe", reason: null, sessionOccurrences: 2 });
		ipc.privacyMark.mockResolvedValue(entry);
		const onMarked = vi.fn();
		render(<MarkSecretPopover sessionId="s1" value={VALUE} anchor={{ x: 10, y: 10 }} onMarked={onMarked} onClose={() => {}} />);
		// Step 3-4: second mark; popover offers 同时替换旧历史 because the transcript still holds the value.
		const btn = await screen.findByRole("button", { name: "同时替换旧历史" });
		fireEvent.click(btn);
		await waitFor(() => expect(onMarked).toHaveBeenCalled());
		expect(ipc.privacyMark).toHaveBeenCalledWith("s1", VALUE, null, true, "all");
		expect(onMarked.mock.calls[0][1]).toBe("all");

		// The backend's answer to scope=all for an existing future link is the unchanged cutoff
		// (src-tauri/src/privacy/store.rs test `future_scope_records_cutoff_once_and_all_never_clears` asserts this),
		// so secrets.json keeps cutoffs {s1: T}. Feed that file to the REAL extension.
		const file = writeSecrets([{ placeholders: ["⟦SECRET_ab12⟧"], current: "⟦SECRET_ab12⟧", value: VALUE, track: true, wholeWord: false, cutoffs: { s1: T } }], "");
		const h = await loadExtension(file, "");
		const messages = [
			{ role: "tool", content: `old output ${VALUE}`, timestamp: T - 1000 },
			{ role: "tool", content: `new output ${VALUE}`, timestamp: T + 1000 },
		];
		const out = (await h.context({ messages }, { sessionManager: { getSessionId: () => "s1" } })) as { messages: { content: string }[] };
		expect(out.messages[1].content).not.toContain(VALUE); // after cutoff: masked
		// REPRODUCTION EVIDENCE: this assertion states the observed (undesired) behavior.
		expect(out.messages[0].content).toContain(VALUE); // before cutoff: real value goes upstream although 替换旧历史 was clicked
	});

	it("untracked entry: a second mark with tracking on still produces no masking in the real extension", async () => {
		ipc.privacyClassify.mockResolvedValue({ level: "safe", reason: null, sessionOccurrences: 0 });
		ipc.privacyMark.mockResolvedValue({ ...entry, track: false });
		const onMarked = vi.fn();
		render(<MarkSecretPopover sessionId="s1" value={VALUE} anchor={{ x: 10, y: 10 }} onMarked={onMarked} onClose={() => {}} />);
		fireEvent.keyDown(await screen.findByRole("textbox"), { key: "Enter" });
		await waitFor(() => expect(onMarked).toHaveBeenCalled());
		// the popover requested track=true, the backend answered with the stored track=false entry
		expect(ipc.privacyMark).toHaveBeenCalledWith("s1", VALUE, null, true, "all");
		expect(onMarked.mock.calls[0][0].track).toBe(false);
		const file = writeSecrets([{ placeholders: ["⟦SECRET_ab12⟧"], current: "⟦SECRET_ab12⟧", value: VALUE, track: false, wholeWord: false }], "");
		const h = await loadExtension(file, "");
		const out = await h.context({ messages: [{ role: "tool", content: VALUE, timestamp: 1 }] }, { sessionManager: { getSessionId: () => "s1" } });
		expect(out).toBeUndefined(); // nothing masked: real value reaches upstream
	});
});

describe("PrivacyNative: extension compaction gate", () => {
	it("allows compaction when file hash equals process hash, whether or not the process loaded the block", async () => {
		// File written after the write recovered: plain hash H. Process was spawned with env H (code: spawn_env uses NATIVE.hash regardless of status).
		const file = writeSecrets([{ placeholders: ["⟦SECRET_ab12⟧"], current: "⟦SECRET_ab12⟧", value: VALUE, track: true, wholeWord: false }], "H1");
		const h = await loadExtension(file, "H1");
		expect(await h.session_before_compact({}, {})).toBeUndefined(); // compaction allowed; extension cannot see what OMP loaded
		// And the fail-closed side works: an "unprotected:" hash cancels compaction.
		const bad = writeSecrets([{ placeholders: ["⟦SECRET_ab12⟧"], current: "⟦SECRET_ab12⟧", value: VALUE, track: true, wholeWord: false }], "unprotected:H1");
		const h2 = await loadExtension(bad, "H1");
		expect(await h2.session_before_compact({}, {})).toEqual({ cancel: true });
	});
});
