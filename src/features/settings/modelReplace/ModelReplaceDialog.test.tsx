// @vitest-environment jsdom
/**
 * 批量替换模型 dialog wiring: scan overview → pick X/Y (per kind) → preview
 * (grouped rows, skipped project, notice) → apply (payload + record id) → retry
 * of the failed items with the same record id → history undo; plus back
 * navigation (state kept), step chips, the post-apply lock and the
 * chat-only thinking level.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { scanMock, applyMock, historyMock, undoMock, probeMock, invalidateMock, listModelsMock, kindCatalogMock } =
	vi.hoisted(() => ({
		scanMock: vi.fn(),
		applyMock: vi.fn(),
		historyMock: vi.fn(),
		undoMock: vi.fn(),
		probeMock: vi.fn(),
		invalidateMock: vi.fn(),
		listModelsMock: vi.fn(),
		kindCatalogMock: vi.fn(),
	}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emit: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => Promise.resolve("0.0.0-test")) }));
vi.mock("../../../lib/ipc", () => ({
	modelUsageScan: scanMock,
	modelReplaceApply: applyMock,
	modelReplaceHistory: historyMock,
	modelReplaceUndo: undoMock,
	modelProbe: probeMock,
	modelKindCatalog: kindCatalogMock,
	listModels: listModelsMock,
}));
vi.mock("./store", () => ({ invalidateAfterModelReplace: invalidateMock }));

import type { ModelReplaceEdit, ModelReplaceResult } from "../../../lib/contracts";
import { useModelSelectPrefs } from "../../../components/modelSelectPrefs";
import { resolveThinkingLevels } from "../../../lib/models";
import { useModelCatalog } from "../../../stores/modelCatalog";
import { useModelKindCatalog } from "./kinds";
import { ModelReplaceDialog } from "./ModelReplaceDialog";

const OPUS = "anthropic/claude-opus";
const GPT = "openai/gpt-5";
const EXA = "web/exa";

const MINI = "openai/gpt-mini";
const PLAIN = "openai/gpt-plain";
/** Real catalog shapes: a model with max, one that tops out below it, and one without thinking. */
const GPT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const MINI_LEVELS = ["minimal", "low", "medium"];

const KIND_ENTRIES = [
	{ selector: GPT, kind: "chat", provider: "openai", name: "gpt-5", thinking: GPT_LEVELS },
	{ selector: MINI, kind: "chat", provider: "openai", name: "gpt-mini", thinking: MINI_LEVELS },
	{ selector: PLAIN, kind: "chat", provider: "openai", name: "gpt-plain", thinking: [] },
	{ selector: EXA, kind: "search", provider: "web", name: "Exa", thinking: [] },
];

const SCAN = {
	refs: [
		{ location: { kind: "role", scope: "global", projectPath: null, name: "default" }, value: OPUS, thinking: null },
		{ location: { kind: "appSetting", field: "doctorModel" }, value: GPT, thinking: null },
	],
	fallbackChains: { chains: { default: [OPUS, "@smol"] } },
	fallbackChainsError: null,
	projects: [{ path: "/repo/alpha", name: "alpha", status: "missing", error: null }],
};

const ROLE_EDIT: ModelReplaceEdit = {
	kind: "value",
	location: { kind: "role", scope: "global", projectPath: null, name: "default" },
	before: OPUS,
	after: GPT,
	thinkingBefore: null,
	thinkingAfter: null,
};
const CHAIN_EDIT: ModelReplaceEdit = {
	kind: "fallbackChain",
	label: "default",
	changes: [{ key: "default", before: [OPUS, "@smol"], after: [GPT, "@smol"] }],
};

const REPLACE_BUTTON_TITLE = "把这个模型的所有引用换成另一个模型";

beforeAll(() => {
	// FloatingLayer measures its anchor with ResizeObserver, which jsdom lacks.
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
});

