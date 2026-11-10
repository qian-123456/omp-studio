// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PathCheck, TranscriptItem } from "../../lib/contracts";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));
vi.mock("./imageTokens", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	getImageTokenPalette: () => ({ hex: "#888" }),
}));
vi.mock("../../lib/ipc", () => ({
	validatePath: vi.fn(async (): Promise<PathCheck> => ({ exists: true, isDir: false, size: 2048 })),
	rpcSend: vi.fn(async (_sessionId: string, command: { type: string }) =>
		command.type === "get_entries" ? { data: { entries: [], leafId: null } } : {}),
	privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "ok", nativeError: null })),
	imageContentsFromPaths: vi.fn(async () => [{ type: "image", mimeType: "image/png", data: "fixture-image-bytes" }]),
	treeNavigate: vi.fn(async () => ({ cancelled: false, editorText: "" })),
	getTranscript: vi.fn(async () => ({ sessionId: "s1", items: [], nextOffset: 0, reset: true, tailId: null })),
}));
vi.mock("../../lib/ensureLive", () => ({
	ensureLive: vi.fn(async () => useLive.setState({ sessions: { s1: { ...emptySessionLive(), alive: true } } })),
	isResumeCancelled: () => false,
}));
vi.mock("../../lib/events", () => ({
	onPrivacyChanged: vi.fn(async () => () => {}),
}));
vi.mock("../privacy/SecretChip", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	PrivacyText: ({ text }: { text: string }) => <>{text}</>,
}));
vi.mock("../../lib/toast", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));
vi.mock("../../lib/dialogs", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	confirmDialog: vi.fn(async () => true),
}));

import { UserRow } from "./MessageList";
import { imageContentsFromPaths, rpcSend, treeNavigate } from "../../lib/ipc";
import { ensureLive } from "../../lib/ensureLive";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useTree } from "../../stores/tree";
import { useTreeEditPending } from "./treeNav";
import { clearEditDraft } from "./editDrafts";

let heights = { scroll: 40, client: 40 };

beforeEach(() => {
	vi.clearAllMocks();
	useLive.setState({ sessions: { s1: { ...emptySessionLive(), alive: true } } });
	useSessions.setState({ sessions: {} });
	useTree.setState({ leaf: {}, resend: {} });
	useTreeEditPending.setState({ entries: {} });
	useComposer.setState({ drafts: {}, images: {}, files: {}, annotations: {} });
	clearEditDraft("u1");
	heights = { scroll: 40, client: 40 };
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
		configurable: true,
		get: () => heights.scroll,
	});
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => heights.client,
	});
	const originalGetComputedStyle = window.getComputedStyle.bind(window);
	vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
		const style = originalGetComputedStyle(el, pseudo);
		return new Proxy(style, {
			get(target, prop) {
				if (prop === "lineHeight") return "20px";
				if (prop === "fontSize") return "14px";
				const val = Reflect.get(target, prop);
				return typeof val === "function" ? val.bind(target) : val;
			},
		});
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const userItem = (text: string): TranscriptItem => ({
	id: "u1",
	parentId: null,
	ts: "2026-10-27T12:00:00.000Z",
	kind: "user",
	text,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
});

