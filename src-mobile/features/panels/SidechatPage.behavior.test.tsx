// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../core/api";
import type * as NavModule from "../../core/nav";
import type { PageProps } from "../../core/nav";
import { events } from "../../core/sse";
import { useSessions } from "../../core/stores/sessions";
import type { MobileSession, TranscriptItem, TranscriptPage } from "../../core/types";
import { SidechatPage } from "./SidechatPage";

vi.mock("../../core/nav", async (original) => ({
	...(await original<typeof NavModule>()),
	nav: { push: vi.fn(), pushLayer: () => () => {} },
}));

const thread: MobileSession = { id: "thread", label: "#2", title: "方案讨论", status: "review", updatedAt: "2026-11-01T10:00:00Z", cwd: "/project", live: true };
const route: PageProps["route"] = { name: "sidechat", path: "/s/parent/sidechat", params: { id: "parent" }, query: {} };
const boundary: TranscriptItem = { id: "first", kind: "user", text: "Side chat forked from main session\n\n## User question\n首个问题", hidden: true };
function deferred<T>() {
	// Match the phone's ES2022 target rather than requiring Promise.withResolvers.
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
let page: TranscriptPage;
let prompt: (path: string, body: unknown) => Promise<unknown>;
let create: () => Promise<unknown>;
let readTranscript: () => Promise<TranscriptPage>;
let abort: () => Promise<unknown>;
const flush = async () => { await act(async () => {}); };
async function tick(ms = 400) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function type(text: string) {
	await act(async () => { fireEvent.input(screen.getByRole("textbox"), { target: { value: text } }); await vi.advanceTimersByTimeAsync(20); });
}
async function openThread() {
	const view = render(<SidechatPage route={route} />);
	await flush();
	fireEvent.click(screen.getByRole("button", { name: /方案讨论/ }));
	await flush();
	return view;
}
function refetch() { act(() => events.emit("rpc", { sessionId: "thread", frame: { type: "message_end" } })); }

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
	vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
	localStorage.clear();
	sessionStorage.clear();
	page = { items: [boundary], reset: true, nextOffset: 1, tailId: "first" };
	prompt = async () => ({});
	create = async () => ({ sessionId: "thread" });
	abort = async () => ({});
	readTranscript = async () => ({ ...page, items: [...page.items] });
	useSessions.setState({ list: [thread], byId: { thread }, loaded: true, loading: false });
	vi.spyOn(apiModule, "api").mockImplementation(async (method, path, body) => {
		if (method === "GET" && (path.endsWith("/sidechats") || path === "/sessions")) return [thread];
		if (method === "GET" && path.includes("/transcript?")) return readTranscript();
		if (method === "GET" && path.endsWith("/composer-state")) return { planMode: false };
		if (method === "POST" && path.endsWith("/sidechats")) return create();
		if (method === "POST" && path.endsWith("/prompt-ex")) return prompt(path, body);
		if (method === "POST" && path.endsWith("/abort")) return abort();
		throw new Error(`Unexpected API call: ${method} ${path}`);
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("sidechat message delivery", () => {
	it("shows only the side question, restoring a hidden boundary without exposing other hidden rows", async () => {
		page.items = [
			{ id: "parent", kind: "user", text: "父会话内容" }, boundary,
			{ id: "internal", kind: "user", text: "内部指令", hidden: true },
			{ id: "image", kind: "user", images: [{ path: "/tmp/photo.png", mimeType: "image/png" }] },
		];
		await openThread();
		expect(screen.getAllByText("首个问题")).toHaveLength(1);
		expect(screen.queryByText("父会话内容")).toBeNull();
		expect(screen.queryByText("内部指令")).toBeNull();
		expect(screen.queryByText(/Side chat forked/)).toBeNull();
		expect(screen.getByRole("img", { name: "#1" }).getAttribute("src")).toContain("/sessions/thread/image?path=");
	});

	it("keeps inherited history hidden until a side question exists", async () => {
		page.items = [{ id: "parent", kind: "user", text: "父会话内容" }];
		await openThread();
		expect(screen.queryByText("父会话内容")).toBeNull();
	});

	it("hands off the first question while the new transcript is still inherited history", async () => {
		page.items = [{ id: "parent", kind: "assistant", text: "父会话回答" }];
		render(<SidechatPage route={route} />);
		await flush();
		await type("首个问题");
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		await flush();
		expect(screen.getAllByText("首个问题")).toHaveLength(1);
		expect(screen.queryByText("父会话回答")).toBeNull();
		page = { items: [boundary], reset: true };
		refetch(); await tick();
		expect(screen.getAllByText("首个问题")).toHaveLength(1);
	});

	it("carries a newer creation draft into the child composer", async () => {
		const ack = deferred<unknown>(); create = () => ack.promise;
		render(<SidechatPage route={route} />); await flush();
		await type("首个问题");
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		await type("创建期间的新草稿");
		await act(async () => ack.resolve({ sessionId: "thread" }));
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("创建期间的新草稿");
		expect(screen.getAllByText("首个问题")).toHaveLength(1);
	});

	it("never opens a completed creation after navigating to another parent", async () => {
		const ack = deferred<unknown>(); create = () => ack.promise;
		const view = render(<SidechatPage route={route} />); await flush();
		await type("旧父会话问题");
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		view.rerender(<SidechatPage route={{ ...route, params: { id: "other" } }} />); await flush();
		await act(async () => ack.resolve({ sessionId: "thread" }));
		expect(screen.getByPlaceholderText("问一个问题，开始辅助对话")).toBeTruthy();
		expect(apiModule.api).not.toHaveBeenCalledWith("GET", expect.stringContaining("/sessions/thread/transcript"));
	});

	it("closes an old child when the parent route changes and sends only to the newly selected child", async () => {
		const view = await openThread();
		view.rerender(<SidechatPage route={{ ...route, params: { id: "other" } }} />); await flush();
		expect(screen.getByPlaceholderText("问一个问题，开始辅助对话")).toBeTruthy();
		create = async () => ({ sessionId: "new-thread" });
		await type("新父会话问题");
		fireEvent.click(screen.getByRole("button", { name: "发送" })); await flush();
		await type("新子会话追问");
		fireEvent.click(screen.getByRole("button", { name: "发送" })); await flush();
		expect(apiModule.api).toHaveBeenCalledWith("POST", "/sessions/other/sidechats", { question: "新父会话问题", imagePaths: [] });
		expect(apiModule.api).toHaveBeenCalledWith("POST", "/sessions/new-thread/prompt-ex", expect.objectContaining({ text: "新子会话追问" }));
		expect(apiModule.api).not.toHaveBeenCalledWith("POST", "/sessions/thread/prompt-ex", expect.anything());
	});

	it("shows a follow-up before acknowledgment and never re-adds it after an earlier transcript echo", async () => {
		const ack = deferred<unknown>();
		prompt = () => ack.promise;
		await openThread();
		await type("继续问题");
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		expect(screen.getAllByText("继续问题")).toHaveLength(1);
		page = { items: [{ id: "echo", kind: "user", text: "继续问题" }], reset: false, nextOffset: 2 };
		refetch(); await tick();
		expect(screen.getAllByText("继续问题")).toHaveLength(1);
		await act(async () => ack.resolve({}));
		await tick();
		expect(screen.getAllByText("继续问题")).toHaveLength(1);
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
	});

	it("reconciles repeated identical questions one at a time, including reset pages", async () => {
		await openThread();
		for (let i = 0; i < 2; i++) {
			await type("重复问题");
			fireEvent.click(screen.getByRole("button", { name: "发送" }));
			await flush();
		}
		expect(screen.getAllByText("重复问题")).toHaveLength(2);
		const first: TranscriptItem = { id: "one", kind: "user", text: "重复问题" };
		page = { items: [boundary, first], reset: true };
		refetch(); await tick();
		expect(screen.getAllByText("重复问题")).toHaveLength(2);
		refetch(); await tick();
		expect(screen.getAllByText("重复问题")).toHaveLength(2);
		page.items.push({ ...first, id: "two" });
		refetch(); await tick();
		expect(screen.getAllByText("重复问题")).toHaveLength(2);
		expect(screen.getAllByText("重复问题").every((el) => !el.classList.contains("opacity-60"))).toBe(true);
	});

	it("keeps edits made during send even when the draft returns to the same text", async () => {
		const ack = deferred<unknown>(); prompt = () => ack.promise;
		await openThread();
		await type("发送原文");
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		await type("更新草稿");
		await type("发送原文");
		await act(async () => ack.resolve({}));
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("发送原文");
	});

	it("removes only the failed optimistic question and preserves the newer input", async () => {
		const ack = deferred<unknown>(); prompt = () => ack.promise;
		await openThread(); await type("失败问题");
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		await type("后续草稿");
		await act(async () => ack.reject(new Error("明确拒绝")));
		expect(screen.queryByText("失败问题")).toBeNull();
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("后续草稿");
		expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(false);
	});

	it.each(["working", "awaiting_answer", "awaiting_approval"] as const)("stops %s and appends withdrawn follow-ups after the current draft", async (status) => {
		useSessions.setState({ byId: { thread: { ...thread, status } } });
		abort = async () => ({ restoredTexts: ["排队问题"] });
		await openThread(); await type("排队问题");
		fireEvent.click(screen.getByRole("button", { name: "发送" })); await flush();
		expect(apiModule.api).toHaveBeenCalledWith("POST", "/sessions/thread/prompt-ex", { text: "排队问题", images: [], streamingBehavior: "followUp" });
		await type("新的草稿");
		fireEvent.click(screen.getByRole("button", { name: "停止" })); await flush();
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("新的草稿\n\n排队问题");
		expect(screen.queryByText("排队问题")).toBeNull();
		expect(apiModule.api).toHaveBeenCalledWith("POST", "/sessions/thread/abort");
	});

	it("preserves an intentionally retyped equal draft when abort withdraws the original send", async () => {
		const ack = deferred<unknown>(); prompt = () => ack.promise;
		useSessions.setState({ byId: { thread: { ...thread, status: "working" } } });
		abort = async () => ({ restoredTexts: ["相同文字"] });
		await openThread(); await type("相同文字");
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		await type("重新编辑"); await type("相同文字");
		fireEvent.click(screen.getByRole("button", { name: "停止" })); await flush();
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("相同文字\n\n相同文字");
		await act(async () => ack.resolve({}));
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("相同文字\n\n相同文字");
	});

	it("reads cross-page tool failures in full without dropping the existing messages", async () => {
		page.items.push({ id: "assistant", kind: "assistant", toolCalls: [{ id: "call", name: "bash", args: { command: "false" } }] });
		await openThread();
		const error = "Error: " + "unbroken-detail".repeat(30);
		page = { items: [{ id: "result", kind: "tool_result", toolResult: { toolCallId: "call", isError: true, text: error } }], reset: false };
		refetch(); await tick();
		fireEvent.click(screen.getByText("失败").closest("button")!);
		expect(screen.getByText(error).textContent).toBe(error);
		expect(screen.getByText("首个问题")).toBeTruthy();
		readTranscript = async () => { throw new Error(error); };
		refetch(); await tick();
		expect(screen.getByRole("alert").textContent).toContain(error);
		expect(screen.getByRole("button", { name: "重试加载" })).toBeTruthy();
		readTranscript = async () => ({ items: [boundary], reset: true });
		fireEvent.click(screen.getByRole("button", { name: "重试加载" })); await flush();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.getByText("首个问题")).toBeTruthy();
	});

	it("refreshes the visible answer during a continuous stream rather than waiting for silence", async () => {
		await openThread();
		page = { items: [{ id: "answer", kind: "assistant", text: "持续回答" }], reset: false };
		for (let i = 0; i < 4; i++) { refetch(); await tick(100); }
		expect(screen.getByText("持续回答")).toBeTruthy();
	});
});

describe("sidechat attachments", () => {
	it("aborts a removed upload and ignores its late completion", async () => {
		const uploaded = deferred<{ path: string }>();
		let signal: AbortSignal | undefined;
		vi.spyOn(apiModule, "upload").mockImplementation(async (_path, _file, options) => { signal = options?.signal; return uploaded.promise; });
		const view = await openThread();
		const picker = view.container.querySelector('input[type="file"]')!;
		fireEvent.change(picker, { target: { files: [new File(["body"], "draft.txt", { type: "text/plain" })] } });
		await flush();
		fireEvent.click(screen.getByRole("button", { name: "移除 draft.txt" }));
		expect(signal?.aborted).toBe(true);
		await act(async () => uploaded.resolve({ path: "/tmp/draft.txt" }));
		expect(screen.queryByText("draft.txt")).toBeNull();
	});

	it("keeps complete attachment failure details available through retry and removal", async () => {
		const error = "模拟失败：完整诊断信息 fixture failure, please retry safely " + "unbroken-diagnostic".repeat(12);
		const upload = vi.spyOn(apiModule, "upload").mockRejectedValueOnce(new Error(error)).mockResolvedValueOnce({ path: "/tmp/sample.txt" });
		const view = await openThread();
		await type("保留输入");
		const picker = view.container.querySelector('input[type="file"]')!;
		fireEvent.change(picker, { target: { files: [new File(["body"], "sample.txt", { type: "text/plain" })] } });
		await flush();
		expect(screen.getByText("sample.txt")).toBeTruthy();
		expect(screen.getByRole("status").textContent).toBe(error);
		fireEvent.click(screen.getByRole("button", { name: "重试上传 sample.txt" }));
		await flush();
		expect(upload).toHaveBeenCalledTimes(2);
		expect(screen.getByRole("status").textContent).toBe("已上传");
		expect(screen.queryByRole("button", { name: "重试上传 sample.txt" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "移除 sample.txt" }));
		expect(screen.queryByText("sample.txt")).toBeNull();
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("保留输入");
	});

	it("keeps failed-send attachments and removes only the sent snapshot on success", async () => {
		vi.spyOn(apiModule, "upload").mockImplementation(async (_path, _file, options) => ({ path: `/tmp/${options?.name}` }));
		const ack = deferred<unknown>(); prompt = () => ack.promise;
		const view = await openThread();
		const picker = view.container.querySelector('input[type="file"]')!;
		fireEvent.change(picker, { target: { files: [new File(["old"], "old.txt")] } }); await flush();
		await type("文件问题");
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		await act(async () => ack.reject(new Error("拒绝")));
		expect(screen.getByRole("button", { name: "移除 old.txt" })).toBeTruthy();
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("文件问题");
		const second = deferred<unknown>(); prompt = () => second.promise;
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		fireEvent.change(picker, { target: { files: [new File(["new"], "new.txt")] } }); await flush();
		await type("更新草稿");
		await act(async () => second.resolve({}));
		expect(screen.queryByRole("button", { name: "移除 old.txt" })).toBeNull();
		expect(screen.getByRole("button", { name: "移除 new.txt" })).toBeTruthy();
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("更新草稿");
	});
});
