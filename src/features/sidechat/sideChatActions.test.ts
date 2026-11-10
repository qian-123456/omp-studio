import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import type * as Ipc from "../../lib/ipc";
import { sideChatAnnKey, useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { sendFirstMessage } from "./sideChatActions";
import { useSideChatView } from "./viewStore";

const firstAskRpc = vi.hoisted(() => ({ create: vi.fn(), ask: vi.fn(), transcript: vi.fn() }));
vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof Ipc>()),
	createSideChat: firstAskRpc.create,
	sideChatAsk: firstAskRpc.ask,
	getTranscript: firstAskRpc.transcript,
}));

vi.mock("../../lib/toast", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));


function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
	return {
		id: "s",
		tool: "omp",
		file: "/tmp/s.jsonl",
		cwd: "/test",
		title: "Session",
		label: "#1",
		createdAt: "2026-09-25T00:00:00Z",
		updatedAt: "2026-09-25T00:00:00Z",
		parentId: null,
		forkDepth: 0,
		status: "idle",
		unread: false,
		pending: null,
		live: false,
		externalPid: null,
		pinned: false,
		archived: false,
		workspaceId: null,
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
		model: null,
		attention: null,
		mode: "code",
		groupId: null,
		...overrides,
	};
}
describe("SideChat actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useComposer.setState({ annotations: {}, drafts: {}, images: {}, sideChatDrafts: {} });
		useUi.setState({ selectedSessionId: null });
		useLive.setState({ sessions: {} });
		useSessions.setState({ sessions: {}, load: vi.fn(async () => {}) });
		useSideChatView.setState({ openChild: {}, openTabs: {}, pending: {} });
		firstAskRpc.create.mockReset().mockResolvedValue({ sessionId: "retry-child" });
		firstAskRpc.ask.mockReset().mockResolvedValue(undefined);
		firstAskRpc.transcript.mockReset().mockImplementation(async (sessionId: string) => ({ sessionId, items: [], nextOffset: 0, reset: false, tailId: null }));
	});

	it("adds last assistant message as annotation to parent and selects parent session", () => {
		const parentId = "parent-1";
		const childId = "child-1";

		useSessions.setState({
			sessions: {
				[parentId]: meta({ id: parentId, title: "Parent Session" }),
				[childId]: meta({
					id: childId,
					parentId,
					title: "Side Chat",
					label: "#1.1",
				}),
			},
		});

		useLive.setState({
			sessions: {
				[childId]: {
					streaming: false,
					state: null,
					pendingUi: [],
					subagents: {},
					streamingMessage: null,
					commands: [],
					liveRequests: [],
					flowNotices: [],
					ompQueue: { steering: [], followUp: [] },
					tools: {},
					items: [
						{
							id: "msg-1",
							parentId: null,
							ts: "2026-09-25T00:00:01Z",
							kind: "user",
							text: "Hello",
							thinking: null,
							toolCalls: [],
							toolResult: null,
							usage: null,
							model: null,
							stopReason: null,
							hidden: false,
						},
						{
							id: "msg-2",
							parentId: "msg-1",
							ts: "2026-09-25T00:00:02Z",
							kind: "assistant",
							text: "This is the final answer from sidechat",
							thinking: null,
							toolCalls: [],
							toolResult: null,
							usage: null,
							model: null,
							stopReason: null,
							hidden: false,
						},
					],
					pendingUserEchoes: [],
					commandOutputs: [],
					nextOffset: 0,
					alive: false,
				},
			},
		});

		// Exercise sending back to parent logic
		const items = useLive.getState().sessions[childId]?.items ?? [];
		const assistantItems = items.filter(
			(it) => it.kind === "assistant" && it.text && it.text.trim().length > 0,
		);
		const lastAssistant = assistantItems[assistantItems.length - 1];

		expect(lastAssistant).toBeDefined();
		expect(lastAssistant.text).toBe("This is the final answer from sidechat");

		useComposer.getState().addAnnotation(parentId, {
			source: "message",
			text: lastAssistant.text!,
			itemId: lastAssistant.id,
		});
		useUi.getState().selectSession(parentId);

		expect(useUi.getState().selectedSessionId).toBe(parentId);
		const annotations = useComposer.getState().annotations[parentId];
		expect(annotations).toHaveLength(1);
		expect(annotations[0]).toMatchObject({
			source: "message",
			text: "This is the final answer from sidechat",
			itemId: "msg-2",
		});
	});

	it("isolates sidechat drafts strictly by parent session id", () => {
		const p1 = "parent-1";
		const p2 = "parent-2";

		useComposer.getState().setSideChatDraft(p1, "Draft question for parent 1");
		useComposer.getState().setSideChatDraft(p2, "Draft question for parent 2");

		expect(useComposer.getState().sideChatDrafts[p1]).toBe("Draft question for parent 1");
		expect(useComposer.getState().sideChatDrafts[p2]).toBe("Draft question for parent 2");

		useComposer.getState().clearSideChatDraft(p1);
		expect(useComposer.getState().sideChatDrafts[p1]).toBe("");
		expect(useComposer.getState().sideChatDrafts[p2]).toBe("Draft question for parent 2");
	});

	it("restores the draft without asking when the authoritative baseline fails and retries the same child", async () => {
		const parentId = "baseline-parent";
		const tabId = useSideChatView.getState().openBlankTab(parentId);
		useComposer.getState().setSideChatDraft(tabId, "retry after baseline read");
		firstAskRpc.transcript.mockRejectedValueOnce(new Error("baseline unavailable"));
		const input = { parentId, tabId, text: "retry after baseline read" };
		await expect(sendFirstMessage(input)).rejects.toThrow("baseline unavailable");
		expect(firstAskRpc.ask).not.toHaveBeenCalled();
		expect(useLive.getState().sessions["retry-child"]?.pendingUserEchoes ?? []).toEqual([]);
		expect(useComposer.getState().sideChatDrafts[tabId]).toBe(input.text);
		expect(useSideChatView.getState().pending).toEqual({});
		await sendFirstMessage(input);
		expect(firstAskRpc.create).toHaveBeenCalledTimes(1);
		expect(firstAskRpc.transcript).toHaveBeenCalledTimes(2);
		expect(firstAskRpc.ask).toHaveBeenCalledTimes(1);
	});

	it("failed first asks leave no real pending echo and retry the same child with annotations and images", async () => {
		const parentId = "retry-parent";
		const tabId = useSideChatView.getState().openBlankTab(parentId);
		useComposer.getState().addAnnotation(sideChatAnnKey(parentId), {
			source: "message", text: "quoted source", comment: "keep annotation",
		});
		const annotations = useComposer.getState().annotations[sideChatAnnKey(parentId)];
		const image = useComposer.getState().addImage(tabId, "/retry.png");
		const input = { parentId, tabId, text: "question 🖼️#1", annotations, images: [image] };
		firstAskRpc.ask.mockRejectedValueOnce(new Error("not accepted"));

		await expect(sendFirstMessage(input)).rejects.toThrow("not accepted");
		expect(useLive.getState().sessions["retry-child"]?.pendingUserEchoes ?? []).toEqual([]);
		expect(useSideChatView.getState().openChild[parentId]).toBe(tabId);
		expect(useSideChatView.getState().pending).toEqual({});
		expect(useComposer.getState().annotations[sideChatAnnKey(parentId)]).toEqual(annotations);
		expect(useComposer.getState().images[tabId]).toEqual([image]);

		await sendFirstMessage(input);
		expect(firstAskRpc.create).toHaveBeenCalledTimes(1);
		expect(firstAskRpc.ask).toHaveBeenCalledTimes(2);
		expect(firstAskRpc.ask.mock.calls[1]).toEqual(firstAskRpc.ask.mock.calls[0]);
		expect(firstAskRpc.ask.mock.calls[1]?.[2]).toContain("keep annotation");
		const echoes = useLive.getState().sessions["retry-child"]?.pendingUserEchoes;
		expect(echoes).toHaveLength(1);
		expect(echoes?.[0]?.images?.[0]?.path).toBe("/retry.png");
		expect(useSideChatView.getState().openChild[parentId]).toBe("retry-child");
		expect(useComposer.getState().images[tabId] ?? []).toEqual([]);
		expect(useComposer.getState().annotations[sideChatAnnKey(parentId)] ?? []).toEqual([]);
	});

	it("single-flights concurrent first asks and releases the failed delivery before retry", async () => {
		const parentId = "single-flight-parent";
		const tabId = useSideChatView.getState().openBlankTab(parentId);
		let rejectCreate!: (error: Error) => void;
		firstAskRpc.create.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectCreate = reject; }));
		const first = sendFirstMessage({ parentId, tabId, text: "first question" });
		const duplicate = sendFirstMessage({ parentId, tabId, text: "must not be sent" });
		expect(duplicate).toBe(first);
		useComposer.getState().setSideChatDraft(tabId, "newer draft");
		rejectCreate(new Error("creation rejected"));
		await expect(first).rejects.toThrow("creation rejected");
		expect(useComposer.getState().sideChatDrafts[tabId]).toBe("newer draft");
		await sendFirstMessage({ parentId, tabId, text: "newer draft" });
		expect(firstAskRpc.create).toHaveBeenCalledTimes(2);
		expect(firstAskRpc.ask).toHaveBeenCalledTimes(1);
		expect(firstAskRpc.ask.mock.calls[0]?.[1]).toBe("newer draft");
	});

	it("binds only its originating parent and preserves newer drafts, images and quotes", async () => {
		const parentId = "origin-parent";
		const tabId = useSideChatView.getState().openBlankTab(parentId);
		const annKey = sideChatAnnKey(parentId);
		useComposer.getState().addAnnotation(annKey, { source: "message", text: "sent quote" });
		const annotations = useComposer.getState().annotations[annKey];
		const image = useComposer.getState().addImage(tabId, "/sent.png");
		let accept!: () => void;
		firstAskRpc.ask.mockReturnValueOnce(new Promise<void>((resolve) => { accept = resolve; }));
		const delivery = sendFirstMessage({ parentId, tabId, text: "original question", annotations, images: [image] });
		await vi.waitFor(() => expect(firstAskRpc.ask).toHaveBeenCalledTimes(1));
		const otherTab = useSideChatView.getState().openBlankTab("other-parent");
		useUi.setState({ selectedSessionId: "other-parent" });
		useComposer.getState().setSideChatDraft(tabId, "follow-up with 🖼️#2");
		useComposer.getState().addImage(tabId, "/newer.png");
		useComposer.setState((state) => ({
			annotations: { ...state.annotations, [annKey]: annotations.map((annotation) => ({ ...annotation, comment: "edited while pending" })) },
		}));
		useComposer.getState().addAnnotation(annKey, { source: "message", text: "newer quote" });
		accept();
		await delivery;
		expect(useUi.getState().selectedSessionId).toBe("other-parent");
		expect(useSideChatView.getState().openChild["other-parent"]).toBe(otherTab);
		expect(useSideChatView.getState().openChild[parentId]).toBe("retry-child");
		expect(useComposer.getState().drafts["retry-child"]).toBe("follow-up with 🖼️#1");
		expect(useComposer.getState().annotations[annKey]?.map((a) => a.text)).toEqual(["sent quote", "newer quote"]);
		expect(useComposer.getState().annotations[annKey]?.[0].comment).toBe("edited while pending");
	});

	it("does not reopen a closed tab when its accepted first message settles", async () => {
		const parentId = "closed-parent";
		const tabId = useSideChatView.getState().openBlankTab(parentId);
		let accept!: () => void;
		firstAskRpc.ask.mockReturnValueOnce(new Promise<void>((resolve) => { accept = resolve; }));
		const delivery = sendFirstMessage({ parentId, tabId, text: "keep sending to the original child" });
		await vi.waitFor(() => expect(firstAskRpc.ask).toHaveBeenCalledTimes(1));
		useSideChatView.getState().closeTab(parentId, tabId);
		accept();
		await delivery;
		expect(useSideChatView.getState().openTabs[parentId] ?? []).toEqual([]);
		expect(firstAskRpc.ask).toHaveBeenCalledTimes(1);
		expect(firstAskRpc.ask.mock.calls[0]?.[0]).toBe("retry-child");
		expect(useSideChatView.getState().pending).toEqual({});
	});
});
