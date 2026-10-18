// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Ipc from "../../lib/ipc";
import type { SessionMeta } from "../../lib/contracts";
import { sideChatAnnKey, useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { SideChatPanel } from "./SideChatPanel";
import { useSideChatView } from "./viewStore";

const h = vi.hoisted(() => ({
	createSideChat: vi.fn(),
	sideChatAsk: vi.fn(),
	addUserEcho: vi.fn(),
}));
vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof Ipc>()),
	createSideChat: h.createSideChat,
	sideChatAsk: h.sideChatAsk,
	getTranscript: vi.fn(async () => ({ items: [] })),
	acceptSession: vi.fn(async () => undefined),
}));
vi.mock("../../stores/live", () => ({
	useLive: Object.assign(
		(selector: (s: { sessions: Record<string, never>; scrollToItem: () => void }) => unknown) =>
			selector({ sessions: {}, scrollToItem: () => {} }),
		{ getState: () => ({ sessions: {}, addUserEcho: h.addUserEcho }) },
	),
}));
vi.mock("../../stores/modelCatalog", () => ({
	useModelOptions: () => null,
	useModelCatalog: Object.assign(vi.fn(() => null), {
		getState: () => ({ refresh: () => Promise.resolve() }),
	}),
}));
vi.mock("../settings/store", () => ({
	useSettings: (selector: (s: { settings: null }) => unknown) =>
		selector({ settings: null }),
	ensureSettings: () => {},
}));
vi.mock("../sessions/newSession", () => ({ startNewSession: vi.fn() }));
vi.mock("../chat/SessionView", () => ({
	SessionView: ({ sessionId }: { sessionId: string }) => <div data-testid="child-view">{sessionId}</div>,
}));
vi.mock("../../components/ModelSelect", () => ({
	ModelMenuContent: () => <div data-testid="model-menu" />,
}));
vi.mock("../../lib/dialogs", () => ({
	confirmDialog: vi.fn(async () => true),
	errMsg: (e: unknown) => String(e),
}));

const meta = (id: string, extra: Partial<SessionMeta> = {}): SessionMeta =>
	({
		id,
		parentId: null,
		forkDepth: 0,
		label: "#1",
		title: "parent",
		status: "idle",
		...extra,
	}) as unknown as SessionMeta;

const seedAnnotation = (parentId: string, text = "引用的文本") => {
	useComposer.getState().addAnnotation(sideChatAnnKey(parentId), {
		source: "message",
		text,
		itemId: "m1",
		comment: "批注内容",
	});
};

const input = () => screen.getByPlaceholderText(/输入侧聊消息/);

const typeAndSend = (text: string) => {
	fireEvent.change(input(), { target: { value: text } });
	fireEvent.keyDown(input(), { key: "Enter" });
};

let blankId = "";

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
});

beforeEach(() => {
	localStorage.clear();
	h.createSideChat.mockReset().mockResolvedValue({ sessionId: "child-new" });
	h.sideChatAsk.mockReset().mockResolvedValue(undefined);
	h.addUserEcho.mockReset();
	useComposer.setState({
		annotations: {},
		sideChatDrafts: {},
		focusNonce: {},
	});
	useSessions.setState({
		sessions: { p1: meta("p1"), "child-new": meta("child-new", { parentId: "p1", forkDepth: 1, kind: "side" }) },
		load: vi.fn(async () => {}),
	});
	useSideChatView.setState({ openChild: {}, openTabs: {}, pending: {} });
	useUi.setState({ selectedSessionId: "p1", rightTab: "sidechat", openRightTabs: ["sidechat"] });
	blankId = useSideChatView.getState().openBlankTab("p1");
});

afterEach(cleanup);

