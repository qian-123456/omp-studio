// @vitest-environment jsdom
/** Composer keyed by sessionId keeps attachment chips per session. */

import { act } from "@testing-library/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadChip, saveChip } from "./slash/chip";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { Composer } from "./Composer";

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		rpcSend: vi.fn(async () => ({})),
		rpcEnsureLive: vi.fn(async () => ({ sessionId: "s1" })),
		sessionUsage: vi.fn(async () => ({ available: false, tokens: 0 })),
		sessionSnapshot: vi.fn(async () => ({})),
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

beforeEach(() => {
	localStorage.clear();
	useComposer.setState({ drafts: {}, annotations: {}, images: {}, files: {}, history: [] });
	useLive.setState({
		sessions: {
			s1: { ...emptySessionLive(), alive: true, state: {} },
			s2: { ...emptySessionLive(), alive: true, state: {} },
		},
	});
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

const chipPaths = () =>
	[...document.querySelectorAll<HTMLElement>("[title]")]
		.map((el) => el.getAttribute("title") ?? "")
		.filter((t) => t.startsWith("/tmp/"));

describe("Composer keyed by sessionId", () => {
	it("shows each session's own file chip when switching", () => {
		useComposer.getState().addFile("s1", "/tmp/one.txt", "one.txt");
		useComposer.getState().addFile("s2", "/tmp/two.txt", "two.txt");
		const { rerender } = render(<Composer key="s1" sessionId="s1" />);
		expect(chipPaths()).toEqual(["/tmp/one.txt"]);
		rerender(<Composer key="s2" sessionId="s2" />);
		expect(chipPaths()).toEqual(["/tmp/two.txt"]);
		rerender(<Composer key="s1" sessionId="s1" />);
		expect(chipPaths()).toEqual(["/tmp/one.txt"]);
	});

	it("switching sessions without a remount keeps the new session's saved chip", async () => {
		saveChip("s1", { name: "skill:aaa", title: "aaa", offset: 0 });
		saveChip("s2", { name: "skill:bbb", title: "bbb", offset: 0 });
		useComposer.getState().setDraft("s1", "/skill:aaa hello");
		useComposer.getState().setDraft("s2", "/skill:bbb world");
		const { rerender } = render(<Composer sessionId="s1" />);
		rerender(<Composer sessionId="s2" />);
		await act(async () => {});
		expect(loadChip("s2")).toMatchObject({ name: "skill:bbb" });
		expect(loadChip("s1")).toMatchObject({ name: "skill:aaa" });
	});
});
