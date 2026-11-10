// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTranscript } from "../../core/normalize";
import type { PendingEntry, TranscriptItem } from "../../core/types";
import { __resetNavForTests, nav, paths, useRoute } from "../../core/nav";
import { events } from "../../core/sse";

const apiMock = vi.fn();
const uploadMock = vi.fn();
vi.mock("../../core/api", async (orig) => {
	const real = await orig<typeof import("../../core/api")>();
	return { ...real, api: (...a: unknown[]) => apiMock(...a), upload: (...a: unknown[]) => uploadMock(...a) };
});

import { ChatCtx } from "./ChatContext";
import { ChatPage } from "./ChatPage";
import { ChatController } from "./chatStore";
import { Composer } from "./components/Composer";
import { MessageList, WINDOW_STEP } from "./components/MessageList";
import { PendingCards } from "./components/PendingCards";
import { clearSlashCache, loadSlashCommands } from "./lib/slash";
import { buildBlocks } from "./lib/turns";
import { draftBook } from "./lib/drafts";
import { ToastHost } from "../../ui/Toast";

class RO {
	observe() {}
	disconnect() {}
	unobserve() {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", RO);
	apiMock.mockReset();
	uploadMock.mockReset();
	apiMock.mockResolvedValue({});
	localStorage.clear();
	clearSlashCache();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const wrap = (c: ChatController, node: React.ReactNode) => (
	<ChatCtx.Provider value={{ controller: c, openActions: () => {}, openStat: () => {} }}>{node}</ChatCtx.Provider>
);

describe("Composer", () => {
	it("keeps the textarea uncontrolled and only flips hasText on empty<->non-empty", async () => {
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));
		const input = screen.getByLabelText("消息输入框") as HTMLTextAreaElement;
		const send = screen.getByLabelText("发送") as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		input.value = "hi";
		await act(async () => {
			fireEvent.input(input);
			await new Promise((r) => requestAnimationFrame(() => r(null)));
		});
		expect(send.disabled).toBe(false);
		expect(input.value).toBe("hi");
	});

	it("does no work during IME composition and syncs on compositionend", async () => {
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));
		const input = screen.getByLabelText("消息输入框") as HTMLTextAreaElement;
		const send = screen.getByLabelText("发送") as HTMLButtonElement;
		fireEvent.compositionStart(input);
		input.value = "ni";
		await act(async () => {
			fireEvent.input(input);
			await new Promise((r) => requestAnimationFrame(() => r(null)));
		});
		expect(send.disabled).toBe(true); // nothing scheduled mid-composition
		input.value = "你";
		await act(async () => {
			fireEvent.compositionEnd(input);
			await new Promise((r) => requestAnimationFrame(() => r(null)));
		});
		expect(send.disabled).toBe(false);
	});

	it("shows the slash popup from the cached list only for input starting with /", async () => {
		await loadSlashCommands("s1", async () => [
			{ name: "new", title: "新会话", group: "会话" },
			{ name: "compact", title: "压缩上下文", group: "会话" },
		]);
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));
		const input = screen.getByLabelText("消息输入框") as HTMLTextAreaElement;
		const type = async (v: string) => {
			input.value = v;
			await act(async () => {
				fireEvent.input(input);
				await new Promise((r) => requestAnimationFrame(() => r(null)));
			});
		};
		await type("hello");
		expect(screen.queryByText("/new")).toBeNull();
		await type("/ne");
		expect(screen.getByText("/new")).toBeTruthy();
		expect(screen.queryByText("/compact")).toBeNull();
		await type("/new now");
		expect(screen.queryByText("/new")).toBeNull();
	});

	it("restores unsent text for the session", () => {
		localStorage.setItem("ompm.chat.unsent", JSON.stringify({ s9: { t: "left over", at: Date.now() } }));
		const c = new ChatController("s9");
		render(wrap(c, <Composer sessionId="s9" />));
		expect((screen.getByLabelText("消息输入框") as HTMLTextAreaElement).value).toBe("left over");
	});

 it("offers a working-only send mode switch without removing Stop", async () => {
  const c = new ChatController("s1");
  render(wrap(c, <Composer sessionId="s1" />));
  expect(screen.queryByRole("button", { name: /发送方式/ })).toBeNull();
  await act(async () => c.store.setState({ working: true }));
  const before = screen.getByRole("button", { name: /发送方式/ }).getAttribute("aria-label");
  fireEvent.click(screen.getByRole("button", { name: /发送方式/ }));
  expect(screen.getByRole("button", { name: /发送方式/ }).getAttribute("aria-label")).not.toBe(before);
  expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
	});
});

