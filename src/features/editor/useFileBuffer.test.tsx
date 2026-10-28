// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Dialogs from "../../lib/dialogs";

const readTextFile = vi.fn<(path: string) => Promise<string>>();
const writeTextFile = vi.fn<(path: string, content: string, expectedContent?: string) => Promise<void>>();
const confirmDialog = vi.fn<() => Promise<boolean>>();
vi.mock("../../lib/ipc", () => ({
	readTextFile: (path: string) => readTextFile(path),
	writeTextFile: (path: string, content: string, expectedContent?: string) => writeTextFile(path, content, expectedContent),
}));
vi.mock("../../lib/dialogs", async (original) => ({
	...await original<typeof Dialogs>(),
	confirmDialog: () => confirmDialog(),
}));

import { useFileBuffer } from "./useFileBuffer";

function deferred<T>() {
	// The project's ES2021 lib predates Promise.withResolvers.
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

beforeEach(() => {
	readTextFile.mockReset().mockResolvedValue("original");
	writeTextFile.mockReset().mockResolvedValue(undefined);
	confirmDialog.mockReset().mockResolvedValue(false);
});
afterEach(cleanup);

describe("shared file buffer loss and conflict guards", () => {
	it("shares the same path between the center and preview consumers", async () => {
		const first = renderHook(() => useFileBuffer("/shared-view.md"));
		const second = renderHook(() => useFileBuffer("/shared-view.md"));
		await waitFor(() => expect(first.result.current.saved).toBe("original"));
		act(() => first.result.current.setDraft("shared draft"));
		expect(second.result.current.draft).toBe("shared draft");
		expect(second.result.current.dirty).toBe(true);
		await act(async () => { await second.result.current.save(); });
		expect(first.result.current.saved).toBe("shared draft");
		expect(first.result.current.dirty).toBe(false);
		expect(writeTextFile).toHaveBeenCalledWith("/shared-view.md", "shared draft", "original");
	});

	it("retains dirty state across unmount and verifies disk on reopening", async () => {
		const first = renderHook(() => useFileBuffer("/retained-draft.md"));
		await waitFor(() => expect(first.result.current.saved).toBe("original"));
		act(() => first.result.current.setDraft("unsaved"));
		first.unmount();
		readTextFile.mockResolvedValue("external edit");
		const reopened = renderHook(() => useFileBuffer("/retained-draft.md"));
		await waitFor(() => expect(reopened.result.current.external).toBe(true));
		expect(reopened.result.current.draft).toBe("unsaved");
		expect(reopened.result.current.saved).toBe("original");
		expect(reopened.result.current.dirty).toBe(true);
	});

	it("reloads a closed clean file rather than retaining stale cached text", async () => {
		const first = renderHook(() => useFileBuffer("/released-clean.md"));
		await waitFor(() => expect(first.result.current.saved).toBe("original"));
		first.unmount();
		await act(async () => { await Promise.resolve(); });
		readTextFile.mockResolvedValue("new disk text");
		const second = renderHook(() => useFileBuffer("/released-clean.md"));
		await waitFor(() => expect(second.result.current.draft).toBe("new disk text"));
		expect(second.result.current.dirty).toBe(false);
	});

	it("requires reload confirmation and cancellation preserves the draft", async () => {
		const { result } = renderHook(() => useFileBuffer("/cancel-reload.md"));
		await waitFor(() => expect(result.current.saved).toBe("original"));
		act(() => result.current.setDraft("draft"));
		await act(async () => { await result.current.reload(); });
		expect(confirmDialog).toHaveBeenCalledOnce();
		expect(readTextFile).toHaveBeenCalledTimes(1);
		expect(result.current.draft).toBe("draft");
		expect(result.current.dirty).toBe(true);
	});

	it("reloads after explicit confirmation without clearing the draft on read failure", async () => {
		const { result } = renderHook(() => useFileBuffer("/confirm-reload.md"));
		await waitFor(() => expect(result.current.saved).toBe("original"));
		act(() => result.current.setDraft("draft"));
		confirmDialog.mockResolvedValue(true);
		readTextFile.mockRejectedValueOnce(new Error("read denied"));
		await act(async () => { await result.current.reload(); });
		expect(result.current.draft).toBe("draft");
		expect(result.current.saved).toBe("original");
		expect(result.current.error).toBe("read denied");
		readTextFile.mockResolvedValue("disk replacement");
		await act(async () => { await result.current.reload(); });
		expect(result.current.draft).toBe("disk replacement");
		expect(result.current.dirty).toBe(false);
		expect(result.current.error).toBeNull();
	});

	it("does not apply confirmation to edits typed after the dialog opened", async () => {
		const { result } = renderHook(() => useFileBuffer("/dialog-race.md"));
		await waitFor(() => expect(result.current.saved).toBe("original"));
		act(() => result.current.setDraft("first draft"));
		const confirmation = deferred<boolean>();
		confirmDialog.mockReturnValue(confirmation.promise);
		let reload!: Promise<void>;
		act(() => { reload = result.current.reload(); });
		act(() => result.current.setDraft("newer draft"));
		await act(async () => { confirmation.resolve(true); await reload; });
		expect(result.current.draft).toBe("newer draft");
		expect(readTextFile).toHaveBeenCalledTimes(1);
	});

	it("preserves typing while an approved reload is reading", async () => {
		const { result } = renderHook(() => useFileBuffer("/reload-read-race.md"));
		await waitFor(() => expect(result.current.saved).toBe("original"));
		act(() => result.current.setDraft("first draft"));
		confirmDialog.mockResolvedValue(true);
		const read = deferred<string>();
		readTextFile.mockReturnValueOnce(read.promise);
		let reload!: Promise<void>;
		await act(async () => { reload = result.current.reload(); await Promise.resolve(); });
		act(() => result.current.setDraft("new input"));
		await act(async () => { read.resolve("external text"); await reload; });
		expect(result.current.draft).toBe("new input");
		expect(result.current.saved).toBe("original");
		expect(result.current.external).toBe(true);
	});

	it("keeps input typed after a clean focus refresh started (finding 20)", async () => {
		const { result } = renderHook(() => useFileBuffer("/focus-race.md"));
		await waitFor(() => expect(result.current.saved).toBe("original"));
		const read = deferred<string>();
		readTextFile.mockReturnValueOnce(read.promise);
		act(() => window.dispatchEvent(new Event("focus")));
		act(() => result.current.setDraft("just typed"));
		await act(async () => { read.resolve("agent edit"); await read.promise; });
		expect(result.current.draft).toBe("just typed");
		expect(result.current.saved).toBe("original");
		expect(result.current.external).toBe(true);
		expect(result.current.dirty).toBe(true);
	});

	it("refreshes clean buffers silently", async () => {
		const { result } = renderHook(() => useFileBuffer("/focus-clean.md"));
		await waitFor(() => expect(result.current.saved).toBe("original"));
		readTextFile.mockResolvedValue("updated");
		act(() => window.dispatchEvent(new Event("focus")));
		await waitFor(() => expect(result.current.draft).toBe("updated"));
		expect(result.current.dirty).toBe(false);
	});

	it("rejects unseen disk changes without dropping the draft (finding 19)", async () => {
		const { result } = renderHook(() => useFileBuffer("/save-conflict.md"));
		await waitFor(() => expect(result.current.saved).toBe("original"));
		act(() => result.current.setDraft("my edit"));
		writeTextFile.mockRejectedValue(new Error("CONFLICT: disk changed"));
		let saved = true;
		await act(async () => { saved = await result.current.save(); });
		expect(saved).toBe(false);
		expect(writeTextFile).toHaveBeenCalledWith("/save-conflict.md", "my edit", "original");
		expect(result.current.draft).toBe("my edit");
		expect(result.current.saved).toBe("original");
		expect(result.current.external).toBe(true);
		expect(result.current.dirty).toBe(true);
		act(() => result.current.dismissExternal());
		expect(result.current.external).toBe(false);
		await act(async () => { await result.current.save(); });
		expect(writeTextFile).toHaveBeenLastCalledWith("/save-conflict.md", "my edit", "original");
	});

	it("saves one snapshot while preserving concurrent typing and prevents duplicate saves", async () => {
		const { result } = renderHook(() => useFileBuffer("/save-typing.md"));
		await waitFor(() => expect(result.current.saved).toBe("original"));
		act(() => result.current.setDraft("submitted"));
		const write = deferred<void>();
		writeTextFile.mockReturnValueOnce(write.promise);
		let save!: Promise<boolean>;
		act(() => { save = result.current.save(); });
		await act(async () => { expect(await result.current.save()).toBe(false); });
		act(() => result.current.setDraft("typed during save"));
		await act(async () => { write.resolve(undefined); await save; });
		expect(writeTextFile).toHaveBeenCalledTimes(1);
		expect(result.current.saved).toBe("submitted");
		expect(result.current.draft).toBe("typed during save");
		expect(result.current.dirty).toBe(true);
	});

	it("ignores a stale focus response after saving", async () => {
		const { result } = renderHook(() => useFileBuffer("/focus-save-race.md"));
		await waitFor(() => expect(result.current.saved).toBe("original"));
		const read = deferred<string>();
		readTextFile.mockReturnValueOnce(read.promise);
		act(() => window.dispatchEvent(new Event("focus")));
		act(() => result.current.setDraft("saved now"));
		await act(async () => { await result.current.save(); });
		await act(async () => { read.resolve("original"); await read.promise; });
		expect(result.current.saved).toBe("saved now");
		expect(result.current.draft).toBe("saved now");
		expect(result.current.external).toBe(false);
	});

	it("isolates a delayed read after the consumer changes paths", async () => {
		const read = deferred<string>();
		readTextFile.mockImplementation((path) => path === "/old-path.md" ? read.promise : Promise.resolve("new file"));
		const { result, rerender } = renderHook(({ path }) => useFileBuffer(path), { initialProps: { path: "/old-path.md" } });
		rerender({ path: "/new-path.md" });
		await waitFor(() => expect(result.current.draft).toBe("new file"));
		await act(async () => { read.resolve("old file"); await read.promise; });
		expect(result.current.draft).toBe("new file");
	});
});
