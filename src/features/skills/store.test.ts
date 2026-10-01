import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillItem, SkillsCatalog, SkillUsageReport } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import {
	computeSkillStats,
	selectVisibleSkills,
	useSkillsStore,
} from "./store";

vi.mock("../../lib/ipc", () => ({
	skillsList: vi.fn(),
	skillsRead: vi.fn(),
	skillsUsage: vi.fn(),
	ompConfigList: vi.fn(),
	ompConfigSet: vi.fn(),
}));

const skill = (over: Partial<SkillItem>): SkillItem => ({
	name: "skill",
	description: "",
	source: "user",
	path: "/home/.omp/agent/skills/skill/SKILL.md",
	dir: "/home/.omp/agent/skills/skill",
	root: "~/.omp/agent/skills",
	copies: 1,
	issues: [],
	promptChars: 10,
	...over,
});

const mockCatalog: SkillsCatalog = {
	skills: [
		skill({
			name: "ego-browser",
			description: "Browser automation",
			path: "/home/.omp/agent/skills/ego-browser/SKILL.md",
			dir: "/home/.omp/agent/skills/ego-browser",
			promptChars: 500,
		}),
		skill({
			name: "eli5",
			description: "Explain like I'm 5",
			path: "/home/.omp/agent/skills/eli5/SKILL.md",
			dir: "/home/.omp/agent/skills/eli5",
			source: "project",
			root: "./.omp/skills",
			copies: 2,
			promptChars: 300,
			issues: ["description_too_long"],
		}),
		skill({
			name: "broken",
			description: "",
			path: "/home/.claude/skills/broken/SKILL.md",
			dir: "/home/.claude/skills/broken",
			root: "~/.claude/skills",
			issues: ["unreadable", "missing_description"],
			promptChars: 100,
		}),
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

const mockReport: SkillUsageReport = {
	days: 45,
	totalTriggers: 7,
	scannedFiles: 12,
	usage: [
		{ name: "ego-browser", count: 5, lastUsedAt: "2026-09-30T10:00:00Z" },
		{ name: "eli5", count: 2, lastUsedAt: "2026-09-20T10:00:00Z" },
	],
};

const resetState = () =>
	useSkillsStore.setState({
		catalog: null,
		loading: false,
		error: null,
		activeTab: "skills",
		searchQuery: "",
		sourceFilter: "all",
		statusFilter: "all",
		sort: "count",
		drawer: null,
		usage: {},
		usageReport: null,
		usageLoading: false,
		usageError: null,
		usageLoaded: false,
		lastLoadedCwd: undefined,
	});

describe("skills store", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetState();
	});

	it("loads catalog once per cwd", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);

		await useSkillsStore.getState().loadCatalog("/test/cwd");
		await useSkillsStore.getState().loadCatalog("/test/cwd");
		expect(ipc.skillsList).toHaveBeenCalledTimes(1);

		await useSkillsStore.getState().loadCatalog("/other/cwd");
		expect(ipc.skillsList).toHaveBeenCalledTimes(2);
	});

	it("refresh forces both catalog and usage reload", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);
		vi.mocked(ipc.skillsUsage).mockResolvedValue(mockReport);

		await useSkillsStore.getState().loadCatalog("/test/cwd");
		await useSkillsStore.getState().loadUsage();
		expect(ipc.skillsList).toHaveBeenCalledTimes(1);
		expect(ipc.skillsUsage).toHaveBeenCalledTimes(1);

		await useSkillsStore.getState().refresh("/test/cwd");
		expect(ipc.skillsList).toHaveBeenCalledTimes(2);
		expect(ipc.skillsUsage).toHaveBeenCalledTimes(2);
	});

	it("loadUsage indexes report by name and dedupes in-flight calls", async () => {
		vi.mocked(ipc.skillsUsage).mockResolvedValue(mockReport);

		await Promise.all([
			useSkillsStore.getState().loadUsage(),
			useSkillsStore.getState().loadUsage(),
		]);

		const state = useSkillsStore.getState();
		expect(ipc.skillsUsage).toHaveBeenCalledTimes(1);
		expect(state.usage["ego-browser"]?.count).toBe(5);
		expect(state.usageReport?.totalTriggers).toBe(7);
		expect(state.usageError).toBeNull();
	});

	it("loadUsage rejection leaves usageError without crashing catalog state", async () => {
		vi.mocked(ipc.skillsUsage).mockRejectedValue("skills_usage is not a command");

		await useSkillsStore.getState().loadUsage();

		const state = useSkillsStore.getState();
		expect(state.usageError).toContain("skills_usage");
		expect(state.usageLoading).toBe(false);
		expect(state.usageLoaded).toBe(false);
	});

	it("loadCatalog failure clears loading and records error", async () => {
		vi.mocked(ipc.skillsList).mockRejectedValue(new Error("scan failed"));

		await useSkillsStore.getState().loadCatalog("/test/cwd");

		const state = useSkillsStore.getState();
		expect(state.loading).toBe(false);
		expect(state.error).toBe("scan failed");
	});

	it("closes the drawer when its target vanishes after reload", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);
		await useSkillsStore.getState().loadCatalog("/test/cwd");

		useSkillsStore.getState().openDrawer({
			kind: "skill",
			path: "/home/.omp/agent/skills/ego-browser/SKILL.md",
		});
		await useSkillsStore.getState().loadCatalog("/test/cwd", true);
		expect(useSkillsStore.getState().drawer?.path).toBe(
			"/home/.omp/agent/skills/ego-browser/SKILL.md",
		);

		vi.mocked(ipc.skillsList).mockResolvedValue({
			skills: [mockCatalog.skills[1]],
			extensions: [],
		});
		await useSkillsStore.getState().loadCatalog("/test/cwd", true);
		expect(useSkillsStore.getState().drawer).toBeNull();
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
});

