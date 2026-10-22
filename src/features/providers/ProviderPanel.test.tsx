// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "../../lib/contracts";

const saveMock = vi.fn();
const state = {
	providers: [] as ProviderConfig[],
	loaded: true,
	error: null,
	load: vi.fn(async () => {}),
	ompProviders: [],
	ompLoaded: true,
	ompError: null,
	exportEnvText: vi.fn(),
	importingOmp: false,
	save: saveMock,
	tests: {},
};

vi.mock("./store", () => {
	const useProviders = (sel: (s: unknown) => unknown) => sel(state);
	useProviders.getState = () => state;
	return { useProviders };
});
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/home/u" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../lib/ipc", () => ({
	providerFetchModels: vi.fn(),
	providerReadEnvFile: vi.fn(),
}));

import { ProviderDialog } from "./ProviderDialog";
import { ProviderPanel } from "./ProviderPanel";

function cfg(over: Partial<ProviderConfig>): ProviderConfig {
	return {
		id: "id1",
		name: "Mycorp",
		slug: "mycorp",
		presetId: null,
		baseUrl: "https://gw.example/v1",
		api: "openai_completions",
		envVar: "MYCORP_API_KEY",
		models: [],
		defaultModel: null,
		defaultContextWindow: null,
		defaultMaxTokens: null,
		enabled: true,
		sort: 0,
		hasKey: true,
		keyHint: null,
		notes: null,
		createdAt: "",
		updatedAt: "",
		...over,
	};
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ProviderPanel search", () => {
	it("finds a workbench-only provider by an object-form model id", () => {
		state.providers = [
			cfg({ models: [{ id: "zeta-model-9", contextWindow: 1000 }] as never }),
			cfg({ id: "id2", name: "Other", slug: "other", models: ["plain"] }),
		];
		render(<ProviderPanel />);
		const input = screen.getByLabelText("筛选供应商");
		fireEvent.change(input, { target: { value: "zeta-model" } });
		expect(screen.getAllByText("Mycorp").length).toBeGreaterThan(0);
		expect(screen.queryByText("Other")).toBeNull();
		fireEvent.change(input, { target: { value: "object" } });
		expect(screen.queryByText("Mycorp")).toBeNull();
	});
});

describe(".env import", () => {
	it("updates a custom provider by its env var instead of skipping it", () => {
		state.providers = [cfg({})];
		render(<ProviderDialog target={{ mode: "import" }} onClose={() => {}} />);
		fireEvent.change(screen.getByLabelText("粘贴 .env 内容"), {
			target: { value: "MYCORP_API_KEY=sk-123" },
		});
		expect(screen.queryByText("未识别，跳过")).toBeNull();
		expect(screen.getByText("预览（1 个可导入）")).toBeTruthy();
	});
});
