// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { ModelRoleSnapshot } from "../../lib/contracts";
import { useModelCatalog } from "../../stores/modelCatalog";
import { useModelKindCatalog, useServiceModelConfiguration } from "../../stores/modelKinds";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { RolesSection } from "./sections/RolesSection";
import { ProvidersSection } from "./sections/ProvidersSection";
import { SettingsPage } from "./SettingsPage";

const { rolesRead, rolesSet, scrollIntoView } = vi.hoisted(() => ({
	rolesRead: vi.fn(),
	rolesSet: vi.fn(),
	scrollIntoView: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emit: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => Promise.resolve("0.0.0-test")) }));
vi.mock("../../lib/ipc", () => ({
	ompModelRolesRead: rolesRead,
	ompModelRolesSet: rolesSet,
	ompConfigList: vi.fn(async () => ({ found: true, entries: [] })),
}));
vi.mock("./store", () => ({
	useSettings: create(() => ({ settings: {}, error: null, load: vi.fn(async () => {}) })),
	DEFAULT_SETTINGS: {},
	ensureSettings: (value: unknown) => value,
}));
vi.mock("./ompConfigStore", () => ({
	useOmpConfigStore: create(() => ({ entries: [], load: vi.fn(async () => {}), invalidate: vi.fn() })),
}));
// Keep the actual settings router, both destination sections, scope controls and role table.
// Unrelated editors and the provider list do not participate in the navigation contract.
vi.mock("./sections", () => ({
	SECTION_COMPONENTS: { "omp-roles": RolesSection, providers: ProvidersSection },
}));
vi.mock("./modelTemplates", () => ({ ModelTemplatesPanel: () => null }));
vi.mock("./SideChatModelCard", () => ({ SideChatModelCard: () => null }));
vi.mock("./OmpSettingsList", () => ({ OmpSections: () => null }));
vi.mock("./SectionJumpBar", () => ({ SectionJumpBar: () => null }));
vi.mock("../providers/ProviderPanel", () => ({
	ProviderPanel: ({ category }: { category: string }) => <div data-testid={`provider-panel-${category}`}>provider catalog</div>,
}));

const snapshot = (cwd: string | null): ModelRoleSnapshot => ({
	global: {
		path: "/home/u/.omp/config.yml",
		exists: true,
		modelRoles: { image: "catalog/original-image" },
		agentModelOverrides: {},
	},
	project: cwd ? {
		path: `${cwd}/.omp/config.yml`,
		exists: true,
		modelRoles: { image: "catalog/project-image" },
		agentModelOverrides: {},
	} : null,
	agents: [],
});