beforeEach(() => {
	scanMock.mockReset().mockResolvedValue(SCAN);
	historyMock.mockReset().mockResolvedValue([]);
	undoMock.mockReset().mockRejectedValue(new Error("unused"));
	probeMock.mockReset().mockResolvedValue({ ok: true, latencyMs: 12, detail: "pong" });
	kindCatalogMock.mockReset().mockResolvedValue(KIND_ENTRIES);
	listModelsMock.mockReset().mockResolvedValue([
		{ provider: "openai", id: "gpt-5", name: "gpt-5", thinking: [], contextWindow: null },
	]);
	applyMock.mockReset().mockResolvedValue({ recordId: "rec-1", results: [] });
	invalidateMock.mockReset();
	localStorage.clear();
	// Recent models live in a module-global store; start from an empty list.
	useModelSelectPrefs.setState({ recent: [], dismissedGuides: [] });
	// Both stores are module-global; start every test from "never loaded".
	useModelCatalog.setState({ models: null, loading: false });
	useModelKindCatalog.setState({ entries: null, kindBySelector: new Map(), loading: false, error: null });
});

afterEach(cleanup);

/** Open the dialog and pick OPUS (the only model missing from the kind catalogue) as the source. */
async function openConfigure() {
	render(<ModelReplaceDialog onClose={() => undefined} />);
	// Section titles only render once the kind catalogue has loaded and rows are stable.
	await screen.findByText(/模型目录中找不到/);
	fireEvent.click((await screen.findAllByTitle(REPLACE_BUTTON_TITLE))[0]);
	await screen.findByRole("button", { name: "预览改动" });
}

/** Open the target picker, optionally switch the kind tab, and click a model row in the provider-grouped menu. */
async function pickTarget(selector: string, tab?: string) {
	fireEvent.click(screen.getByTitle(/^选择目标模型$|^[a-z0-9-]+\/.+$/));
	if (tab) fireEvent.click(await screen.findByRole("tab", { name: tab }));
	// The picker may open on 常用 once a model was picked; select the provider group explicitly.
	const provider = selector.slice(0, selector.indexOf("/"));
	fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${provider}\\s*\\d`) }));
	const id = selector.slice(selector.indexOf("/") + 1);
	fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`) }));
}

/** Scan → pick X → pick Y from the catalogue → preview. */
async function openPreview() {
	await openConfigure();
	await pickTarget(GPT);
	fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
	await screen.findByText("回退链条目");
}

async function applyAll() {
	applyMock.mockResolvedValueOnce({
		recordId: "rec-2",
		results: [
			{ edit: ROLE_EDIT, ok: true, error: null },
			{ edit: CHAIN_EDIT, ok: true, error: null },
		],
	});
	fireEvent.click(screen.getByRole("button", { name: /^应用 \d+ 项$/ }));
	await screen.findByText("成功 2");
}

