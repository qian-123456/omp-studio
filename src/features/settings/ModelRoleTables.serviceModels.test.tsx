// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelKindEntry } from "../../lib/contracts";
import { useModelCatalog } from "../../stores/modelCatalog";
import { useModelKindCatalog, useServiceModelConfiguration } from "../../stores/modelKinds";
import { useModelSelectPrefs } from "../../components/modelSelectPrefs";
import { useUi } from "../../stores/ui";
import { buildAssignmentRows, type AssignmentScope } from "./agentModelAssignments";
import { type AssignmentContext, RoleAssignmentTable } from "./ModelRoleTables";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emit: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => Promise.resolve("0.0.0-test")) }));

const writes = vi.fn();
const load = vi.fn(async () => {});
const entry = (id: string, kind: string, thinking: string[] = [], provider = "catalog"): ModelKindEntry => ({
	selector: `${provider}/${id}`,
	provider,
	name: id,
	kind,
	thinking,
});
const CATALOG = [
	entry("paint", "image", ["high"]),
	entry("voice", "tts"),
	entry("transcribe", "stt"),
	entry("search", "search"),
	entry("judge", "judge", ["high"]),
	entry("tiny", "tiny", ["low", "high"]),
	entry("chat", "chat", ["low", "high"]),
	entry("embedding", "embedding"),
	entry("future-kind", "future-runner"),
];

function setCatalog(entries: ModelKindEntry[] | null, error: string | null = null, loading = false) {
	useModelKindCatalog.setState({ entries, kindBySelector: new Map((entries ?? []).map((item) => [item.selector, item.kind])), error, loading, load });
}

function Harness({
	globalRoles = {},
	projectRoles = {},
	scope = "global",
}: {
	globalRoles?: Record<string, string>;
	projectRoles?: Record<string, string>;
	scope?: AssignmentScope;
}) {
	const [global, setGlobal] = useState(globalRoles);
	const [project, setProject] = useState(projectRoles);
	const rows = buildAssignmentRows({
		global: { modelRoles: global, agentModelOverrides: {} },
		project: scope === "project" ? { modelRoles: project, agentModelOverrides: {} } : null,
		agents: [],
		sessionModel: null,
	});
	const ctx: AssignmentContext = {
		scope,
		models: [{ provider: "chat-only", id: "wrong-directory", name: "wrong-directory", thinking: ["high"] }],
		projectName: "alpha",
		sessionSelected: false,
		globalPath: "/home/u/.omp/config.yml",
		projectPath: scope === "project" ? "/repo/alpha/.omp/config.yml" : null,
		projectCwd: scope === "project" ? "/repo/alpha" : null,
		busy: false,
		roles: scope === "project" ? { ...global, ...project } : global,
		roleUsers: new Map(),
		write: async (targetScope, table, name, value) => {
			writes(targetScope, table, name, value);
			const update = targetScope === "global" ? setGlobal : setProject;
			update((previous) => {
				const next = { ...previous };
				if (value === null) delete next[name];
				else next[name] = value;
				return next;
			});
		},
	};
	return <RoleAssignmentTable rows={rows} query="" ctx={ctx} />;
}

function expand(role: string) {
	const row = screen.getByTestId("role-table").querySelector<HTMLElement>(`[data-row-name="${role}"]`)!;
	fireEvent.click(row.querySelector('[role="button"]')!);
	return row;
}

function openPicker(row: HTMLElement) {
	const button = row.querySelector<HTMLButtonElement>('button[title]')!;
	fireEvent.click(button);
}