describe("controller send", () => {
	const hold = (c: ChatController, text: string) => {
		c.composer = { get: () => text, set: vi.fn() };
	};

	it("adds an optimistic bubble and posts a plain prompt when idle", async () => {
		const c = new ChatController("s1");
		hold(c, "ship it");
		await c.send("ship it", "steer");
		expect(c.state.optimistic.map((o) => o.text)).toEqual(["ship it"]);
		expect(c.state.working).toBe(true);
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/prompt-ex", { text: "ship it", images: [] });
	});

	it("sends streamingBehavior while a turn is running", async () => {
		const c = new ChatController("s1");
		c.start();
		events.emit("rpc", { sessionId: "s1", frame: { type: "agent_start" } });
		await c.send("also this", "steer");
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/prompt-ex", { text: "also this", images: [], streamingBehavior: "steer" });
		await c.send("later", "followUp");
		expect(apiMock).toHaveBeenLastCalledWith("POST", "/sessions/s1/prompt-ex", { text: "later", images: [], streamingBehavior: "followUp" });
		c.dispose();
	});

	it("marks failed delivery unknown without restoring an apparently unsent draft", async () => {
		const c = new ChatController("s1");
		const set = vi.fn();
		c.composer = { get: () => "", set };
		apiMock.mockRejectedValueOnce(new Error("boom"));
		await c.send("lost?", "followUp");
		expect(c.state.optimistic).toEqual([]);
		expect(c.state.working).toBe(false);
		expect(set).toHaveBeenLastCalledWith("");
		expect(c.state.delivery).toMatchObject({ text: "lost?", phase: "unknown" });
	});

	it("runs a slash command, shows its output locally and ignores the prompt path", async () => {
		const c = new ChatController("s1");
		apiMock.mockResolvedValueOnce({ ok: true, output: "状态正常" });
		await c.send("/status", "followUp");
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/slash", { name: "status", args: undefined });
		expect(c.state.localOut[0]).toMatchObject({ name: "status", text: "状态正常" });
		expect(c.state.optimistic).toEqual([]);
	});
 it("preserves draft and attachments without claiming approval when the host command fails", async () => {
  const c = new ChatController("s1");
  let draft = "未发送的补充要求";
  c.composer = { get: () => draft, set: (value) => { draft = value; } };
  const attachment = { id: 1, name: "notes.txt", path: "/uploads/notes.txt", isImage: false, status: "ok" as const, url: "" };
  c.store.setState({ cstate: { planMode: true }, atts: [attachment] });
  apiMock.mockRejectedValueOnce(new Error("host rejected approval"));
  await expect(c.approvePlan("turn-plan", "approved plan text")).resolves.toBe(false);
  expect(draft).toBe("未发送的补充要求");
  expect(c.state.atts).toEqual([attachment]);
  expect(c.state.cstate?.planMode).toBe(true);
  expect(c.state.acceptedPlan).toBeNull();
  expect(c.state.working).toBe(false);
 });

	it("fork-from-here sends the entry id with the typed first message", async () => {
		const c = new ChatController("s1");
		c.composer = { get: () => "", set: vi.fn() };
		c.forkFrom("a7", "answer");
		apiMock.mockResolvedValueOnce({ ok: true });
		await c.send("continue differently", "followUp");
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/slash", { name: "fork", args: "continue differently", entryId: "a7" });
		expect(c.state.forkFrom).toBeNull();
	});

	it("hands a draft's first prompt to the real session and remembers it for the next page", async () => {
		const draft = new ChatController("mobile-draft-1");
		apiMock.mockImplementation(async (_m: string, path: string) => (path.endsWith("/prompt-ex") ? { ok: true, sessionId: "real-1" } : {}));
		await draft.send("first", "followUp");
		const next = new ChatController("real-1");
		expect(next.state.optimistic.map((o) => o.text)).toEqual(["first"]);
		expect(next.state.working).toBe(true);
	});
});

