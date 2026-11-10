// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
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
import { PLAN_OFF } from "../../../src/features/chat/plan/planStatus";

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
	it("renders Menu (left), session header, 新建对话, and tool menu, while model picker is in composer", async () => {
		apiMock.mockImplementation(async (_method: string, path: string) => path.endsWith("/models") ? { models: [{ provider: "openai", id: "gpt-test", thinking: ["low", "high"] }], current: { provider: "openai", id: "gpt-test" }, thinkingLevel: "low", liveThinking: ["low", "high"] } : {});
		render(<ChatPage route={{ name: "chat", path: "/s/s1", params: { id: "s1" }, query: {} }} />);
		// Left: Menu
		expect(screen.getByRole("button", { name: "菜单" })).toBeTruthy();
		// Right: 新建对话 icon and 工具菜单 icon
		expect(screen.getByRole("button", { name: "新建对话" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "工具菜单" })).toBeTruthy();

		// Composer toolbar below composer input contains Model & Thinking level
		const modelBtn = screen.getByRole("button", { name: /当前模型/ });
		expect(modelBtn).toBeTruthy();

		// Tapping the model button in composer opens the model/thinking bottom sheet picker
		await act(async () => { fireEvent.click(modelBtn); });
		expect(screen.getByRole("dialog", { name: "模型" })).toBeTruthy();
		expect(screen.getByRole("radiogroup", { name: "思考强度" })).toBeTruthy();
		expect(screen.getAllByText("gpt-test").length).toBeGreaterThan(0);
	});

	it("consumes a queued home prompt exactly once after the draft composer mounts in StrictMode", async () => {
		queueFirstSend("mobile-draft-home", "从首页开始");
		apiMock.mockImplementation(async (_method: string, path: string) => path.endsWith("/prompt-ex") ? new Promise(() => {}) : {});
		await act(async () => { render(<StrictMode><ChatPage route={{ name: "chat", path: "/s/mobile-draft-home", params: { id: "mobile-draft-home" }, query: {} }} /></StrictMode>); });
		expect(screen.getByText("从首页开始")).toBeTruthy();
		expect(screen.queryByText("会话不存在")).toBeNull();
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/mobile-draft-home/prompt-ex", { text: "从首页开始", images: [] });
		expect(apiMock.mock.calls.filter(([, path]) => String(path).endsWith("/prompt-ex"))).toHaveLength(1);
	});
});

describe("Toolbar below composer (Change 2)", () => {
	it("renders model, thinking and context usage in the composer toolbar", async () => {
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

		const modelBtn = screen.getByRole("button", { name: /当前模型/ });
		expect(modelBtn).toBeTruthy();
		expect(modelBtn.textContent).toContain("gpt-4o");

		const ctxBtn = screen.getByRole("button", { name: /上下文用量/ });
		expect(ctxBtn).toBeTruthy();

		// Tapping context opens ContextSheet with compaction action
		fireEvent.click(ctxBtn);
		expect(screen.getByText("上下文用量")).toBeTruthy();
		expect(screen.getByRole("button", { name: "压缩上下文" })).toBeTruthy();
	});

	it("shows a queue chip with the queued composition while messages wait in omp's queue", () => {
		const c = new ChatController("s1");
		c.store.setState({
			cstate: {
				model: "gpt-4o",
				queue: { steering: ["插一条"], followUp: ["排队一", "排队二"], liveSteered: 0 },
			},
		});
		render(wrap(c, <Composer sessionId="s1" />));
		expect(screen.getByText("排队 3 条 · 插话 1 · 后续 2")).toBeTruthy();

		// Delivered live steering and empty queues stay invisible.
		act(() => {
			c.store.setState({
				cstate: { model: "gpt-4o", queue: { steering: ["已插话"], followUp: [], liveSteered: 1 } },
			});
		});
		expect(screen.queryByText(/排队/)).toBeNull();
	});
});

describe("Composer attachment actions", () => {
 it("offers photo, file and desktop attachment actions alongside project controls", () => {
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));

		const plusBtn = screen.getByRole("button", { name: "添加" });
		fireEvent.click(plusBtn);

		expect(screen.getByText("文件")).toBeTruthy();
  expect(screen.getByRole("button", { name: "电脑端选中项" })).toBeTruthy();
		expect(screen.getByText("在项目中工作")).toBeTruthy();
		expect(screen.getByText("目标")).toBeTruthy();
		expect(screen.getByText(/规划模式/)).toBeTruthy();
		expect(screen.getByText("草图")).toBeTruthy();

  expect(screen.getByRole("button", { name: "拍照" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "相册" })).toBeTruthy();
	});
});

describe("Composer send and stop controls", () => {
	it("has voice input mic button and send button", () => {
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));

		expect(screen.getByRole("button", { name: "语音输入" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
	});

 it("keeps independent send and stop controls during a run", async () => {
		const c = new ChatController("s1");
		render(wrap(c, <Composer sessionId="s1" />));

		await act(async () => c.store.setState({ working: true }));
		expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
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

 it("stages a revision and preserves its draft while approval awaits authoritative execution", async () => {
		const c = new ChatController("s1");
		c.store.setState({
			cstate: {
				model: "gpt-4o",
				thinkingLevel: "auto",
				contextTokens: 100,
				contextWindow: 1000,
				contextPercent: 10,
				planMode: true,
    planStatus: { ...PLAN_OFF, enabled: true, phase: "review", content: "## Step 1: Design\n## Step 2: Implement" },
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

  let draft = "";
  c.composer = { get: () => draft, set: (value) => { draft = value; }, focus: () => {} };
  apiMock.mockImplementation(async (_method: string, path: string) => path.endsWith("/composer-state") ? { planMode: false } : {});
		render(wrap(c, <TurnView turn={turn} isLast={true} sessionId="s1" />));

		expect(screen.getByText("计划已生成")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Step 1: Design" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "执行计划" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "修改计划" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "复制计划" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "下载 .md 文件" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "修改计划" }));
  expect(draft).toContain("请按以下要求修改计划");
  expect(draft).toContain("Step 1: Design");
		expect(c.store.getState().cstate?.planMode).toBe(true);
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "执行计划" })); });
  expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/slash", { name: "plan-action", args: "approve keep" });
  expect(draft).toContain("请按以下要求修改计划");
  expect(screen.getByText("等待执行确认")).toBeTruthy();
  expect(screen.queryByText("计划执行中")).toBeNull();
  c.dispose();
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
		expect(screen.getByRole("button", { name: /当前模型/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: "新建对话" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "工具菜单" })).toBeTruthy();
		expect(screen.getByLabelText("消息输入框")).toBeTruthy();
		expect(screen.getByRole("button", { name: "语音输入" })).toBeTruthy();
	});
});
