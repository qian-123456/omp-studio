import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import type * as Ipc from "../../lib/ipc";
import { sideChatAnnKey, useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { sendFirstMessage } from "./sideChatActions";
import { useSideChatView } from "./viewStore";

const firstAskRpc = vi.hoisted(() => ({ create: vi.fn(), ask: vi.fn() }));
vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof Ipc>()),
	createSideChat: firstAskRpc.create,
	sideChatAsk: firstAskRpc.ask,
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
});