beforeEach(() => {
	rolesRead.mockReset().mockImplementation(async (cwd: string | null) => snapshot(cwd));
	rolesSet.mockReset();
	scrollIntoView.mockClear();
	vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(scrollIntoView);
	vi.spyOn(Element.prototype, "scrollTo").mockImplementation(() => {});
	useModelCatalog.setState({ models: [], loading: false, refresh: async () => {} });
	useModelKindCatalog.setState({ entries: [], kindBySelector: new Map(), loading: false, error: null, load: async () => {} });
	useServiceModelConfiguration.setState({ origin: null, returning: false });
	useUi.setState({ selectedSessionId: null, lastSessionId: null, settingsSection: null, settingsFocus: null });
	useSessions.setState({
		sessions: {},
		workspaces: [
			{ id: "w1", name: "alpha", path: "/repo/alpha", kind: "project", sort: 0, mode: "code" },
			{ id: "w2", name: "beta", path: "/repo/beta", kind: "project", sort: 1, mode: "code" },
		],
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

// jsdom has no scrolling implementation; record the actual deep-link target instead.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.scrollTo ??= () => {};

async function openRolePage() {
	useUi.getState().openSettings("omp-roles");
	render(<SettingsPage />);
	await screen.findByTestId("role-table");
}

function imageRow() {
	return screen.getByTestId("role-table").querySelector<HTMLElement>('[data-row-name="image"]')!;
}

function configureImage() {
	fireEvent.click(imageRow().querySelector('[role="button"]')!);
	fireEvent.click(within(imageRow()).getByRole("button", { name: "配置其他类型模型" }));
}

async function returnFromOtherModels() {
	await screen.findByTestId("provider-panel-other");
	expect(screen.queryByTestId("role-table")).toBeNull();
	expect(screen.getByRole("radio", { name: "其他类型模型" }).getAttribute("aria-checked")).toBe("true");
	const anchor = document.querySelector<HTMLElement>('[data-field-id="otherModels"]')!;
	expect(anchor.childElementCount).toBe(0);
	await waitFor(() => expect(scrollIntoView.mock.instances).toContain(anchor));
	fireEvent.click(screen.getByRole("button", { name: "返回模型角色" }));
	await screen.findByTestId("role-table");
	await waitFor(() => expect(imageRow().querySelector('[role="button"]')?.getAttribute("aria-expanded")).toBe("true"));
	expect(within(imageRow()).getByRole("button", { name: "配置其他类型模型" })).toBeTruthy();
	expect(screen.queryByTestId("provider-panel-other")).toBeNull();
	expect(useServiceModelConfiguration.getState().origin).toBeNull();
	expect(useServiceModelConfiguration.getState().returning).toBe(false);
	expect(rolesSet).not.toHaveBeenCalled();
}

describe("service role configuration navigation", () => {
	it("returns to the original expanded global role without altering its value", async () => {
		await openRolePage();
		configureImage();
		await returnFromOtherModels();
		expect(screen.getByTestId("role-table").getAttribute("data-scope")).toBe("global");
		expect(screen.getByRole("radio", { name: "全局" }).getAttribute("aria-checked")).toBe("true");
		expect(imageRow().textContent).toContain("catalog/original-image");
	});

	it("restores the exact selected project and expanded role after both sections unmount", async () => {
		await openRolePage();
		fireEvent.click(screen.getByRole("radio", { name: "项目" }));
		fireEvent.change(screen.getByLabelText("选择要配置的项目"), { target: { value: "/repo/beta" } });
		await waitFor(() => expect(imageRow().textContent).toContain("catalog/project-image"));
		configureImage();
		await returnFromOtherModels();
		await waitFor(() => expect(screen.getByTestId("role-table").getAttribute("data-scope")).toBe("project"));
		expect((screen.getByLabelText("选择要配置的项目") as HTMLSelectElement).value).toBe("/repo/beta");
		expect(imageRow().textContent).toContain("catalog/project-image");
		expect(rolesRead).toHaveBeenCalledWith("/repo/beta", null);
		expect(rolesRead).not.toHaveBeenCalledWith("/repo/beta/.omp/config.yml", null);
		// Once consumed, ordinary navigation must not replay the old project return.
		act(() => useUi.getState().openSettings("providers"));
		await screen.findByTestId("provider-panel-chat");
		act(() => useUi.getState().openSettings("omp-roles"));
		await screen.findByTestId("role-table");
		expect(screen.getByTestId("role-table").getAttribute("data-scope")).toBe("global");
		expect(imageRow().querySelector('[role="button"]')?.getAttribute("aria-expanded")).toBe("false");
	});

	it("retains the inactive project selection when returning to a global role", async () => {
		await openRolePage();
		fireEvent.click(screen.getByRole("radio", { name: "项目" }));
		fireEvent.change(screen.getByLabelText("选择要配置的项目"), { target: { value: "/repo/beta" } });
		fireEvent.click(screen.getByRole("radio", { name: "全局" }));
		configureImage();
		await returnFromOtherModels();
		expect(screen.getByTestId("role-table").getAttribute("data-scope")).toBe("global");
		fireEvent.click(screen.getByRole("radio", { name: "项目" }));
		expect((screen.getByLabelText("选择要配置的项目") as HTMLSelectElement).value).toBe("/repo/beta");
	});

	it("does not offer a return action for an unrelated providers visit", async () => {
		useUi.getState().openSettings("providers", { focusKey: "otherModels" });
		render(<SettingsPage />);
		await screen.findByTestId("provider-panel-other");
		expect(screen.queryByRole("button", { name: "返回模型角色" })).toBeNull();
	});
});