describe("computeSkillStats", () => {
	const usage = {
		"ego-browser": { name: "ego-browser", count: 5, lastUsedAt: "x" },
		eli5: { name: "eli5", count: 2, lastUsedAt: "y" },
	};

	it("buckets skills by activity and issues", () => {
		const stats = computeSkillStats(mockCatalog.skills, usage);
		expect(stats.total).toBe(3);
		expect(stats.userCount).toBe(2);
		expect(stats.projectCount).toBe(1);
		expect(stats.active).toBe(2);
		expect(stats.idle).toBe(1); // "broken" has no usage record
		expect(stats.totalTriggers).toBe(7);
		expect(stats.withIssues).toBe(2);
		expect(stats.missingDescription).toBe(1);
		expect(stats.tooLong).toBe(1);
		expect(stats.unreadable).toBe(1);
	});

	it("sums promptChars as the resident budget estimate", () => {
		expect(computeSkillStats(mockCatalog.skills, {}).budgetUsed).toBe(900);
	});
});

describe("selectVisibleSkills", () => {
	const base = {
		catalog: mockCatalog,
		searchQuery: "",
		sourceFilter: "all" as const,
		statusFilter: "all" as const,
		sort: "name" as const,
		usage: {
			"ego-browser": {
				name: "ego-browser",
				count: 5,
				lastUsedAt: "2026-09-30T10:00:00Z",
			},
			eli5: {
				name: "eli5",
				count: 0,
				lastUsedAt: "2026-09-20T10:00:00Z",
			},
		},
	};

	it("filters by source", () => {
		expect(
			selectVisibleSkills({ ...base, sourceFilter: "project" }).map(
				(s) => s.name,
			),
		).toEqual(["eli5"]);
		expect(
			selectVisibleSkills({ ...base, sourceFilter: "user" }).map((s) => s.name),
		).toEqual(["broken", "ego-browser"]);
	});

	it("filters by status buckets", () => {
		expect(
			selectVisibleSkills({ ...base, statusFilter: "active" }).map(
				(s) => s.name,
			),
		).toEqual(["ego-browser"]);
		// idle = zero or absent usage
		expect(
			selectVisibleSkills({ ...base, statusFilter: "idle" }).map((s) => s.name),
		).toEqual(["broken", "eli5"]);
		expect(
			selectVisibleSkills({ ...base, statusFilter: "issues" }).map(
				(s) => s.name,
			),
		).toEqual(["broken", "eli5"]);
	});

	it("searches name, description and install root", () => {
		expect(
			selectVisibleSkills({ ...base, searchQuery: "browser" }).map(
				(s) => s.name,
			),
		).toEqual(["ego-browser"]);
		expect(
			selectVisibleSkills({ ...base, searchQuery: ".claude" }).map(
				(s) => s.name,
			),
		).toEqual(["broken"]);
	});

	it("sorts by count desc with name tiebreak, never-triggered last", () => {
		const state = { ...base, sort: "count" as const };
		expect(selectVisibleSkills(state).map((s) => s.name)).toEqual([
			"ego-browser",
			"broken", // count 0: name before eli5
			"eli5",
		]);
	});

	it("sorts by lastUsed desc with nulls last", () => {
		const state = { ...base, sort: "lastUsed" as const };
		expect(selectVisibleSkills(state).map((s) => s.name)).toEqual([
			"ego-browser", // 09-30
			"eli5", // 09-20 (count 0 still sorts by timestamp)
			"broken", // no record → last
		]);
	});

	it("sorts by name", () => {
		expect(
			selectVisibleSkills({ ...base, sort: "name" as const }).map(
				(s) => s.name,
			),
		).toEqual(["broken", "ego-browser", "eli5"]);
	});
});
