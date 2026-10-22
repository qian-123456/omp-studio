import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillItem, SkillsCatalog, SkillUsageReport } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import {
	DEFAULT_SKILL_CONFIG,
	resolveSkillEnablement,
	type SkillEnableConfig,
} from "../../lib/skillEnablement";
import { computeSkillStats, selectVisibleSkills, useSkillsStore } from "./store";

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("../settings/ompConfigStore", () => ({
	useOmpConfigStore: { getState: () => ({ invalidate }) },
}));

vi.mock("../../lib/ipc", () => ({
	skillsList: vi.fn(),
	skillsRead: vi.fn(),
	skillsUsage: vi.fn(),
	skillsTrash: vi.fn(),
	ompConfigList: vi.fn(),
	ompProjectConfigRead: vi.fn(),
	ompConfigSet: vi.fn(),
	extensionEnableFile: vi.fn(),
}));

const skill = (over: Partial<SkillItem>): SkillItem => ({
	name: "skill",
	description: "",
	source: "user",
	path: "/home/.omp/agent/skills/skill/SKILL.md",
	dir: "/home/.omp/agent/skills/skill",
	root: "~/.omp/agent/skills",
	provider: "native",
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
		skillConfig: DEFAULT_SKILL_CONFIG,
		trashingDirs: [],
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
});

