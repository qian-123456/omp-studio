// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta, TranscriptItem } from "../../lib/contracts";
import type * as Ipc from "../../lib/ipc";
import type * as Events from "../../lib/events";
import { MessageList } from "../chat/MessageList";
import { Composer } from "../chat/Composer";
import { sideChatAnnKey, useComposer } from "../../stores/composer";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { SideChatPanel } from "./SideChatPanel";
import { useSideChatView } from "./viewStore";

const rpc = vi.hoisted(() => ({ create: vi.fn(), ask: vi.fn(), transcript: vi.fn(), send: vi.fn(), images: vi.fn() }));
vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof Ipc>()),
	createSideChat: rpc.create, sideChatAsk: rpc.ask,
	getTranscript: rpc.transcript,
	rpcSend: rpc.send,
	imageContentsFromPaths: rpc.images,
	sessionUsage: vi.fn(async () => ({ available: false, tokens: 0 })),
	sessionSnapshot: vi.fn(async () => ({})),
	listWorkspaceFiles: vi.fn(async () => []),
	listModels: vi.fn(async () => ({ models: [], source: "cli", completeness: "unverified" })),
	listSessions: vi.fn(async () => []),
	listWorkspaces: vi.fn(async () => []),
	skillsList: vi.fn(async () => ({ skills: [], extensions: [] })),
	privacySessionEntryIds: vi.fn(async () => []),
	mcpConfigList: vi.fn(async () => ({ servers: [] })),
	pluginsList: vi.fn(async () => ({ roots: [], plugins: [] })),
	privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "ok", nativeError: null })),
}));
vi.mock("../../lib/events", async (importOriginal) => ({
	...(await importOriginal<typeof Events>()),
	onPrivacyChanged: vi.fn(async () => () => {}),
}));
// Some IPC imports are reached during the live-store cycle before the partial
// module mock resolves. Keep the native transcript boundary on the same fixture.
vi.mock("@tauri-apps/api/core", () => ({
	convertFileSrc: (path: string) => path,
	invoke: vi.fn(async (command: string, args?: { sessionId?: string; fromOffset?: number; tailId?: string }) => {
		if (command === "get_transcript") return rpc.transcript(args?.sessionId, args?.fromOffset, args?.tailId);
	}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("../../stores/modelCatalog", () => ({
	useModelOptions: () => null,
	useModelCatalog: Object.assign(vi.fn(() => null), { getState: () => ({ refresh: async () => {} }) }),
}));
vi.mock("../settings/store", () => ({
	useSettings: Object.assign(
		(selector: (s: { settings: null }) => unknown) => selector({ settings: null }),
		{ getState: () => ({ settings: null }) },
	),
	ensureSettings: () => {},
}));
vi.mock("../sessions/newSession", () => ({ startNewSession: vi.fn() }));
vi.mock("../../components/ModelSelect", () => ({ ModelMenuContent: () => null }));
// Keep the actual message renderer and stores; omit only SessionView's RPC lifecycle.
vi.mock("../chat/SessionView", () => {
	return { SessionView: ({ sessionId }: { sessionId: string }) => {
		const scrollRef = createRef<HTMLDivElement>();
		return <div ref={scrollRef}><MessageList sessionId={sessionId} scrollRef={scrollRef} /></div>;
	} };
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
	return { promise, resolve, reject };
}
const meta = (id: string, extra: Partial<SessionMeta> = {}) => ({
	id, parentId: null, forkDepth: 0, title: id, status: "idle", label: "#1", ...extra,
}) as SessionMeta;

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	Element.prototype.scrollIntoView = () => {};
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
	useLive.setState({ sessions: {} });
	useComposer.setState({ annotations: {}, images: {}, files: {}, drafts: {}, sideChatDrafts: {} });
	useSideChatView.setState({ openTabs: {}, openChild: {}, pending: {}, pendingAttachments: {} });
	useSessions.setState({
		sessions: { parent: meta("parent"), child: meta("child", { parentId: "parent", forkDepth: 1, kind: "side" }) },
		load: vi.fn(async () => {}),
	});
	useUi.setState({ selectedSessionId: "parent", rightTab: "sidechat", openRightTabs: ["sidechat"] });
	rpc.create.mockReset().mockResolvedValue({ sessionId: "child" });
	rpc.ask.mockReset().mockResolvedValue(undefined);
	rpc.transcript.mockReset().mockImplementation(async (sessionId: string) => ({ sessionId, items: [], nextOffset: 0, reset: false, tailId: null }));
	rpc.send.mockReset().mockResolvedValue({});
	rpc.images.mockReset().mockImplementation(async (paths: string[]) => paths.map((path) => ({ type: "image", mimeType: "image/png", data: path })));
});
afterEach(cleanup);

describe("side chat first-message handoff", () => {
	it.each(["text", "quotes", "images", "nested"] as const)("keeps the %s first question visible through creation, early stream, hidden transcript and remount", async (kind) => {
		const tabId = useSideChatView.getState().openBlankTab("parent");
		const creation = deferred<{ sessionId: string }>();
		const acceptance = deferred<void>();
		rpc.create.mockReturnValueOnce(creation.promise);
		rpc.ask.mockImplementationOnce(() => {
			useLive.getState().reduceFrame({ sessionId: "child", frame: { type: "agent_start" } });
			return acceptance.promise;
		});
		if (kind === "text" || kind === "nested") useComposer.getState().setSideChatDraft(tabId, "visible first question");
		if (kind === "quotes") useComposer.getState().addAnnotation(sideChatAnnKey("parent"), { source: "message", text: "visible quoted source" });
		if (kind === "images") useComposer.getState().addImage(tabId, "/first.png");
		const expected = kind === "text" || kind === "nested" ? "visible first question" : kind === "quotes" ? "visible quoted source" : "请结合所附图片回答。";
		if (kind === "nested") rpc.transcript.mockResolvedValueOnce({
			sessionId: "child", nextOffset: 20, reset: false, tailId: "inherited-answer",
			items: [
				{ id: "inherited-marker", kind: "user", text: `Side chat forked from main session\n\n## User question\n\n${expected}`, hidden: true },
				{ id: "inherited-answer", kind: "assistant", text: "inherited answer" },
			],
		});
		const first = render(<SideChatPanel />);
		fireEvent.keyDown(screen.getByPlaceholderText(/输入辅助对话消息/), { key: "Enter" });
		expect(screen.getAllByText(expected, { exact: false })).toHaveLength(1);
		await act(async () => creation.resolve({ sessionId: "child" }));
		expect(screen.getAllByText(expected, { exact: false })).toHaveLength(1);
		await act(async () => acceptance.resolve());
		await waitFor(() => expect(useSideChatView.getState().openChild.parent).toBe("child"));
		expect(screen.getAllByText(expected, { exact: false })).toHaveLength(1);
		expect(document.querySelector("[data-queued-message]")).toBeNull();
		const [, question, selection] = rpc.ask.mock.calls[0]!;
		const saved: TranscriptItem = {
			id: "persisted-first", parentId: null, ts: "2026-11-06T00:00:00Z", kind: "user",
			text: [
				"Side chat forked from main session",
				...(selection ? ["## Selected text the user is asking about", `> ${selection}`, ""] : []),
				"## User question", question,
			].join("\n"),
			hidden: true, thinking: null, toolCalls: [], toolResult: null, usage: null, model: null, stopReason: null,
			images: useLive.getState().sessions.child?.pendingUserEchoes[0]?.images,
		};
		act(() => useLive.getState().setItems("child", [...(useLive.getState().sessions.child?.items ?? []), saved], 100));
		expect(screen.getAllByText(expected, { exact: false })).toHaveLength(1);
		expect(useLive.getState().sessions.child?.pendingUserEchoes).toEqual([]);
		first.unmount();
		render(<SideChatPanel />);
		expect(screen.getAllByText(expected, { exact: false })).toHaveLength(1);
		expect(screen.queryByText(/Side chat forked/)).toBeNull();
		expect(screen.queryByText("inherited answer")).toBeNull();
		if (kind === "images") expect(document.querySelector('img[src="/first.png"]')).not.toBeNull();
	});

	it.each(["text", "new-image"] as const)("does not resend the first image when the pending draft becomes a %s follow-up", async (kind) => {
		const tabId = useSideChatView.getState().openBlankTab("parent");
		useComposer.getState().addImage(tabId, "/sent.png");
		useComposer.getState().setSideChatDraft(tabId, "first 🖼️#1");
		const acceptance = deferred<void>();
		rpc.ask.mockReturnValueOnce(acceptance.promise);
		const panel = render(<SideChatPanel />);
		const blankInput = screen.getByPlaceholderText(/输入辅助对话消息/);
		fireEvent.keyDown(blankInput, { key: "Enter" });
		await waitFor(() => expect(rpc.ask).toHaveBeenCalledTimes(1));
		expect(rpc.ask.mock.calls[0]?.[4]).toEqual(["/sent.png"]);
		if (kind === "new-image") act(() => { useComposer.getState().addImage(tabId, "/newer.png"); });
		fireEvent.change(blankInput, { target: { value: kind === "text" ? "next pure text" : "next 🖼️#1 and 🖼️#2" } });
		await act(async () => acceptance.resolve());
		await waitFor(() => expect(useSideChatView.getState().openChild.parent).toBe("child"));
		panel.unmount();
		act(() => useLive.setState((state) => ({ sessions: { ...state.sessions, child: { ...emptySessionLive(), ...state.sessions.child, alive: true, commands: [] } } })));
		render(<Composer sessionId="child" />);
		const followUp = document.querySelector<HTMLTextAreaElement>('textarea[data-composer="child"]')!;
		expect(followUp.value).toBe(kind === "text" ? "next pure text" : "next and 🖼️#1");
		fireEvent.keyDown(followUp, { key: "Enter" });
		await waitFor(() => expect(rpc.send.mock.calls.some(([, command]) => command.type === "prompt")).toBe(true));
		const [, command] = rpc.send.mock.calls.find(([, value]) => value.type === "prompt")!;
		expect(command.message).not.toContain("/sent.png");
		if (kind === "text") {
			expect(command.message).toBe("next pure text");
			expect(command.images).toBeUndefined();
			expect(rpc.images).not.toHaveBeenCalled();
		} else {
			expect(command.message).toContain("[Image #1: /newer.png]");
			expect(command.images).toEqual([{ type: "image", mimeType: "image/png", data: "/newer.png" }]);
			expect(rpc.images).toHaveBeenCalledWith(["/newer.png"]);
		}
	});
});
