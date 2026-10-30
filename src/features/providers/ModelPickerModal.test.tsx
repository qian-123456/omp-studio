// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
	providerTestModel: vi.fn(),
	providerRows: vi.fn(),
	listModels: vi.fn(async () => []),
}));
vi.mock("../../lib/ipc", () => ipc);
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ModelPickerModal } from "./ModelPickerModal";
import { useProviders } from "./store";

const models = [
	{ id: "alpha-chat" },
	{ id: "beta-dead" },
	{ id: "gamma-chat" },
	{ id: "text-embedding-3-small" },
];

function renderPicker(providerId: string | null = "p") {
	return render(
		<ModelPickerModal
			models={models}
			existingModelIds={new Set()}
			providerId={providerId}
			onClose={() => {}}
			onAppend={() => {}}
			onReplace={() => {}}
		/>,
	);
}

describe("ModelPickerModal", () => {
	beforeEach(() => {
		useProviders.setState({ modelTests: {} });
		ipc.providerTestModel.mockReset().mockImplementation(async (_p: string, id: string) =>
			id === "beta-dead"
				? { ok: false, latencyMs: 5, detail: "API 返回空响应（0 token，stopReason=stop）" }
				: { ok: true, latencyMs: 5, detail: "模型可用" },
		);
	});
	afterEach(cleanup);

	it("separates chat and other models into tabs", () => {
		renderPicker();
		expect(screen.queryByText("text-embedding-3-small")).toBeNull();
		fireEvent.click(screen.getByText(/其他类型模型 \(1\)/));
		expect(screen.getByText("text-embedding-3-small")).toBeTruthy();
		expect(screen.queryByText("alpha-chat")).toBeNull();
	});

	it("keeps an unavailable model, unchecks it and sinks it to the bottom with a badge", async () => {
		renderPicker();
		fireEvent.click(screen.getByText("全选"));
		expect(screen.getByText("已选 3 / 3 个")).toBeTruthy();
		fireEvent.click(screen.getByText("批量检测可用性"));
		await waitFor(() => expect(screen.getByText("空渠道 / 不可用")).toBeTruthy());

		const ids = screen.getAllByText(/-(chat|dead)$/).map((el) => el.textContent);
		expect(ids).toEqual(["alpha-chat", "gamma-chat", "beta-dead"]);
		expect(screen.getByText("已选 2 / 3 个")).toBeTruthy();
		expect(screen.getByText(/API 返回空响应/)).toBeTruthy();
	});

	it("disables availability probing until the provider is saved", () => {
		renderPicker(null);
		expect((screen.getByText("批量检测可用性").closest("button") as HTMLButtonElement).disabled).toBe(true);
	});
});
