// @vitest-environment jsdom
/**
 * Plan mode from a new-chat draft: the command chip must not follow the draft
 * onto the real session, a failed command keeps it, and the plan tab opens only
 * for a newer plan revision.
 */

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import type * as DraftSessionModule from "../sessions/draftSession";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useUi } from "../../stores/ui";
import { usePendingSession } from "../sessions/pendingSession";
import { loadChip, saveChip } from "./slash/chip";
import { Composer } from "./Composer";

const DRAFT = "local-draft:plan-1";
const REAL = "real-1";

const h = vi.hoisted(() => ({
	rpcSend: vi.fn(async (_id: string, _cmd: unknown) => ({}) as Record<string, unknown>),
	materialize: vi.fn<(id: string) => Promise<string>>(),
}));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		rpcSend: h.rpcSend,
		rpcEnsureLive: vi.fn(async () => ({ sessionId: REAL })),
		sessionUsage: vi.fn(async () => ({ available: false, tokens: 0 })),
		sessionSnapshot: vi.fn(async () => ({})),
		skillsList: vi.fn(async () => ({ skills: [], extensions: [] })),
		listWorkspaceFiles: vi.fn(async () => []),
		listModels: vi.fn(async () => []),
		listSessions: vi.fn(async () => []),
		listWorkspaces: vi.fn(async () => []),
		getSettings: vi.fn(async () => null),
		gitBadge: vi.fn(async () => null),
		privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "missing", nativeError: null })),
		privacySessionEntryIds: vi.fn(async () => []),
		mcpConfigList: vi.fn(async () => ({ servers: [] })),
		pluginsList: vi.fn(async () => ({ roots: [], plugins: [] })),
	};
});
vi.mock("../sessions/draftSession", async (importOriginal) => {
	const orig = await importOriginal<typeof DraftSessionModule>();
	return { ...orig, materializeDraft: h.materialize, warmDraft: () => {}, prewarmDraft: async () => REAL };
});
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("../../lib/events", async (importOriginal) => {
	const orig = await importOriginal<typeof EventsModule>();
	return { ...orig, onPrivacyChanged: async () => () => {} };
});
vi.mock("../../stores/modelCatalog", () => ({
	useModelOptions: () => null,
	useModelCatalog: Object.assign(vi.fn(() => null), {
		getState: () => ({ models: [], refresh: () => Promise.resolve() }),
	}),
}));
vi.mock("../../components/ModelSelect", () => ({
	ModelMenuContent: () => <div data-testid="model-menu" />,
}));

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
	Element.prototype.scrollIntoView = () => {};
});

const PLAN_CHIP = { name: "plan", title: "规划模式", argHint: "<任务>" };

beforeEach(async () => {
	localStorage.clear();
	h.rpcSend.mockClear();
	h.materialize.mockReset();
	useUi.setState({ rightTab: "git" } as never);
	useComposer.setState({ drafts: {}, annotations: {}, images: {}, files: {}, history: [] });
	usePendingSession.setState({
		drafts: {
			[DRAFT]: {
				id: DRAFT, cwd: "/tmp/proj", mode: "code", groupId: null,
				opts: { cwd: "/tmp/proj" } as never, model: null, thinking: null,
				sessionId: null, startError: null,
			},
		},
		selectedId: DRAFT,
	});
	useLive.setState({
		sessions: {
			[DRAFT]: { ...emptySessionLive(), alive: true, state: {} },
			[REAL]: { ...emptySessionLive(), alive: true, state: {} },
		},
	});
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

const ta = (id: string): HTMLTextAreaElement => {
	const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-composer="${id}"]`);
	if (!el) throw new Error("composer textarea not rendered");
	return el;
};

describe("Composer plan chip on a new-chat draft", () => {
	it("does not carry the chip to the materialized session", async () => {
		const { transferDraft } = await vi.importActual<typeof DraftSessionModule>("../sessions/draftSession");
		h.materialize.mockImplementation(async (id) => {
			transferDraft(id, REAL);
			return REAL;
		});
		saveChip(DRAFT, PLAN_CHIP);
		useComposer.getState().setDraft(DRAFT, "write a plan");
		render(<Composer sessionId={DRAFT} />);

		fireEvent.keyDown(ta(DRAFT), { key: "Enter" });

		await waitFor(() => expect(h.materialize).toHaveBeenCalledWith(DRAFT));
		await waitFor(() => expect(h.rpcSend).toHaveBeenCalled());
		expect(loadChip(REAL)).toBeNull();
		expect(loadChip(DRAFT)).toBeNull();
	});

	it("keeps the chip for retry when the command fails on the same composer", async () => {
		h.materialize.mockRejectedValue(new Error("spawn failed"));
		saveChip(DRAFT, PLAN_CHIP);
		useComposer.getState().setDraft(DRAFT, "write a plan");
		render(<Composer sessionId={DRAFT} />);

		fireEvent.keyDown(ta(DRAFT), { key: "Enter" });

		await waitFor(() => expect(h.materialize).toHaveBeenCalled());
		await waitFor(() => expect(loadChip(DRAFT)).toEqual(PLAN_CHIP));
		expect(document.querySelector("[data-command-chip]")).not.toBeNull();
	});
});

describe("plan tab auto-open", () => {
	const setPlan = (plan: { enabled: boolean; version: number } | undefined) =>
		act(() => {
			useLive.setState({
				sessions: { [REAL]: { ...emptySessionLive(), alive: true, state: {}, ...(plan ? { plan } : {}) } as never },
			});
		});

	it("opens only for a newer revision, not for resume or mode start", () => {
		setPlan({ enabled: true, version: 3 });
		render(<Composer sessionId={REAL} />);
		expect(useUi.getState().rightTab).toBe("git"); // resumed at v3: baseline

		setPlan({ enabled: true, version: 3 });
		expect(useUi.getState().rightTab).toBe("git");

		setPlan({ enabled: true, version: 4 });
		expect(useUi.getState().rightTab).toBe("plan");
	});

	it("does not open when plan mode is toggled on at version 0", () => {
		setPlan(undefined);
		render(<Composer sessionId={REAL} />);
		setPlan({ enabled: true, version: 0 });
		expect(useUi.getState().rightTab).toBe("git");
	});
});