describe("draft handoff composer ownership", () => {
	const deferred = <T,>() => {
		// The mobile ES2021 library target does not expose Promise.withResolvers.
		let resolve!: (value: T) => void;
		let reject!: (reason: Error) => void;
		const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
		return { promise, resolve, reject };
	};
	const edit = async (text: string) => {
		const input = screen.getByLabelText("消息输入框") as HTMLTextAreaElement;
		input.value = text;
		await act(async () => {
			fireEvent.input(input);
			await new Promise((r) => requestAnimationFrame(r));
		});
	};
	const view = (c: ChatController) => wrap(c, <><MessageList sessionId={c.id} /><Composer sessionId={c.id} /></>);
	function RoutedChat() {
		const route = useRoute();
		return route.name === "chat" ? <ChatPage route={route} /> : <div>away from chat</div>;
	}
	const attach = async (container: HTMLElement, ...names: string[]) => {
		await act(async () => {
			fireEvent.change(container.querySelector('input[type="file"]')!, {
				target: { files: names.map((name) => new File(["image"], name, { type: "image/png" })) },
			});
		});
	};
	beforeEach(() => {
		vi.stubGlobal("URL", class extends URL {
			static createObjectURL(file: File) { return `blob:${file.name}`; }
			static revokeObjectURL = vi.fn();
		});
		__resetNavForTests();
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		__resetNavForTests();
	});

	it.each([
		{ name: "latest edits, upload completes after handoff", latest: "独立草稿二", before: false, disposeFirst: false },
		{ name: "same-value re-entry, upload completes before handoff", latest: "首条消息", before: true, disposeFirst: false },
		{ name: "unmount before success, late upload", latest: "离开前的新草稿", before: false, disposeFirst: true },
	])("preserves $name without sending the new draft", async ({ name, latest, before, disposeFirst }) => {
		const id = `mobile-draft-${name}`;
		const realId = `real-${name}`;
		const first = deferred<{ sessionId: string }>();
		const lateUpload = deferred<{ path: string }>();
		const removedUpload = deferred<{ path: string }>();
		apiMock.mockImplementation((_method: string, path: string) => path.endsWith("/prompt-ex") ? first.promise : Promise.resolve([]));
		uploadMock.mockImplementation((_path: string, file: File) => {
			if (file.name === "submitted.png") return Promise.resolve({ path: "/uploads/submitted.png" });
			return file.name === "removed.png" ? removedUpload.promise : lateUpload.promise;
		});
		const draft = new ChatController(id);
		let mounted = render(view(draft));
		await attach(mounted.container, "submitted.png");
		await edit("首条消息");
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "发送" })); });
		expect((screen.getByLabelText("消息输入框") as HTMLTextAreaElement).value).toBe("");
		await edit("独立草稿一");
		await edit(latest);
		await attach(mounted.container, "removed.png", "retained.png");
		await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "移除附件" })[0]); });
		if (before) await act(async () => { lateUpload.resolve({ path: "/uploads/retained.png" }); });
		if (disposeFirst) {
			mounted.unmount();
			draft.dispose();
		}
		await act(async () => { first.resolve({ sessionId: realId }); });
		if (!disposeFirst) mounted.unmount();
		const real = new ChatController(realId);
		mounted = render(view(real));
		// Exercise old-page disposal after the real page already mounted as well.
		if (!disposeFirst) draft.dispose();
		expect((screen.getByLabelText("消息输入框") as HTMLTextAreaElement).value).toBe(latest);
		expect(screen.getByText("retained.png")).toBeTruthy();
		expect(screen.queryByText("removed.png")).toBeNull();
		expect(screen.queryByText("submitted.png")).toBeNull();
		expect(real.state.atts).toMatchObject([{ name: "retained.png", status: before ? "ok" : "up" }]);
		expect(real.state.optimistic).toHaveLength(1);
		const firstEcho = real.state.optimistic[0].text;
		expect(firstEcho).toContain("首条消息");
		expect(firstEcho).toContain("/uploads/submitted.png");
		expect(screen.getAllByText(firstEcho)).toHaveLength(1);
		await act(async () => {
			lateUpload.resolve({ path: "/uploads/retained.png" });
			removedUpload.resolve({ path: "/uploads/removed.png" });
		});
		expect(screen.queryByText("上传中")).toBeNull();
		expect(real.state.atts).toMatchObject([{ name: "retained.png", status: "ok", path: "/uploads/retained.png" }]);
		expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:retained.png");
		expect(apiMock.mock.calls.filter((call) => String(call[1]).endsWith("/prompt-ex"))).toEqual([
			["POST", `/sessions/${id}/prompt-ex`, { text: firstEcho, images: [] }],
		]);
		// A real-page remount must retain the same draft, attachment ownership and single echo.
		mounted.unmount();
		real.dispose();
		const remounted = new ChatController(realId);
		mounted = render(view(remounted));
		expect((screen.getByLabelText("消息输入框") as HTMLTextAreaElement).value).toBe(latest);
		expect(screen.getByText("retained.png")).toBeTruthy();
		expect(screen.getAllByText(firstEcho)).toHaveLength(1);
		mounted.unmount();
		remounted.dispose();
		draftBook.forget(id);
		draftBook.forget(realId);
	});

	it.each([
		{ delay: false, latest: "new text after success", keepImage: true },
		{ delay: true, latest: "new text during route transition", keepImage: true },
		{ delay: true, latest: "", keepImage: false },
	])("routes the live remounted draft and preserves post-success edits (delay=$delay, image=$keepImage)", async ({ delay, latest, keepImage }) => {
		const id = "mobile-draft-remounted-pending";
		const realId = "real-remounted-pending";
		const first = deferred<{ sessionId: string }>();
		const removedUpload = deferred<{ path: string }>();
		const retainedUpload = deferred<{ path: string }>();
		apiMock.mockImplementation(async (_method: string, path: string) => {
			if (path.endsWith("/prompt-ex")) return first.promise;
			if (path.includes("/transcript")) return { items: [], nextOffset: 0, tailId: null };
			if (path.endsWith("/composer-state")) return {};
			return [];
		});
		uploadMock.mockImplementation((_path: string, file: File) => file.name === "removed.png" ? removedUpload.promise : retainedUpload.promise);
		nav.replace(paths.chat(id));
		const mounted = render(<RoutedChat />);
		await edit("first");
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "发送" })); });
		await edit("before remount");
		await attach(mounted.container, "removed.png", "retained.png");
		await act(async () => { nav.replace(paths.home()); });
		expect(screen.queryByLabelText("消息输入框")).toBeNull();
		await act(async () => { nav.replace(paths.chat(id)); });
		await edit("latest after remount");
		const replace = nav.replace;
		const pendingNavigation = vi.fn();
		const delayed = delay ? vi.spyOn(nav, "replace").mockImplementation(pendingNavigation) : null;
		await act(async () => { first.resolve({ sessionId: realId }); });
		if (delay) {
			expect(nav.getRoute().params.id).toBe(id);
			expect(pendingNavigation).toHaveBeenCalledExactlyOnceWith(paths.chat(realId));
		} else {
			expect(nav.getRoute().params.id).toBe(realId);
		}
		// Do not unmount the successful draft manually: edit whichever composer is actually visible.
		await edit(latest);
		await act(async () => {
			const removals = screen.getAllByRole("button", { name: "移除附件" });
			fireEvent.click(removals[0]);
			if (!keepImage) fireEvent.click(removals[1]);
		});
		await act(async () => {
			removedUpload.resolve({ path: "/uploads/removed.png" });
			retainedUpload.resolve({ path: "/uploads/retained.png" });
		});
		if (delayed) {
			delayed.mockRestore();
			await act(async () => { replace(paths.chat(realId)); });
		}
		expect(nav.getRoute().params.id).toBe(realId);
		expect((screen.getByLabelText("消息输入框") as HTMLTextAreaElement).value).toBe(latest);
		expect(screen.queryByText("removed.png")).toBeNull();
		expect(!!screen.queryByText("retained.png")).toBe(keepImage);
		expect(screen.queryByText("上传中")).toBeNull();
		expect(screen.getAllByText("first")).toHaveLength(1);
		expect(draftBook.restore(id)).toBeNull();
		if (keepImage) {
			expect(draftBook.restore(realId)).toMatchObject({ text: latest, atts: [{ name: "retained.png", status: "ok", path: "/uploads/retained.png" }] });
		} else {
			expect(draftBook.restore(realId)).toBeNull();
		}
		expect(apiMock.mock.calls.filter((call) => String(call[1]).endsWith("/prompt-ex"))).toEqual([
			["POST", `/sessions/${id}/prompt-ex`, { text: "first", images: [] }],
		]);
		mounted.unmount();
		draftBook.forget(realId);
	});

	it.each([paths.home(), paths.chat("mobile-draft-unrelated")])("does not reopen or redirect a disposed sender from %s", async (destination) => {
		const id = "mobile-draft-closed-pending";
		const realId = "real-closed-pending";
		const first = deferred<{ sessionId: string }>();
		apiMock.mockImplementation(async (_method: string, path: string) => path.endsWith("/prompt-ex") ? first.promise : []);
		nav.replace(paths.chat(id));
		const mounted = render(<RoutedChat />);
		await edit("closed first");
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "发送" })); });
		await edit("closed unsent");
		await act(async () => { nav.replace(destination); });
		if (destination !== paths.home()) await edit("unrelated draft");
		await act(async () => { first.resolve({ sessionId: realId }); });
		expect(nav.getRoute().path).toBe(destination);
		if (destination !== paths.home()) {
			expect((screen.getByLabelText("消息输入框") as HTMLTextAreaElement).value).toBe("unrelated draft");
		} else {
			expect(screen.queryByLabelText("消息输入框")).toBeNull();
		}
		expect(draftBook.restore(realId)).toEqual({ text: "closed unsent", atts: [] });
		expect(apiMock.mock.calls.filter((call) => String(call[1]).endsWith("/prompt-ex"))).toHaveLength(1);
		mounted.unmount();
		draftBook.forget(realId);
		draftBook.forget("mobile-draft-unrelated");
	});

	it("retains newer unsent text and attachments on HTTP failure without restoring or resending the submitted snapshot", async () => {
		const id = "mobile-draft-failed-pending";
		const first = deferred<{ sessionId: string }>();
		const upload = deferred<{ path: string }>();
		apiMock.mockImplementation((_method: string, path: string) => path.endsWith("/prompt-ex") ? first.promise : Promise.resolve([]));
		uploadMock.mockReturnValue(upload.promise);
		const draft = new ChatController(id);
		let mounted = render(view(draft));
		await edit("submitted first");
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "发送" })); });
		await edit("独立草稿一");
		await edit("独立草稿二");
		await attach(mounted.container, "unsent.png");
		await act(async () => {
			first.reject(new Error("HTTP connection lost"));
			upload.resolve({ path: "/uploads/unsent.png" });
		});
		expect((screen.getByLabelText("消息输入框") as HTMLTextAreaElement).value).toBe("独立草稿二");
		expect(screen.getByText("unsent.png")).toBeTruthy();
		expect(draft.state.delivery).toMatchObject({ phase: "unknown", text: "submitted first", atts: [] });
		expect(draft.state.optimistic).toEqual([]);
		mounted.unmount();
		draft.dispose();
		const resumed = new ChatController(id);
		mounted = render(view(resumed));
		expect((screen.getByLabelText("消息输入框") as HTMLTextAreaElement).value).toBe("独立草稿二");
		expect(screen.getByText("unsent.png")).toBeTruthy();
		expect(resumed.state.atts).toMatchObject([{ name: "unsent.png", path: "/uploads/unsent.png", status: "ok" }]);
		expect(resumed.state.delivery?.phase).toBe("unknown");
		expect(apiMock.mock.calls.filter((call) => String(call[1]).endsWith("/prompt-ex"))).toHaveLength(1);
		mounted.unmount();
		resumed.dispose();
		draftBook.forget(id);
	});
});

