// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTranscript } from "../../../core/normalize";
import { ChatCtx } from "../ChatContext";
import { ChatController } from "../chatStore";
import { Composer } from "../components/Composer";
import { MessageList } from "../components/MessageList";
import { draftBook } from "../lib/drafts";
import { buildBlocks } from "../lib/turns";
import { clearUnsent } from "../lib/unsent";
import { makeTranscript } from "./harness";

vi.mock("../../../core/api", async (orig) => {
	const real = await orig<typeof import("../../../core/api")>();
	return { ...real, api: vi.fn().mockResolvedValue({}) };
});

class RO {
	observe() {}
	disconnect() {}
	unobserve() {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", RO);
	vi.useFakeTimers();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("chat bench harness", () => {
	it("generates a transcript with tool results", () => {
		const raw = makeTranscript(150);
		expect(raw.filter((r) => r.kind === "user")).toHaveLength(150);
		expect(raw.some((r) => r.kind === "tool_result")).toBe(true);
	});

	it("keeps a composed draft while streamed messages update and submits it", async () => {
		const id = "bench-smoke-session";
		const controller = new ChatController(id);
		const items = normalizeTranscript(makeTranscript(150));
		controller.store.setState({ loaded: true, blocks: buildBlocks(items, {}), transcript: { items, offset: 0, tailId: null, stats: {} } });
		const view = render(
			<ChatCtx.Provider value={{ controller, openActions: () => {}, openStat: () => {} }}>
				<MessageList sessionId={id} />
				<Composer sessionId={id} />
			</ChatCtx.Provider>,
		);
		try {
			expect(screen.getByText("请帮我处理第 149 个任务，并说明原因。")).toBeTruthy();
			expect(screen.getByText("结果 149")).toBeTruthy();
			const input = screen.getByLabelText("消息输入框") as HTMLTextAreaElement;
			const send = screen.getByLabelText("发送") as HTMLButtonElement;
			expect(send.disabled).toBe(true);

			const live = { id: "__live", role: "assistant" as const, kind: "assistant" as const, text: "流式第一段", thinking: "", tools: [], images: [], ts: null, streaming: true };
			act(() => controller.store.setState({ working: true, live }));
			expect(screen.getByText("流式第一段")).toBeTruthy();
			fireEvent.compositionStart(input);
			fireEvent.input(input, { target: { value: "ni" } });
			expect(input.value).toBe("ni");
			act(() => controller.store.setState({ live: { ...live, text: "流式第一段，继续输出" } }));
			expect(screen.getByText("流式第一段，继续输出")).toBeTruthy();
			expect(input.value).toBe("ni");
			expect(send.disabled).toBe(true);

			fireEvent.input(input, { target: { value: "你好" } });
			fireEvent.compositionEnd(input);
			await act(async () => { vi.advanceTimersToNextFrame(); });
			expect(input.value).toBe("你好");
			expect(send.disabled).toBe(false);
			fireEvent.input(input, { target: { value: "你好，补充说明" } });
			await act(async () => { vi.advanceTimersToNextFrame(); });
			expect(input.value).toBe("你好，补充说明");
			expect(send.disabled).toBe(false);
			act(() => controller.store.setState({ live: { ...live, text: "流式第一段，继续输出，完成" } }));
			expect(screen.getByText("流式第一段，继续输出，完成")).toBeTruthy();
			expect(input.value).toBe("你好，补充说明");

			await act(async () => { fireEvent.click(send); });
			expect(input.value).toBe("");
			expect(send.disabled).toBe(true);
			expect(screen.getByText("你好，补充说明")).toBeTruthy();
		} finally {
			view.unmount();
			controller.dispose();
			draftBook.forget(id);
			clearUnsent(id);
			localStorage.removeItem(`omp.mobile.delivery.${id}`);
		}
	});
});
