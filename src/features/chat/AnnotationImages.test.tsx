// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ClipboardEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	open: vi.fn(),
	saveClipboardImage: vi.fn(async () => "/clip/pasted.png"),
	importImageFile: vi.fn(async (p: string) => `/clip/${p.split("/").pop()}`),
	clipboardFilePaths: vi.fn(async () => [] as string[]),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: m.open }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("../../lib/ipc", () => ({
	saveClipboardImage: m.saveClipboardImage,
	importImageFile: m.importImageFile,
	clipboardFilePaths: m.clipboardFilePaths,
}));
vi.mock("../../lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { useAnnotationImages } from "./AnnotationImages";

/** A minimal clipboard event typed as the hook's real parameter, with its preventDefault spy exposed. */
const pasteEvent = (files: File[], types = ["Files"]) => {
	const preventDefault = vi.fn();
	const event = {
		preventDefault,
		clipboardData: {
			types,
			items: files.map((f) => ({ kind: "file", getAsFile: () => f })),
		},
	} as unknown as ClipboardEvent<HTMLElement>;
	return { event, preventDefault };
};

beforeEach(() => vi.clearAllMocks());

describe("useAnnotationImages", () => {
	it("pastes a screenshot blob, saves it and appends the stored path", async () => {
		const onChange = vi.fn();
		const { result } = renderHook(() => useAnnotationImages([], onChange));
		const { event, preventDefault } = pasteEvent([new File(["x"], "s.png", { type: "image/png" })]);
		// The handler is fire-and-forget (FileReader resolves on a real task), so wait for its outcome.
		act(() => result.current.onPaste(event));
		expect(preventDefault).toHaveBeenCalled();
		await waitFor(() => expect(onChange).toHaveBeenCalledWith(["/clip/pasted.png"]));
		expect(m.saveClipboardImage).toHaveBeenCalledOnce();
	});

	it("leaves plain-text paste alone", () => {
		const onChange = vi.fn();
		const { result } = renderHook(() => useAnnotationImages([], onChange));
		const { event, preventDefault } = pasteEvent([], ["text/plain"]);
		result.current.onPaste(event);
		expect(preventDefault).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("uses Finder-copied image paths via import", async () => {
		m.clipboardFilePaths.mockResolvedValueOnce(["/Users/u/a.jpg"]);
		const onChange = vi.fn();
		const { result } = renderHook(() => useAnnotationImages([], onChange));
		act(() => result.current.onPaste(pasteEvent([]).event));
		await waitFor(() => expect(onChange).toHaveBeenCalledWith(["/clip/a.jpg"]));
		expect(m.importImageFile).toHaveBeenCalledWith("/Users/u/a.jpg");
	});

	it("picks files, dedupes and removes", async () => {
		m.open.mockResolvedValueOnce(["/x/b.png", "/x/b.png"]);
		const onChange = vi.fn();
		const { result, rerender } = renderHook(
			({ p }: { p: string[] }) => useAnnotationImages(p, onChange),
			{ initialProps: { p: ["/clip/old.png"] } },
		);
		act(() => result.current.pick());
		await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(["/clip/old.png", "/clip/b.png"]));
		rerender({ p: ["/clip/old.png", "/clip/b.png"] });
		act(() => result.current.remove("/clip/old.png"));
		expect(onChange).toHaveBeenLastCalledWith(["/clip/b.png"]);
	});
});