describe("批量替换模型 dialog", () => {
	it("previews grouped rows, the skipped project and the scope notice", async () => {
		await openPreview();
		expect(screen.getByText("回退链")).toBeTruthy();
		expect(screen.getByText("仅覆盖在本桌面端添加的项目")).toBeTruthy();
		expect(screen.getByText("目录不存在")).toBeTruthy();
		expect(screen.getByRole("button", { name: "应用 2 项" })).toBeTruthy();
	});

	it("replaces only inside the chosen project scope, with search active", async () => {
		const PROJECT_EDIT: ModelReplaceEdit = {
			kind: "value",
			location: { kind: "role", scope: "project", projectPath: "/repo/alpha", name: "smol" },
			before: OPUS,
			after: GPT,
			thinkingBefore: null,
			thinkingAfter: null,
		};
		scanMock.mockResolvedValue({
			...SCAN,
			refs: [...SCAN.refs, { location: PROJECT_EDIT.location, value: OPUS, thinking: null }],
			projects: [{ path: "/repo/alpha", name: "alpha", status: "ok", error: null }],
		});
		render(<ModelReplaceDialog onClose={() => undefined} />);
		await screen.findByText(/模型目录中找不到/);

		fireEvent.change(screen.getByLabelText("搜索模型引用"), { target: { value: "CLAUDE" } });
		fireEvent.change(screen.getByLabelText("替换范围"), { target: { value: "project:/repo/alpha" } });
		fireEvent.click((await screen.findAllByTitle(REPLACE_BUTTON_TITLE))[0]);
		await pickTarget(GPT);
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		await screen.findByText("范围：项目：alpha");

		applyMock.mockResolvedValueOnce({ recordId: "rec-3", results: [{ edit: PROJECT_EDIT, ok: true, error: null }] });
		fireEvent.click(screen.getByRole("button", { name: "应用 1 项" }));
		await screen.findByText("成功 1");
		expect(applyMock).toHaveBeenCalledWith(OPUS, GPT, [PROJECT_EDIT], null);
	});

	it("applies the planned edits, then retries the failures on the same record", async () => {
		await openPreview();
		applyMock.mockResolvedValueOnce({
			recordId: "rec-1",
			results: [
				{ edit: ROLE_EDIT, ok: true, error: null },
				{ edit: CHAIN_EDIT, ok: false, error: "回退链写入失败" },
			],
		});
		fireEvent.click(screen.getByRole("button", { name: "应用 2 项" }));

		await screen.findByText("回退链写入失败");
		expect(applyMock).toHaveBeenCalledWith(OPUS, GPT, [ROLE_EDIT, CHAIN_EDIT], null);
		expect(invalidateMock).toHaveBeenCalled();
		expect(screen.getByText("成功 1")).toBeTruthy();

		const retry: ModelReplaceResult = { recordId: "rec-1", results: [{ edit: CHAIN_EDIT, ok: true, error: null }] };
		applyMock.mockResolvedValueOnce(retry);
		fireEvent.click(screen.getByRole("button", { name: /重试失败项/ }));

		await screen.findByText("成功 2");
		expect(applyMock).toHaveBeenLastCalledWith(OPUS, GPT, [CHAIN_EDIT], "rec-1");
	});

	it("lists history and reports the outcome of an undo", async () => {
		historyMock.mockResolvedValue([
			{
				id: "rec-1",
				createdAt: new Date().toISOString(),
				fromModel: OPUS,
				toModel: GPT,
				edits: [ROLE_EDIT],
				undoneAt: null,
			},
		]);
		undoMock.mockResolvedValue({
			recordId: "rec-1",
			results: [{ edit: ROLE_EDIT, ok: false, error: "当前值已被修改，已跳过" }],
		});

		render(<ModelReplaceDialog onClose={() => undefined} />);
		fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
		await screen.findByText(/anthropic\/claude-opus → openai\/gpt-5/);

		fireEvent.click(screen.getByRole("button", { name: /撤销/ }));
		await screen.findByText("当前值已被修改，已跳过");
		expect(undoMock).toHaveBeenCalledWith("rec-1");
		expect(invalidateMock).toHaveBeenCalled();
	});

	it("returns to the overview from the results page instead of closing", async () => {
		const onClose = vi.fn();
		render(<ModelReplaceDialog onClose={onClose} />);
		await screen.findByText(/模型目录中找不到/);
		fireEvent.click((await screen.findAllByTitle(REPLACE_BUTTON_TITLE))[0]);
		await pickTarget(GPT);
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		applyMock.mockResolvedValueOnce({ recordId: "rec-2", results: [{ edit: ROLE_EDIT, ok: true, error: null }] });
		fireEvent.click(await screen.findByRole("button", { name: "应用 2 项" }));
		await screen.findByText("成功 1");

		// Finishing lands back on the overview with a fresh scan; the dialog stays open.
		fireEvent.click(screen.getByRole("button", { name: "返回总览" }));
		await screen.findByText(/模型目录中找不到/);
		expect(scanMock).toHaveBeenCalledTimes(2);
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog")).toBeTruthy();
	});
});

describe("pick target step", () => {
	it("lists every place the model to replace appears", async () => {
		await openConfigure();
		const heading = screen.getByText("出现在以下 2 处：");
		const list = heading.nextElementSibling as HTMLElement;
		expect(list.textContent).toContain("全局");
		expect(list.textContent).toContain("default");
		expect(list.textContent).toContain("回退链");
	});
});

