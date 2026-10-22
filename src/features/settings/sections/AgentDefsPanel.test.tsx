// @vitest-environment jsdom
/**
 * Settings ▸ 子代理 ▸ AgentDefsPanel:
 * lists built-in subagents (scout, task, reviewer, etc.) and custom agents.
 * Clicking an existing agent expands the FileEditor inline; missing ones can be configured.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { ompAgentRead, ompAgentWrite, fsReadDir, scopeSession, createSession } = vi.hoisted(() => ({
	ompAgentRead: vi.fn(),
	ompAgentWrite: vi.fn(),
	fsReadDir: vi.fn(),
	scopeSession: { current: null as string | null },
	createSession: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(() => Promise.resolve("/Users/tester")) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emit: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("../../../lib/dialogs", () => ({
	confirmDialog: vi.fn(),
	errMsg: (e: unknown) => String(e),
}));
vi.mock("../../../lib/ipc", () => ({
	ompAgentRead,
	ompAgentWrite,
	fsReadDir,
	ompConfigList: vi.fn(() => Promise.resolve({ found: true, entries: [] })),
}));
vi.mock("../../../lib/createSession", () => ({ createSession }));
vi.mock("../useAppSettings", () => ({ useSettingsScopeSessionId: () => scopeSession.current }));
vi.mock("@uiw/react-codemirror", () => ({
	default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
		<textarea data-testid="codemirror" value={value} onChange={(e) => onChange(e.target.value)} />
	),
	EditorView: { lineWrapping: {} },
}));

import { useComposer } from "../../../stores/composer";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import { AgentDefsPanel } from "./AgentDefsPanel";

const SCOUT_PATH = "/Users/tester/.omp/agent/agents/scout.md";
const PROJECT_SCOUT_PATH = "/repo/.omp/agents/scout.md";

beforeAll(() => {
	Element.prototype.scrollIntoView = () => {};
});

const disk: Record<string, string> = {};

beforeEach(() => {
	for (const key of Object.keys(disk)) delete disk[key];
	scopeSession.current = null;
	useSessions.setState({ sessions: {}, workspaces: [] });
	disk[SCOUT_PATH] = `---\nname: scout\ndescription: "Fast scout"\nmodel:\n  - "@scout"\n---\n\nScout prompt body`;

	ompAgentRead.mockReset().mockImplementation((path: string) =>
		Promise.resolve(
			disk[path] === undefined
				? { content: null, stamp: null }
				: { content: disk[path], stamp: `1-${disk[path].length}` },
		),
	);
	ompAgentWrite.mockReset().mockImplementation((path: string, content: string) => {
		disk[path] = content;
		return Promise.resolve(`2-${content.length}`);
	});

	fsReadDir.mockReset().mockImplementation((dir: string) => {
		const prefix = `${dir}/`;
		return Promise.resolve(
			Object.keys(disk)
				.filter((p) => p.startsWith(prefix))
				.map((p) => ({ name: p.slice(prefix.length), path: p, isDir: false })),
		);
	});
});

afterEach(cleanup);

describe("AgentDefsPanel", () => {
	it("says which version each agent actually uses", async () => {
		render(<AgentDefsPanel />);

		const scoutRow = await screen.findByTestId("agent-row-scout");
		expect(await within(scoutRow).findByText("正在用：全局版本")).toBeDefined();

		const taskRow = screen.getByTestId("agent-row-task");
		expect(await within(taskRow).findByText("正在用：内置版本")).toBeDefined();
	});

	it("warns when the global file is overridden by the session's project", async () => {
		scopeSession.current = "s1";
		useSessions.setState({ sessions: { s1: { cwd: "/repo" } } as never });
		disk[PROJECT_SCOUT_PATH] = "---\nname: scout\ndescription: project scout\n---\n\nProject body";
		render(<AgentDefsPanel />);

		const scoutRow = await screen.findByTestId("agent-row-scout");
		expect(await within(scoutRow).findByText("正在用：项目版本")).toBeDefined();
		expect(within(scoutRow).getByText(/「repo」另有自己的项目版本/)).toBeDefined();
	});

	it("edits any registered project picked from the list, not only the session's", async () => {
		scopeSession.current = "s1";
		useSessions.setState({
			sessions: { s1: { cwd: "/repo" } } as never,
			workspaces: [{ id: "w2", name: "other", path: "/other", kind: "project", sort: 0, mode: "code" }] as never,
		});
		disk["/other/.omp/agents/scout.md"] = "---\nname: scout\ndescription: other scout\n---\n\nOther body";
		render(<AgentDefsPanel />);

		fireEvent.click(await screen.findByRole("radio", { name: "项目" }));
		const picker = await screen.findByRole("combobox", { name: "选择要配置的项目" });
		expect((picker as HTMLSelectElement).value).toBe("/repo");
		fireEvent.change(picker, { target: { value: "/other" } });

		const scoutRow = await screen.findByTestId("agent-row-scout");
		expect(await within(scoutRow).findByText("other scout")).toBeDefined();
		const taskRow = screen.getByTestId("agent-row-task");
		fireEvent.click(await within(taskRow).findByRole("button", { name: "为 task 新建项目版本" }));
		await waitFor(() => {
			expect(ompAgentWrite).toHaveBeenCalledWith("/other/.omp/agents/task.md", expect.any(String), null);
		});
	});

	it("expands the editor on clicking an existing agent and allows saving edits", async () => {
		render(<AgentDefsPanel />);

		const toggle = await screen.findByRole("button", { name: /查看并编辑 scout/ });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		const editor = await screen.findByTestId("codemirror");
		expect((editor as HTMLTextAreaElement).value).toContain("Scout prompt body");

		// Edit and click save
		fireEvent.change(editor, { target: { value: "---\nname: scout\n---\nUpdated scout prompt" } });
		fireEvent.click(screen.getByRole("button", { name: "保存" }));

		await waitFor(() => {
			expect(ompAgentWrite).toHaveBeenCalledWith(
				SCOUT_PATH,
				"---\nname: scout\n---\nUpdated scout prompt",
				"1-84",
			);
		});
	});

	it("creates a global copy for a built-in agent without its own file", async () => {
		render(<AgentDefsPanel />);

		const taskRow = await screen.findByTestId("agent-row-task");
		const configBtn = await within(taskRow).findByRole("button", { name: "为 task 新建全局版本" });
		expect(configBtn).toBeDefined();

		fireEvent.click(configBtn);

		await waitFor(() => {
			expect(ompAgentWrite).toHaveBeenCalledWith("/Users/tester/.omp/agent/agents/task.md", expect.any(String), null);
		});
	});

	it("creates a dispatchable custom agent from the form", async () => {
		render(<AgentDefsPanel />);
		fireEvent.click(await screen.findByRole("button", { name: /新建子代理/ }));
		fireEvent.change(screen.getByLabelText("子代理名字"), { target: { value: "docs-writer" } });
		fireEvent.change(screen.getByLabelText("负责什么"), { target: { value: "Update docs: after API changes" } });
		fireEvent.change(screen.getByLabelText("工作要求"), { target: { value: "Write the docs." } });
		fireEvent.click(screen.getByRole("radio", { name: "只读" }));
		fireEvent.click(screen.getByRole("radio", { name: "复用模型角色" }));
		fireEvent.change(screen.getByLabelText("复用的模型角色"), { target: { value: "smol" } });
		fireEvent.click(screen.getByRole("button", { name: "创建子代理" }));

		const path = "/Users/tester/.omp/agent/agents/docs-writer.md";
		await waitFor(() => expect(screen.queryByTestId("new-agent-form")).toBeNull());
		expect(disk[path]).toBe(
			'---\nname: docs-writer\ndescription: "Update docs: after API changes"\ntools:\n  - "read"\n  - "grep"\n  - "glob"\n  - "find"\n  - "web_search"\nmodel: "@smol"\n---\n\nWrite the docs.\n',
		);
		expect(await screen.findByTestId("agent-row-docs-writer")).toBeDefined();
	});

	it("lets the user pick tools instead of typing them", async () => {
		render(<AgentDefsPanel />);
		fireEvent.click(await screen.findByRole("button", { name: /新建子代理/ }));
		fireEvent.change(screen.getByLabelText("子代理名字"), { target: { value: "fixer" } });
		fireEvent.change(screen.getByLabelText("负责什么"), { target: { value: "Fix bugs" } });
		fireEvent.change(screen.getByLabelText("工作要求"), { target: { value: "Fix it." } });
		fireEvent.click(screen.getByRole("radio", { name: "自己选" }));
		// Starts from the read-only set; turn off two of them and add editing + shell.
		fireEvent.click(screen.getByRole("checkbox", { name: /^web_search / }));
		fireEvent.click(screen.getByRole("checkbox", { name: /^find / }));
		fireEvent.click(screen.getByRole("checkbox", { name: /^bash / }));
		fireEvent.click(screen.getByRole("checkbox", { name: /^edit / }));
		fireEvent.click(screen.getByRole("button", { name: "创建子代理" }));

		await waitFor(() => expect(screen.queryByTestId("new-agent-form")).toBeNull());
		expect(disk["/Users/tester/.omp/agent/agents/fixer.md"]).toContain(
			'tools:\n  - "read"\n  - "grep"\n  - "glob"\n  - "edit"\n  - "bash"\n---',
		);
	});

	it("refuses a built-in agent's name and an empty description without writing", async () => {
		render(<AgentDefsPanel />);
		fireEvent.click(await screen.findByRole("button", { name: /新建子代理/ }));
		fireEvent.change(screen.getByLabelText("子代理名字"), { target: { value: "scout" } });
		fireEvent.click(screen.getByRole("button", { name: "创建子代理" }));
		expect(screen.getByRole("alert").textContent).toContain("已有子代理「scout」");

		fireEvent.change(screen.getByLabelText("子代理名字"), { target: { value: "docs-writer" } });
		fireEvent.click(screen.getByRole("button", { name: "创建子代理" }));
		expect(screen.getByRole("alert").textContent).toContain("负责什么");
		expect(ompAgentWrite).not.toHaveBeenCalled();
	});

	it("hands the filled-in fields to a new AI session as a draft", async () => {
		createSession.mockResolvedValue({ sessionId: "s-new", stub: { id: "s-new", cwd: "/Users/tester" } });
		render(<AgentDefsPanel />);
		fireEvent.click(await screen.findByRole("button", { name: /新建子代理/ }));
		fireEvent.change(screen.getByLabelText("子代理名字"), { target: { value: "docs-writer" } });
		fireEvent.click(await screen.findByRole("button", { name: /让 AI 帮我写/ }));

		await waitFor(() => expect(useUi.getState().selectedSessionId).toBe("s-new"));
		expect(createSession).toHaveBeenCalledWith({ cwd: "/Users/tester", workspaceId: null });
		const draft = useComposer.getState().drafts["s-new"] ?? "";
		expect(draft).toContain("/Users/tester/.omp/agent/agents/docs-writer.md");
		expect(draft).toContain("- 名字：docs-writer");
		expect(draft).toContain("- 负责什么、什么时候该派它：（还没想好）");
		expect(ompAgentWrite).not.toHaveBeenCalled();
	});
});
