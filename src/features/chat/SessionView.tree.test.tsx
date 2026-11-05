// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem, TranscriptPage } from "../../lib/contracts";
import type * as EventsModule from "../../lib/events";
import type * as IpcModule from "../../lib/ipc";
import type { SessionLive } from "../../stores/live";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useTree } from "../../stores/tree";

const SID = "tree-session";
const h = vi.hoisted(() => ({ getTranscript: vi.fn(), treeGet: vi.fn(), treeNavigate: vi.fn() }));

vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof IpcModule>()),
	getTranscript: h.getTranscript,
	treeGet: h.treeGet,
	treeNavigate: h.treeNavigate,
	gitSessionTurns: vi.fn(async () => []),
	rpcPendingUi: vi.fn(async () => []),
	rpcSend: vi.fn(async () => ({})),
	privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "ok", nativeError: null })),
}));
vi.mock("../../lib/events", async (importOriginal) => ({
	...(await importOriginal<typeof EventsModule>()),
	onTreeNavigated: vi.fn(async () => () => {}),
	onPrivacyChanged: vi.fn(async () => () => {}),
}));
vi.mock("./ChatTrace", () => ({ ChatTrace: () => null }));
vi.mock("./AnnotationMarkers", () => ({ AnnotationMarkers: () => null }));
vi.mock("./Composer", () => ({ Composer: () => null }));
vi.mock("./HeldQueueBar", () => ({ HeldQueueBar: () => null }));
vi.mock("./PendingUiCard", () => ({ PendingUiCard: () => null }));
vi.mock("./SelectionToolbar", () => ({ SelectionToolbar: () => null }));
vi.mock("./share/ShareSelectionBar", () => ({ ShareSelectionBar: () => null }));
vi.mock("./subagents/TopCapsule", () => ({ TopCapsule: () => null }));
vi.mock("./ask/AskPanel", () => ({
	AskPanel: () => null,
	useAskRouting: () => ({ route: null, awaiting: false, submit: () => {}, cancel: () => {} }),
}));

import { SessionView } from "./SessionView";
import { navigateTree, refetchTranscript } from "./treeNav";

function item(id: string, parentId: string | null, kind: TranscriptItem["kind"], text: string | null = null): TranscriptItem {
	return {
		id, parentId, kind, text,
		ts: "2026-01-01T00:00:00Z",
		thinking: null, assistantParts: [], toolCalls: [], toolResult: null,
		usage: null, model: null, stopReason: kind === "assistant" ? "stop" : null,
		images: [], hidden: false, duration: null, ttft: null, completedAt: null,
		firstKeptEntryId: null,
	};
}

const root = item("model-1", null, "model_change");
const model = item("model-2", root.id, "model_change");
const user = item("user-1", model.id, "user", "Shrink the button fill area");
const answer = item("answer-1", user.id, "assistant", "The button fill is smaller now.");
const other = item("answer-2", user.id, "assistant", "An abandoned alternative answer.");
const page = (items: TranscriptItem[], nextOffset = 10): TranscriptPage => ({
	sessionId: SID, items, nextOffset, reset: false, tailId: items[items.length - 1]?.id ?? null,
});

interface SnapshotNode {
	entry: TranscriptItem;
	children: SnapshotNode[];
}

