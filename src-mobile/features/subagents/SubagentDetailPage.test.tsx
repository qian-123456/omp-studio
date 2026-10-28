// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "../../core/types";
import { SubagentDetailPage } from "./SubagentDetailPage";
import type { TranscriptView } from "./transcript";

const state = vi.hoisted(() => ({ view: {} as TranscriptView, messages: [] as Item[] }));
vi.mock("./transcript", () => ({ useSubagentTranscript: () => state.view }));
vi.mock("../../core/normalize", () => ({ normalizeTranscript: () => state.messages }));

const route = { name: "subagent" as const, path: "/s/session/subagents/agent", params: { id: "session", agentId: "agent" }, query: {} };

describe("SubagentDetailPage", () => {
	beforeEach(() => {
		state.view = {
			info: { agentId: "agent", summary: { id: "0-完整可读的子代理任务名称", status: "completed", model: "provider/long-model-name", tokens: 1200 }, prompt: "任务要求" },
			items: [], loading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined),
		};
		state.messages = [{
			id: "answer", role: "assistant", kind: "assistant", text: "执行结果", thinking: "完整思考内容", images: [], ts: null, streaming: false,
			tools: [{ id: "tool", name: "read", intent: "读取配置文件", args: { path: "/project/config.json" }, status: "done", result: "完整工具结果" }],
		}];
	});
	afterEach(cleanup);

	it("keeps the full agent name in the scrollable overview, not the fixed header", () => {
		render(<SubagentDetailPage route={route} />);
		expect(screen.getByText("子代理详情")).toBeTruthy();
		expect(screen.getByText("完整可读的子代理任务名称")).toBeTruthy();
		expect(screen.getByText("provider/long-model-name")).toBeTruthy();
		expect(screen.getByText("1.2k 词元")).toBeTruthy();
	});

	it("progressively discloses thinking, steps, and full tool parameters and results", () => {
		render(<SubagentDetailPage route={route} />);
		expect(screen.queryByText("完整思考内容")).toBeNull();
		expect(screen.queryByText("read")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "思考过程" }));
		expect(screen.getByText("完整思考内容")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "已运行 1 个步骤" }));
		fireEvent.click(screen.getByRole("button", { name: /read.*读取配置文件.*已完成/ }));
		expect(screen.getByText((text) => text.includes("/project/config.json"))).toBeTruthy();
		expect(screen.getByText("完整工具结果")).toBeTruthy();
		expect(screen.getByRole("button", { name: "复制参数" })).toBeTruthy();
	});

	it("uses a full-height action to expand long task requirements", () => {
		state.view.info!.prompt = "任务要求".repeat(150);
		render(<SubagentDetailPage route={route} />);
		const expand = screen.getByRole("button", { name: "展开全部" });
		expect(expand.className).toContain("min-h-11");
		fireEvent.click(expand);
		expect(screen.getByRole("button", { name: "收起" })).toBeTruthy();
	});

	it("offers an explicit retry when the detail cannot load", () => {
		state.view = { ...state.view, info: null, error: "网络连接中断" };
		render(<SubagentDetailPage route={route} />);
		expect(screen.getByText("网络连接中断")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
		expect(state.view.refresh).toHaveBeenCalledOnce();
	});

	it("keeps the first visible followup when it differs from the original assignment", () => {
		state.messages = [{ ...state.messages[0], id: "followup", role: "user", kind: "user", text: "请保留这条后续说明\n以及第二行", thinking: "", tools: [] }];
		render(<SubagentDetailPage route={route} />);
		const bubble = screen.getByText((_, element) => element?.children.length === 0 && element.textContent === "请保留这条后续说明\n以及第二行");
		expect(bubble.className).toContain("whitespace-pre-wrap");
		expect(bubble.className).toContain("px-[18px]");
		expect(bubble.className).toContain("py-3");
		expect(bubble.className).toContain("max-w-[85%]");
	});

	it("removes only the assignment already shown in the task card", () => {
		state.view.info!.prompt = "原始分配任务";
		const user: Item = { ...state.messages[0], id: "assignment", role: "user", kind: "user", text: "原始分配任务", thinking: "", tools: [] };
		state.messages = [user, state.messages[0], { ...user, id: "followup", text: "后续补充" }];
		render(<SubagentDetailPage route={route} />);
		expect(screen.getAllByText("原始分配任务")).toHaveLength(1);
		expect(screen.getByText("后续补充")).toBeTruthy();
	});

	it("shows live thinking only on the latest thinking-only message while running", () => {
		state.view.info!.summary.status = "running";
		state.messages.push({ ...state.messages[0], id: "live-thinking", text: "", thinking: "正在继续分析", tools: [] });
		const { rerender } = render(<SubagentDetailPage route={route} />);
		const thinking = screen.getByRole("button", { name: "思考中" });
		expect(screen.getByText("思考中").className).toContain("m-shimmer");
		expect(screen.getByRole("button", { name: "思考过程" })).toBeTruthy();
		fireEvent.click(thinking);
		expect(screen.getByText("正在继续分析")).toBeTruthy();
		state.view.info!.summary.status = "completed";
		rerender(<SubagentDetailPage route={route} />);
		expect(screen.queryByRole("button", { name: "思考中" })).toBeNull();
		expect(screen.getAllByRole("button", { name: "思考过程" })).toHaveLength(2);
	});

	it("shows the complete failure in a visible danger block without clipping long tokens", () => {
		const failure = `失败原因\n${"unbroken-error-token".repeat(30)}`;
		state.view.info!.summary.status = "failed";
		state.view.info!.output = failure;
		render(<SubagentDetailPage route={route} />);
		expect(screen.getByRole("alert").textContent).toContain(failure);
		const error = screen.getByRole("alert").querySelector("pre")!;
		expect(error.className).toContain("[overflow-wrap:anywhere]");
		expect(error.className).toContain("whitespace-pre-wrap");
		expect(screen.queryByText("产出")).toBeNull();
	});

	it("keeps tool failures complete and readable when their step is expanded", () => {
		const tool = state.messages[0].tools[0];
		tool.status = "error";
		tool.result = `完整工具错误\n${"long-error".repeat(50)}`;
		render(<SubagentDetailPage route={route} />);
		fireEvent.click(screen.getByRole("button", { name: /已运行 1 个步骤\s*· 有失败/ }));
		fireEvent.click(screen.getByRole("button", { name: /read.*读取配置文件.*失败/ }));
		const result = screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent === tool.result);
		expect(result.className).toContain("text-m-danger");
		expect(result.className).toContain("[overflow-wrap:anywhere]");
		expect(screen.getByRole("button", { name: "复制错误" })).toBeTruthy();
	});
});
