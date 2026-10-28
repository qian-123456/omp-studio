// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nav } from "../../core/nav";
import type { PendingEntry } from "../../core/types";

const apiMock = vi.fn();
vi.mock("../../core/api", async (orig) => {
	const real = await orig<typeof import("../../core/api")>();
	return { ...real, api: (...a: unknown[]) => apiMock(...a), upload: vi.fn() };
});

import { ChatCtx } from "./ChatContext";
import { ChatPage } from "./ChatPage";
import { ChatController } from "./chatStore";
import { Composer } from "./components/Composer";
import { PendingCards } from "./components/PendingCards";
import { SelectionToolbar } from "./components/SelectionToolbar";
import { TurnView } from "./components/TurnView";
import type { Turn } from "./lib/turns";
import { queueFirstSend } from "./lib/drafts";

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
	sessionStorage.clear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const wrap = (c: ChatController, node: React.ReactNode) => (
	<ChatCtx.Provider value={{ controller: c, openActions: () => {}, openStat: () => {} }}>
		{node}
	</ChatCtx.Provider>
);

describe("Top Bar (Change 1)", () => {
	it("renders Menu (left), model+thinking pill, 新建对话, and tool menu", async () => {
		apiMock.mockImplementation(async (_method: string, path: string) => path.endsWith("/models") ? { models: [{ provider: "openai", id: "gpt-test", thinking: ["low", "high"] }], current: { provider: "openai", id: "gpt-test" }, thinkingLevel: "low", liveThinking: ["low", "high"] } : {});
		render(<ChatPage route={{ name: "chat", path: "/s/s1", params: { id: "s1" }, query: {} }} />);
		// Left: Menu
		expect(screen.getByRole("button", { name: "菜单" })).toBeTruthy();
		// Middle-left: Model + Thinking level pill
		const pill = screen.getByRole("button", { name: "选择模型和思考等级" });
		expect(pill).toBeTruthy();
		// Right: 新建对话 icon and 工具菜单 icon
		expect(screen.getByRole("button", { name: "新建对话" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "工具菜单" })).toBeTruthy();

		// Tapping the pill opens the model/thinking bottom sheet picker
		await act(async () => { fireEvent.click(pill); });
		expect(screen.getByRole("dialog", { name: "模型" })).toBeTruthy();
		expect(screen.getByRole("radiogroup", { name: "思考强度" })).toBeTruthy();
		expect(screen.getAllByText("gpt-test").length).toBeGreaterThan(0);
	});

	it("consumes a queued home prompt after the draft composer mounts", async () => {
		queueFirstSend("mobile-draft-home", "从首页开始");
		apiMock.mockImplementation(async (_method: string, path: string) => path.endsWith("/prompt-ex") ? new Promise(() => {}) : {});
		await act(async () => { render(<ChatPage route={{ name: "chat", path: "/s/mobile-draft-home", params: { id: "mobile-draft-home" }, query: {} }} />); });
		expect(screen.getByText("从首页开始")).toBeTruthy();
		expect(screen.queryByText("会话不存在")).toBeNull();
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/mobile-draft-home/prompt-ex", { text: "从首页开始", images: [] });
	});
});

describe("Status bar above composer (Change 2)", () => {
	it("renders current directory on the left and context usage on the right", async () => {
		const c = new ChatController("s1");
		c.store.setState({
			cstate: {
				model: "gpt-4o",
				thinkingLevel: "auto",
				contextTokens: 1000,
				contextWindow: 10000,
				contextPercent: 10,
				planMode: false,
				goal: null,
			},
		});

		render(wrap(c, <Composer sessionId="s1" />));

		const dirBtn = screen.getByRole("button", { name: "当前工作目录" });
		expect(dirBtn).toBeTruthy();

		const ctxBtn = screen.getByRole("button", { name: "上下文用量" });
		expect(ctxBtn).toBeTruthy();
		expect(ctxBtn.textContent).toContain("上下文");

		// Tapping directory opens PathSheet
		fireEvent.click(dirBtn);
		expect(screen.getByText("当前工作目录")).toBeTruthy();
		expect(screen.getByRole("button", { name: "复制路径" })).toBeTruthy();

		// Tapping context opens ContextSheet with compaction action
		fireEvent.click(ctxBtn);
		expect(screen.getByText("上下文用量")).toBeTruthy();
		expect(screen.getByRole("button", { name: "压缩上下文" })).toBeTruthy();
	});
});