describe("back navigation", () => {
	it("keeps the target, level and row checks when stepping back and forward", async () => {
		await openConfigure();
		await pickTarget(GPT);
		fireEvent.change(screen.getByLabelText("思考等级"), { target: { value: "off" } });
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		await screen.findByText("回退链条目");
		expect(screen.getAllByText(`${GPT}:off`).length).toBeGreaterThan(0);

		fireEvent.click(screen.getByLabelText("替换 default"));
		await screen.findByRole("button", { name: "应用 1 项" });

		fireEvent.click(screen.getByRole("button", { name: "上一步" }));
		await screen.findByRole("button", { name: "预览改动" });
		expect(screen.getByTitle(GPT)).toBeTruthy();
		expect((screen.getByLabelText("思考等级") as HTMLSelectElement).value).toBe("off");

		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		await screen.findByRole("button", { name: "应用 1 项" });
	});

	it("goes back from the target step with 上一步 and keeps the target for the same source", async () => {
		await openConfigure();
		await pickTarget(GPT);
		fireEvent.click(screen.getByRole("button", { name: "上一步" }));
		await screen.findByText(/模型目录中找不到/);

		fireEvent.click((await screen.findAllByTitle(REPLACE_BUTTON_TITLE))[0]);
		await screen.findByRole("button", { name: "预览改动" });
		expect(screen.getByTitle(GPT)).toBeTruthy();
	});

	it("resets the target when another source is chosen", async () => {
		await openConfigure();
		await pickTarget(GPT);
		fireEvent.click(screen.getByRole("button", { name: "重新选择" }));
		await screen.findByText(/模型目录中找不到/);

		// The second row is GPT itself.
		fireEvent.click((await screen.findAllByTitle(REPLACE_BUTTON_TITLE))[1]);
		await screen.findByRole("button", { name: "预览改动" });
		expect(screen.getByTitle("选择目标模型")).toBeTruthy();
		expect((screen.getByRole("button", { name: "预览改动" }) as HTMLButtonElement).disabled).toBe(true);
	});

	it("lets the header step chips go back to earlier steps only", async () => {
		await openPreview();
		expect(screen.queryByTitle("回到「执行结果」")).toBeNull();
		expect(screen.queryByTitle("回到「预览改动」")).toBeNull();

		fireEvent.click(screen.getByTitle("回到「选择目标」"));
		await screen.findByRole("button", { name: "预览改动" });
		expect(screen.getByTitle(GPT)).toBeTruthy();

		fireEvent.click(screen.getByTitle("回到「选择来源」"));
		await screen.findByText(/模型目录中找不到/);
		expect(screen.queryByTitle("回到「选择来源」")).toBeNull();
	});

	it("keeps steps 1-3 reachable from the results page and re-plans against a fresh scan", async () => {
		await openPreview();
		await applyAll();

		// The outcome is still on screen, and every earlier step is one click away.
		expect(screen.getByText("成功 2")).toBeTruthy();
		fireEvent.click(screen.getByTitle("回到「选择目标」"));
		await screen.findByRole("button", { name: "预览改动" });
		expect(screen.getByTitle(GPT)).toBeTruthy();
		// Leaving the results page re-scans instead of reusing the rows it just rewrote.
		expect(scanMock).toHaveBeenCalledTimes(2);
		// Leaving the results page ended that run, so applying again opens a new record.
		expect(screen.queryByRole("button", { name: "返回总览" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		await screen.findByRole("button", { name: /^应用 \d+ 项$/ });
		applyMock.mockResolvedValueOnce({ recordId: "rec-3", results: [{ edit: ROLE_EDIT, ok: true, error: null }] });
		fireEvent.click(screen.getByRole("button", { name: /^应用 \d+ 项$/ }));
		await screen.findByText("成功 1");
		// A new run never appends to the finished record.
		expect(applyMock).toHaveBeenLastCalledWith(OPUS, GPT, expect.any(Array), null);
	});

	it("returns from the results page with 上一步 and keeps target and row checks", async () => {
		await openPreview();
		fireEvent.click(screen.getByLabelText("替换 default"));
		await screen.findByRole("button", { name: "应用 1 项" });
		applyMock.mockResolvedValueOnce({ recordId: "rec-2", results: [{ edit: ROLE_EDIT, ok: true, error: null }] });
		fireEvent.click(screen.getByRole("button", { name: "应用 1 项" }));
		await screen.findByText("成功 1");

		fireEvent.click(screen.getByRole("button", { name: "上一步" }));
		await screen.findByText("回退链条目");
		// The unchecked row stayed unchecked, so the plan is still the same size.
		expect(screen.getByRole("button", { name: "应用 1 项" })).toBeTruthy();
		// The finished run is not offered again: its rows must never be re-sent, and it
		// is in 历史记录 instead.
		expect(screen.queryByTitle("回到「执行结果」")).toBeNull();
		expect(screen.queryByRole("button", { name: /重试失败项/ })).toBeNull();

		// The chosen target survived too.
		fireEvent.click(screen.getByRole("button", { name: "上一步" }));
		await screen.findByRole("button", { name: "预览改动" });
		expect(screen.getByTitle(GPT)).toBeTruthy();
	});

	it("goes back from the results page with 返回总览, rescans and starts over", async () => {
		await openPreview();
		await applyAll();

		fireEvent.click(screen.getByRole("button", { name: "返回总览" }));
		await screen.findByText(/模型目录中找不到/);
		expect(scanMock).toHaveBeenCalledTimes(2);

		// A fresh replace starts with no target.
		fireEvent.click((await screen.findAllByTitle(REPLACE_BUTTON_TITLE))[0]);
		await screen.findByRole("button", { name: "预览改动" });
		expect(screen.getByTitle("选择目标模型")).toBeTruthy();
	});

	it("keeps a failed rescan from trapping the user on the overview", async () => {
		const onClose = vi.fn();
		render(<ModelReplaceDialog onClose={onClose} />);
		await screen.findByText(/模型目录中找不到/);
		fireEvent.click((await screen.findAllByTitle(REPLACE_BUTTON_TITLE))[0]);
		await pickTarget(GPT);
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		applyMock.mockResolvedValueOnce({ recordId: "rec-2", results: [{ edit: ROLE_EDIT, ok: true, error: null }] });
		fireEvent.click(await screen.findByRole("button", { name: /^应用 \d+ 项$/ }));
		await screen.findByText("成功 1");

		// The rescan that 返回总览 starts fails: the old rows stay, with the full error.
		scanMock.mockRejectedValueOnce(new Error("scan exploded: permission denied on /repo/alpha"));
		fireEvent.click(screen.getByRole("button", { name: "返回总览" }));
		await screen.findByText(/scan exploded: permission denied on \/repo\/alpha/);
		// Still an overview the user can work from.
		fireEvent.click((await screen.findAllByTitle(REPLACE_BUTTON_TITLE))[0]);
		await screen.findByRole("button", { name: "预览改动" });
		await pickTarget(GPT);
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));

		// The stale rows are never applied again, and the reason is spelled out in full.
		const apply = await screen.findByRole("button", { name: /^应用 \d+ 项$/ }) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);
		expect(screen.getByRole("status").textContent).toContain("permission denied on /repo/alpha");

		// Retrying the scan unblocks applying; the dialog was closable the whole time.
		fireEvent.click(screen.getByRole("button", { name: "上一步" }));
		await screen.findByRole("button", { name: "预览改动" });
		fireEvent.click(screen.getByRole("button", { name: "上一步" }));
		fireEvent.click(await screen.findByRole("button", { name: /重新扫描/ }));
		await screen.findByText(/模型目录中找不到/);
		expect(screen.queryByText(/scan exploded/)).toBeNull();
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onClose).toHaveBeenCalled();
	});

	it("returns from the history view to the results page it was opened from", async () => {
		await openPreview();
		await applyAll();

		fireEvent.click(screen.getByRole("button", { name: /历史记录/ }));
		await screen.findByText(/最近 10 次批量替换/);
		// The history view is not a dead end: it names where it goes back to.
		fireEvent.click(screen.getByRole("button", { name: /返回结果/ }));
		await screen.findByText("成功 2");
		expect(screen.getByRole("button", { name: "返回总览" })).toBeTruthy();
	});

	it("opens the history view from the overview and returns there", async () => {
		render(<ModelReplaceDialog onClose={() => undefined} />);
		await screen.findByText(/模型目录中找不到/);
		fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
		await screen.findByText(/最近 10 次批量替换/);
		fireEvent.click(screen.getByRole("button", { name: /返回选择来源/ }));
		await screen.findByText(/模型目录中找不到/);
	});

	it("keeps the results reachable after leaving it through the history view", async () => {
		await openPreview();
		applyMock.mockResolvedValueOnce({
			recordId: "rec-2",
			results: [
				{ edit: ROLE_EDIT, ok: true, error: null },
				{ edit: CHAIN_EDIT, ok: false, error: "回退链写入失败" },
			],
		});
		fireEvent.click(screen.getByRole("button", { name: /^应用 \d+ 项$/ }));
		await screen.findByText("失败 1");

		// A detour through the history view comes back to the same outcome.
		fireEvent.click(screen.getByRole("button", { name: /历史记录/ }));
		await screen.findByText(/最近 10 次批量替换/);
		fireEvent.click(screen.getByRole("button", { name: /返回结果/ }));
		await screen.findByText("失败 1");

		// A failed retry leaves the results page and its exits in place.
		applyMock.mockRejectedValueOnce(new Error("retry exploded"));
		fireEvent.click(screen.getByRole("button", { name: /重试失败项/ }));
		await screen.findByText(/retry exploded/);
		expect((screen.getByRole("button", { name: "返回总览" }) as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "返回总览" }));
		await screen.findByText(/模型目录中找不到/);
	});

	it("stays closable while an apply is in flight", async () => {
		const onClose = vi.fn();
		render(<ModelReplaceDialog onClose={onClose} />);
		await screen.findByText(/模型目录中找不到/);
		fireEvent.click((await screen.findAllByTitle(REPLACE_BUTTON_TITLE))[0]);
		await pickTarget(GPT);
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		await screen.findByText("回退链条目");

		// The apply never settles during the test: the dialog must still be closable.
		applyMock.mockReturnValueOnce(new Promise<ModelReplaceResult>(() => undefined));
		fireEvent.click(screen.getByRole("button", { name: /^应用 \d+ 项$/ }));
		// Escape is not swallowed while the write is in flight.
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onClose).toHaveBeenCalled();
	});

	it("keeps every exit usable while a retry is still running", async () => {
		await openPreview();
		applyMock.mockResolvedValueOnce({
			recordId: "rec-2",
			results: [{ edit: ROLE_EDIT, ok: false, error: "写入失败" }],
		});
		fireEvent.click(screen.getByRole("button", { name: /^应用 \d+ 项$/ }));
		await screen.findByText("失败 1");
		expect(screen.getByText("成功 0")).toBeTruthy();

		// A retry that hangs must not trap the user on the results page.
		applyMock.mockReturnValueOnce(new Promise<ModelReplaceResult>(() => undefined));
		fireEvent.click(screen.getByRole("button", { name: /重试失败项/ }));
		const back = screen.getByRole("button", { name: "返回总览" }) as HTMLButtonElement;
		expect(back.disabled).toBe(false);
		fireEvent.click(back);
		await screen.findByText(/模型目录中找不到/);
	});

	it("keeps the preview page reachable when the apply itself fails", async () => {
		await openPreview();
		applyMock.mockRejectedValueOnce(new Error("写入 /etc/omp/config.yml 失败：只读文件系统"));
		fireEvent.click(screen.getByRole("button", { name: /^应用 \d+ 项$/ }));

		// The full error is shown and the user is still on the preview with a way back.
		await screen.findByText(/只读文件系统/);
		expect(screen.getByRole("button", { name: "上一步" })).toBeTruthy();
		expect((screen.getByRole("button", { name: /^应用 \d+ 项$/ }) as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "上一步" }));
		await screen.findByRole("button", { name: "预览改动" });
	});
});

