// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OmpImportPlanItem } from "../../lib/contracts";

const planMock = vi.fn();
const importMock = vi.fn();

vi.mock("../../lib/ipc", () => ({
	providerImportOmpPlan: (ids: string[]) => planMock(ids),
}));
vi.mock("./store", () => ({
	useProviders: (sel: (s: unknown) => unknown) =>
		sel({ importOmp: importMock, importingOmp: false }),
}));

import { ImportOmpDialog } from "./ImportOmpDialog";

const items: OmpImportPlanItem[] = [
	{
		id: "good",
		slug: "good",
		baseUrl: "https://a.example/v1",
		api: "openai-completions",
		action: "create",
		ok: true,
		issue: null,
		error: null,
	},
	{
		id: "zhipu-coding-plan",
		slug: "zhipu-coding-plan",
		baseUrl: null,
		api: null,
		action: "create",
		ok: false,
		issue: "missingBaseUrl",
		error: "缺少 baseUrl",
	},
];

beforeEach(() => {
	planMock.mockResolvedValue(items);
	importMock.mockImplementation(async (ids: string[]) =>
		ids.map((id) => ({ id, ok: true, error: null })),
	);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ImportOmpDialog", () => {
	it("makes a missing-baseUrl row importable and sends it as an override", async () => {
		render(<ImportOmpDialog ids={["good", "zhipu-coding-plan"]} onClose={() => {}} />);
		await screen.findByText("需要处理（1）");
		expect(screen.getByText("导入 1 个")).toBeTruthy();

		const input = screen.getByLabelText("zhipu-coding-plan 接口地址");
		fireEvent.change(input, { target: { value: "not a url" } });
		expect(screen.getByText("导入 1 个")).toBeTruthy();

		fireEvent.change(input, {
			target: { value: "https://open.bigmodel.cn/api/coding/paas/v4" },
		});
		await screen.findByText("导入 2 个");
		fireEvent.click(screen.getByText("导入 2 个"));

		await waitFor(() => expect(importMock).toHaveBeenCalledTimes(1));
		expect(importMock).toHaveBeenCalledWith(["good", "zhipu-coding-plan"], {
			"zhipu-coding-plan": "https://open.bigmodel.cn/api/coding/paas/v4",
		});
		await screen.findByText("导入结果");
	});
});
