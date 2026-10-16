// @vitest-environment jsdom
/**
 * 批量替换模型 dialog wiring: scan overview → pick X/Y → preview (grouped rows,
 * skipped project, notice) → apply (payload + record id) → retry of the failed
 * items with the same record id → history undo.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { scanMock, applyMock, historyMock, undoMock, probeMock, invalidateMock, listModelsMock } = vi.hoisted(() => ({
	scanMock: vi.fn(),
	applyMock: vi.fn(),
	historyMock: vi.fn(),
	undoMock: vi.fn(),
	probeMock: vi.fn(),
	invalidateMock: vi.fn(),
	listModelsMock: vi.fn(),
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
	listModels: listModelsMock,
}));
vi.mock("./store", () => ({ invalidateAfterModelReplace: invalidateMock }));

import type { ModelReplaceEdit, ModelReplaceResult } from "../../../lib/contracts";
import { ModelReplaceDialog } from "./ModelReplaceDialog";
import { useModelCatalog } from "../../../stores/modelCatalog";

const OPUS = "anthropic/claude-opus";
const GPT = "openai/gpt-5";

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
	listModelsMock.mockReset().mockResolvedValue([
		{ provider: "openai", id: "gpt-5", name: "gpt-5", thinking: [], contextWindow: null },
	]);
	applyMock.mockReset().mockResolvedValue({ recordId: "rec-1", results: [] });
	localStorage.clear();
	// The catalogue store is module-global; start every test from "never loaded".
	useModelCatalog.setState({ models: null, loading: false });
});

afterEach(cleanup);

/** Scan → pick X → pick Y from the catalogue → preview. */
async function openPreview() {
	render(<ModelReplaceDialog onClose={() => undefined} />);
	fireEvent.click(await screen.findByTitle(`把 ${OPUS} 作为要替换的模型`));
	fireEvent.click(screen.getByTitle("选择目标模型"));
	// The picker lists the model once per section (recent + provider), same key either way.
	fireEvent.click((await screen.findAllByText("gpt-5"))[0]);
	fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
	await screen.findByText("回退链条目");
}

describe("批量替换模型 dialog", () => {
	it("marks models missing from the catalogue and probes only on demand", async () => {
		render(<ModelReplaceDialog onClose={() => undefined} />);
		// Only the source model is missing from the catalogue; the chain key `default`
		// is a role name and is never reported as a missing model.
		await waitFor(() => expect(screen.getAllByText("可能失效")).toHaveLength(1));
		expect(screen.getByText("2 处引用")).toBeTruthy();
		expect(probeMock).not.toHaveBeenCalled();

		fireEvent.click(screen.getByTitle(new RegExp(`^用一次真实调用测试 ${OPUS}`)));
		await screen.findByText(/可用 12ms/);
		expect(probeMock).toHaveBeenCalledWith(OPUS);
	});

	it("flags nothing while the catalogue is empty and says why", async () => {
		listModelsMock.mockResolvedValue([]);
		render(<ModelReplaceDialog onClose={() => undefined} />);
		await screen.findByText(/模型目录尚未加载/);
		expect(screen.queryByText("可能失效")).toBeNull();
	});

	it("previews grouped rows, the skipped project and the scope notice", async () => {
		await openPreview();
		expect(screen.getByText("回退链")).toBeTruthy();
		expect(screen.getByText("仅覆盖在本桌面端添加的项目")).toBeTruthy();
		expect(screen.getByText("目录不存在")).toBeTruthy();
		expect(screen.getByRole("button", { name: "应用 2 项" })).toBeTruthy();
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

	it("closes from the results page", async () => {
		const onClose = vi.fn();
		render(<ModelReplaceDialog onClose={onClose} />);
		fireEvent.click(await screen.findByTitle(`把 ${OPUS} 作为要替换的模型`));
		fireEvent.click(screen.getByTitle("选择目标模型"));
		fireEvent.click((await screen.findAllByText("gpt-5"))[0]);
		fireEvent.click(screen.getByRole("button", { name: "预览改动" }));
		applyMock.mockResolvedValueOnce({ recordId: "rec-2", results: [{ edit: ROLE_EDIT, ok: true, error: null }] });
		fireEvent.click(await screen.findByRole("button", { name: "应用 2 项" }));
		await screen.findByText("成功 1");

		fireEvent.click(screen.getByRole("button", { name: "完成" }));
		expect(onClose).toHaveBeenCalled();
	});
});