describe("target kinds", () => {
	it("hides the thinking level for a search target and writes no suffix", async () => {
		await openConfigure();
		await pickTarget(GPT);
		fireEvent.change(screen.getByLabelText("思考等级"), { target: { value: "high" } });

		await pickTarget(EXA, "搜索服务");
		expect(screen.queryByLabelText("思考等级")).toBeNull();
		expect(screen.getByTitle(EXA)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		await screen.findByText("回退链条目");
		expect(screen.queryByText(new RegExp(`${EXA}:`))).toBeNull();
		expect(screen.queryByLabelText("「default」的思考等级")).toBeNull();

		applyMock.mockResolvedValueOnce({ recordId: "rec-3", results: [{ edit: ROLE_EDIT, ok: true, error: null }] });
		fireEvent.click(screen.getByRole("button", { name: "应用 2 项" }));
		await screen.findByText("成功 1");
		const edits = applyMock.mock.calls[0]?.[2] as ModelReplaceEdit[];
		expect(applyMock.mock.calls[0]?.[1]).toBe(EXA);
		expect(edits[0]).toMatchObject({ kind: "value", after: EXA });
		// Live-session switching only exists for chat targets.
		expect(screen.queryByText(/写入配置不会改变运行中的会话/)).toBeNull();
	});

	it("opens the provider-grouped picker on the source's kind and switches kind tabs", async () => {
		await openConfigure();
		fireEvent.click(screen.getByTitle("选择目标模型"));
		// The source is missing from the catalogue, so the chat tab is open, grouped by provider.
		await screen.findByRole("button", { name: "gpt-5" });
		expect(screen.getByTitle("openai")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "exa" })).toBeNull();

		fireEvent.click(screen.getByRole("tab", { name: "搜索服务" }));
		await screen.findByRole("button", { name: "exa" });
		expect(screen.getByTitle("web")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "gpt-5" })).toBeNull();
	});
});