describe("UserRow long message inline disclosure", () => {
	it("renders user message without disclosure control when text fits in 4 lines", () => {
		heights = { scroll: 60, client: 60 };
		render(<UserRow sessionId="s1" item={userItem("Short question")} />);

		expect(screen.getByText("Short question")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /查看更多|view more/i })).toBeNull();
	});

	it("renders ChatGPT-like inline disclosure (not a heavy capsule) and toggles expansion", () => {
		// 160px scrollHeight > 20px * (4 + 0.5) = 90px -> triggers overflow
		heights = { scroll: 160, client: 80 };
		const longText = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6";
		const { container } = render(<UserRow sessionId="s1" item={userItem(longText)} />);

		// Clamped initially
		const textEl = container.querySelector(".line-clamp-4");
		expect(textEl).toBeTruthy();
		expect(textEl?.textContent).toContain("Line 1");

		// Control is rendered
		const toggleBtn = screen.getByRole("button", { name: /查看更多|view more/i });
		expect(toggleBtn).toBeTruthy();
		expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");

		// Must NOT have the awkward capsule classes: rounded-full border border-[var(--line)] px-2.5 py-0.5
		expect(toggleBtn.className).not.toContain("rounded-full");
		expect(toggleBtn.className).not.toContain("border");
		expect(toggleBtn.className).not.toContain("px-2.5");

		// Must have integrated inline disclosure styling
		expect(toggleBtn.className).toContain("inline-flex");
		expect(toggleBtn.className).toContain("items-center");

		// Click to expand
		act(() => {
			fireEvent.click(toggleBtn);
		});

		// Now expanded
		expect(container.querySelector(".line-clamp-4")).toBeNull();
		const collapseBtn = screen.getByRole("button", { name: /收起|collapse/i });
		expect(collapseBtn).toBeTruthy();
		expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");

		// Click to collapse again
		act(() => {
			fireEvent.click(collapseBtn);
		});

		// Collapsed again
		expect(container.querySelector(".line-clamp-4")).toBeTruthy();
		expect(screen.getByRole("button", { name: /查看更多|view more/i })).toBeTruthy();
	});
});

describe("UserRow cold message edit", () => {
	it("wakes on pencil click, restores the sent text and releases pending without sending a prompt", async () => {
		vi.clearAllMocks();
		useLive.setState({ sessions: { s1: emptySessionLive() } });
		useSessions.setState({ sessions: {} });
		useTree.setState({ leaf: {}, resend: {} });
		useTreeEditPending.setState({ entries: {} });
		useComposer.setState({ drafts: {} });
		const original = "修改这条已经发送的消息\n保留第二行";
		render(<UserRow sessionId="s1" item={userItem(original)} />);

		fireEvent.click(screen.getByRole("button", { name: /编辑并重新发送|Edit and resend/ }));
		expect(ensureLive).toHaveBeenCalledWith("s1");
		expect(useTreeEditPending.getState().entries.s1).toBe("u1");
		await waitFor(() => expect(useComposer.getState().drafts.s1).toBe(original));

		expect(treeNavigate).toHaveBeenCalledWith("s1", "u1");
		expect(useTree.getState().resend.s1).toEqual({ entryId: "u1", prevLeafId: null });
		expect(useTreeEditPending.getState().entries.s1).toBeUndefined();
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(rpcSend).not.toHaveBeenCalledWith("s1", expect.objectContaining({ type: "prompt" }));
	});
});

