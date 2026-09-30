import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillsCatalog } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import { useSkillsStore } from "./store";

vi.mock("../../lib/ipc", () => ({
	skillsList: vi.fn(),
	skillsRead: vi.fn(),
	ompConfigList: vi.fn(),
	ompConfigSet: vi.fn(),
}));

const mockCatalog: SkillsCatalog = {
	skills: [
		{
			name: "ego-browser",
			description: "Browser automation",
			source: "user",
			path: "/home/.omp/agent/skills/ego-browser/SKILL.md",
			dir: "/home/.omp/agent/skills/ego-browser",
		},
		{
			name: "eli5",
			description: "Explain like I'm 5",
			source: "user",
			path: "/home/.omp/agent/skills/eli5/SKILL.md",
			dir: "/home/.omp/agent/skills/eli5",
		},
	],
	extensions: [
		{
			name: "session-autoname",
			path: "/home/.omp/agent/extensions/session-autoname.ts",
			source: "user",
			enabled: true,
		},
		{
			name: "translator",
			path: "/home/.omp/agent/extensions/translator.ts.disabled",
			source: "user",
			enabled: false,
		},
	],
};

describe("skills store", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSkillsStore.setState({
			catalog: null,
			loading: false,
			error: null,
			activeTab: "skills",
			searchQuery: "",
			selectedSkillPath: null,
			selectedExtensionPath: null,
			lastLoadedCwd: undefined,
		});
	});

	it("loads catalog and selects first skill and extension", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);

		await useSkillsStore.getState().loadCatalog("/test/cwd");

		const state = useSkillsStore.getState();
		expect(state.catalog).toEqual(mockCatalog);
		expect(state.loading).toBe(false);
		expect(state.selectedSkillPath).toBe("/home/.omp/agent/skills/ego-browser/SKILL.md");
		expect(state.selectedExtensionPath).toBe(
			"/home/.omp/agent/extensions/session-autoname.ts",
		);
		expect(ipc.skillsList).toHaveBeenCalledTimes(1);
	});

	it("caches catalog and does not refetch if cwd is the same", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);

		await useSkillsStore.getState().loadCatalog("/test/cwd");
		expect(ipc.skillsList).toHaveBeenCalledTimes(1);

		// Second call with same cwd
		await useSkillsStore.getState().loadCatalog("/test/cwd");
		expect(ipc.skillsList).toHaveBeenCalledTimes(1);
	});

	it("forces reload on refresh", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);

		await useSkillsStore.getState().loadCatalog("/test/cwd");
		expect(ipc.skillsList).toHaveBeenCalledTimes(1);

		await useSkillsStore.getState().refresh("/test/cwd");
		expect(ipc.skillsList).toHaveBeenCalledTimes(2);
	});

	it("updates extension enabled status optimistically", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);
		await useSkillsStore.getState().loadCatalog("/test/cwd");

		useSkillsStore
			.getState()
			.updateExtensionEnabled(
				"/home/.omp/agent/extensions/session-autoname.ts",
				false,
			);

		const updated = useSkillsStore
			.getState()
			.catalog?.extensions.find((e) => e.name === "session-autoname");
		expect(updated?.enabled).toBe(false);
	});

	it("updates tab and search query", () => {
		useSkillsStore.getState().setActiveTab("extensions");
		expect(useSkillsStore.getState().activeTab).toBe("extensions");

		useSkillsStore.getState().setSearchQuery("browser");
		expect(useSkillsStore.getState().searchQuery).toBe("browser");
	});
});