describe("thinking levels follow the target model", () => {
	/** Option values and the first option's label of a level select. */
	const optionsOf = (label: string | RegExp) => {
		const select = screen.getByLabelText(label) as HTMLSelectElement;
		return { values: Array.from(select.options).map((o) => o.value), first: select.options[0]?.textContent };
	};

	it("offers 模型默认 plus exactly the levels the target supports", async () => {
		await openConfigure();
		await pickTarget(GPT);
		expect(optionsOf("思考等级")).toEqual({
			values: ["", ...resolveThinkingLevels(undefined, GPT_LEVELS, null)],
			first: "模型默认",
		});
		expect(optionsOf("思考等级").values).toContain("max");

		await pickTarget(MINI);
		const mini = optionsOf("思考等级");
		expect(mini.values).toEqual(["", ...resolveThinkingLevels(undefined, MINI_LEVELS, null)]);
		expect(mini.values).not.toContain("max");
		expect(mini.values).not.toContain("high");
		const off = (screen.getByLabelText("思考等级") as HTMLSelectElement).querySelector('option[value="off"]');
		expect(off?.textContent).toBe("off（关闭思考）");
	});

	it("hides the level control before a target is picked and for a model without thinking", async () => {
		await openConfigure();
		expect(screen.queryByLabelText("思考等级")).toBeNull();

		await pickTarget(GPT);
		expect(screen.getByLabelText("思考等级")).toBeTruthy();

		await pickTarget(PLAIN);
		expect(screen.queryByLabelText("思考等级")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		await screen.findByText("回退链条目");
		expect(screen.queryByLabelText(/的思考等级$/)).toBeNull();
		expect(screen.queryByText(new RegExp(`${PLAIN}:`))).toBeNull();
	});

	it("resets an unsupported level to 模型默认 when the target changes and writes no suffix", async () => {
		await openConfigure();
		await pickTarget(GPT);
		fireEvent.change(screen.getByLabelText("思考等级"), { target: { value: "max" } });
		expect((screen.getByLabelText("思考等级") as HTMLSelectElement).value).toBe("max");

		await pickTarget(MINI);
		expect((screen.getByLabelText("思考等级") as HTMLSelectElement).value).toBe("");

		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		await screen.findByText("回退链条目");
		expect(screen.queryByText(new RegExp(`${MINI}:`))).toBeNull();
		applyMock.mockResolvedValueOnce({ recordId: "rec-4", results: [{ edit: ROLE_EDIT, ok: true, error: null }] });
		fireEvent.click(screen.getByRole("button", { name: "应用 2 项" }));
		await screen.findByText("成功 1");
		const edits = applyMock.mock.calls[0]?.[2] as ModelReplaceEdit[];
		expect(applyMock.mock.calls[0]?.[1]).toBe(MINI);
		expect(edits[0]).toMatchObject({ kind: "value", after: MINI });
	});

	it("keeps a level the new target also supports", async () => {
		await openConfigure();
		await pickTarget(GPT);
		fireEvent.change(screen.getByLabelText("思考等级"), { target: { value: "low" } });
		await pickTarget(MINI);
		expect((screen.getByLabelText("思考等级") as HTMLSelectElement).value).toBe("low");
	});

	it("offers a per-row override the levels of that row's own target", async () => {
		await openConfigure();
		await pickTarget(GPT);
		fireEvent.change(screen.getByLabelText("思考等级"), { target: { value: "max" } });
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		await screen.findByText("回退链条目");
		expect(screen.getAllByText(`${GPT}:max`).length).toBeGreaterThan(0);

		fireEvent.click(screen.getAllByRole("button", { name: "换成别的模型" })[0]);
		// Still on the shared target: its levels, including max.
		expect(optionsOf(/的思考等级$/).values).toEqual(["", ...resolveThinkingLevels(undefined, GPT_LEVELS, null)]);

		await pickTarget(MINI);
		const row = optionsOf(/的思考等级$/);
		expect(row.first).toBe("模型默认");
		expect(row.values).toEqual(["", ...resolveThinkingLevels(undefined, MINI_LEVELS, null)]);
		expect(row.values).not.toContain("max");
		// The shared max does not carry over to the row's unsupported target.
		expect((screen.getByLabelText(/的思考等级$/) as HTMLSelectElement).value).toBe("");
		expect(screen.getByText("单独指定")).toBeTruthy();
		expect(screen.getAllByText(MINI).length).toBeGreaterThan(0);
		expect(screen.queryByText(`${MINI}:max`)).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "改回统一目标" }));
		expect(screen.queryByText("单独指定")).toBeNull();
		expect(screen.getAllByText(`${GPT}:max`).length).toBeGreaterThan(0);
	});
});

