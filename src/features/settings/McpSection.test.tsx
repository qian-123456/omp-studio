// @vitest-environment jsdom
/**
 * Settings ▸ MCP 服务器: supports project switching, project-level scoping,
 * and moving a server between global and project-scoped mcp.json files.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mcpConfigList, mcpServerMove, mcpServerRemove, mcpServerSetEnabled, confirm } =
	vi.hoisted(() => ({
		mcpConfigList: vi.fn(),
		mcpServerMove: vi.fn(),
		mcpServerRemove: vi.fn(),
		mcpServerSetEnabled: vi.fn(),
		confirm: vi.fn(),
	}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("../../lib/dialogs", () => ({
	confirmDialog: confirm,
	errMsg: (e: unknown) => String(e),
}));
vi.mock("../../lib/ipc", () => ({
	mcpConfigList,
	mcpServerMove,
	mcpServerRemove,
	mcpServerSetEnabled,
	mcpServerUpsert: vi.fn(),
}));
vi.mock("./OmpConfigSection", () => ({ OmpConfigSection: () => null }));

import { useSessions } from "../../stores/sessions";
import { McpSection } from "./McpSection";

const GLOBAL_FILE = "/home/user/.omp/agent/mcp.json";
const PROJ_FILE = "/home/user/projects/demo/.omp/mcp.json";

const MOCK_SNAPSHOT = {
	defaultWritePath: GLOBAL_FILE,
	files: [
		{ path: GLOBAL_FILE, scope: "user", exists: true, disabledServers: [], enabledServers: [] },
		{ path: PROJ_FILE, scope: "project", exists: false, disabledServers: [], enabledServers: [] },
	],
	servers: [
		{
			name: "rea",
			transport: "stdio",
			command: "npx",
			args: ["-y", "rea-agents@6.5.0", "mcp"],
			instructions: true,
			enabled: false,
			shadowed: false,
			denylisted: false,
			allowlisted: false,
			env: [],
			headers: [],
			hasAuth: false,
			hasOauth: false,
			sourceFile: GLOBAL_FILE,
			scope: "user",
		},
	],
};

beforeEach(() => {
	mcpConfigList.mockReset().mockResolvedValue(MOCK_SNAPSHOT);
	mcpServerMove.mockReset().mockResolvedValue(undefined);
	confirm.mockReset();
	useSessions.setState({
		workspaces: [
			{ id: "ws-1", name: "demo", path: "/home/user/projects/demo", kind: "project", sort: 0, mode: "code" },
			{ id: "ws-2", name: "other", path: "/home/user/projects/other", kind: "project", sort: 1, mode: "code" },
		],
	});
});

afterEach(cleanup);

describe("McpSection project management", () => {
	it("renders global server and shows move-to-project button when project is active", async () => {
		render(<McpSection cwd="/home/user/projects/demo" onNavigateSection={() => {}} />);
		expect(await screen.findByText("rea")).toBeDefined();
		const moveBtn = screen.getByLabelText("移入项目 rea");
		expect(moveBtn).toBeDefined();
		expect(moveBtn.textContent).toContain("移入当前项目");
	});

	it("calls mcpServerMove when move-to-project is confirmed", async () => {
		confirm.mockResolvedValue(true);
		render(<McpSection cwd="/home/user/projects/demo" onNavigateSection={() => {}} />);
		const moveBtn = await screen.findByLabelText("移入项目 rea");
		fireEvent.click(moveBtn);

		await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
		expect(mcpServerMove).toHaveBeenCalledWith(
			GLOBAL_FILE,
			PROJ_FILE,
			"rea",
			"/home/user/projects/demo",
		);
	});

	it("does not call mcpServerMove when confirm is cancelled", async () => {
		confirm.mockResolvedValue(false);
		render(<McpSection cwd="/home/user/projects/demo" onNavigateSection={() => {}} />);
		const moveBtn = await screen.findByLabelText("移入项目 rea");
		fireEvent.click(moveBtn);

		await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
		expect(mcpServerMove).not.toHaveBeenCalled();
	});

	it("reloads snapshot when user switches project via dropdown", async () => {
		render(<McpSection cwd={null} onNavigateSection={() => {}} />);
		await screen.findByText("rea");
		expect(mcpConfigList).toHaveBeenCalledWith(null);

		const select = screen.getByLabelText("选择要配置的项目");
		fireEvent.change(select, { target: { value: "/home/user/projects/other" } });

		await waitFor(() =>
			expect(mcpConfigList).toHaveBeenCalledWith("/home/user/projects/other"),
		);
	});
});