describe("controller stop", () => {
	it("restores withdrawn queue texts after the draft and counts them in the toast", async () => {
		const c = new ChatController("s1");
		let draft = "已有草稿";
		const set = vi.fn((v: string) => { draft = v; });
		c.composer = { get: () => draft, set };
		apiMock.mockResolvedValueOnce({ aborted: true, restoredTexts: ["排队的追问", "排队的后续"] });
		render(<ToastHost />);
		await act(async () => { await c.stop(); });
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/abort");
		expect(set).toHaveBeenLastCalledWith("已有草稿\n\n排队的追问\n\n排队的后续");
		expect(screen.getByText("已停止，撤回 2 条排队消息")).toBeTruthy();
	});

	it("keeps the plain stop toast and touches no composer when nothing was queued", async () => {
		const c = new ChatController("s1");
		const set = vi.fn();
		c.composer = { get: () => "", set };
		apiMock.mockResolvedValueOnce({ aborted: true, restoredTexts: [] });
		render(<ToastHost />);
		await act(async () => { await c.stop(); });
		expect(screen.getByText("已发送停止请求")).toBeTruthy();
		expect(set).not.toHaveBeenCalled();
	});
});

describe("PendingCards", () => {
	const confirm = (id: string): PendingEntry => ({ request: { id, method: "confirm", title: `Run ${id}?` } });
	it("shows 「全部允许」 only from two approvals and calls ui-respond-all", async () => {
		const c = new ChatController("s1");
		render(wrap(c, <PendingCards />));
		await act(async () => c.store.setState({ pendings: [confirm("a")] }));
		expect(screen.queryByText("全部允许")).toBeNull();
		await act(async () => c.store.setState({ pendings: [confirm("a"), confirm("b")] }));
		apiMock.mockResolvedValue({ handled: 2, skipped: 0 });
		await act(async () => fireEvent.click(screen.getByText("全部允许")));
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/ui-respond-all", { action: "approve", ids: ["a", "b"] });
	});
});

