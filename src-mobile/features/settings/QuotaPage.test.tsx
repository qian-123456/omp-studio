// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QuotaPage } from "./QuotaPage";
import * as apiModule from "../../core/api";

vi.mock("../../core/api", () => ({
	api: vi.fn(),
	errorMessage: vi.fn((e: unknown) => String(e)),
}));

const NOW = 1700000000000;

const MOCK_QUOTA_RESPONSE = {
	providers: [
		{
			id: "anthropic",
			name: "Anthropic Claude",
			badge: "Claude Pro/Max",
			accounts: [
				{
					id: "acct-claude-1",
					email: "developer@example.com",
					plan: "Claude Pro",
					limits: [
						{
							name: "5 Hour Rolling",
							used: 40.0,
							total: 100.0,
							unit: "percent",
							resetAt: NOW + 2 * 3600 * 1000 + 15 * 60 * 1000, // 2h 15m
						},
						{
							name: "7 Day Limit",
							used: 65.0,
							total: 100.0,
							unit: "percent",
							resetAt: NOW + 3 * 86400 * 1000, // 3d
						},
					],
				},
			],
		},
		{
			id: "openai-codex",
			name: "ChatGPT Plus/Pro",
			badge: "Codex Subscription",
			accounts: [
				{
					id: "acct-openai-1",
					email: "team@company.org",
					plan: "Plus",
					limits: [
						{
							name: "5-Hour Window",
							used: 85.0,
							total: 100.0,
							unit: "percent",
							resetAt: NOW + 45 * 60 * 1000, // 45m
						},
					],
				},
			],
		},
	],
	updatedAt: NOW,
};

describe("QuotaPage (/quota)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(Date, "now").mockReturnValue(NOW);
	});
	afterEach(() => {
		cleanup();
	});


	it("fetches /quota and displays unified provider cards with 5h/7d limits", async () => {
		vi.mocked(apiModule.api).mockResolvedValueOnce(MOCK_QUOTA_RESPONSE);

		render(<QuotaPage />);

		// Verify title
		expect(screen.getByText("订阅与配额")).toBeDefined();

		// Wait for providers
		expect(await screen.findByText("Anthropic Claude")).toBeDefined();
		expect(screen.getByText("ChatGPT Plus/Pro")).toBeDefined();

		// Verify 5h and 7d rolling window labels
		expect(screen.getAllByText("5 小时滚动限额").length).toBe(2);
		expect(screen.getByText("7 天周期限额")).toBeDefined();

		// Verify used/remaining percentages
		expect(screen.getByText("已用 40% · 剩余 60%")).toBeDefined();
		expect(screen.getByText("已用 65% · 剩余 35%")).toBeDefined();
		expect(screen.getByText("已用 85% · 剩余 15%")).toBeDefined();

		// Verify reset countdowns
		expect(screen.getByText("2 小时 15 分后重置")).toBeDefined();
		expect(screen.getByText("3 天后重置")).toBeDefined();
		expect(screen.getByText("45 分钟后重置")).toBeDefined();

		// Verify account details
		expect(screen.getByText("developer@example.com")).toBeDefined();
		expect(screen.getByText("Claude Pro")).toBeDefined();
		expect(screen.getByText("team@company.org")).toBeDefined();
		expect(screen.getByText("Plus")).toBeDefined();
	});

	it("triggers manual refresh when clicking the refresh button", async () => {
		vi.mocked(apiModule.api)
			.mockResolvedValueOnce(MOCK_QUOTA_RESPONSE)
			.mockResolvedValueOnce({
				...MOCK_QUOTA_RESPONSE,
				updatedAt: NOW + 60000,
			});

		render(<QuotaPage />);

		await screen.findByText("Anthropic Claude");

		const refreshBtn = screen.getByLabelText("刷新配额");
		fireEvent.click(refreshBtn);

		await waitFor(() => {
			expect(apiModule.api).toHaveBeenCalledWith("GET", "/quota?refresh=true");
		});
	});

	it("renders empty state when no providers returned", async () => {
		vi.mocked(apiModule.api).mockResolvedValueOnce({
			providers: [],
			updatedAt: NOW,
		});

		render(<QuotaPage />);

		expect(await screen.findByText("暂无订阅或配额")).toBeDefined();
	});

	it("renders error state with retry on network failure", async () => {
		vi.mocked(apiModule.api).mockRejectedValueOnce(new Error("网络连接超时"));

		render(<QuotaPage />);

		expect(await screen.findByText("加载失败")).toBeDefined();
		const retryBtn = screen.getByText("重试");
		expect(retryBtn).toBeDefined();

		vi.mocked(apiModule.api).mockResolvedValueOnce(MOCK_QUOTA_RESPONSE);
		fireEvent.click(retryBtn);

		expect(await screen.findByText("Anthropic Claude")).toBeDefined();
	});

	it("renders cleanly within 390x844 viewport", async () => {
		vi.mocked(apiModule.api).mockResolvedValueOnce(MOCK_QUOTA_RESPONSE);

		const { container } = render(
			<div style={{ width: "390px", height: "844px" }}>
				<QuotaPage />
			</div>,
		);

		await screen.findByText("Anthropic Claude");
		expect(container.querySelector("[data-testid='provider-card-anthropic']")).toBeDefined();
		expect(container.querySelector("[data-testid='provider-card-openai-codex']")).toBeDefined();
	});
});
