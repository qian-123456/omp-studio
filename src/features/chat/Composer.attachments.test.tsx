// @vitest-environment jsdom
/**
 * Composer attachment bookkeeping against the real <Composer/> in jsdom:
 * token deletion, slash sends, failed-send restore and the @ file menu.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import type { CameraPhoto } from "../../lib/mobileCameraTypes";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useHeldQueue } from "./heldQueue";
import { rpcEnsureLive } from "../../lib/ipc";
import { rejectResume, RESUME_MISSING_MODEL_MODAL } from "../../lib/ensureLive";
import { useUi } from "../../stores/ui";
import { Composer } from "./Composer";
import * as slashExecutors from "./slash/executors";

const SESSION = "s1";

const h = vi.hoisted(() => ({
	rpcSend: vi.fn(async (_sessionId: string, _command: unknown) => ({}) as Record<string, unknown>),
	imageContentsFromPaths: vi.fn(async (paths: string[]) =>
		paths.map(() => ({ type: "image" as const, data: "AAAA", mimeType: "image/png" })),
	),
	listWorkspaceFiles: vi.fn(async (_cwd: string) => [] as string[]),
	cameraPhoto: null as null | ((photo: CameraPhoto, isCurrent: () => boolean) => Promise<boolean>),
}));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		rpcSend: h.rpcSend,
		imageContentsFromPaths: h.imageContentsFromPaths,
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
	ModelMenuContent: ({ onSelect }: { onSelect: (key: string) => void }) => (
		<div data-testid="model-menu"><button onClick={() => onSelect("available/model")}>available/model</button></div>
	),
}));
vi.mock("../../components/PhoneCameraDialog", () => ({
	PhoneCameraDialog: ({ onPhoto }: { onPhoto: typeof h.cameraPhoto }) => {
		h.cameraPhoto = onPhoto;
		return <div data-testid="phone-camera" />;
	},
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
	h.imageContentsFromPaths.mockReset();
	h.imageContentsFromPaths.mockImplementation(async (paths) =>
		paths.map(() => ({ type: "image" as const, data: "AAAA", mimeType: "image/png" })),
	);
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
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});
const cameraPhoto: CameraPhoto = { id: "phone-1", path: "/images/phone.jpg", name: "phone.jpg", width: 20, height: 20, state: "received" };

describe("phone camera attachments", () => {
	it("adds a phone image alongside existing images without sending, then sends it manually", async () => {
		const originalImage = globalThis.Image;
		class LoadedImage {
			naturalWidth = 20;
			naturalHeight = 20;
			onload: (() => void) | null = null;
			set src(_value: string) { queueMicrotask(() => this.onload?.()); }
		}
		vi.stubGlobal("Image", LoadedImage);
		try {
			act(() => {
				useComposer.getState().setImages(SESSION, [img("existing", "/existing.png")]);
				useComposer.getState().setDraft(SESSION, "🖼️#1 ");
			});
			ta().setSelectionRange(ta().value.length, ta().value.length);
			fireEvent.click(screen.getByRole("button", { name: /添加/ }));
			fireEvent.click(screen.getByText("手机拍照"));
			await act(async () => { expect(await h.cameraPhoto!(cameraPhoto, () => true)).toBe(true); });
			expect(useComposer.getState().images[SESSION].map((image) => image.path)).toEqual(["/existing.png", cameraPhoto.path]);
			expect(draft()).toContain("🖼️#2");
			expect(prompts()).toHaveLength(0);
			fireEvent.keyDown(ta(), { key: "Enter" });
			await waitFor(() => expect(prompts()).toHaveLength(1));
			const command = h.rpcSend.mock.calls.map(([, value]) => value).find((value) => value !== null && typeof value === "object" && "type" in value && value.type === "prompt");
			expect(command && typeof command === "object" && "images" in command ? command.images : null).toHaveLength(2);
		} finally {
			vi.stubGlobal("Image", originalImage);
		}
	});

	it("discards a photo when its owner changes during dimension loading", async () => {
		const originalImage = globalThis.Image;
		let finish: (() => void) | null = null;
		class PendingImage {
			naturalWidth = 20;
			naturalHeight = 20;
			onload: (() => void) | null = null;
			set src(_value: string) { finish = () => this.onload?.(); }
		}
		vi.stubGlobal("Image", PendingImage);
		try {
			fireEvent.click(screen.getByRole("button", { name: /添加/ }));
			fireEvent.click(screen.getByText("手机拍照"));
			let current = true;
			const result = h.cameraPhoto!(cameraPhoto, () => current);
			current = false;
			await act(async () => { finish!(); expect(await result).toBe(false); });
			expect(useComposer.getState().images[SESSION] ?? []).toHaveLength(0);
		} finally {
			vi.stubGlobal("Image", originalImage);
		}
	});
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

interface TestImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

// ES2021 does not provide Promise.withResolvers.
const deferred = <T,>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
};

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

	it("keeps the next payload when an unknown slash prompt resolves late", async () => {
		const request = deferred<Record<string, unknown>>();
		h.rpcSend.mockImplementation((_sid, command) =>
			command !== null && typeof command === "object" && "type" in command && command.type === "prompt"
				? request.promise : Promise.resolve({}),
		);
		fireEvent.change(ta(), { target: { value: "/zzunknown old" } });
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(prompts()).toHaveLength(1));
		fireEvent.change(ta(), { target: { value: "next message" } });
		act(() => {
			const store = useComposer.getState();
			store.addImage(SESSION, "/next.png");
			store.addFile(SESSION, "/next.txt");
			store.addAnnotation(SESSION, { source: "message", text: "next quote" });
		});
		fireEvent.change(ta(), { target: { value: "next message 🖼️#1 📎#1" } });
		await act(async () => { request.resolve({}); });
		expect(draft()).toBe("next message 🖼️#1 📎#1");
		expect(useComposer.getState().images[SESSION]?.[0].path).toBe("/next.png");
		expect(useComposer.getState().files[SESSION]?.[0].path).toBe("/next.txt");
		expect(useComposer.getState().annotations[SESSION]?.[0].text).toBe("next quote");
	});

	it.each([
		["dispatch", "identical text", false, ""],
		["dispatch", "the same prefix", false, " next"],
		["dispatch", "identical text after remount", true, ""],
		["prompt", "identical text", false, ""],
		["prompt", "the same prefix", false, " next"],
		["prompt", "identical text after remount", true, ""],
	] as const)("keeps a replacement draft with %s pending and %s", async (stage, _label, remount, suffix) => {
		const registry = deferred<null>();
		const request = deferred<Record<string, unknown>>();
		vi.spyOn(slashExecutors, "runSlashInput").mockReturnValueOnce(registry.promise);
		h.rpcSend.mockImplementation((_sid, command) =>
			command !== null && typeof command === "object" && "type" in command && command.type === "prompt"
				? request.promise : Promise.resolve({}),
		);
		const submitted = "/zzunknown same 🖼️#1 📎#1";
		act(() => {
			const store = useComposer.getState();
			store.setImages(SESSION, [img("old", "/old.png")]);
			store.setFiles(SESSION, [file("old", "/old.txt")]);
			store.setDraft(SESSION, submitted);
		});
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(slashExecutors.runSlashInput).toHaveBeenCalled());
		if (stage === "prompt") {
			await act(async () => { registry.resolve(null); });
			await waitFor(() => expect(prompts()).toHaveLength(1));
		}
		if (remount) {
			cleanup();
			render(<Composer sessionId={SESSION} />);
		}
		fireEvent.change(ta(), { target: { value: "" } });
		act(() => {
			const store = useComposer.getState();
			store.addImage(SESSION, "/new.png");
			store.addFile(SESSION, "/new.txt");
			store.addAnnotation(SESSION, { source: "message", text: "new quote" });
		});
		fireEvent.change(ta(), { target: { value: submitted + suffix } });
		if (stage === "dispatch") {
			await act(async () => { registry.resolve(null); });
			await waitFor(() => expect(prompts()).toHaveLength(1));
		}
		await act(async () => { request.resolve({}); });
		expect(draft()).toBe(submitted + suffix);
		expect(useComposer.getState().images[SESSION]?.map((image) => image.path)).toEqual(["/new.png"]);
		expect(useComposer.getState().files[SESSION]?.map((attachment) => attachment.path)).toEqual(["/new.txt"]);
		expect(useComposer.getState().annotations[SESSION]?.map((annotation) => annotation.text)).toEqual(["new quote"]);
		expect(prompts()[0]).toContain("/old.png");
		expect(prompts()[0]).toContain("/old.txt");
		expect(prompts()[0]).not.toContain("/new.png");
		expect(prompts()[0]).not.toContain("/new.txt");
	});

	it.each(["keep", "reject"] as const)("restores a %s slash ahead of a retyped identical draft", async (outcome) => {
		const registry = deferred<"keep">();
		vi.spyOn(slashExecutors, "runSlashInput").mockReturnValueOnce(registry.promise);
		const submitted = "/goal same";
		fireEvent.change(ta(), { target: { value: submitted } });
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(slashExecutors.runSlashInput).toHaveBeenCalled());
		fireEvent.change(ta(), { target: { value: "" } });
		fireEvent.change(ta(), { target: { value: submitted } });
		await act(async () => {
			if (outcome === "keep") registry.resolve("keep");
			else registry.reject(new Error("boom"));
		});
		expect(draft()).toBe(`${submitted}\n${submitted}`);
	});

	it("leaves unchanged slash retry annotations and attachments intact on keep", async () => {
		const registry = deferred<"keep">();
		vi.spyOn(slashExecutors, "runSlashInput").mockReturnValueOnce(registry.promise);
		act(() => {
			const store = useComposer.getState();
			store.addAnnotation(SESSION, { source: "message", text: "retry quote" });
			store.setImages(SESSION, [img("retry-image", "/retry.png")]);
			store.setDraft(SESSION, "/goal old 🖼️#1");
		});
		const annotation = useComposer.getState().annotations[SESSION][0];
		const image = useComposer.getState().images[SESSION][0];
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(slashExecutors.runSlashInput).toHaveBeenCalled());
		await act(async () => { registry.resolve("keep"); });
		expect(draft()).toBe("/goal old 🖼️#1");
		expect(useComposer.getState().annotations[SESSION]).toEqual([annotation]);
		expect(useComposer.getState().images[SESSION]).toEqual([image]);
	});


	it("consumes only the unknown slash payload captured before registry dispatch", async () => {
		const registry = deferred<null>();
		vi.spyOn(slashExecutors, "runSlashInput").mockReturnValueOnce(registry.promise);
		act(() => {
			const store = useComposer.getState();
			store.setImages(SESSION, [img("old-image", "/old.png")]);
			store.setFiles(SESSION, [file("old-file", "/old.txt")]);
			store.addAnnotation(SESSION, { source: "message", text: "old quote" });
			store.setDraft(SESSION, "/zzunknown old 🖼️#1 📎#1");
		});
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(slashExecutors.runSlashInput).toHaveBeenCalled());
		act(() => {
			const store = useComposer.getState();
			store.addImage(SESSION, "/new.png");
			store.addFile(SESSION, "/new.txt");
			store.addAnnotation(SESSION, { source: "message", text: "new quote" });
		});
		fireEvent.change(ta(), { target: { value: draft() + "\nnext 🖼️#2 📎#2" } });
		await act(async () => { registry.resolve(null); });
		await waitFor(() => expect(draft()).toBe("next 🖼️#1 📎#1"));
		expect(prompts()).toHaveLength(1);
		expect(prompts()[0]).toContain("/old.txt");
		expect(prompts()[0]).toContain("old quote");
		expect(prompts()[0]).not.toContain("/new.txt");
		expect(prompts()[0]).not.toContain("new quote");
		expect(useComposer.getState().images[SESSION]?.map((image) => image.path)).toEqual(["/new.png"]);
		expect(useComposer.getState().files[SESSION]?.map((attachment) => attachment.path)).toEqual(["/new.txt"]);
		expect(useComposer.getState().annotations[SESSION]?.map((annotation) => annotation.text)).toEqual(["new quote"]);
	});

	it.each(["sent", "handled"] as const)("keeps newer input and native attachments after registry outcome %s", async (outcome) => {
		const registry = deferred<typeof outcome>();
		vi.spyOn(slashExecutors, "runSlashInput").mockReturnValueOnce(registry.promise);
		act(() => {
			const store = useComposer.getState();
			store.setImages(SESSION, [img("old", "/old.png")]);
			store.setFiles(SESSION, [file("old-file", "/old.txt")]);
			store.addAnnotation(SESSION, { source: "message", text: "unsent quote" });
			store.setDraft(SESSION, "/goal old 🖼️#1 📎#1");
		});
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(slashExecutors.runSlashInput).toHaveBeenCalled());
		act(() => {
			const store = useComposer.getState();
			store.addImage(SESSION, "/new.png");
			store.addFile(SESSION, "/new.txt");
		});
		fireEvent.change(ta(), { target: { value: draft() + "\nnext 🖼️#2 📎#2" } });
		await act(async () => { registry.resolve(outcome); });
		await waitFor(() => expect(draft()).toBe(outcome === "sent" ? "next 🖼️#1 📎#2" : "next 🖼️#2 📎#2"));
		expect(useComposer.getState().images[SESSION]?.map((image) => image.path)).toEqual(
			outcome === "sent" ? ["/new.png"] : ["/old.png", "/new.png"],
		);
		expect(useComposer.getState().files[SESSION]).toHaveLength(2);
		expect(useComposer.getState().annotations[SESSION]?.[0].text).toBe("unsent quote");
	});

	it("restores a rejected unknown slash with newer text and renumbered attachments", async () => {
		const request = deferred<Record<string, unknown>>();
		h.rpcSend.mockImplementation((_sid, command) =>
			command !== null && typeof command === "object" && "type" in command && command.type === "prompt"
				? request.promise : Promise.resolve({}),
		);
		act(() => {
			const store = useComposer.getState();
			store.setImages(SESSION, [img("old-image", "/old.png")]);
			store.setFiles(SESSION, [file("old-file", "/old.txt")]);
			store.addAnnotation(SESSION, { source: "message", text: "old quote" });
			store.setDraft(SESSION, "/zzunknown old 🖼️#1 📎#1");
		});
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(prompts()).toHaveLength(1));
		// Replacing the submitted text also removes its attachment tokens.
		fireEvent.change(ta(), { target: { value: "next" } });
		act(() => {
			const store = useComposer.getState();
			store.addImage(SESSION, "/new.png");
			store.addFile(SESSION, "/new.txt");
			store.addAnnotation(SESSION, { source: "message", text: "new quote" });
		});
		fireEvent.change(ta(), { target: { value: "next 🖼️#1 📎#1" } });
		await act(async () => { request.reject(new Error("boom")); });
		await waitFor(() => expect(draft()).toBe("/zzunknown old 🖼️#1 📎#1\nnext 🖼️#2 📎#2"));
		expect(useComposer.getState().images[SESSION]?.map((image) => image.path)).toEqual(["/old.png", "/new.png"]);
		expect(useComposer.getState().files[SESSION]?.map((attachment) => attachment.path)).toEqual(["/old.txt", "/new.txt"]);
		expect(useComposer.getState().annotations[SESSION]?.map((annotation) => annotation.text).sort()).toEqual(["new quote", "old quote"]);
	});

	it.each(["keep", "reject"] as const)("restores the submitted slash without replacing newer input on %s", async (outcome) => {
		const registry = deferred<"keep">();
		vi.spyOn(slashExecutors, "runSlashInput").mockReturnValueOnce(registry.promise);
		fireEvent.change(ta(), { target: { value: "/goal old" } });
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(slashExecutors.runSlashInput).toHaveBeenCalled());
		fireEvent.change(ta(), { target: { value: "next message" } });
		await act(async () => {
			if (outcome === "keep") registry.resolve("keep");
			else registry.reject(new Error("boom"));
		});
		await waitFor(() => expect(draft()).toBe("/goal old\nnext message"));
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
	it("passes an explicit Composer model choice into dead-session startup", async () => {
		vi.mocked(rpcEnsureLive).mockClear();
		act(() => {
			useLive.setState({ sessions: { [SESSION]: {
				...emptySessionLive(), alive: false, state: { model: { provider: "old", id: "missing" } }, commands: [],
			} } });
		});
		fireEvent.click(await screen.findByText("missing"));
		fireEvent.click(await screen.findByText("available/model"));
		await waitFor(() => expect(rpcEnsureLive).toHaveBeenCalledWith(SESSION, undefined, "available/model"));
		expect(useUi.getState().modal).toBeNull();
	});
	it("restores draft and attachments when unavailable-model recovery is cancelled", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce("SESSION_MODEL_UNAVAILABLE:Could not restore model old/missing");
		act(() => {
			useLive.setState({ sessions: { [SESSION]: { ...emptySessionLive(), alive: false, state: {}, commands: [] } } });
			useComposer.getState().setImages(SESSION, [img("saved", "/saved.png")]);
			useComposer.getState().setDraft(SESSION, "preserve this 🖼️#1");
		});
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_MODEL_MODAL));
		expect(draft()).toBe("");
		expect(prompts()).toEqual([]);
		act(() => {
			useComposer.getState().setDraft(SESSION, "typed while choosing");
			rejectResume(SESSION);
		});
		await waitFor(() => expect(draft()).toBe("preserve this 🖼️#1\ntyped while choosing"));
		expect(useComposer.getState().images[SESSION]?.map((i) => i.path)).toEqual(["/saved.png"]);
		expect(useLive.getState().sessions[SESSION]?.pendingUserEchoes).toEqual([]);
		expect(useSessions.getState().sessions[SESSION]?.cwd).toBe("/work");
		expect(prompts()).toEqual([]);
	});
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


describe("deferred image conversion", () => {
	it.each([
		["identical text", false, "", false],
		["the same prefix", false, " next", false],
		["identical text after remount", true, "", false],
		["identical text on rejection", false, "", true],
	] as const)("keeps a replacement draft with %s before the echo", async (_label, remount, suffix, reject) => {
		const conversion = deferred<TestImageContent[]>();
		const request = deferred<Record<string, unknown>>();
		h.imageContentsFromPaths.mockReturnValueOnce(conversion.promise);
		h.rpcSend.mockImplementation((_sid, command) =>
			command !== null && typeof command === "object" && "type" in command && command.type === "prompt"
				? request.promise : Promise.resolve({}),
		);
		const submitted = "same message 🖼️#1 📎#1";
		act(() => {
			const store = useComposer.getState();
			store.setImages(SESSION, [img("old", "/old.png")]);
			store.setFiles(SESSION, [file("old", "/old.txt")]);
			store.setDraft(SESSION, submitted);
		});
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(h.imageContentsFromPaths).toHaveBeenCalledWith(["/old.png"]));
		if (remount) {
			cleanup();
			render(<Composer sessionId={SESSION} />);
		}
		fireEvent.change(ta(), { target: { value: "" } });
		act(() => {
			const store = useComposer.getState();
			store.addImage(SESSION, "/new.png");
			store.addFile(SESSION, "/new.txt");
			store.addAnnotation(SESSION, { source: "message", text: "new quote" });
		});
		fireEvent.change(ta(), { target: { value: submitted + suffix } });
		await act(async () => { conversion.resolve([{ type: "image", data: "AAAA", mimeType: "image/png" }]); });
		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(draft()).toBe(submitted + suffix);
		expect(useComposer.getState().images[SESSION]?.map((image) => image.path)).toEqual(["/new.png"]);
		expect(useComposer.getState().files[SESSION]?.map((attachment) => attachment.path)).toEqual(["/new.txt"]);
		expect(useComposer.getState().annotations[SESSION]?.map((annotation) => annotation.text)).toEqual(["new quote"]);
		await act(async () => {
			if (reject) request.reject(new Error("boom"));
			else request.resolve({});
		});
		expect(draft()).toBe(reject ? `${submitted}\nsame message 🖼️#2 📎#2` : submitted + suffix);
		expect(useComposer.getState().images[SESSION]?.map((image) => image.path)).toEqual(reject ? ["/old.png", "/new.png"] : ["/new.png"]);
		expect(useComposer.getState().files[SESSION]?.map((attachment) => attachment.path)).toEqual(reject ? ["/old.txt", "/new.txt"] : ["/new.txt"]);
		expect(prompts()[0]).toContain("/old.png");
		expect(prompts()[0]).not.toContain("/new.png");
	});

	it("keeps new quotes and edited annotations even when the submitted text is unchanged", async () => {
		const conversion = deferred<TestImageContent[]>();
		h.imageContentsFromPaths.mockReturnValueOnce(conversion.promise);
		act(() => {
			const store = useComposer.getState();
			store.setImages(SESSION, [img("old", "/old.png")]);
			store.addAnnotation(SESSION, { source: "message", text: "old quote", comment: "original comment" });
			store.setDraft(SESSION, "first 🖼️#1");
		});
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(h.imageContentsFromPaths).toHaveBeenCalledWith(["/old.png"]));
		act(() => {
			const store = useComposer.getState();
			store.updateAnnotation(SESSION, store.annotations[SESSION][0].id, { comment: "new comment" });
			store.addAnnotation(SESSION, { source: "message", text: "new quote" });
			store.addImage(SESSION, "/new.png");
			store.addFile(SESSION, "/new.txt");
		});
		await act(async () => { conversion.resolve([{ type: "image", data: "AAAA", mimeType: "image/png" }]); });
		await waitFor(() => expect(draft()).toBe(""));
		expect(useComposer.getState().annotations[SESSION]?.map((annotation) => [annotation.text, annotation.comment])).toEqual([
			["old quote", "new comment"], ["new quote", undefined],
		]);
		expect(useComposer.getState().images[SESSION]?.map((image) => image.path)).toEqual(["/new.png"]);
		expect(useComposer.getState().files[SESSION]?.map((attachment) => attachment.path)).toEqual(["/new.txt"]);
		expect(prompts()[0]).toContain("original comment");
		expect(prompts()[0]).not.toContain("new comment");
		expect(prompts()[0]).not.toContain("new quote");
	});

	it("keeps a replacement attachment whose token reused the submitted number", async () => {
		const conversion = deferred<TestImageContent[]>();
		const request = deferred<Record<string, unknown>>();
		h.imageContentsFromPaths.mockReturnValueOnce(conversion.promise);
		h.rpcSend.mockImplementation((_sid, command) =>
			command !== null && typeof command === "object" && "type" in command && command.type === "prompt"
				? request.promise : Promise.resolve({}),
		);
		act(() => {
			useComposer.getState().setImages(SESSION, [img("old", "/old.png")]);
			useComposer.getState().setDraft(SESSION, "first 🖼️#1");
		});
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(h.imageContentsFromPaths).toHaveBeenCalled());
		fireEvent.change(ta(), { target: { value: "second" } });
		act(() => { useComposer.getState().addImage(SESSION, "/new.png"); });
		fireEvent.change(ta(), { target: { value: "second 🖼️#1" } });
		await act(async () => { conversion.resolve([{ type: "image", data: "AAAA", mimeType: "image/png" }]); });
		await waitFor(() => expect(prompts()).toHaveLength(1));
		expect(draft()).toBe("second 🖼️#1");
		expect(useComposer.getState().images[SESSION]?.map((image) => image.path)).toEqual(["/new.png"]);
		await act(async () => { request.reject(new Error("boom")); });
		await waitFor(() => expect(draft()).toBe("first 🖼️#1\nsecond 🖼️#2"));
		expect(useComposer.getState().images[SESSION]?.map((image) => image.path)).toEqual(["/old.png", "/new.png"]);
	});

	it("does not discard a newer identical draft when the original send fails", async () => {
		const request = deferred<Record<string, unknown>>();
		h.rpcSend.mockImplementation((_sid, command) =>
			command !== null && typeof command === "object" && "type" in command && command.type === "prompt"
				? request.promise : Promise.resolve({}),
		);
		fireEvent.change(ta(), { target: { value: "same message" } });
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(draft()).toBe(""));
		fireEvent.change(ta(), { target: { value: "same message" } });
		await act(async () => { request.reject(new Error("boom")); });
		await waitFor(() => expect(draft()).toBe("same message\nsame message"));
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