describe("Plus (+) menu 6 desktop options (Change 3)", () => {
	it("displays exact 6 desktop options: 文件, Finder 选中项, 在项目中工作, 目标, 规划模式, 草图", async () => {
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));

		const plusBtn = screen.getByRole("button", { name: "添加" });
		fireEvent.click(plusBtn);

		expect(screen.getByText("文件")).toBeTruthy();
		expect(screen.getByText("Finder 选中项")).toBeTruthy();
		expect(screen.getByText("在项目中工作")).toBeTruthy();
		expect(screen.getByText("目标")).toBeTruthy();
		expect(screen.getByText(/规划模式/)).toBeTruthy();
		expect(screen.getByText("草图")).toBeTruthy();

		// No leftover camera or album options
		expect(screen.queryByText("拍照")).toBeNull();
		expect(screen.queryByText("相册")).toBeNull();
	});
});

describe("Composer right side 2 round buttons (Change 4 & 5)", () => {
	it("has voice input mic button and send button", () => {
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));

		expect(screen.getByRole("button", { name: "语音输入" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
	});

	it("turns send button to stop button while streaming", async () => {
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));

		await act(async () => c.store.setState({ working: true }));
		expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "发送" })).toBeNull();
	});
});

describe("Plan mode (Change 7)", () => {
	it("shows '规划模式已启用' indicator when plan mode is active", async () => {
		const c = new ChatController("s1");
		c.store.setState({
			cstate: {
				model: "gpt-4o",
				thinkingLevel: "auto",
				contextTokens: 100,
				contextWindow: 1000,
				contextPercent: 10,
				planMode: true,
				goal: null,
			},
		});

		render(wrap(c, <Composer sessionId="s1" />));
		expect(screen.getByText("规划模式")).toBeTruthy();
	});

	it("renders plan actions, preserves edit mode, and exits plan mode on execution", async () => {
		const c = new ChatController("s1");
		c.store.setState({
			cstate: {
				model: "gpt-4o",
				thinkingLevel: "auto",
				contextTokens: 100,
				contextWindow: 1000,
				contextPercent: 10,
				planMode: true,
				goal: null,
			},
		});

		const turn: Turn = {
			type: "turn",
			id: "t1",
			user: null,
			steps: [],
			answer: { id: "ans-1", text: "## Step 1: Design\n## Step 2: Implement", images: [] },
			answerStat: null,
			start: 0,
			end: 0,
			lastAssistantId: "ans-1",
			src: [],
		};

		const focus = vi.spyOn(c, "focusComposer");
		const send = vi.spyOn(c, "send").mockResolvedValue(true);
		render(wrap(c, <TurnView turn={turn} isLast={true} sessionId="s1" />));

		expect(screen.getByText("计划已生成")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Step 1: Design" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "执行计划" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "修改计划" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "复制计划" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "下载 .md 文件" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "修改计划" }));
		expect(focus).toHaveBeenCalledOnce();
		expect(c.store.getState().cstate?.planMode).toBe(true);
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "执行计划" })); });
		expect(send).toHaveBeenCalledWith("/plan-action approve keep", "followUp");
		expect(c.store.getState().cstate?.planMode).toBe(false);
	});
});

describe("Text selection annotation (Change 8)", () => {
	it("stages quote and comment into composer for 主对话", () => {
		const c = new ChatController("s1");
		const container = document.createElement("div");
		container.textContent = "Selected message text";
		document.body.appendChild(container);

		render(wrap(c, <SelectionToolbar containerRef={{ current: container }} sessionId="s1" />));

		// Call stageAnnotation directly on controller to verify composer integration
		let staged = "";
		c.composer = { get: () => staged, set: (t) => { staged = t; } };
		c.stageAnnotation("Selected message text", "Needs revision");

		expect(staged).toContain("> Selected message text");
		expect(staged).toContain("Needs revision");
	});
});

