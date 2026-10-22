// @vitest-environment jsdom
/**
 * Settings ▸ 模型角色: the page-level scope row decides which config layer the table
 * reads and writes, so switching scope must re-read that layer, and 项目 must be
 * unreachable when there is no project to configure.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rolesRead, rolesSet } = vi.hoisted(() => ({ rolesRead: vi.fn(), rolesSet: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emit: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => Promise.resolve("0.0.0-test")) }));
vi.mock("../../lib/ipc", () => ({
	ompModelRolesRead: rolesRead,
	ompModelRolesSet: rolesSet,
	ompConfigList: vi.fn(() => Promise.resolve({ found: true, entries: [] })),
}));

import { useModelCatalog } from "../../stores/modelCatalog";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { AgentModelAssignmentsPanel } from "./AgentModelAssignmentsPanel";
import { RoleScopeBar, useRoleScope } from "./modelRoleScope";

/** The panel as `RolesSection` mounts it: scope state owned above, bar passed in. */
function Harness() {
	const roleScope = useRoleScope();
	return <AgentModelAssignmentsPanel roleScope={roleScope} scopeBar={<RoleScopeBar roleScope={roleScope} />} />;
}

const SNAPSHOT = {
	global: {
		path: "/home/u/.omp/config.yml",
		exists: true,
		modelRoles: { default: "openai/gpt-5" },
		agentModelOverrides: {},
	},
	project: null,
	agents: [],
};

const NO_PROJECT_GUIDE = "先在侧栏添加一个项目或打开一个会话";

beforeEach(() => {
	rolesRead.mockReset().mockResolvedValue(SNAPSHOT);
	rolesSet.mockReset().mockRejectedValue(new Error("unused"));
	useUi.setState({ selectedSessionId: null, lastSessionId: null });
	useSessions.setState({ sessions: {}, workspaces: [] });
});

afterEach(cleanup);

describe("模型角色 scope row", () => {
	it("disables the project scope and explains it once when there is no project", async () => {
		render(<Harness />);
		await waitFor(() => expect(screen.getByTestId("role-table")).toBeTruthy());

		const project = screen.getByRole("radio", { name: "项目" }) as HTMLButtonElement;
		expect(project.disabled).toBe(true);
		expect(project.title).toBe(NO_PROJECT_GUIDE);
		// The row's own description is the only explanation: no separate warning block.
		expect(screen.queryByText(NO_PROJECT_GUIDE)).toBeNull();
		expect(screen.getByText("对所有项目生效，不受当前会话所在项目影响。")).toBeTruthy();
		expect(rolesRead).toHaveBeenCalledWith(null, null);
	});

	it("reveals the project picker and reads the project layer once 项目 is chosen", async () => {
		useSessions.setState({
			workspaces: [{ id: "w1", name: "alpha", path: "/repo/alpha", kind: "project", sort: 0, mode: "code" }],
		});
		render(<Harness />);
		await waitFor(() => expect(rolesRead).toHaveBeenCalledWith(null, null));

		fireEvent.click(screen.getByRole("radio", { name: "项目" }));

		await waitFor(() => expect(rolesRead).toHaveBeenCalledWith("/repo/alpha", null));
		expect((screen.getByLabelText("选择要配置的项目") as HTMLSelectElement).value).toBe("/repo/alpha");
		expect(screen.getByText(/只写入/).textContent).toContain("alpha");
	});

	it("re-reads the current scope from the header action", async () => {
		render(<Harness />);
		await waitFor(() => expect(screen.getByTestId("role-table")).toBeTruthy());
		const before = rolesRead.mock.calls.length;

		const reload = screen.getByRole("button", { name: "重新读取模型角色" });
		// It is a page-level action: in the header, not inside the card.
		const header = reload.parentElement!.parentElement!;
		expect(header.contains(screen.getByRole("heading", { name: "模型角色" }))).toBe(true);
		expect(screen.getByTestId("role-table").closest("section")!.contains(reload)).toBe(false);

		fireEvent.click(reload);

		await waitFor(() => expect(rolesRead.mock.calls.length).toBe(before + 1));
	});
});

describe("模型角色 添加角色", () => {
	beforeEach(() => {
		// The model picker's FloatingLayer measures its anchor with ResizeObserver, which jsdom lacks.
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		useModelCatalog.setState({ models: [], refresh: () => Promise.resolve() });
	});

	it("writes a new custom role into the shown scope and lists it", async () => {
		rolesSet.mockResolvedValue({
			...SNAPSHOT,
			global: { ...SNAPSHOT.global, modelRoles: { default: "openai/gpt-5", reviewer: "openai/gpt-5.5" } },
		});
		render(<Harness />);
		await waitFor(() => expect(screen.getByTestId("role-table")).toBeTruthy());

		fireEvent.click(screen.getByRole("button", { name: /添加角色/ }));
		fireEvent.change(screen.getByLabelText("新角色名称"), { target: { value: "reviewer" } });
		fireEvent.click(screen.getByRole("button", { name: /选择模型/ }));
		const search = screen.getByPlaceholderText("搜索模型，或直接输入模型标识…");
		fireEvent.change(search, { target: { value: "openai/gpt-5.5" } });
		fireEvent.keyDown(search, { key: "Enter" });
		fireEvent.click(screen.getByRole("button", { name: "添加" }));

		await waitFor(() => expect(screen.queryByTestId("add-role-form")).toBeNull());
		expect(rolesSet).toHaveBeenCalledWith(null, "global", "modelRoles", "reviewer", "openai/gpt-5.5", null);
		const row = document.querySelector('[data-row-kind="role"][data-row-name="reviewer"]');
		// Nothing references the new role yet, so the row says it will not be called.
		expect(row?.textContent).toContain("未被引用，不会被调用");
	});

	it("refuses a name that is already a role without writing", async () => {
		render(<Harness />);
		await waitFor(() => expect(screen.getByTestId("role-table")).toBeTruthy());

		fireEvent.click(screen.getByRole("button", { name: /添加角色/ }));
		fireEvent.change(screen.getByLabelText("新角色名称"), { target: { value: "smol" } });
		fireEvent.click(screen.getByRole("button", { name: "添加" }));

		expect(screen.getByRole("alert").textContent).toContain("已有角色「smol」");
		expect(rolesSet).not.toHaveBeenCalled();
	});
});
