import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

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
		...overrides,
	};
}
describe("SideChat actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useComposer.setState({ annotations: {}, drafts: {} });
		useUi.setState({ selectedSessionId: null });
		useLive.setState({ sessions: {} });
		useSessions.setState({ sessions: {} });
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
});
