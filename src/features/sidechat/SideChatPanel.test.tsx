// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
	sendPrompt: vi.fn(),
}));
vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof Ipc>()),
	createSideChat: h.createSideChat,
	getTranscript: vi.fn(async () => ({ items: [] })),
	acceptSession: vi.fn(async () => undefined),
}));
vi.mock("../../stores/live", () => ({
	useLive: (selector: (s: { sessions: Record<string, never>; scrollToItem: () => void }) => unknown) =>
		selector({ sessions: {}, scrollToItem: () => {} }),
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
	SessionView: () => <div data-testid="child-view" />,
}));
vi.mock("../chat/send", () => ({ sendPrompt: h.sendPrompt }));
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
	h.sendPrompt.mockReset().mockResolvedValue(undefined);
	useComposer.setState({
		annotations: {},
		sideChatDrafts: {},
		focusNonce: {},
		annotationTarget: "main",
	});
	useSessions.setState({ sessions: { p1: meta("p1") } });
	useSideChatView.setState({ openChild: {} });
	useUi.setState({ selectedSessionId: "p1", rightTab: "sidechat" });
});

afterEach(cleanup);

describe("SideChatPanel staged annotations", () => {
	it("keeps staged annotations and focuses the composer on mount", async () => {
		seedAnnotation("p1");
		// Simulates SelectionToolbar staging while the tab was closed.
		useComposer.getState().focusComposer(sideChatAnnKey("p1"));

		render(<SideChatPanel />);

		// Regression: the [selectedId] reset effect used to wipe the freshly
		// consumed selection on first mount. Store-backed staged data survives.
		expect(useComposer.getState().annotations[sideChatAnnKey("p1")]).toHaveLength(1);
		expect(screen.getByText("1 条批注")).toBeTruthy();
		await waitFor(() => {
			expect(document.activeElement?.tagName).toBe("TEXTAREA");
		}, { timeout: 500 });
	});

	it("creates a new thread with formatted quote blocks on send", async () => {
		seedAnnotation("p1", "hello quote");
		render(<SideChatPanel />);
		fireEvent.change(screen.getByPlaceholderText(/输入侧聊消息/), {
			target: { value: "解释一下" },
		});
		fireEvent.keyDown(
			screen.getByPlaceholderText(/输入侧聊消息/),
			{ key: "Enter" },
		);
		await waitFor(() => expect(h.createSideChat).toHaveBeenCalled());
		const [parentId, question, selection] = h.createSideChat.mock.calls[0]!;
		expect(parentId).toBe("p1");
		expect(question).toBe("解释一下");
		expect(selection).toContain("[1]");
		expect(selection).toContain("> hello quote");
		expect(selection).toContain("批注：批注内容");
		expect(h.sendPrompt).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(useComposer.getState().annotations[sideChatAnnKey("p1")]).toEqual([]),
		);
	});

	it("appends question+quotes to the open thread instead of creating one", async () => {
		useSessions.setState({
			sessions: {
				p1: meta("p1"),
				c1: meta("c1", {
					parentId: "p1",
					forkDepth: 1,
					label: "#1.1",
					title: "child",
				}),
			},
		});
		seedAnnotation("p1", "第二条引用");
		render(<SideChatPanel />);
		fireEvent.click(screen.getByText("child"));
		// Child view keeps the slim staged bar.
		const input = screen.getByLabelText("追加到侧聊的问题");
		fireEvent.change(input, { target: { value: "追问" } });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(h.sendPrompt).toHaveBeenCalled());
		expect(h.sendPrompt.mock.calls[0]![0]).toBe("c1");
		const text = h.sendPrompt.mock.calls[0]![1] as string;
		expect(text).toContain("追问");
		expect(text).toContain("> 第二条引用");
		expect(h.createSideChat).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(useComposer.getState().annotations[sideChatAnnKey("p1")]).toEqual([]),
		);
		expect(useComposer.getState().sideChatDrafts["p1"]).toBe("");
	});
});

describe("SideChatPanel view state persistence", () => {

	it("keeps the open child thread and typed draft across unmount/remount", async () => {
		useSessions.setState({
			sessions: {
				p1: meta("p1"),
				c1: meta("c1", {
					parentId: "p1",
					forkDepth: 1,
					label: "#1.1",
					title: "child",
				}),
			},
		});
		seedAnnotation("p1");

		const first = render(<SideChatPanel />);
		fireEvent.click(screen.getByText("child"));
		expect(screen.getByTestId("child-view")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("追加到侧聊的问题"), {
			target: { value: "未发送的追问" },
		});

		// Panel unmount (collapse / right-tab switch) then remount.
		first.unmount();
		render(<SideChatPanel />);

		expect(screen.getByTestId("child-view")).toBeTruthy();
		expect(
			(screen.getByLabelText("追加到侧聊的问题") as HTMLInputElement).value,
		).toBe("未发送的追问");
		expect(useSideChatView.getState().openChild["p1"]).toBe("c1");
	});

	it("keeps the list composer draft across unmount/remount", () => {
		const first = render(<SideChatPanel />);
		fireEvent.change(screen.getByPlaceholderText(/输入侧聊消息/), {
			target: { value: "草稿内容" },
		});
		first.unmount();
		render(<SideChatPanel />);
		expect(
			(screen.getByPlaceholderText(/输入侧聊消息/) as HTMLTextAreaElement)
				.value,
		).toBe("草稿内容");
	});

	it("scopes the open child to its own parent session", () => {
		useSessions.setState({
			sessions: {
				p1: meta("p1"),
				p2: meta("p2", { label: "#2" }),
				c1: meta("c1", {
					parentId: "p1",
					forkDepth: 1,
					label: "#1.1",
					title: "child",
				}),
			},
		});
		const first = render(<SideChatPanel />);
		fireEvent.click(screen.getByText("child"));
		expect(screen.getByTestId("child-view")).toBeTruthy();

		// Switching to another parent shows that parent's own view (list, no child).
		act(() => useUi.setState({ selectedSessionId: "p2" }));
		expect(screen.queryByTestId("child-view")).toBeNull();
		first.unmount();

		// Back on p1, the previously open child is still restored.
		act(() => useUi.setState({ selectedSessionId: "p1" }));
		render(<SideChatPanel />);
		expect(screen.getByTestId("child-view")).toBeTruthy();
	});
});