describe("overview probe", () => {
	it("probes each kind its own way, shows the full error, and offers no test for untestable kinds", async () => {
		const IMAGE = "openai/gpt-image-2";
		scanMock.mockResolvedValue({ ...SCAN, fallbackChains: { chains: { web: [EXA], image: [IMAGE] } } });
		kindCatalogMock.mockResolvedValue([
			...KIND_ENTRIES,
			{ selector: IMAGE, kind: "image", provider: "openai", name: null, thinking: [] },
		]);
		const longError = `Error: No web search model matches selector "${EXA}". ${"detail ".repeat(60)}END-OF-ERROR`;
		probeMock.mockResolvedValueOnce({ ok: false, latencyMs: 30, detail: longError });
		render(<ModelReplaceDialog onClose={() => undefined} />);
		await screen.findByText(/搜索服务/);

		fireEvent.click(screen.getByTitle(new RegExp(`测试 ${EXA}（`)));
		expect(await screen.findByText(/END-OF-ERROR/)).toBeTruthy();
		expect(probeMock).toHaveBeenCalledWith(EXA, "search");
		expect(screen.queryByTitle(new RegExp(`测试 ${IMAGE}（`))).toBeNull();
		expect(screen.getByTitle("此类型暂不支持测试")).toBeTruthy();
	});
});