describe("selectVisibleSkills", () => {
	const base = {
		catalog: mockCatalog,
		searchQuery: "",
		sourceFilter: "all" as const,
		statusFilter: "all" as const,
		sort: "name" as const,
		skillConfig: DEFAULT_SKILL_CONFIG,
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

describe("resolveSkillEnablement", () => {
	const cfg = (over: Partial<SkillEnableConfig> = {}): SkillEnableConfig => ({
		...DEFAULT_SKILL_CONFIG,
		...over,
	});
	const s = (over: Partial<SkillItem> = {}) => skill(over);

	it("enabled by default", () => {
		expect(resolveSkillEnablement(s(), cfg())).toEqual({
			enabled: true,
			reason: null,
		});
	});

	it("all_off wins over every other reason", () => {
		const c = cfg({
			skillsEnabled: false,
			disabledExtensions: ["skill:x"],
			ignored: ["x"],
		});
		expect(resolveSkillEnablement(s({ name: "x" }), c)).toEqual({
			enabled: false,
			reason: { kind: "all_off" },
		});
	});

	it("disabledExtensions marker beats source/ignored/include", () => {
		const c = cfg({
			disabledExtensions: ["skill:x"],
			sourceToggles: { "skills.enablePiUser": false },
			ignored: ["x"],
			include: ["other"],
		});
		expect(resolveSkillEnablement(s({ name: "x" }), c)).toEqual({
			enabled: false,
			reason: { kind: "disabled" },
		});
	});

	it("source toggle off reports the key, per provider+scope", () => {
		const c = cfg({ sourceToggles: { "skills.enableClaudeUser": false } });
		expect(
			resolveSkillEnablement(s({ provider: "claude", source: "user" }), c)
				.reason,
		).toEqual({ kind: "source", key: "skills.enableClaudeUser" });
		// project scope uses a different key — unaffected
		expect(
			resolveSkillEnablement(s({ provider: "claude", source: "project" }), c)
				.enabled,
		).toBe(true);
		// managed/github have no toggle
		expect(resolveSkillEnablement(s({ provider: "managed" }), c).enabled).toBe(
			true,
		);
		expect(resolveSkillEnablement(s({ provider: "github" }), c).enabled).toBe(
			true,
		);
	});

	it("ignored: exact name entry reports exact=true", () => {
		const r = resolveSkillEnablement(
			s({ name: "playwright" }),
			cfg({ ignored: ["playwright", "foo*"] }),
		);
		expect(r).toEqual({
			enabled: false,
			reason: { kind: "ignored", pattern: "playwright", exact: true },
		});
	});

	it("ignored: glob match reports exact=false; exact wins over earlier glob", () => {
		const both = resolveSkillEnablement(
			s({ name: "playwright-core" }),
			cfg({ ignored: ["playwright-*", "playwright-core"] }),
		);
		expect(both.reason).toEqual({
			kind: "ignored",
			pattern: "playwright-core",
			exact: true,
		});
		const g = resolveSkillEnablement(
			s({ name: "playwright-core" }),
			cfg({ ignored: ["playwright-*"] }),
		);
		expect(g.reason).toEqual({
			kind: "ignored",
			pattern: "playwright-*",
			exact: false,
		});
	});

	it("include allowlist excludes non-matches", () => {
		const c = cfg({ include: ["keep-*"] });
		expect(resolveSkillEnablement(s({ name: "keep-me" }), c).enabled).toBe(
			true,
		);
		expect(resolveSkillEnablement(s({ name: "other" }), c).reason).toEqual({
			kind: "not_included",
		});
		// include evaluated after ignored
		const both = cfg({ include: ["keep-*"], ignored: ["keep-x"] });
		expect(
			resolveSkillEnablement(s({ name: "keep-x" }), both).reason?.kind,
		).toBe("ignored");
	});

	it("glob semantics: * ? single-segment, case-sensitive, anchored", () => {
		const q = cfg({ ignored: ["a?c"] });
		expect(resolveSkillEnablement(s({ name: "abc" }), q).enabled).toBe(false);
		expect(resolveSkillEnablement(s({ name: "ac" }), q).enabled).toBe(true);
		const star = cfg({ ignored: ["x*"] });
		expect(resolveSkillEnablement(s({ name: "xyz" }), star).enabled).toBe(
			false,
		);
		const ci = cfg({ ignored: ["Play*"] });
		expect(resolveSkillEnablement(s({ name: "play" }), ci).enabled).toBe(true);
		const anchored = cfg({ ignored: ["lay"] });
		expect(resolveSkillEnablement(s({ name: "play" }), anchored).enabled).toBe(
			true,
		);
	});
});

describe("setSkillEnabled", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetState();
	});

	const target = () => skill({ name: "foo" });
	const listWith = (entries: Record<string, unknown>) => ({
		found: true,
		error: null,
		entries: Object.entries(entries).map(([key, value]) => ({
			key,
			value,
			valueType: "array",
			description: "",
			redacted: false,
			tab: "",
		})),
	});

	it("disable appends skill:<name> to disabledExtensions", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(
			listWith({ disabledExtensions: ["ext-a"] }),
		);
		vi.mocked(ipc.ompConfigSet).mockResolvedValue(undefined);

		await useSkillsStore.getState().setSkillEnabled(target(), false);

		expect(ipc.ompConfigSet).toHaveBeenCalledWith(
			"disabledExtensions",
			JSON.stringify(["ext-a", "skill:foo"]),
		);
		expect(
			useSkillsStore.getState().skillConfig.disabledExtensions,
		).toContain("skill:foo");
	});

	it("enable removes the marker plus the exact ignored entry", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(
			listWith({
				disabledExtensions: ["skill:foo"],
				"skills.ignoredSkills": ["foo", "keep-*"],
			}),
		);
		vi.mocked(ipc.ompConfigSet).mockResolvedValue(undefined);
		useSkillsStore.setState({
			skillConfig: {
				...DEFAULT_SKILL_CONFIG,
				disabledExtensions: ["skill:foo"],
				ignored: ["foo", "keep-*"],
			},
		});

		await useSkillsStore.getState().setSkillEnabled(target(), true);

		expect(ipc.ompConfigSet).toHaveBeenCalledWith(
			"disabledExtensions",
			JSON.stringify([]),
		);
		expect(ipc.ompConfigSet).toHaveBeenCalledWith(
			"skills.ignoredSkills",
			JSON.stringify(["keep-*"]),
		);
		expect(useSkillsStore.getState().skillConfig.ignored).toEqual(["keep-*"]);
	});

	it("does not touch ignoredSkills when the match is a glob", async () => {
		useSkillsStore.setState({
			skillConfig: {
				...DEFAULT_SKILL_CONFIG,
				disabledExtensions: ["skill:foo"],
				ignored: ["fo*"],
			},
		});
		vi.mocked(ipc.ompConfigList).mockResolvedValue(
			listWith({ disabledExtensions: ["skill:foo"] }),
		);
		vi.mocked(ipc.ompConfigSet).mockResolvedValue(undefined);

		await useSkillsStore.getState().setSkillEnabled(target(), true);

		expect(ipc.ompConfigSet).toHaveBeenCalledTimes(1);
		expect(ipc.ompConfigSet).toHaveBeenCalledWith(
			"disabledExtensions",
			JSON.stringify([]),
		);
		expect(useSkillsStore.getState().skillConfig.ignored).toEqual(["fo*"]);
	});

	it("rolls back optimistic state when ompConfigSet rejects", async () => {
		useSkillsStore.setState({
			skillConfig: {
				...DEFAULT_SKILL_CONFIG,
				disabledExtensions: ["skill:foo"],
			},
		});
		vi.mocked(ipc.ompConfigList).mockResolvedValue(
			listWith({ disabledExtensions: ["skill:foo"] }),
		);
		vi.mocked(ipc.ompConfigSet).mockRejectedValue(new Error("write failed"));

		await useSkillsStore.getState().setSkillEnabled(target(), true);

		expect(useSkillsStore.getState().skillConfig.disabledExtensions).toEqual([
			"skill:foo",
		]);
	});
});