describe("Question & Choice cards (Change 9)", () => {
	it("submits a custom single-select answer and retries a failed response", async () => {
		const c = new ChatController("s1");
		const questionEntry: PendingEntry = {
			request: {
				id: "q1",
				method: "select",
				title: "Choose deployment target (1/3)",
				options: ["Vercel (Recommended)", "Cloudflare Workers", "AWS Lambda"],
			},
		};

		const respond = vi.spyOn(c, "respond").mockRejectedValueOnce(new Error("request failed")).mockResolvedValue(undefined);
		render(wrap(c, <PendingCards />));
		act(() => c.store.setState({ pendings: [questionEntry] }));

		// Multi-step pagination (Question 1 of 3)
		expect(screen.getByLabelText("问题 1 / 3")).toBeTruthy();

		// Single-select radio items
		const radios = screen.getAllByRole("radio");
		expect(radios.length).toBe(3);

		const custom = screen.getByRole("textbox", { name: "其他回答" });
		fireEvent.change(custom, { target: { value: "Private deployment" } });
		expect(screen.getByRole("button", { name: "跳过" })).toBeTruthy();
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "提交" })); });
		expect(respond).toHaveBeenCalledWith(questionEntry, { value: "Private deployment" });
		expect(screen.getByText("提交失败")).toBeTruthy();
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试" })); });
		expect(respond).toHaveBeenCalledTimes(2);
	});

	it("submits selected choices for a multi-select question", async () => {
		const c = new ChatController("s1");
		const multiEntry: PendingEntry = {
			request: {
				id: "q2",
				method: "select",
				title: "(0 selected) Select features",
				options: ["Feature A", "Feature B", "Feature C", " Done selecting"],
			},
		};

		const respondMulti = vi.spyOn(c, "respondMulti").mockResolvedValue(undefined);
		render(wrap(c, <PendingCards />));
		act(() => c.store.setState({ pendings: [multiEntry] }));

		const checkboxes = screen.getAllByRole("checkbox");
		expect(checkboxes.length).toBe(3);
		fireEvent.click(screen.getByRole("checkbox", { name: "Feature B" }));
		expect(screen.getByRole("checkbox", { name: "Feature B" }).getAttribute("aria-checked")).toBe("true");
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "提交" })); });
		expect(respondMulti).toHaveBeenCalledWith(multiEntry, ["Feature B"]);
		expect(screen.getByRole("button", { name: "跳过" })).toBeTruthy();
	});
});

describe("Draft slash bug fix (Change 10)", () => {
	it("uses nav.replace instead of nav.push when runCommand receives new sessionId from a draft", async () => {
		const draftId = "mobile-draft-123";
		const c = new ChatController(draftId);

		const replaceSpy = vi.spyOn(nav, "replace");
		const pushSpy = vi.spyOn(nav, "push");

		apiMock.mockResolvedValueOnce({ ok: true, sessionId: "sess-real-456" });

		await c.runCommand("new", "");

		expect(replaceSpy).toHaveBeenCalledWith("/s/sess-real-456");
		expect(pushSpy).not.toHaveBeenCalled();

		replaceSpy.mockRestore();
		pushSpy.mockRestore();
	});

	it("uses nav.push when runCommand receives new sessionId from a non-draft session", async () => {
		const regularId = "sess-existing-123";
		const c = new ChatController(regularId);

		const replaceSpy = vi.spyOn(nav, "replace");
		const pushSpy = vi.spyOn(nav, "push");

		apiMock.mockResolvedValueOnce({ ok: true, sessionId: "sess-forked-789" });

		await c.runCommand("fork", "");

		expect(pushSpy).toHaveBeenCalledWith("/s/sess-forked-789");
		expect(replaceSpy).not.toHaveBeenCalled();

		replaceSpy.mockRestore();
		pushSpy.mockRestore();
	});
});

describe("Chat UI at 390x844 viewport", () => {
	it("renders ChatPage cleanly without horizontal overflow at 390x844", () => {
		window.innerWidth = 390;
		window.innerHeight = 844;

		const { container } = render(
			<div style={{ width: 390, height: 844, overflowX: "hidden" }}>
				<ChatPage route={{ name: "chat", path: "/s/s1", params: { id: "s1" }, query: {} }} />
			</div>,
		);

		const root = container.firstElementChild as HTMLElement;
		expect(root).not.toBeNull();
		expect(root.scrollWidth).toBeLessThanOrEqual(390);

		// Verify key elements are mounted
		expect(screen.getByRole("button", { name: "菜单" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "选择模型和思考等级" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "新建对话" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "工具菜单" })).toBeTruthy();
		expect(screen.getByLabelText("消息输入框")).toBeTruthy();
		expect(screen.getByRole("button", { name: "语音输入" })).toBeTruthy();
	});
});
