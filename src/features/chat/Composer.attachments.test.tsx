// @vitest-environment jsdom
/**
 * Composer attachment bookkeeping against the real <Composer/> in jsdom:
 * token deletion, slash sends, failed-send restore and the @ file menu.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useHeldQueue } from "./heldQueue";
import { Composer } from "./Composer";

const SESSION = "s1";

const h = vi.hoisted(() => ({
	rpcSend: vi.fn(async (_sessionId: string, _command: unknown) => ({}) as Record<string, unknown>),
	listWorkspaceFiles: vi.fn(async (_cwd: string) => [] as string[]),
}));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		rpcSend: h.rpcSend,
		imageContentsFromPaths: vi.fn(async (paths: string[]) =>
			paths.map(() => ({ type: "image" as const, data: "AAAA", mimeType: "image/png" })),
		),
		rpcEnsureLive: vi.fn(async () => ({ sessionId: SESSION })),
		sessionUsage: vi.fn(async () => ({ available: false, tokens: 0 })),
		sessionSnapshot: vi.fn(async () => ({})),
		listWorkspaceFiles: h.listWorkspaceFiles,
		listModels: vi.fn(async () => []),
		listSessions: vi.fn(async () => []),
		skillsList: vi.fn(async () => ({ skills: [], extensions: [] })),
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
	Object.assign(window, { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => `asset://${p}` } });
});

beforeEach(() => {
	localStorage.clear();
	h.rpcSend.mockReset();
	h.rpcSend.mockResolvedValue({});
	h.listWorkspaceFiles.mockReset();
	h.listWorkspaceFiles.mockResolvedValue([]);
	useComposer.setState({ drafts: {}, annotations: {}, images: {}, files: {}, history: [] });
	useHeldQueue.setState({ queues: {}, dismissed: {} });
	useLive.setState({
		sessions: { [SESSION]: { ...emptySessionLive(), alive: true, state: {}, commands: [] } },
	});
	useSessions.setState({
		sessions: { [SESSION]: { id: SESSION, cwd: "/work" } } as never,
	});
	render(<Composer sessionId={SESSION} />);
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

const ta = (): HTMLTextAreaElement => {
	const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-composer="${SESSION}"]`);
	if (!el) throw new Error("composer textarea not rendered");
	return el;
};
const draft = () => useComposer.getState().drafts[SESSION] ?? "";
const prompts = () =>
	h.rpcSend.mock.calls
		.map(([, command]) => command as Record<string, unknown>)
		.filter((c) => c.type === "prompt")
		.map((c) => String(c.message));

const img = (id: string, path: string) => ({ id, path });
const file = (id: string, path: string) => ({ id, path, name: path.split("/").pop() ?? path });

describe("selection-deleted attachment tokens", () => {
	it("deleting 🖼️#1 keeps the second image and renumbers its token", () => {
		act(() => {
			const s = useComposer.getState();
			s.setImages(SESSION, [img("a", "/a.png"), img("b", "/b.png")]);
			s.setDraft(SESSION, "x 🖼️#1 y 🖼️#2");
		});
		fireEvent.change(ta(), { target: { value: "x  y 🖼️#2" } });

		expect(useComposer.getState().images[SESSION]).toEqual([img("b", "/b.png")]);
		expect(draft()).toBe("x  y 🖼️#1");

		// The next keystroke must not drop the surviving image.
		fireEvent.change(ta(), { target: { value: "x  y 🖼️#1!" } });
		expect(useComposer.getState().images[SESSION]).toEqual([img("b", "/b.png")]);
	});

	it("files get the same renumbering", () => {
		act(() => {
			const s = useComposer.getState();
			s.setFiles(SESSION, [file("f1", "/a.txt"), file("f2", "/b.txt")]);
			s.setDraft(SESSION, "📎#1 and 📎#2");
		});
		fireEvent.change(ta(), { target: { value: " and 📎#2" } });

		expect(useComposer.getState().files[SESSION]?.map((f) => f.id)).toEqual(["f2"]);
		expect(draft()).toBe(" and 📎#1");
	});

	it("Backspace on 🖼️#1 leaves 🖼️#10 intact", () => {
		const images = Array.from({ length: 10 }, (_, i) => img(`i${i + 1}`, `/${i + 1}.png`));
		act(() => {
			useComposer.getState().setImages(SESSION, images);
			useComposer.getState().setDraft(SESSION, "🖼️#1 🖼️#10");
		});
		ta().setSelectionRange(5, 5);
		fireEvent.keyDown(ta(), { key: "Backspace" });

		expect(useComposer.getState().images[SESSION]).toHaveLength(9);
		expect(draft()).toContain("🖼️#9");
		expect(draft()).not.toMatch(/🖼️#\d*0\b/u);
	});
});

describe("slash-prefixed send", () => {
	it("keeps the command first and still ships annotations and files", async () => {
		act(() => {
			const s = useComposer.getState();
			s.setFiles(SESSION, [file("f1", "/tmp/a.txt")]);
			s.addAnnotation(SESSION, { source: "message", text: "quoted line" });
			s.setDraft(SESSION, "/zzunknown 看看 📎#1");
		});
		fireEvent.keyDown(ta(), { key: "Enter" });

		await waitFor(() => expect(prompts()).toHaveLength(1));
		const sent = prompts()[0];
		expect(sent.startsWith("/zzunknown 看看 [文件 #1: /tmp/a.txt]")).toBe(true);
		expect(sent).toContain("> quoted line");
		await waitFor(() => expect(draft()).toBe(""));
		expect(useComposer.getState().annotations[SESSION] ?? []).toHaveLength(0);
		expect(useComposer.getState().files[SESSION] ?? []).toHaveLength(0);
	});
});

describe("held queue included in the next Composer send", () => {
	const queuedImage = { id: "queued-image", path: "/queued.png", marker: "[Image #1]" };
	const currentImage = { id: "current-image", path: "/current.png", marker: "[Image #1]" };

	it("sends queued messages in order with the typed prompt and renumbered images", async () => {
		const addUserEcho = vi.spyOn(useLive.getState(), "addUserEcho");
		act(() => {
			useHeldQueue.getState().push(SESSION, "[Image #1: /queued.png] first", [queuedImage]);
			useHeldQueue.getState().push(SESSION, "[Image #1: /second.png] second", [
				{ id: "second-image", path: "/second.png", marker: "[Image #1]" },
			]);
			useComposer.getState().setImages(SESSION, [img(currentImage.id, currentImage.path)]);
			useComposer.getState().setDraft(SESSION, "current 🖼️#1");
		});

		fireEvent.keyDown(ta(), { key: "Enter" });
		const expected =
			"current [Image #1: /current.png]\n\n---\n\n[Image #2: /queued.png] first\n\n---\n\n[Image #3: /second.png] second";
		await waitFor(() => expect(prompts()).toEqual([expected]));
		expect(useHeldQueue.getState().queues[SESSION]).toEqual([]);
		expect(addUserEcho).toHaveBeenCalledWith(
			SESSION,
			expected,
			[
				{ ...currentImage, marker: "[Image #1]", width: undefined, height: undefined },
				{ ...queuedImage, marker: "[Image #2]" },
				{ id: "second-image", path: "/second.png", marker: "[Image #3]" },
			],
			false,
		);
		addUserEcho.mockRestore();
	});

	it("restores the snapshotted held messages exactly once when the combined send fails", async () => {
		h.rpcSend.mockRejectedValue(new Error("boom"));
		act(() => {
			useHeldQueue.getState().push(SESSION, "held one");
			useHeldQueue.getState().push(SESSION, "held two");
			useComposer.getState().setDraft(SESSION, "current prompt");
		});

		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(useHeldQueue.getState().queues[SESSION]).toHaveLength(2));
		expect(useHeldQueue.getState().queues[SESSION]?.map((item) => item.text)).toEqual([
			"held one",
			"held two",
		]);
		expect(draft()).toContain("current prompt");
	});
});

describe("failed send", () => {
	it("merges the original text with what was typed meanwhile", async () => {
		let reject: (e: Error) => void = () => {};
		h.rpcSend.mockImplementation((_sid, command) => {
			if ((command as { type?: string }).type !== "prompt") return Promise.resolve({});
			return new Promise((_res, rej) => {
				reject = rej;
			});
		});
		act(() => {
			const s = useComposer.getState();
			s.setImages(SESSION, [img("a", "/a.png")]);
			s.setDraft(SESSION, "first 🖼️#1");
		});
		fireEvent.keyDown(ta(), { key: "Enter" });

		// Released as soon as the echo lands; the user keeps typing.
		await waitFor(() => expect(draft()).toBe(""));
		act(() => {
			const s = useComposer.getState();
			s.setImages(SESSION, [img("b", "/b.png")]);
			s.setDraft(SESSION, "second 🖼️#1");
		});
		await act(async () => {
			reject(new Error("boom"));
		});

		await waitFor(() => expect(draft()).toContain("first"));
		expect(draft()).toBe("first 🖼️#1\nsecond 🖼️#2");
		expect(useComposer.getState().images[SESSION]?.map((i) => i.id)).toEqual(["a", "b"]);
	});
});

describe("@ file menu", () => {
	const type = (value: string) => fireEvent.change(ta(), { target: { value } });

	it("closes on Esc and stays closed while the same @ token is edited", async () => {
		h.listWorkspaceFiles.mockResolvedValue(["src/alpha.ts", "src/beta.ts"]);
		type("@");
		await waitFor(() => expect(screen.getByText("src/alpha.ts")).toBeTruthy());

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByText("src/alpha.ts")).toBeNull());

		type("@s");
		expect(screen.queryByText("src/alpha.ts")).toBeNull();
		expect(h.listWorkspaceFiles).toHaveBeenCalledTimes(1);

		// A fresh @ elsewhere reopens it.
		type("@s x @");
		await waitFor(() => expect(screen.getByText("src/alpha.ts")).toBeTruthy());
	});
});
