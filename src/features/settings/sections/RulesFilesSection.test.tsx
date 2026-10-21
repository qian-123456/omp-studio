// @vitest-environment jsdom
/**
 * 设置 ▸ 规则文件: an existing file row is a real expand control — clicking it
 * reveals that file's editable text inline (and saves through omp_rule_write);
 * a file that does not exist yet is not clickable, it only offers 「创建」.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { ompRuleRead, ompRuleWrite, fsReadDir } = vi.hoisted(() => ({
	ompRuleRead: vi.fn(),
	ompRuleWrite: vi.fn(),
	fsReadDir: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(() => Promise.resolve("/Users/tester")) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("../../../lib/dialogs", () => ({
	confirmDialog: vi.fn(),
	errMsg: (e: unknown) => String(e),
}));
vi.mock("../../../lib/ipc", () => ({ ompRuleRead, ompRuleWrite, fsReadDir }));
vi.mock("../OmpSettingsList", () => ({
	OmpSections: ({ page }: { page: string }) => <div data-testid="omp-sections" data-page={page} />,
}));
vi.mock("../useAppSettings", () => ({ useSettingsProjectCwd: () => null }));
// CodeMirror needs real layout; a textarea exposes the same value/onChange contract.
vi.mock("@uiw/react-codemirror", () => ({
	default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
		<textarea data-testid="codemirror" value={value} onChange={(e) => onChange(e.target.value)} />
	),
	EditorView: { lineWrapping: {} },
}));

import { RulesFilesSection } from "./RulesFilesSection";

const AGENTS = "/Users/tester/.omp/agent/AGENTS.md";
const RULES = "/Users/tester/.omp/agent/RULES.md";

beforeAll(() => {
	Element.prototype.scrollIntoView = () => {};
});

/** On-disk state the mocked IPC reads back (AGENTS.md exists, RULES.md does not). */
const disk: Record<string, string> = {};

beforeEach(() => {
	for (const key of Object.keys(disk)) delete disk[key];
	disk[AGENTS] = "# AGENTS\n\n全局规则正文";
	ompRuleRead.mockReset().mockImplementation((path: string) =>
		Promise.resolve(
			disk[path] === undefined
				? { content: null, stamp: null }
				: { content: disk[path], stamp: `1-${disk[path].length}` },
		),
	);
	ompRuleWrite.mockReset().mockImplementation((path: string, content: string) => {
		disk[path] = content;
		return Promise.resolve(`2-${content.length}`);
	});
	// No rules/ directory: only the three fixed files are listed.
	fsReadDir.mockReset().mockRejectedValue(new Error("ENOENT"));
});

afterEach(cleanup);

describe("RulesFilesSection inline editing", () => {
	it("reveals the file text inside the clicked row and hides it again", async () => {
		render(<RulesFilesSection />);

		const toggle = await screen.findByRole("button", { name: /查看并编辑 AGENTS\.md/ });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		// Nothing is expanded before the click: no editor, no editable text.
		expect(screen.queryByTestId("codemirror")).toBeNull();
		expect(document.querySelector("[data-rule-row='agents-global']")?.textContent).not.toContain("全局规则正文");

		fireEvent.click(toggle);

		const editor = await screen.findByTestId("codemirror");
		expect((editor as HTMLTextAreaElement).value).toBe("# AGENTS\n\n全局规则正文");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		// The editor sits in the row it belongs to, directly after the toggle.
		const row = document.querySelector('[data-rule-row="agents-global"]');
		expect(row?.contains(editor)).toBe(true);
		expect(toggle.getAttribute("aria-controls")).toBe(row?.querySelector("[id^='rule-editor-']")?.id);

		fireEvent.click(toggle);
		await waitFor(() => expect(screen.queryByTestId("codemirror")).toBeNull());
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
	});

	it("saves edits of the revealed text through omp_rule_write with the loaded stamp", async () => {
		render(<RulesFilesSection />);
		fireEvent.click(await screen.findByRole("button", { name: /查看并编辑 AGENTS\.md/ }));

		const editor = await screen.findByTestId("codemirror");
		fireEvent.change(editor, { target: { value: "# AGENTS\n\n改过的规则" } });
		const save = screen.getByRole("button", { name: "保存" });
		await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(save);

		await waitFor(() =>
			expect(ompRuleWrite).toHaveBeenCalledWith(AGENTS, "# AGENTS\n\n改过的规则", "1-16"),
		);
	});

	it("keeps a missing file non-interactive: only 「创建」, no expand affordance", async () => {
		render(<RulesFilesSection />);
		await screen.findByRole("button", { name: /查看并编辑 AGENTS\.md/ });

		// RULES.md does not exist yet, so its row must not look or act clickable.
		expect(screen.queryByRole("button", { name: /查看并编辑 RULES\.md/ })).toBeNull();
		const row = document.querySelector('[data-rule-row="rules-md"]');
		// No expand control at all — the only action is 「创建」.
		expect(row?.querySelector("button[aria-expanded]")).toBeNull();
		expect(row?.textContent).toContain("未创建");
		expect(row?.textContent).toContain("创建");

		fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "创建" }));
		await waitFor(() => expect(ompRuleWrite).toHaveBeenCalledWith(RULES, "# RULES\n\n", null));
		// Creating a file opens it for editing right away.
		expect((await screen.findByTestId("codemirror")).closest("[data-rule-row]")).toBe(row);
	});
});
