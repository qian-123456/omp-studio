// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTranscript } from "../../core/normalize";
import type { PendingEntry, TranscriptItem } from "../../core/types";

const apiMock = vi.fn();
vi.mock("../../core/api", async (orig) => {
	const real = await orig<typeof import("../../core/api")>();
	return { ...real, api: (...a: unknown[]) => apiMock(...a), upload: vi.fn() };
});

import { ChatCtx } from "./ChatContext";
import { ChatController } from "./chatStore";
import { Composer } from "./components/Composer";
import { MessageList, WINDOW_STEP } from "./components/MessageList";
import { PendingCards } from "./components/PendingCards";
import { clearSlashCache, loadSlashCommands } from "./lib/slash";
import { buildBlocks } from "./lib/turns";

class RO {
	observe() {}
	disconnect() {}
	unobserve() {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", RO);
	apiMock.mockReset();
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

	it("offers steer/queue only while streaming", async () => {
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));
		expect(screen.queryByText("插话")).toBeNull();
		await act(async () => c.store.setState({ working: true }));
		expect(screen.getByText("插话")).toBeTruthy();
		expect(screen.getByText("排队")).toBeTruthy();
		expect(screen.getByLabelText("停止")).toBeTruthy();
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
		c.store.setState({ working: true });
		await c.send("also this", "steer");
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/prompt-ex", { text: "also this", images: [], streamingBehavior: "steer" });
		await c.send("later", "followUp");
		expect(apiMock).toHaveBeenLastCalledWith("POST", "/sessions/s1/prompt-ex", { text: "later", images: [], streamingBehavior: "followUp" });
	});

	it("rolls back the optimistic bubble and restores the text on failure", async () => {
		const c = new ChatController("s1");
		const set = vi.fn();
		c.composer = { get: () => "", set };
		apiMock.mockRejectedValueOnce(new Error("boom"));
		await c.send("lost?", "followUp");
		expect(c.state.optimistic).toEqual([]);
		expect(c.state.working).toBe(false);
		expect(set).toHaveBeenLastCalledWith("lost?");
	});

	it("runs a slash command, shows its output locally and ignores the prompt path", async () => {
		const c = new ChatController("s1");
		apiMock.mockResolvedValueOnce({ ok: true, output: "状态正常" });
		await c.send("/status", "followUp");
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/slash", { name: "status", args: undefined });
		expect(c.state.localOut[0]).toMatchObject({ name: "status", text: "状态正常" });
		expect(c.state.optimistic).toEqual([]);
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
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/ui-respond-all", { action: "approve" });
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
		const { container } = render(wrap(c, <MessageList sessionId="s1" />));
		expect(container.querySelectorAll(".m-turn,.m-turn-live").length).toBe(WINDOW_STEP);
		expect(screen.getByText("answer 149")).toBeTruthy();
		expect(screen.queryByText("answer 0")).toBeNull();
		await act(async () => fireEvent.click(screen.getByText(/加载更早的/)));
		expect(container.querySelectorAll(".m-turn,.m-turn-live").length).toBe(WINDOW_STEP * 2);
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
});