describe("SideChatPanel blank new chat", () => {
	it("keeps staged annotations and focuses the composer on mount", async () => {
		seedAnnotation("p1");
		// Simulates SelectionToolbar staging while the tab was closed.
		useComposer.getState().focusComposer(sideChatAnnKey("p1"));

		render(<SideChatPanel />);

		expect(useComposer.getState().annotations[sideChatAnnKey("p1")]).toHaveLength(1);
		expect(screen.getByText("1 条批注")).toBeTruthy();
		await waitFor(() => {
			expect(document.activeElement?.tagName).toBe("TEXTAREA");
		}, { timeout: 500 });
	});

	it("opens a blank tab itself when the group is showing with nothing open", () => {
		useSideChatView.setState({ openChild: {}, openTabs: {} });
		render(<SideChatPanel />);
		expect(useSideChatView.getState().openTabs["p1"]).toHaveLength(1);
		expect(input()).toBeTruthy();
	});

	it("echoes first, then creates, binds the tab, and asks (nothing starts before send)", async () => {
		seedAnnotation("p1", "hello quote");
		let resolveCreate!: (v: { sessionId: string }) => void;
		const create = {
			promise: new Promise<{ sessionId: string }>((r) => {
				resolveCreate = r;
			}),
			resolve: (v: { sessionId: string }) => resolveCreate(v),
		};
		h.createSideChat.mockReset().mockReturnValue(create.promise);
		render(<SideChatPanel />);
		// Mounting alone starts nothing.
		expect(h.createSideChat).not.toHaveBeenCalled();
		expect(h.sideChatAsk).not.toHaveBeenCalled();

		typeAndSend("解释一下");

		// The message is visible before the backend answers; the input is empty.
		expect(screen.getByText("解释一下")).toBeTruthy();
		expect((input() as HTMLTextAreaElement).value).toBe("");
		expect(h.createSideChat).toHaveBeenCalledWith("p1", undefined);
		expect(h.sideChatAsk).not.toHaveBeenCalled();

		await act(async () => create.resolve({ sessionId: "child-new" }));
		await waitFor(() => expect(h.sideChatAsk).toHaveBeenCalled());

		const [sid, question, selection] = h.sideChatAsk.mock.calls[0]!;
		expect(sid).toBe("child-new");
		expect(question).toBe("解释一下");
		expect(selection).toContain("[1]");
		expect(selection).toContain("> hello quote");
		expect(selection).toContain("批注：批注内容");
		expect(h.addUserEcho).toHaveBeenCalledWith("child-new", "解释一下");
		const view = useSideChatView.getState();
		expect(view.openTabs["p1"]).toEqual(["child-new"]);
		expect(view.openChild["p1"]).toBe("child-new");
		expect(view.pending).toEqual({});
		expect(blankId.startsWith("new:")).toBe(true);
		expect(useComposer.getState().annotations[sideChatAnnKey("p1")] ?? []).toEqual([]);
		expect(screen.getByTestId("child-view").textContent).toBe("child-new");
	});

	it("restores the draft and starts nothing when creation fails", async () => {
		h.createSideChat.mockReset().mockRejectedValue(new Error("boom"));
		render(<SideChatPanel />);
		typeAndSend("问题");
		await waitFor(() => expect((input() as HTMLTextAreaElement).value).toBe("问题"));
		expect(h.sideChatAsk).not.toHaveBeenCalled();
		expect(useSideChatView.getState().openTabs["p1"]).toEqual([blankId]);
		expect(useSideChatView.getState().pending).toEqual({});
	});

	it("keeps the draft across unmount/remount", () => {
		const first = render(<SideChatPanel />);
		fireEvent.change(input(), { target: { value: "草稿内容" } });
		first.unmount();
		render(<SideChatPanel />);
		expect((input() as HTMLTextAreaElement).value).toBe("草稿内容");
	});
});

describe("SideChatPanel existing side chats", () => {
	beforeEach(() => {
		useSideChatView.setState({ openChild: {}, openTabs: {}, pending: {} });
		useSideChatView.getState().setOpenChild("p1", "child-new");
	});

	it("shows the thread with a more-actions menu and no return-to-list bar", () => {
		render(<SideChatPanel />);
		expect(screen.getByTestId("child-view").textContent).toBe("child-new");
		expect(screen.queryByText(/返回列表/)).toBeNull();
		expect(screen.queryByText("在主视图打开")).toBeNull();
		fireEvent.click(screen.getByLabelText("更多操作"));
		expect(screen.getByText("在主视图打开")).toBeTruthy();
		expect(screen.getByText("回传给父会话")).toBeTruthy();
	});

	it("keeps the open thread across unmount/remount and parent switches", () => {
		const first = render(<SideChatPanel />);
		first.unmount();
		act(() => useUi.setState({ selectedSessionId: null }));
		act(() => useUi.setState({ selectedSessionId: "p1" }));
		render(<SideChatPanel />);
		expect(screen.getByTestId("child-view").textContent).toBe("child-new");
		expect(useSideChatView.getState().openChild["p1"]).toBe("child-new");
	});

	it("drops a tab whose session was deleted", async () => {
		useSideChatView.getState().setOpenChild("p1", "gone");
		render(<SideChatPanel />);
		await waitFor(() => expect(useSideChatView.getState().openTabs["p1"]).toEqual(["child-new"]));
	});
});

describe("SideChatPanel auto-opened blank tab", () => {
	it("opens exactly one blank tab even when effects run twice (StrictMode)", () => {
		useSideChatView.setState({ openChild: {}, openTabs: {}, pending: {} });
		render(
			<StrictMode>
				<SideChatPanel />
			</StrictMode>,
		);
		expect(useSideChatView.getState().openTabs["p1"]).toHaveLength(1);
	});
});