describe("extension toggle + revalidate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetState();
		vi.mocked(ipc.ompConfigSet).mockResolvedValue(undefined);
		vi.mocked(ipc.extensionEnableFile).mockResolvedValue(undefined);
	});
	const cfgList = (disabled: string[]) => ({
		found: true,
		error: null,
		entries: [
			{
				key: "disabledExtensions",
				value: disabled,
				valueType: "array",
				description: "",
				redacted: false,
				tab: "",
			},
		],
	});
	const [liveExt, offExt] = mockCatalog.extensions;

	it("disable writes ext.name, updates state and invalidates the config store", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);
		vi.mocked(ipc.ompConfigList).mockResolvedValue(cfgList(["x"]));
		await useSkillsStore.getState().loadCatalog("/c");
		await useSkillsStore.getState().setExtensionEnabled(liveExt, false, "/c");
		expect(ipc.ompConfigSet).toHaveBeenCalledWith(
			"disabledExtensions",
			JSON.stringify(["x", "session-autoname"]),
		);
		const s = useSkillsStore.getState();
		expect(s.skillConfig.disabledExtensions).toEqual(["x", "session-autoname"]);
		expect(s.catalog?.extensions[0].enabled).toBe(false);
		expect(invalidate).toHaveBeenCalled();
	});

	it("enable removes name / module id / path entries", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);
		vi.mocked(ipc.ompConfigList).mockResolvedValue(
			cfgList(["session-autoname", "extension-module:session-autoname", "keep"]),
		);
		await useSkillsStore.getState().loadCatalog("/c");
		await useSkillsStore.getState().setExtensionEnabled(liveExt, true, "/c");
		expect(ipc.ompConfigSet).toHaveBeenCalledWith("disabledExtensions", JSON.stringify(["keep"]));
		expect(ipc.extensionEnableFile).not.toHaveBeenCalled();
	});

	it("rolls back state when the config write fails", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);
		vi.mocked(ipc.ompConfigList).mockResolvedValue(cfgList([]));
		vi.mocked(ipc.ompConfigSet).mockRejectedValue(new Error("boom"));
		await useSkillsStore.getState().loadCatalog("/c");
		await expect(
			useSkillsStore.getState().setExtensionEnabled(liveExt, false, "/c"),
		).resolves.toBeUndefined();
		const s = useSkillsStore.getState();
		expect(s.skillConfig.disabledExtensions).toEqual([]);
		expect(s.catalog?.extensions[0].enabled).toBe(true);
	});

	it(".disabled path renames the file and refetches the catalog", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);
		vi.mocked(ipc.ompConfigList).mockResolvedValue(cfgList([]));
		await useSkillsStore.getState().loadCatalog("/c");
		vi.mocked(ipc.skillsList).mockClear();
		await useSkillsStore.getState().setExtensionEnabled(offExt, true, "/c");
		expect(ipc.extensionEnableFile).toHaveBeenCalledWith(offExt.path, "/c");
		expect(ipc.skillsList).toHaveBeenCalledTimes(1);
	});

	it("setSkillEnabled invalidates the config store", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(cfgList([]));
		await useSkillsStore.getState().setSkillEnabled(skill({ name: "foo" }), false);
		expect(invalidate).toHaveBeenCalled();
	});

	it("revalidateCatalog swaps data silently and keeps old data on failure", async () => {
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);
		vi.mocked(ipc.ompConfigList).mockResolvedValue(cfgList([]));
		await useSkillsStore.getState().loadCatalog("/c");
		const seen: boolean[] = [];
		const unsub = useSkillsStore.subscribe((s) => seen.push(s.loading));
		const next = { skills: [mockCatalog.skills[0]], extensions: [] };
		vi.mocked(ipc.skillsList).mockResolvedValue(next);
		await useSkillsStore.getState().revalidateCatalog("/c");
		expect(useSkillsStore.getState().catalog).toEqual(next);
		vi.mocked(ipc.skillsList).mockRejectedValue(new Error("down"));
		await useSkillsStore.getState().revalidateCatalog("/c");
		unsub();
		expect(useSkillsStore.getState().catalog).toEqual(next);
		expect(useSkillsStore.getState().error).toBeNull();
		expect(seen.every((l) => l === false)).toBe(true);
	});

	it("revalidateCatalog sets error only when no catalog exists", async () => {
		vi.mocked(ipc.skillsList).mockRejectedValue(new Error("down"));
		vi.mocked(ipc.ompConfigList).mockResolvedValue(cfgList([]));
		await useSkillsStore.getState().revalidateCatalog("/c");
		expect(useSkillsStore.getState().error).toBe("down");
	});
});