beforeEach(() => {
	writes.mockClear();
	load.mockClear();
	setCatalog(CATALOG);
	useModelCatalog.setState({ models: [], loading: false, refresh: async () => {} });
	useModelSelectPrefs.setState({ recent: [] });
	useUi.setState({ settingsSection: null, settingsFocus: null, settingsPending: false });
	useServiceModelConfiguration.setState({ origin: null, returning: false });
	vi.stubGlobal("ResizeObserver", class {
		observe() {}
		unobserve() {}
		disconnect() {}
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("service role model selection", () => {
	it.each([
		["image", ["paint"]],
		["speech", ["voice"]],
		["dictation", ["transcribe"]],
		["web", ["search"]],
		["judge", ["judge", "tiny", "chat"]],
	] as const)("shows and saves only compatible catalog candidates for %s", async (role, visible) => {
		render(<Harness />);
		const row = expand(role);
		openPicker(row);
		expect(load).toHaveBeenCalledWith();
		for (const item of CATALOG) {
			const id = item.selector.slice("catalog/".length);
			expect(screen.queryByRole("button", { name: id }) !== null).toBe((visible as readonly string[]).includes(id));
		}
		expect(screen.queryByRole("button", { name: "wrong-directory" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: visible[0] }));
		await waitFor(() => expect(writes).toHaveBeenCalledWith("global", "modelRoles", role, `catalog/${visible[0]}`));
		expect(row.textContent).toContain(`catalog/${visible[0]}`);
		expect(within(row).getByRole("button", { name: "配置其他类型模型" })).toBeTruthy();
	});

	it("groups compatible entries by provider without showing an unrelated provider", () => {
		setCatalog([entry("first", "image", [], "alpha"), entry("second", "image", [], "beta"), entry("chat", "chat", [], "chat-only")]);
		render(<Harness />);
		openPicker(expand("image"));
		expect(screen.getByRole("button", { name: "first" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "second" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /beta/ }));
		expect(screen.getByRole("button", { name: "second" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /chat-only/ })).toBeNull();
	});

	it("does not offer a known incompatible ID as a manual search choice", () => {
		setCatalog([...Array.from({ length: 6 }, (_, index) => entry(`paint-${index}`, "image")), entry("chat", "chat")]);
		render(<Harness />);
		openPicker(expand("image"));
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "catalog/chat" } });
		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
		expect(screen.queryByRole("button", { name: /catalog\/chat/ })).toBeNull();
		expect(writes).not.toHaveBeenCalled();
	});

	it("leaves conversation role candidates on the existing chat directory", async () => {
		render(<Harness />);
		openPicker(expand("default"));
		expect(screen.queryByRole("button", { name: "paint" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "wrong-directory" }));
		await waitFor(() => expect(writes).toHaveBeenCalledWith("global", "modelRoles", "default", "chat-only/wrong-directory"));
	});

	it.each(["catalog/chat:high", "old-provider/unknown:high"])("preserves %s until explicitly replaced", async (stored) => {
		render(<Harness globalRoles={{ image: stored }} />);
		const row = expand("image");
		expect(row.textContent).toContain(stored.split(":")[0]);
		expect(row.textContent).toContain(stored.startsWith("old-provider") ? "兼容性尚未验证" : "此模型不适用于该角色");
		expect(within(row).queryByRole("button", { name: /思考/ })).toBeNull();
		openPicker(row);
		expect(writes).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "paint" }));
		await waitFor(() => expect(writes).toHaveBeenCalledWith("global", "modelRoles", "image", "catalog/paint"));
		expect(row.textContent).toContain("catalog/paint");
		expect(row.textContent).not.toContain(stored.split(":")[0]);
	});

	it("clears only the project override and reveals its global model", async () => {
		render(<Harness scope="project" globalRoles={{ image: "catalog/paint" }} projectRoles={{ image: "old/unknown:high" }} />);
		const row = expand("image");
		fireEvent.click(row.querySelector('button[aria-label]')!);
		await waitFor(() => expect(writes).toHaveBeenCalledWith("project", "modelRoles", "image", null));
		expect(row.textContent).toContain("catalog/paint");
		expect(row.textContent).not.toContain("old/unknown");
	});

	it("preserves a stored incompatible alias while filtering other incompatible aliases", async () => {
		render(<Harness globalRoles={{ image: "@default", default: "catalog/chat", wrong: "catalog/voice", saved: "catalog/paint" }} />);
		const row = expand("image");
		const select = within(row).getByRole("combobox") as HTMLSelectElement;
		expect(select.value).toBe("@default");
		expect([...select.options].some((option) => option.value === "@wrong")).toBe(false);
		expect([...select.options].some((option) => option.value === "@saved")).toBe(true);
		expect(row.textContent).toContain("此模型不适用于该角色");
		expect(writes).not.toHaveBeenCalled();
		fireEvent.change(select, { target: { value: "@saved" } });
		await waitFor(() => expect(writes).toHaveBeenCalledWith("global", "modelRoles", "image", "@saved"));
		expect(row.textContent).toContain("catalog/paint");
	});

	describe.each([
		{ phase: "loading", error: null, loading: true },
		{ phase: "failed", error: "catalog unavailable", loading: false },
	])("service aliases while catalog is $phase", ({ error, loading }) => {
		it("disables new aliases and rejects change events for unavailable candidates", () => {
			setCatalog(null, error, loading);
			render(<Harness globalRoles={{ speech: "catalog/voice" }} />);
			const row = expand("image");
			const select = within(row).getByRole("combobox") as HTMLSelectElement;
			const speech = [...select.options].find((option) => option.value === "@speech")!;
			expect(speech.disabled).toBe(true);
			// A stale native selection event must not bypass the disabled option.
			fireEvent.change(select, { target: { value: "@speech" } });
			expect(writes).not.toHaveBeenCalled();
		});

		it("keeps the configured alias visible and clearable but blocks replacing it", async () => {
			setCatalog(null, error, loading);
			render(<Harness globalRoles={{ image: "@saved", saved: "catalog/paint", speech: "catalog/voice" }} />);
			const row = expand("image");
			const select = within(row).getByRole("combobox") as HTMLSelectElement;
			expect(select.value).toBe("@saved");
			expect([...select.options].find((option) => option.value === "@saved")!.disabled).toBe(false);
			expect([...select.options].find((option) => option.value === "@speech")!.disabled).toBe(true);
			fireEvent.change(select, { target: { value: "@speech" } });
			expect(writes).not.toHaveBeenCalled();
			fireEvent.change(select, { target: { value: "" } });
			await waitFor(() => expect(writes).toHaveBeenCalledWith("global", "modelRoles", "image", null));
			expect(select.value).toBe("");
		});

		it.each(["@saved", "old/unknown:high"])("allows clearing project value %s to inherit globally", async (stored) => {
			setCatalog(null, error, loading);
			render(<Harness scope="project" globalRoles={{ image: "catalog/paint", saved: "catalog/paint" }} projectRoles={{ image: stored }} />);
			const row = expand("image");
			if (stored.startsWith("@")) {
				const select = within(row).getByRole("combobox") as HTMLSelectElement;
				expect(select.value).toBe(stored);
				fireEvent.change(select, { target: { value: "" } });
			} else {
				fireEvent.click(row.querySelector('button[aria-label]')!);
			}
			await waitFor(() => expect(writes).toHaveBeenCalledWith("project", "modelRoles", "image", null));
			expect(row.textContent).toContain("catalog/paint");
		});
	});

	it("keeps unresolved aliases verbatim instead of silently erasing them", () => {
		render(<Harness globalRoles={{ speech: "@external-role:high" }} />);
		const row = expand("speech");
		expect((within(row).getByRole("combobox") as HTMLSelectElement).value).toBe("@external-role:high");
		expect(writes).not.toHaveBeenCalled();
	});

	it("marks an existing web chat assignment unverified, not invalid, when capability metadata is absent", () => {
		render(<Harness globalRoles={{ web: "@default", default: "catalog/chat:high" }} />);
		const row = expand("web");
		expect(row.textContent).toContain("兼容性尚未验证，已保留原值");
		expect(row.textContent).not.toContain("此模型不适用于该角色");
		expect((within(row).getByRole("combobox") as HTMLSelectElement).value).toBe("@default");
		expect(within(row).queryByRole("button", { name: /思考/ })).toBeNull();
		expect(writes).not.toHaveBeenCalled();
	});

	it.each([
		["image", "catalog/paint:high", false],
		["judge", "catalog/judge:high", false],
		["judge", "catalog/chat:high", true],
		["judge", "catalog/tiny:high", true],
	] as const)("offers thinking only for a compatible capable LLM: %s %s", (role, stored, visible) => {
		render(<Harness globalRoles={{ [role]: stored }} />);
		const row = expand(role);
		expect(within(row).queryByRole("button", { name: /思考/ }) !== null).toBe(visible);
		expect(writes).not.toHaveBeenCalled();
	});

	it.each(["empty", "loading", "failed", "populated"] as const)("allows configuration from an expanded role with its picker closed: %s catalog", (state) => {
		if (state === "empty") setCatalog([]);
		if (state === "loading") setCatalog(null, null, true);
		if (state === "failed") setCatalog(null, "catalog unavailable");
		render(<Harness />);
		const row = expand("image");
		expect(document.querySelector('[data-layer="popover"]')).toBeNull();
		const configure = within(row).getByRole("button", { name: "配置其他类型模型" });
		expect((configure as HTMLButtonElement).disabled).toBe(false);
		expect(screen.getAllByRole("button", { name: "配置其他类型模型" })).toHaveLength(1);
		fireEvent.click(configure);
		expect(useUi.getState().settingsSection).toBe("providers");
		expect(useUi.getState().settingsFocus).toBe("otherModels");
		expect(writes).not.toHaveBeenCalled();
	});

	it("keeps the single configuration action outside an empty candidate popup", () => {
		setCatalog([entry("chat", "chat")]);
		render(<Harness />);
		const row = expand("image");
		openPicker(row);
		expect(screen.getByText("暂无适用于此角色的模型。")).toBeTruthy();
		const popup = document.querySelector<HTMLElement>('[data-layer="popover"]')!;
		expect(within(popup).queryByRole("button", { name: "配置其他类型模型" })).toBeNull();
		expect(screen.getAllByRole("button", { name: "配置其他类型模型" })).toHaveLength(1);
		fireEvent.click(within(row).getByRole("button", { name: "配置其他类型模型" }));
		expect(useUi.getState().settingsSection).toBe("providers");
		expect(useUi.getState().settingsFocus).toBe("otherModels");
		expect(writes).not.toHaveBeenCalled();
	});

	it("keeps configuration accessible through loading and empty updates while the picker is open", () => {
		render(<Harness />);
		const row = expand("image");
		openPicker(row);
		expect(screen.getByRole("button", { name: "paint" })).toBeTruthy();
		act(() => setCatalog(null, null, true));
		expect(within(row).getByRole("button", { name: "配置其他类型模型" })).toBeTruthy();
		act(() => setCatalog([]));
		expect(screen.getByText("暂无适用于此角色的模型。")).toBeTruthy();
		const configure = within(row).getByRole("button", { name: "配置其他类型模型" });
		configure.focus();
		expect(document.activeElement).toBe(configure);
		fireEvent.click(configure);
		expect(useUi.getState().settingsSection).toBe("providers");
		expect(useUi.getState().settingsFocus).toBe("otherModels");
		expect(writes).not.toHaveBeenCalled();
	});

	it("keeps configuration separate from a populated grouped candidate list", () => {
		render(<Harness />);
		const row = expand("dictation");
		openPicker(row);
		expect(screen.getByRole("button", { name: "transcribe" })).toBeTruthy();
		const popup = document.querySelector<HTMLElement>('[data-layer="popover"]')!;
		expect(within(popup).queryByRole("button", { name: "配置其他类型模型" })).toBeNull();
		fireEvent.click(within(row).getByRole("button", { name: "配置其他类型模型" }));
		expect(useUi.getState().settingsSection).toBe("providers");
		expect(useUi.getState().settingsFocus).toBe("otherModels");
		expect(writes).not.toHaveBeenCalled();
	});

	it("keeps loading and request failure distinct from an empty catalog", () => {
		setCatalog(null, null, true);
		render(<Harness />);
		openPicker(expand("image"));
		expect(screen.getByRole("status").textContent).toContain("加载");
		expect(screen.queryByText("暂无适用于此角色的模型。")).toBeNull();
	});

	it("shows catalog failure and lets the user retry without replacing their value", () => {
		setCatalog(null, "catalog unavailable");
		render(<Harness globalRoles={{ image: "old/unknown" }} />);
		const row = expand("image");
		openPicker(row);
		expect(screen.getByRole("alert").textContent).toContain("catalog unavailable");
		fireEvent.click(within(screen.getByRole("alert")).getByRole("button"));
		expect(load).toHaveBeenCalledTimes(2);
		expect(load).toHaveBeenNthCalledWith(1);
		expect(load).toHaveBeenNthCalledWith(2, true);
		expect(row.textContent).toContain("old/unknown");
		expect(writes).not.toHaveBeenCalled();
	});
});
