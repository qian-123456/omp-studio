// @vitest-environment jsdom
/**
 * Plan mode is switched by explicit, silent host commands (`/plan-action enable|disable`),
 * never by a bare `/plan` toggle: the chip X sends disable, the + menu item enables when off.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import type * as DraftSessionModule from "../sessions/draftSession";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { usePendingSession } from "../sessions/pendingSession";
import { Composer } from "./Composer";
import { clearAllPlanModelApplied } from "./plan/planModelApplied";

const S1 = "plan-switch-s1";

const h = vi.hoisted(() => ({
	rpcSend: vi.fn(async (_id: string, _cmd: unknown) => ({}) as Record<string, unknown>),
}));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		rpcSend: h.rpcSend,
		rpcEnsureLive: vi.fn(async () => ({ sessionId: S1 })),
		ompModelRolesRead: vi.fn(async () => ({
			global: { path: "/g", exists: true, modelRoles: {}, agentModelOverrides: {} },
			project: null,
			agents: [],
		})),
		ompModelRolesSet: vi.fn(async () => ({})),
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
	return { ...orig, materializeDraft: vi.fn(async () => S1), warmDraft: () => {}, prewarmDraft: async () => S1 };
});
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("../../lib/events", async (importOriginal) => {
	const orig = await importOriginal<typeof EventsModule>();
	return { ...orig, onPrivacyChanged: async () => () => {} };
});

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
	Element.prototype.scrollIntoView = () => {};
});

const setPlan = (enabled: boolean) =>
	act(() => {
		useLive.setState({
			sessions: {
				[S1]: {
					...emptySessionLive(),
					alive: true,
					state: { model: { provider: "p", id: "m" }, thinkingLevel: "low" },
					plan: { enabled, version: 0 },
				},
			} as never,
		});
	});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const prompts = () =>
	h.rpcSend.mock.calls
		.filter(([, c]) => (c as { type: string }).type === "prompt")
		.map(([id, c]) => [id, (c as { message: string }).message]);

beforeEach(() => {
	clearAllPlanModelApplied();
	localStorage.clear();
	h.rpcSend.mockReset();
	h.rpcSend.mockImplementation(async () => ({}));
	useComposer.setState({ drafts: {}, annotations: {}, images: {}, files: {}, history: [] });
	useLive.setState({ sessions: {} });
	useSessions.setState({ sessions: {} } as never);
	usePendingSession.setState({ drafts: {}, selectedId: null });
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

describe("Composer plan switching", () => {
	it("chip X sends exactly one silent /plan-action disable", async () => {
		setPlan(true);
		render(<Composer sessionId={S1} />);
		await flush();
		h.rpcSend.mockClear();
		fireEvent.click(screen.getByTitle("点击关闭规划模式"));
		await flush();
		expect(prompts()).toEqual([[S1, "/plan-action disable"]]);
	});

	it("+ menu plan item sends /plan-action enable when off and disable when on", async () => {
		setPlan(false);
		render(<Composer sessionId={S1} />);
		await flush();
		h.rpcSend.mockClear();
		fireEvent.click(screen.getByLabelText("添加"));
		fireEvent.click(screen.getByText("开启规划模式"));
		await flush();
		expect(prompts()).toEqual([[S1, "/plan-action enable"]]);

		setPlan(true);
		h.rpcSend.mockClear();
		fireEvent.click(screen.getByLabelText("添加"));
		fireEvent.click(screen.getByText("关闭规划模式"));
		await flush();
		expect(prompts()).toEqual([[S1, "/plan-action disable"]]);
	});
});