function tree(entries = [root, model, user, answer, other]): SnapshotNode[] {
	const nodes = new Map(entries.map((entry) => [entry.id, { entry, children: [] } as SnapshotNode]));
	const roots: SnapshotNode[] = [];
	for (const entry of entries) {
		const node = nodes.get(entry.id)!;
		const parent = entry.parentId ? nodes.get(entry.parentId) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	return roots;
}

function setLive(patch: Partial<SessionLive>) {
	useLive.setState((state) => ({ sessions: { ...state.sessions, [SID]: { ...state.sessions[SID], ...patch } } }));
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
	h.getTranscript.mockReset();
	h.treeGet.mockReset();
	h.treeNavigate.mockReset();
	useLive.setState({ sessions: { [SID]: emptySessionLive() } });
	useSessions.setState({ sessions: {} });
	useTree.setState({ leaf: {}, resend: {} });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("SessionView conversation tree history", () => {
	it("does not let a live tree older than disk hide the newest turn after reopening", async () => {
		h.getTranscript.mockResolvedValue(page([root, model, user, answer]));
		h.treeGet.mockResolvedValue({ tree: tree([root, model]), leafId: model.id });
		setLive({ alive: true });
		useTree.getState().setLeaf(SID, model.id);
		const view = render(<SessionView sessionId={SID} />);

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
		view.rerender(<SessionView key="reopened" sessionId={SID} />);
		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("honors an intentional rewind when the tree already knows the later turn", async () => {
		h.getTranscript.mockResolvedValue(page([root, model, user, answer]));
		h.treeGet.mockResolvedValue({ tree: tree(), leafId: model.id });
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(4));
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));

		expect(screen.queryByText(user.text!)).toBeNull();
		expect(screen.queryByText(answer.text!)).toBeNull();
	});

	it("keeps a completed turn visible when the next tree read fails", async () => {
		h.getTranscript.mockResolvedValue(page([root, model]));
		h.treeGet.mockResolvedValue({ tree: tree([root, model]), leafId: model.id });
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));

		h.getTranscript.mockResolvedValue(page([user, answer], 20));
		h.treeGet.mockRejectedValue(new Error("RPC disconnected"));
		act(() => {
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_start" } });
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_end" } });
		});

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("shows the first persisted user and answer after a stream advances the leaf", async () => {
		let leaf = model.id;
		h.treeGet.mockImplementation(async () => ({ tree: tree(), leafId: leaf }));
		h.getTranscript.mockImplementation(async (_sid: string, offset?: number) =>
			offset === undefined ? page([root, model]) : page([user, answer], 20),
		);
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));

		act(() => setLive({ streaming: true }));
		leaf = answer.id; // Upstream advances its current leaf on append, without a navigation event.
		act(() => setLive({ streaming: false }));

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("commits a turn whose start and end arrive before the next render", async () => {
		let leaf = model.id;
		h.treeGet.mockImplementation(async () => ({ tree: tree(), leafId: leaf }));
		h.getTranscript.mockImplementation(async (_sid: string, offset?: number) =>
			offset === undefined ? page([root, model]) : page([user, answer], 20),
		);
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));

		leaf = answer.id;
		act(() => {
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_start" } });
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_end" } });
		});

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("does not replace a committed answer with an older initial history response", async () => {
		let resolveInitial!: (value: TranscriptPage) => void;
		let leaf = model.id;
		h.getTranscript.mockImplementationOnce(() => new Promise<TranscriptPage>((resolve) => {
			resolveInitial = resolve;
		}));
		h.getTranscript.mockResolvedValue(page([user, answer], 20));
		h.treeGet.mockImplementation(async () => ({ tree: tree(), leafId: leaf }));
		setLive({ alive: true, items: [root, model], nextOffset: 10 });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));

		act(() => useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_start" } }));
		leaf = answer.id;
		act(() => useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_end" } }));
		await waitFor(() => expect(useLive.getState().sessions[SID].items.some((entry) => entry.id === answer.id)).toBe(true));
		await act(async () => { resolveInitial(page([root, model])); });

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("keeps a newer answer when a separate navigation reader returns late", async () => {
		let leaf = model.id;
		h.getTranscript.mockResolvedValue(page([root, model]));
		h.treeGet.mockImplementation(async () => ({ tree: tree(), leafId: leaf }));
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));

		let resolveNavigation!: (value: TranscriptPage) => void;
		h.getTranscript.mockImplementationOnce(() => new Promise<TranscriptPage>((resolve) => {
			resolveNavigation = resolve;
		}));
		const navigating = refetchTranscript(SID);
		h.getTranscript.mockResolvedValue(page([user, answer], 20));
		leaf = answer.id;
		act(() => {
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_start" } });
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_end" } });
		});
		expect(await screen.findByText(answer.text!)).toBeTruthy();

		await act(async () => {
			resolveNavigation(page([root, model]));
			await navigating;
		});
		expect(screen.getByText(user.text!)).toBeTruthy();
		expect(screen.getByText(answer.text!)).toBeTruthy();
	});

	it("refreshes a cached pre-prompt leaf when a mounted cold session reconnects", async () => {
		h.getTranscript.mockResolvedValue(page([root, model, user, answer, other]));
		h.treeGet.mockResolvedValue({ tree: tree(), leafId: answer.id });
		useTree.getState().setLeaf(SID, model.id);
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(5));

		act(() => setLive({ alive: true }));
		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
		await waitFor(() => expect(screen.queryByText(other.text!)).toBeNull());
	});

	it("does not hide persisted history behind a stale leaf after suspension", async () => {
		h.getTranscript.mockResolvedValue(page([root, model]));
		h.treeGet.mockResolvedValue({ tree: tree(), leafId: model.id });
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));

		act(() => setLive({ alive: false, items: [root, model, user, answer] }));
		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("ignores an idle tree response that arrives after suspension", async () => {
		// The project's ES2021 library does not provide Promise.withResolvers.
		let resolveTree!: (value: { tree: unknown[]; leafId: string }) => void;
		h.treeGet.mockImplementation(() => new Promise<{ tree: unknown[]; leafId: string }>((resolve) => { resolveTree = resolve; }));
		h.getTranscript.mockResolvedValue(page([root, model, user, answer]));
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(h.treeGet).toHaveBeenCalled());
		expect(await screen.findByText(answer.text!)).toBeTruthy();

		act(() => setLive({ alive: false }));
		await act(async () => { resolveTree({ tree: tree(), leafId: model.id }); });
		expect(screen.getByText(user.text!)).toBeTruthy();
		expect(screen.getByText(answer.text!)).toBeTruthy();
	});

	it("keeps an explicitly navigated branch rather than choosing the file tail", async () => {
		let leaf = other.id;
		h.getTranscript.mockResolvedValue(page([root, model, user, answer, other]));
		h.treeGet.mockImplementation(async () => ({ tree: tree(), leafId: leaf }));
		h.treeNavigate.mockImplementation(async (_sid: string, entryId: string) => {
			leaf = entryId;
			return { cancelled: false };
		});
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		expect(await screen.findByText(other.text!)).toBeTruthy();
		await waitFor(() => expect(screen.queryByText(answer.text!)).toBeNull());

		await act(async () => { await navigateTree(SID, answer.id); });
		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
		expect(screen.queryByText(other.text!)).toBeNull();
	});
});