describe("MessageList", () => {
	const raw: TranscriptItem[] = [];
	for (let i = 0; i < 150; i++) {
		raw.push({ id: `u${i}`, kind: "user", text: `question ${i}`, ts: "2026-10-26T10:00:00Z" });
		raw.push({ id: `a${i}`, kind: "assistant", text: `answer ${i}`, ts: "2026-10-26T10:00:05Z" });
	}
	const seed = (c: ChatController) => {
		const items = normalizeTranscript(raw);
		c.store.setState({ loaded: true, blocks: buildBlocks(items, {}) });
	};

	it("renders only a window of a 150-turn session and can load earlier turns", async () => {
		const c = new ChatController("s1");
		seed(c);
  render(wrap(c, <MessageList sessionId="s1" />));
  expect(screen.getByText(`question ${150 - WINDOW_STEP}`)).toBeTruthy();
  expect(screen.queryByText(`question ${149 - WINDOW_STEP}`)).toBeNull();
		expect(screen.getByText("answer 149")).toBeTruthy();
		expect(screen.queryByText("answer 0")).toBeNull();
		await act(async () => fireEvent.click(screen.getByText(/加载更早的/)));
  expect(screen.getByText(`question ${150 - WINDOW_STEP * 2}`)).toBeTruthy();
  expect(screen.queryByText(`question ${149 - WINDOW_STEP * 2}`)).toBeNull();
  expect(screen.getByText("answer 149")).toBeTruthy();
	});
 it("keeps loaded history visible when a new turn arrives away from the tail", async () => {
  const c = new ChatController("s1");
  seed(c);
  render(wrap(c, <MessageList sessionId="s1" />));
  fireEvent.click(screen.getByRole("button", { name: /加载更早的/ }));
  const anchorText = `question ${150 - WINDOW_STEP * 2}`;
  expect(screen.getByText(anchorText)).toBeTruthy();
  const next: TranscriptItem[] = [...raw,
   { id: "u150", kind: "user", text: "new question", ts: "2026-10-26T10:01:00Z" },
   { id: "a150", kind: "assistant", text: "new answer", ts: "2026-10-26T10:01:05Z" },
  ];
  await act(async () => c.store.setState({ blocks: buildBlocks(normalizeTranscript(next), {}) }));
  expect(screen.getByText(anchorText)).toBeTruthy();
  expect(screen.getByText("new answer")).toBeTruthy();
 });

	it("streaming updates leave earlier turn DOM nodes untouched", async () => {
		const c = new ChatController("s1");
		seed(c);
		const { container } = render(wrap(c, <MessageList sessionId="s1" />));
		const earlier = screen.getByText("answer 120");
		await act(async () => c.store.setState({ working: true, live: { id: "__live", role: "assistant", kind: "assistant", text: "streaming…", thinking: "", tools: [], images: [], ts: null, streaming: true } }));
		expect(screen.getByText("streaming…")).toBeTruthy();
		expect(screen.getByText("answer 120")).toBe(earlier);
		expect(container.contains(earlier)).toBe(true);
	});

	it("shows an explicit unknown-delivery notice with original text, files and recovery actions", () => {
		const c = new ChatController("s1");
		c.store.setState({ loaded: true, delivery: { text: "original message", prompt: "original message", phase: "unknown", atts: [{ id: 1, name: "notes.txt", path: "/uploads/notes.txt", isImage: false, status: "ok", url: "" }] } });
		render(wrap(c, <MessageList sessionId="s1" />));
		expect(screen.getByRole("alert").textContent).toContain("电脑可能已经收到");
		expect(screen.getByText("original message")).toBeTruthy();
		expect(screen.getByText("notes.txt")).toBeTruthy();
		expect(screen.getByText("恢复输入")).toBeTruthy();
		expect(screen.getByText("已核对，不再重发")).toBeTruthy();
	});
});
