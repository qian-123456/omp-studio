// @vitest-environment jsdom
/** Typing into a stopped session silently starts its omp process. */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import type { SessionMeta } from "../../lib/contracts";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { Composer } from "./Composer";

const h = vi.hoisted(() => ({ rpcEnsureLive: vi.fn() }));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		rpcSend: vi.fn(async () => ({})),
		rpcEnsureLive: h.rpcEnsureLive,
		sessionUsage: vi.fn(async () => ({ available: false, tokens: 0 })),
		sessionSnapshot: vi.fn(async () => ({})),
		skillsList: vi.fn(async () => ({ skills: [] })),
		listWorkspaceFiles: vi.fn(async () => []),
		listModels: vi.fn(async () => []),
		listSessions: vi.fn(async () => []),
		listWorkspaces: vi.fn(async () => []),
		getSettings: vi.fn(async () => null),
		privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "missing", nativeError: null })),
		privacySessionEntryIds: vi.fn(async () => []),
		mcpConfigList: vi.fn(async () => ({ servers: [] })),
		pluginsList: vi.fn(async () => ({ roots: [], plugins: [] })),
	};
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

const meta = (id: string, over: Partial<SessionMeta> = {}): SessionMeta => ({
	id,
	tool: "omp",
	file: `/tmp/${id}.jsonl`,
	cwd: "/tmp",
	title: "stored",
	label: "#1",
	createdAt: "",
	updatedAt: "",
	parentId: null,
	forkDepth: 0,
	status: "suspended",
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
	...over,
});

const setAlive = (alive: boolean) =>
	act(() => {
		useLive.setState({ sessions: { s1: { ...emptySessionLive(), alive, state: {} } } });
	});

const type = (value: string) => {
	const ta = document.querySelector("textarea");
	if (!ta) throw new Error("no textarea");
	fireEvent.change(ta, { target: { value } });
};

beforeEach(() => {
	localStorage.clear();
	h.rpcEnsureLive.mockReset();
	h.rpcEnsureLive.mockResolvedValue({ sessionId: "s1" });
	useUi.getState().closeModal();
	useComposer.setState({ drafts: {}, annotations: {}, images: {}, files: {}, history: [] });
	useSessions.setState({ sessions: { s1: meta("s1") } });
	useLive.setState({ sessions: { s1: { ...emptySessionLive(), alive: false, state: {} } } });
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

describe("Composer start-on-type", () => {
	it("starts a stopped session once when the user types", async () => {
		render(<Composer sessionId="s1" />);
		type("h");
		type("he");
		await vi.waitFor(() => expect(h.rpcEnsureLive).toHaveBeenCalledTimes(1));
		expect(h.rpcEnsureLive).toHaveBeenCalledWith("s1");
		expect(useUi.getState().modal).toBeNull();
	});

	it("does not start when merely mounted with a restored draft", async () => {
		useComposer.setState({ drafts: { s1: "restored draft" } });
		render(<Composer sessionId="s1" />);
		await act(async () => {});
		expect(h.rpcEnsureLive).not.toHaveBeenCalled();
	});

	it("does not start an alive session", async () => {
		setAlive(true);
		render(<Composer sessionId="s1" />);
		type("hi");
		await act(async () => {});
		expect(h.rpcEnsureLive).not.toHaveBeenCalled();
	});

	it("does not start brand-new stubs, archived or externally held sessions", async () => {
		for (const over of [
			{ title: "", label: "", lastAssistant: null },
			{ archived: true },
			{ status: "external" as const, externalPid: 99 },
		]) {
			useSessions.setState({ sessions: { s1: meta("s1", over) } });
			const { unmount } = render(<Composer sessionId="s1" />);
			type("hi");
			await act(async () => {});
			unmount();
		}
		expect(h.rpcEnsureLive).not.toHaveBeenCalled();
	});

	it("swallows a failure and does not retry on every keystroke", async () => {
		h.rpcEnsureLive.mockRejectedValue("SESSION_HELD:123");
		vi.spyOn(console, "warn").mockImplementation(() => {});
		render(<Composer sessionId="s1" />);
		type("a");
		await vi.waitFor(() => expect(h.rpcEnsureLive).toHaveBeenCalledTimes(1));
		await act(async () => {});
		type("ab");
		type("abc");
		await act(async () => {});
		expect(h.rpcEnsureLive).toHaveBeenCalledTimes(1);
		expect(useUi.getState().modal).toBeNull();
	});

	it("retries after the process state changes, and re-arms when alive flips false", async () => {
		h.rpcEnsureLive.mockRejectedValueOnce("boom");
		vi.spyOn(console, "warn").mockImplementation(() => {});
		render(<Composer sessionId="s1" />);
		type("a");
		await vi.waitFor(() => expect(h.rpcEnsureLive).toHaveBeenCalledTimes(1));
		await act(async () => {});
		// Failure is remembered while the process state is unchanged.
		type("ab");
		await act(async () => {});
		expect(h.rpcEnsureLive).toHaveBeenCalledTimes(1);
		// Process came up, then the idle reaper stopped it again: next edit starts it.
		setAlive(true);
		type("abc");
		await act(async () => {});
		expect(h.rpcEnsureLive).toHaveBeenCalledTimes(1);
		setAlive(false);
		type("abcd");
		await vi.waitFor(() => expect(h.rpcEnsureLive).toHaveBeenCalledTimes(2));
	});

	it("keeps one start in flight per session", async () => {
		let release: (v: unknown) => void = () => {};
		h.rpcEnsureLive.mockReturnValue(new Promise((r) => (release = r)));
		render(<Composer sessionId="s1" />);
		type("a");
		type("ab");
		type("abc");
		expect(h.rpcEnsureLive).toHaveBeenCalledTimes(1);
		await act(async () => release({ sessionId: "s1" }));
	});
});
