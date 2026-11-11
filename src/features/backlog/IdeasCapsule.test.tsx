// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogItem, Workspace } from "../../lib/contracts";

const ipc = vi.hoisted(() => ({
	backlogList: vi.fn<() => Promise<BacklogItem[]>>(), listWorkspaces: vi.fn<() => Promise<Workspace[]>>(),
	backlogUpdate: vi.fn(), rpcStart: vi.fn(), rpcSend: vi.fn(), dispatchPrompt: vi.fn(), backlogBuildPrompt: vi.fn(),
}));
vi.mock("../../lib/ipc", () => ipc);
vi.mock("../../lib/events", () => ({ onBacklogChanged: async () => () => {} }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
// Quick capture is independent of the real panel/row/dock handoff being exercised here.
vi.mock("./IdeaCaptureBox", () => ({ IdeaCaptureBox: () => null }));

import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { tNow } from "../../stores/language";
import { useToasts } from "../../lib/toast";
import { draftMeta, usePendingSession } from "../sessions/pendingSession";
import { useSidebarStore } from "../sessions/sidebarStore";
import { useBacklog } from "./backlogStore";
import { resetPendingFills } from "./fillComposer";
import { IdeasCapsule } from "./IdeasCapsule";
import { IdeasPanel } from "./IdeasPanel";

const idea = (id: string, projectDir: string | null): BacklogItem => ({
	id, projectDir, text: `Idea ${id}`, kind: "idea", refs: [], status: "inbox", targetSessionId: null,
	createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", deletedAt: null,
});
const initialItems = [idea("one", "/alpha"), idea("two", "/alpha")];
const latestToast = () => {
	const items = useToasts.getState().items;
	return items[items.length - 1];
};

beforeEach(() => {
	vi.clearAllMocks();
	ipc.backlogList.mockReset().mockResolvedValue(initialItems);
	ipc.listWorkspaces.mockReset().mockResolvedValue([]);
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	localStorage.clear();
	window.getSelection()?.removeAllRanges();
	resetPendingFills();
	useComposer.setState({ drafts: {}, images: {}, files: {}, annotations: {}, focusNonce: {} });
	usePendingSession.setState({ drafts: {}, selectedId: null });
	useSessions.setState({ sessions: {}, workspaces: [] });
	useUi.setState({ selectedSessionId: null, selectedIds: new Set(), centerView: "session" });
	useSidebarStore.setState({ activeMode: "code" });
	useBacklog.setState({ items: initialItems, editBuffer: null, captureProject: null });
	useToasts.setState({ items: [] });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	resetPendingFills();
	for (const forbidden of [ipc.rpcStart, ipc.rpcSend, ipc.dispatchPrompt, ipc.backlogBuildPrompt, ipc.backlogUpdate]) {
		expect(forbidden).not.toHaveBeenCalled();
	}
});

async function openPanel() {
	render(<IdeasCapsule />);
	fireEvent.click(screen.getByRole("button", { name: tNow("backlog.capsuleAriaLabel") }));
	await screen.findAllByRole("button", { name: tNow("backlog.openInNewSession") });
}

function selectRows() {
	for (const checkbox of screen.getAllByTitle(tNow("backlog.select"))) fireEvent.click(checkbox);
}

describe("IdeasCapsule draft handoff", () => {
	it("guards two rapid clicks while preparing, leaves fill available, and closes only on success", async () => {
		const source = usePendingSession.getState().open({ cwd: "/source", mode: "chat" });
		useComposer.getState().setDraft(source, "Existing source input");
		useSidebarStore.setState({ activeMode: "chat" });
		// The project targets ES2021, whose Promise type has no withResolvers().
		let finish!: (workspaces: Workspace[]) => void;
		ipc.listWorkspaces.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
		await openPanel();
		const button = screen.getAllByRole("button", { name: tNow("backlog.openInNewSession") })[0];
		act(() => {
			fireEvent.click(button);
			fireEvent.click(button);
		});
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getAllByRole("button", { name: tNow("backlog.fillCurrent") })[0] as HTMLButtonElement).disabled).toBe(false);
		expect(ipc.listWorkspaces).toHaveBeenCalledTimes(1);
		expect(Object.keys(usePendingSession.getState().drafts)).toEqual([source]);
		await act(async () => { finish([]); });
		await waitFor(() => expect(screen.queryByRole("button", { name: tNow("backlog.openInNewSession") })).toBeNull());
		const prepared = Object.values(usePendingSession.getState().drafts).filter((draft) => draft.id !== source);
		expect(prepared).toHaveLength(1);
		expect(useComposer.getState().drafts[prepared[0].id]).toBe("Idea one");
		expect(useComposer.getState().drafts[source]).toBe("Existing source input");
		expect(useBacklog.getState().items.every((item) => item.status === "inbox")).toBe(true);
		expect(latestToast()?.text).toBe(tNow("backlog.openedDraftSingle"));
	});

	it("preserves batch selection and the open panel after failure, then prepares every project on success", async () => {
		useSidebarStore.setState({ activeMode: "chat" });
		const items = [idea("one", "/alpha"), idea("two", "/beta")];
		useBacklog.setState({ items });
		ipc.backlogList.mockResolvedValue(items);
		ipc.listWorkspaces.mockRejectedValueOnce(new Error("Workspace unavailable\nfull failure details"));
		await openPanel();
		selectRows();
		fireEvent.click(screen.getByRole("button", { name: tNow("backlog.openInNewSession") }));
		await waitFor(() => expect(latestToast()?.kind).toBe("error"));
		expect(screen.getByText(tNow("backlog.selectedCount", { count: 2 }))).toBeTruthy();
		expect(screen.getAllByTitle(tNow("backlog.select")).every((element) => (element as HTMLInputElement).checked)).toBe(true);
		expect(usePendingSession.getState().drafts).toEqual({});
		expect(latestToast()?.text).toContain("Workspace unavailable\nfull failure details");
		fireEvent.click(screen.getByRole("button", { name: tNow("backlog.openInNewSession") }));
		await waitFor(() => expect(screen.queryByRole("button", { name: tNow("backlog.openInNewSession") })).toBeNull());
		const drafts = Object.values(usePendingSession.getState().drafts);
		expect(drafts.map((draft) => draft.cwd)).toEqual(["/alpha", "/beta"]);
		expect(drafts.map((draft) => useComposer.getState().drafts[draft.id])).toEqual(["Idea one", "Idea two"]);
		expect(usePendingSession.getState().selectedId).toBe(drafts[0].id);
		expect(latestToast()?.text).toBe(tNow("backlog.openedDraftMultiple", { count: 2 }));
		fireEvent.click(screen.getByRole("button", { name: tNow("backlog.capsuleAriaLabel") }));
		expect(screen.queryByText(tNow("backlog.selectedCount", { count: 2 }))).toBeNull();
		expect(useBacklog.getState().items).toEqual(items);
	});

	it("uses the selected local draft's directory for global ideas without overwriting its content or attachments", async () => {
		const source = usePendingSession.getState().open({ cwd: "/local-project", mode: "code" });
		useComposer.getState().setDraft(source, "Keep local draft");
		useComposer.getState().addImage(source, "/existing.png");
		const items = [idea("global", null)];
		useBacklog.setState({ items });
		ipc.backlogList.mockResolvedValue(items);
		await openPanel();
		fireEvent.click(screen.getByRole("button", { name: tNow("backlog.openInNewSession") }));
		await waitFor(() => expect(usePendingSession.getState().selectedId).not.toBe(source));
		const selected = usePendingSession.getState().selectedId!;
		expect(usePendingSession.getState().drafts[selected].cwd).toBe("/local-project");
		expect(useComposer.getState().drafts[selected]).toBe("Idea global");
		expect(useComposer.getState().drafts[source]).toBe("Keep local draft");
		expect(useComposer.getState().images[source].map((image) => image.path)).toEqual(["/existing.png"]);
	});

	it("prefers the selected real session's directory over an inactive local draft", async () => {
		const local = usePendingSession.getState().open({ cwd: "/local-project", mode: "code" });
		const real = { ...draftMeta(usePendingSession.getState().drafts[local]), id: "real", cwd: "/real-project" };
		useSessions.setState({ sessions: { real } });
		useUi.setState({ selectedSessionId: "real" });
		useComposer.getState().setDraft("real", "Keep real draft");
		const items = [idea("global", null)];
		useBacklog.setState({ items });
		ipc.backlogList.mockResolvedValue(items);
		await openPanel();
		fireEvent.click(screen.getByRole("button", { name: tNow("backlog.openInNewSession") }));
		await waitFor(() => expect(useUi.getState().selectedSessionId).toBeNull());
		const selected = usePendingSession.getState().selectedId!;
		expect(usePendingSession.getState().drafts[selected].cwd).toBe("/real-project");
		expect(useComposer.getState().drafts.real).toBe("Keep real draft");
	});

	it("keeps global ideas selected when no directory can be resolved", async () => {
		const items = [idea("global", null)];
		useBacklog.setState({ items });
		ipc.backlogList.mockResolvedValue(items);
		await openPanel();
		selectRows();
		fireEvent.click(screen.getByRole("button", { name: tNow("backlog.openInNewSession") }));
		await waitFor(() => expect(latestToast()?.text).toContain(tNow("backlog.noProjectDirInMode")));
		expect(screen.getByText(tNow("backlog.selectedCount", { count: 1 }))).toBeTruthy();
		expect(usePendingSession.getState().drafts).toEqual({});
	});

	it("still appends selected ideas into the current draft rather than replacing or sending it", async () => {
		const source = usePendingSession.getState().open({ cwd: "/alpha", mode: "code" });
		useComposer.getState().setDraft(source, "Existing text");
		await openPanel();
		selectRows();
		fireEvent.click(screen.getByRole("button", { name: tNow("backlog.fillCurrent") }));
		expect(useComposer.getState().drafts[source]).toContain("Existing text\n以下是 2 个待处理问题");
		expect(useComposer.getState().drafts[source]).toContain("Idea one");
		expect(useComposer.getState().drafts[source]).toContain("Idea two");
		expect(Object.keys(usePendingSession.getState().drafts)).toEqual([source]);
		expect(screen.queryByText(tNow("backlog.selectedCount", { count: 2 }))).toBeNull();
	});

	it("clears panel selection only when the asynchronous handoff reports full success", async () => {
		const handoff = vi.fn<(items: BacklogItem[]) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		render(<IdeasPanel items={initialItems} currentProject="/alpha" opening={false} onOpenInNewSession={handoff} />);
		selectRows();
		fireEvent.click(screen.getByRole("button", { name: tNow("backlog.openInNewSession") }));
		await waitFor(() => expect(handoff).toHaveBeenCalledTimes(1));
		expect(screen.getByText(tNow("backlog.selectedCount", { count: 2 }))).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: tNow("backlog.openInNewSession") }));
		await waitFor(() => expect(screen.queryByText(tNow("backlog.selectedCount", { count: 2 }))).toBeNull());
		expect(handoff).toHaveBeenNthCalledWith(1, initialItems);
		expect(handoff).toHaveBeenNthCalledWith(2, initialItems);
	});
});