describe("UserRow original attachment replay", () => {
	const image = { id: "blob-1", path: "/blobs/one.png", marker: "[Image #1]", width: 640, height: 480 };
	const cases = [
		{ name: "image only", text: "[Image #1]" },
		{ name: "image and file without prose", text: "[Image #1] [File #1: /files/report.pdf]" },
	] as const;

	it.each(cases)("resends $name through the real image conversion and prompt wire path", async ({ text }) => {
		render(<UserRow sessionId="s1" item={{ ...userItem(text), images: [image] }} />);
		fireEvent.click(screen.getByRole("button", { name: /重新发送此消息|Resend this message/ }));
		await waitFor(() => expect(rpcSend).toHaveBeenCalledWith("s1", {
			type: "prompt", message: text,
			images: [{ type: "image", mimeType: "image/png", data: "fixture-image-bytes" }],
		}));
		expect(imageContentsFromPaths).toHaveBeenCalledWith(["/blobs/one.png"]);
		expect(useLive.getState().sessions.s1.pendingUserEchoes[0].images).toEqual([image]);
	});

	it.each(cases)("wakes a suspended session and preserves $name in the shared composer", async ({ text }) => {
		useLive.setState({ sessions: { s1: emptySessionLive() } });
		render(<UserRow sessionId="s1" item={{ ...userItem(text), images: [image] }} />);
		fireEvent.click(screen.getByRole("button", { name: /编辑并重新发送|Edit and resend/ }));
		const hasFile = text.includes("[File");
		await waitFor(() => expect(useComposer.getState().drafts.s1).toBe(hasFile ? "🖼️#1 📎#1" : "🖼️#1"));
		expect(ensureLive).toHaveBeenCalledWith("s1");
		expect(treeNavigate).toHaveBeenCalledWith("s1", "u1");
		expect(useComposer.getState().images.s1).toEqual([{ id: image.id, path: image.path, width: 640, height: 480 }]);
		expect(useComposer.getState().files.s1).toEqual(hasFile ? [{ id: "replay-file-1", path: "/files/report.pdf" }] : []);
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(useTreeEditPending.getState().entries.s1).toBeUndefined();
	});

	it.each(cases)("restores $name into real composer stores after live tree edit", async ({ text }) => {
		render(<UserRow sessionId="s1" item={{ ...userItem(text), images: [image] }} />);
		fireEvent.click(screen.getByRole("button", { name: /编辑并重新发送|Edit and resend/ }));
		const hasFile = text.includes("[File");
		await waitFor(() => expect(useComposer.getState().drafts.s1).toBe(hasFile ? "🖼️#1 📎#1" : "🖼️#1"));
		expect(treeNavigate).toHaveBeenCalledWith("s1", "u1");
		expect(useComposer.getState().images.s1).toEqual([{ id: image.id, path: image.path, width: 640, height: 480 }]);
		expect(useComposer.getState().files.s1).toEqual(hasFile ? [{ id: "replay-file-1", path: "/files/report.pdf" }] : []);
		expect(useTree.getState().resend.s1).toEqual({ entryId: "u1", prevLeafId: null });
		expect(rpcSend).not.toHaveBeenCalledWith("s1", expect.objectContaining({ type: "prompt" }));
	});

	it("keeps an unavailable historical image visible without fabricating a path or bytes on replay", async () => {
		const missing = { id: "missing", path: null, marker: "[Image #1]" };
		const { container } = render(<UserRow sessionId="s1" item={{ ...userItem("[Image #1]"), images: [missing] }} />);
		expect(screen.getByText(/（附件）|\(Attachment\)/)).toBeTruthy();
		expect(container.querySelector("img")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /重新发送此消息|Resend this message/ }));
		await waitFor(() => expect(rpcSend).toHaveBeenCalledWith("s1", { type: "prompt", message: "[Image #1]" }));
		expect(imageContentsFromPaths).not.toHaveBeenCalled();
		expect(useLive.getState().sessions.s1.pendingUserEchoes[0].images).toEqual([missing]);
	});

	it("resends a structured image-only message even when its original text is empty", async () => {
		render(<UserRow sessionId="s1" item={{ ...userItem(""), images: [image] }} />);
		fireEvent.click(screen.getByRole("button", { name: /重新发送此消息|Resend this message/ }));
		await waitFor(() => expect(rpcSend).toHaveBeenCalledWith("s1", {
			type: "prompt", message: "[Image #1]",
			images: [{ type: "image", mimeType: "image/png", data: "fixture-image-bytes" }],
		}));
		expect(imageContentsFromPaths).toHaveBeenCalledWith(["/blobs/one.png"]);
	});

	it("does not bind an unavailable image slot to a different real attachment during live edit", async () => {
		const missing = { id: "missing", path: null, marker: "[Image #1]" };
		const available = { ...image, marker: "[Image #2]" };
		render(<UserRow sessionId="s1" item={{ ...userItem("[Image #1] [Image #2]"), images: [missing, available] }} />);
		fireEvent.click(screen.getByRole("button", { name: /编辑并重新发送|Edit and resend/ }));
		await waitFor(() => expect(useComposer.getState().drafts.s1).toMatch(/^(?:（附件）|\(Attachment\)) 🖼️#1$/));
		expect(useComposer.getState().images.s1).toEqual([{ id: image.id, path: image.path, width: 640, height: 480 }]);
	});
});
