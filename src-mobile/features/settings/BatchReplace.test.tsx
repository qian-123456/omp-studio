// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SettingsRolesPage } from "./models/RolesPage";
import * as apiModule from "../../core/api";

vi.mock("../../core/api", () => ({
	api: vi.fn(),
	errorMessage: vi.fn((e: unknown) => String(e)),
}));

const MOCK_ROLES_RESPONSE = {
	snapshot: {
		global: {
			modelRoles: {
				default: "anthropic/claude-3-7-sonnet:high",
				scout: "anthropic/claude-3-5-haiku:low",
				task: "anthropic/claude-3-7-sonnet:medium",
				reviewer: "anthropic/claude-3-7-sonnet:low",
			},
		},
		project: {},
	},
	models: [
		{ provider: "anthropic", id: "claude-3-7-sonnet", thinking: ["low", "medium", "high"] },
		{ provider: "anthropic", id: "claude-3-5-haiku", thinking: ["low"] },
		{ provider: "openai", id: "gpt-4o", thinking: [] },
	],
};

describe("SettingsRolesPage Batch Replace (批量替换)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(apiModule.api).mockResolvedValue(MOCK_ROLES_RESPONSE);
	});
	afterEach(() => {
		cleanup();
	});


	it("renders 批量替换 button in the header", async () => {
		render(<SettingsRolesPage route={{ name: "settingsRoles", path: "/settings/roles", params: {}, query: {} }} />);

		const batchBtn = await screen.findByText("批量替换");
		expect(batchBtn).toBeDefined();
	});

	it("opens BatchReplaceSheet and shows affected roles when selecting a source model", async () => {
		render(<SettingsRolesPage route={{ name: "settingsRoles", path: "/settings/roles", params: {}, query: {} }} />);

		const batchBtn = await screen.findByText("批量替换");
		fireEvent.click(batchBtn);

		expect(await screen.findByText("批量替换模型角色")).toBeDefined();
		expect(screen.getByText("1. 选择要被替换的原模型")).toBeDefined();
		expect(screen.getByText("2. 选择替换后的新模型")).toBeDefined();

		// Check affected roles count for anthropic/claude-3-7-sonnet (default, task, reviewer = 3 roles)
		expect(screen.getByText(/将影响以下 3 个角色/)).toBeDefined();
	});
});