describe("disabled skills", () => {
	it("stats count disabled skills", () => {
		const cfg: SkillEnableConfig = {
			...DEFAULT_SKILL_CONFIG,
			disabledExtensions: ["skill:eli5"],
		};
		const stats = computeSkillStats(mockCatalog.skills, {}, cfg);
		expect(stats.disabled).toBe(1);
	});

	it("status filter 'disabled' lists only non-enabled skills", () => {
		const names = selectVisibleSkills({
			catalog: mockCatalog,
			searchQuery: "",
			sourceFilter: "all",
			statusFilter: "disabled",
			sort: "name",
			usage: {},
			skillConfig: {
				...DEFAULT_SKILL_CONFIG,
				disabledExtensions: ["skill:broken"],
			},
		}).map((s) => s.name);
		expect(names).toEqual(["broken"]);
	});
});

describe("project config layer", () => {
	const projectFile = (content: string) => ({
		path: "/c/.omp/config.yml",
		exists: true,
		content,
	});
	const globalList = (disabled: string[]) => ({
		found: true,
		error: null,
		entries: [
			{
				key: "disabledExtensions",
				value: disabled,
				valueType: "array",
				description: "",
				redacted: false,
				tab: "",
			},
		],
	});
	const [liveExt] = mockCatalog.extensions;

	beforeEach(() => {
		vi.clearAllMocks();
		resetState();
		vi.mocked(ipc.skillsList).mockResolvedValue(mockCatalog);
		vi.mocked(ipc.ompConfigSet).mockResolvedValue(undefined);
	});

	it("project disabledExtensions replaces global, records the override and path", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(globalList(["skill:a"]));
		vi.mocked(ipc.ompProjectConfigRead).mockResolvedValue(
			projectFile("disabledExtensions:\n  - skill:b\n"),
		);
		await useSkillsStore.getState().loadCatalog("/c");
		const s = useSkillsStore.getState();
		expect(s.skillConfig.disabledExtensions).toEqual(["skill:b"]);
		expect(s.skillConfigOverrides).toContain("disabledExtensions");
		expect(s.projectConfigPath).toBe("/c/.omp/config.yml");
		expect(s.projectConfigNotice).toBeNull();
	});

	it("uses the backend-provided extension enabled flag as-is", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(globalList([liveExt.name]));
		vi.mocked(ipc.ompProjectConfigRead).mockResolvedValue(projectFile("disabledExtensions: []\n"));
		// The backend already applied project-replaces-global; the store must not recompute.
		vi.mocked(ipc.skillsList).mockResolvedValue({
			...mockCatalog,
			extensions: mockCatalog.extensions.map((e) =>
				e.name === liveExt.name ? { ...e, enabled: false } : e,
			),
		});
		await useSkillsStore.getState().loadCatalog("/c");
		const s = useSkillsStore.getState();
		expect(s.skillConfig.disabledExtensions).toEqual([]);
		expect(s.catalog?.extensions.find((e) => e.name === liveExt.name)?.enabled).toBe(false);
	});

	it("absent project key inherits global and flags no override", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(globalList(["skill:a"]));
		vi.mocked(ipc.ompProjectConfigRead).mockResolvedValue(projectFile("theme: dark\n"));
		await useSkillsStore.getState().loadCatalog("/c");
		const s = useSkillsStore.getState();
		expect(s.skillConfig.disabledExtensions).toEqual(["skill:a"]);
		expect(s.skillConfigOverrides).toEqual([]);
	});

	it("project read failure falls back to global with a full-text notice", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(globalList(["skill:a"]));
		vi.mocked(ipc.ompProjectConfigRead).mockRejectedValue(new Error("permission denied: /c/.omp"));
		await useSkillsStore.getState().loadCatalog("/c");
		const s = useSkillsStore.getState();
		expect(s.error).toBeNull();
		expect(s.skillConfig.disabledExtensions).toEqual(["skill:a"]);
		expect(s.skillConfigOverrides).toEqual([]);
		expect(s.projectConfigNotice).toContain("permission denied: /c/.omp");
	});

	it("invalid project YAML falls back to global with a notice naming the file", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(globalList(["skill:a"]));
		vi.mocked(ipc.ompProjectConfigRead).mockResolvedValue(projectFile("a: [unclosed\n"));
		await useSkillsStore.getState().loadCatalog("/c");
		const s = useSkillsStore.getState();
		expect(s.skillConfig.disabledExtensions).toEqual(["skill:a"]);
		expect(s.projectConfigNotice).toContain("/c/.omp/config.yml");
	});

	it("without a cwd the project config is not read", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(globalList([]));
		await useSkillsStore.getState().loadCatalog(null);
		expect(ipc.ompProjectConfigRead).not.toHaveBeenCalled();
		expect(useSkillsStore.getState().projectConfigPath).toBeNull();
	});

	it("toggles are refused (no global write) while the project overrides the list", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(globalList([]));
		vi.mocked(ipc.ompProjectConfigRead).mockResolvedValue(projectFile("disabledExtensions: []\n"));
		await useSkillsStore.getState().loadCatalog("/c");
		await useSkillsStore.getState().setSkillEnabled(mockCatalog.skills[0], false);
		await useSkillsStore.getState().setExtensionEnabled(liveExt, false, "/c");
		expect(ipc.ompConfigSet).not.toHaveBeenCalled();
	});
});
