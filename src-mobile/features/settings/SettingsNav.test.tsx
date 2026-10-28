// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SettingsPage } from "./SettingsPage";
import * as apiModule from "../../core/api";
import * as navModule from "../../core/nav";
import { usePrefs } from "../../core/stores/prefs";

vi.mock("../../core/api", () => ({
	api: vi.fn(),
	errorMessage: vi.fn((e: unknown) => String(e)),
}));

describe("SettingsPage navigation and groups", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		usePrefs.setState({ scheme: "system", extra: {} });
		vi.mocked(apiModule.api).mockImplementation((_method: string, path: string) => {
			if (path === "/left/settings") {
				return Promise.resolve({
					appVersion: "1.0.0",
					defaultModel: "claude-3-7-sonnet",
					defaultApprovalMode: "write",
					mobile: { running: true, port: 1425, lanUrl: "http://192.168.1.10:1425" },
				});
			}
			if (path === "/left/dirs") {
				return Promise.resolve({ dirs: [] });
			}
			return Promise.resolve({});
		});
	});
	afterEach(() => {
		cleanup();
	});


	it("renders all 6 group titles with exact desktop original labels", async () => {
		render(<SettingsPage />);

		await screen.findByText("通用");

		// Group 1: 常规
		expect(screen.getByText("常规")).toBeDefined();
		// Group 2: 模型
		expect(screen.getByText("模型")).toBeDefined();
		// Group 3: 会话 (group header + item both say 会话)
		expect(screen.getAllByText("会话").length).toBeGreaterThanOrEqual(1);
		// Group 4: Agent 能力
		expect(screen.getByText("Agent 能力")).toBeDefined();
		// Group 5: 连接
		expect(screen.getByText("连接")).toBeDefined();
		// Group 6: 帮助
		expect(screen.getByText("帮助")).toBeDefined();
	});

	it("renders all agreed items under each group with exact labels", async () => {
		render(<SettingsPage />);

		await screen.findByText("通用");

		// 常规: 通用, 外观, 通知, 隐私
		expect(screen.getByText("通用")).toBeDefined();
		expect(screen.getByText("外观")).toBeDefined();
		expect(screen.getByText("通知")).toBeDefined();
		expect(screen.getByText("隐私")).toBeDefined();

		// 模型: 模型与供应商, 模型角色, 思考与采样, 辅助模型, 备用模型与重试, 上下文窗口
		expect(screen.getByText("模型与供应商")).toBeDefined();
		expect(screen.getByText("模型角色")).toBeDefined();
		expect(screen.getByText("思考与采样")).toBeDefined();
		expect(screen.getByText("辅助模型")).toBeDefined();
		expect(screen.getByText("备用模型与重试")).toBeDefined();
		expect(screen.getByText("上下文窗口")).toBeDefined();

		// 会话: 会话, 收件箱, 会话体检, 规则文件, 系统提示词
		expect(screen.getByText("收件箱")).toBeDefined();
		expect(screen.getByText("会话体检")).toBeDefined();
		expect(screen.getByText("规则文件")).toBeDefined();
		expect(screen.getByText("系统提示词")).toBeDefined();

		// Agent 能力: 工具, 子代理, 记忆, 技能与命令
		expect(screen.getByText("工具")).toBeDefined();
		expect(screen.getByText("子代理")).toBeDefined();
		expect(screen.getByText("记忆")).toBeDefined();
		expect(screen.getByText("技能与命令")).toBeDefined();

		// 连接: 连接与设备, MCP 服务器, 联网搜索
		expect(screen.getByText("连接与设备")).toBeDefined();
		expect(screen.getByText("MCP 服务器")).toBeDefined();
		expect(screen.getByText("联网搜索")).toBeDefined();

		// 帮助: 使用教程, 版本与更新
		expect(screen.getByText("使用教程")).toBeDefined();
		expect(screen.getByText("版本与更新")).toBeDefined();
	});

	it("hides desktop-only items and excludes 存储空间 and 快捷键 from 常规", async () => {
		render(<SettingsPage />);

		await screen.findByText("通用");

		// Desktop-only items: 窗口标题, 防休眠, 缩放, 底栏, Dock 角标
		expect(screen.queryByText("窗口标题")).toBeNull();
		expect(screen.queryByText("防休眠")).toBeNull();
		expect(screen.queryByText("缩放")).toBeNull();
		expect(screen.queryByText("底栏")).toBeNull();
		expect(screen.queryByText("Dock 角标")).toBeNull();

		// Excluded from 常规: 存储空间, 快捷键
		expect(screen.queryByText("存储空间")).toBeNull();
		expect(screen.queryByText("快捷键")).toBeNull();
	});

	it("opens the General bottom sheet on tapping 通用", async () => {
		render(<SettingsPage />);

		const generalBtn = await screen.findByText("通用");
		fireEvent.click(generalBtn);

		// Bottom sheet title should appear
		expect(await screen.findByText("通用设置")).toBeDefined();
		expect(screen.getByText("审批权限模式")).toBeDefined();
	});

	it("opens the Appearance bottom sheet on tapping 外观", async () => {
		render(<SettingsPage />);

		const appearanceBtn = await screen.findByText("外观");
		fireEvent.click(appearanceBtn);

		expect(await screen.findByText("外观设置")).toBeDefined();
		expect(screen.getByRole("switch", { name: "默认展开步骤" })).toBeDefined();
		expect(screen.getByRole("radiogroup", { name: "色彩模式" })).toBeDefined();
		expect(screen.getByRole("radiogroup", { name: "对话字号" })).toBeDefined();
	});

	it("keeps system, light, and dark appearance choices editable and persisted locally", async () => {
		render(<SettingsPage />);
		fireEvent.click(await screen.findByText("外观"));

		for (const [label, value] of [["浅色", "light"], ["深色", "dark"], ["跟随系统", "system"]] as const) {
			const option = screen.getByRole("radio", { name: label });
			fireEvent.click(option);
			expect(option.getAttribute("aria-checked")).toBe("true");
			expect(usePrefs.getState().scheme).toBe(value);
		}

		fireEvent.click(screen.getByRole("radio", { name: "特大" }));
		expect(usePrefs.getState().extra.msgSize).toBe("xl");
		fireEvent.click(screen.getByRole("switch", { name: "默认展开步骤" }));
		expect(usePrefs.getState().extra.foldOpen).toBe(true);
		expect(apiModule.api).not.toHaveBeenCalledWith("POST", expect.anything(), expect.anything());
	});

	it("opens the Doctor bottom sheet on tapping 会话体检", async () => {
		render(<SettingsPage />);

		const doctorBtn = await screen.findByText("会话体检");
		fireEvent.click(doctorBtn);

		expect(await screen.findByText("会话体检 (只读)")).toBeDefined();
		expect(screen.getByText("长期共性问题 Top 3")).toBeDefined();
		expect(screen.getByText("健康指标监控")).toBeDefined();
	});

	it("opens the Rules Files bottom sheet on tapping 规则文件", async () => {
		render(<SettingsPage />);

		const rulesBtn = await screen.findByText("规则文件");
		fireEvent.click(rulesBtn);

		expect(await screen.findByText("规则文件 (查看并编辑)")).toBeDefined();
		expect(screen.getByText("AGENTS.md")).toBeDefined();
		expect(screen.getByText("RULES.md")).toBeDefined();
	});

	it("opens the Subagents bottom sheet on tapping 子代理", async () => {
		render(<SettingsPage />);

		const subagentsBtn = await screen.findByText("子代理");
		fireEvent.click(subagentsBtn);

		expect(await screen.findByText("子代理管理")).toBeDefined();
		expect(screen.getByText("新建子代理")).toBeDefined();
		expect(screen.getByText("scout")).toBeDefined();
		expect(screen.getByText("task")).toBeDefined();
	});

	it("navigates to named routes when tapping routing items", async () => {
		const pushSpy = vi.spyOn(navModule.nav, "push").mockImplementation(() => {});

		render(<SettingsPage />);

		const rolesBtn = await screen.findByText("模型角色");
		fireEvent.click(rolesBtn);
		expect(pushSpy).toHaveBeenCalledWith("/settings/roles");

		const providersBtn = screen.getByText("模型与供应商");
		fireEvent.click(providersBtn);
		expect(pushSpy).toHaveBeenCalledWith("/settings/providers");

		const quotaBtn = screen.getByText("订阅与配额");
		fireEvent.click(quotaBtn);
		expect(pushSpy).toHaveBeenCalledWith("/quota");
	});

	it("scopes roles to the project picked in 配置范围", async () => {
		vi.mocked(apiModule.api).mockImplementation((_m: string, path: string) =>
			Promise.resolve(path === "/left/dirs" ? { dirs: [{ path: "/p/app", label: "app" }] } : { defaultApprovalMode: "write" }),
		);
		const pushSpy = vi.spyOn(navModule.nav, "push").mockImplementation(() => {});
		render(<SettingsPage />);

		fireEvent.click(await screen.findByText("配置范围"));
		fireEvent.click(await screen.findByText("app"));
		fireEvent.click(screen.getByText("模型角色"));
		expect(pushSpy).toHaveBeenCalledWith("/settings/roles?cwd=%2Fp%2Fapp");
	});

	it("shows the desktop's current OMP values in the 工具 sheet", async () => {
		vi.mocked(apiModule.api).mockImplementation((_m: string, path: string) =>
			Promise.resolve(path === "/left/dirs" ? { dirs: [] } : { omp: { "ask.enabled": false, "bash.autoBackground.enabled": true } }),
		);
		render(<SettingsPage />);

		fireEvent.click(await screen.findByText("工具"));
		expect((await screen.findByRole("switch", { name: "允许智能体向我提问" })).getAttribute("aria-checked")).toBe("false");
		expect(screen.getByRole("switch", { name: "长命令自动转后台" }).getAttribute("aria-checked")).toBe("true");
		// Keys the desktop did not return are hidden instead of showing made-up defaults.
		expect(screen.queryByText("工具最长超时")).toBeNull();
	});
});
