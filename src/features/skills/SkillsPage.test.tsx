// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillItem } from "../../lib/contracts";
import { SkillsPage } from "./SkillsPage";
import { useSkillsStore } from "./store";

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("../../lib/ipc", async () => ({
	...(await vi.importActual<Record<string, unknown>>("../../lib/ipc")),
	skillsRead: vi.fn().mockResolvedValue("# Original skill document"),
}));

const skill = (name: string): SkillItem => ({
	name,
	description: "d",
	source: "user",
	path: `/s/${name}/SKILL.md`,
	dir: `/s/${name}`,
	root: "~/s",
	provider: "native",
	copies: 1,
	issues: [],
	promptChars: 10,
});

const catalog = { skills: [skill("alpha"), skill("beta")], extensions: [] } as never;

function seed(over: Record<string, unknown>) {
	useSkillsStore.setState({
		catalog,
		loading: false,
		error: null,
		activeTab: "skills",
		drawer: null,
		searchQuery: "",
		sourceFilter: "all",
		statusFilter: "all",
		skillConfigOverrides: [],
		projectConfigNotice: null,
		projectConfigPath: null,
		usageReport: null,
		sort: "count",
		usage: {},
		usageLoaded: false,
		usageLoading: true,
		usageError: null,
		loadCatalog: vi.fn().mockResolvedValue(undefined),
		loadUsage: vi.fn().mockResolvedValue(undefined),
		revalidateCatalog: vi.fn().mockResolvedValue(undefined),
		...over,
	} as never);
}

describe("SkillsPage", () => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	beforeEach(() => seed({}));
	afterEach(cleanup);

	it("shows a placeholder instead of rows while usage-driven sort is pending", () => {
		render(<SkillsPage />);
		expect(screen.getByTestId("skills-sort-pending")).toBeTruthy();
		expect(screen.queryByText("alpha")).toBeNull();
		act(() => {
			useSkillsStore.setState({ usageLoaded: true, usageLoading: false } as never);
		});
		expect(screen.queryByTestId("skills-sort-pending")).toBeNull();
		expect(screen.getByRole("heading", { name: "alpha" })).toBeTruthy();
	});

	it("keeps the delete popover open with busy state until trashSkill settles", async () => {
		let resolve: () => void = () => {};
		const trashSkill = vi.fn(
			() =>
				new Promise<void>((r) => {
					resolve = r;
				}),
		);
		seed({ usageLoaded: true, usageLoading: false, trashSkill });
		render(<SkillsPage />);
		fireEvent.click(screen.getByTitle("把该技能目录移到废纸篓"));
		await screen.findByRole("button", { name: "取消" });
		const confirms = screen.getAllByRole("button", { name: "移到废纸篓" });
		const confirm = confirms[confirms.length - 1];
		fireEvent.click(confirm);
		expect(trashSkill).toHaveBeenCalled();
		expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
		await act(async () => resolve());
		expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
	});

	it("states scope once and keeps counts in the status filters instead of duplicate cards", () => {
		seed({ usageLoaded: true, usageLoading: false });
		render(<SkillsPage />);
		expect(screen.getAllByText("这里的启用/停用开关写入全局配置，会影响所有项目的新会话")).toHaveLength(1);
		expect(screen.queryByText("启用/停用写入 OMP 配置，对新会话生效")).toBeNull();
		expect(screen.queryByRole("button", { name: /全部 skills/ })).toBeNull();
		for (const name of ["全部状态 2", "活跃 0", "未触发 2", "有问题 0", "已停用 0"]) {
			expect(screen.getByRole("radio", { name })).toBeTruthy();
		}
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("warns with the config path and locks switches when the project overrides disabledExtensions", () => {
		seed({
			usageLoaded: true,
			usageLoading: false,
			skillConfigOverrides: ["disabledExtensions"],
			projectConfigPath: "/p/.omp/config.yml",
		});
		render(<SkillsPage />);
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("自带一份停用名单");
		expect(alert.textContent).toContain("/p/.omp/config.yml");
		const switches = screen.getAllByRole("switch") as HTMLButtonElement[];
		expect(switches.length).toBeGreaterThan(0);
		for (const sw of switches) expect(sw.disabled).toBe(true);
	});

	it("shows the project-config read failure notice without blocking the list", () => {
		seed({
			usageLoaded: true,
			usageLoading: false,
			projectConfigNotice: "读取项目配置失败，已只按全局配置显示：boom",
		});
		render(<SkillsPage />);
		expect(screen.getByRole("status").textContent).toContain("boom");
		expect(screen.getByRole("heading", { name: "alpha" })).toBeTruthy();
	});

	it("exposes every actual location and confirms symlink deletion separately", () => {
		const alpha = skill("alpha");
		const copy = {
			...alpha,
			dir: "/u/.claude/skills/alpha",
			path: "/u/.claude/skills/alpha/SKILL.md",
			source: "user",
			provider: "claude" as const,
			root: "~/.claude/skills",
			active: false,
			symlink: true,
			issues: [],
		};
		seed({
			trashSkill: vi.fn().mockResolvedValue(undefined),
			catalog: {
				skills: [
					{
						...alpha,
						copies: 2,
						locations: [
							{
								dir: alpha.dir,
								path: alpha.path,
								source: alpha.source,
								provider: alpha.provider,
								root: alpha.root,
								active: true,
								symlink: false,
								issues: [],
							},
							copy,
						],
					},
				],
				extensions: [],
			} as never,
			usageLoaded: true,
			usageLoading: false,
		});
		render(<SkillsPage />);
		fireEvent.click(screen.getByText("存储与安装位置（高级）"));
		expect(screen.getAllByText("~/s").length).toBeGreaterThan(0);
		const standbyLocation = screen.getByText(copy.dir).closest("li");
		expect(standbyLocation).not.toBeNull();
		const activeLocation = screen.getAllByRole("listitem").find((item) => item.textContent?.includes(alpha.dir));
		expect(activeLocation).toBeTruthy();
		expect(within(activeLocation!).getByText("现在用这里")).toBeTruthy();
		expect(within(standbyLocation!).getByText("现在不用")).toBeTruthy();
		expect(within(standbyLocation!).getByText("真实文件不会被删除，仍在原处。")).toBeTruthy();
		fireEvent.click(within(standbyLocation!).getByRole("button", { name: "删除" }));
		expect(screen.getAllByText(copy.dir).length).toBeGreaterThan(1);
		expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
	});

	it("selects details without toggling and toggles without changing selection", () => {
		const setSkillEnabled = vi.fn().mockResolvedValue(undefined);
		seed({ usageLoaded: true, usageLoading: false, setSkillEnabled });
		render(<SkillsPage />);
		fireEvent.click(screen.getByRole("button", { name: /beta.*45/ }));
		expect(screen.getByRole("heading", { name: "beta" })).toBeTruthy();
		expect(setSkillEnabled).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("switch", { name: "启用 alpha" }));
		expect(setSkillEnabled).toHaveBeenCalledWith(expect.objectContaining({ name: "alpha" }), false);
		expect(screen.getByRole("heading", { name: "beta" })).toBeTruthy();
	});

	it("does not turn failed usage reads into a never-used claim", () => {
		seed({ usageLoaded: false, usageLoading: false, usageError: "/full/path: denied" });
		render(<SkillsPage />);
		expect(screen.getByRole("status").textContent).toContain("/full/path: denied");
		expect(screen.queryByText("从未触发")).toBeNull();
	});

	it("keeps usage filtering and sorting attached to real counts", () => {
		seed({ usageLoaded: true, usageLoading: false, usage: { beta: { count: 7, lastUsedAt: "2026-10-01T00:00:00Z" } } });
		render(<SkillsPage />);
		expect(screen.getByRole("heading", { name: "beta" })).toBeTruthy();
		act(() => useSkillsStore.setState({ statusFilter: "idle" }));
		expect(screen.getByRole("heading", { name: "alpha" })).toBeTruthy();
		expect(screen.queryByRole("switch", { name: "启用 beta" })).toBeNull();
		act(() => useSkillsStore.setState({ statusFilter: "all", sort: "name", drawer: null }));
		expect(screen.getByRole("heading", { name: "alpha" })).toBeTruthy();
	});

	it.each(["active", "idle"] as const)("does not display an unverified %s detail after a usage failure", (statusFilter) => {
		seed({
			usageLoaded: false, usageLoading: false, usageError: "scan failed",
			statusFilter, drawer: { kind: "skill", path: skill("alpha").path },
			usage: { alpha: { count: 3, lastUsedAt: null } },
		});
		render(<SkillsPage />);
		expect(screen.queryByRole("heading", { name: "alpha" })).toBeNull();
		expect(screen.queryByRole("heading", { name: "beta" })).toBeNull();
		expect(screen.queryByRole("switch")).toBeNull();
		expect(screen.getByRole("status").textContent).toContain("scan failed");
	});

	it("finds and manages a nonwinning project location through source and path search", () => {
		const alpha = { ...skill("alpha"), description: "distinctive description" };
		const location = {
			dir: "/project/.omp/skills/alternate-alpha",
			path: "/project/.omp/skills/alternate-alpha/SKILL.md",
			root: "/project/.omp/skills",
			source: "project", provider: "native" as const,
			active: false, symlink: false, issues: [],
		};
		seed({
			usageLoaded: true, usageLoading: false,
			catalog: { skills: [{ ...alpha, locations: [location] }], extensions: [] },
		});
		render(<SkillsPage />);
		fireEvent.click(screen.getByRole("radio", { name: "项目级 1" }));
		for (const searchQuery of [location.root, location.dir, location.path, "alpha", "distinctive description"]) {
			act(() => useSkillsStore.setState({ searchQuery }));
			expect(screen.getByRole("heading", { name: "alpha" })).toBeTruthy();
		}
		fireEvent.click(screen.getByText("存储与安装位置（高级）"));
		const entry = screen.getByText(location.dir).closest("li");
		expect(entry).not.toBeNull();
		expect(within(entry!).getByRole("button", { name: "删除" })).toBeTruthy();
		fireEvent.click(within(entry!).getByRole("button", { name: "查看详情" }));
		expect(screen.getAllByText(location.path).length).toBeGreaterThan(0);
	});

	it("combines count and last-triggered time in one wrapping row line", () => {
		seed({ usageLoaded: true, usageLoading: false, usage: { beta: { count: 188, lastUsedAt: "2026-10-01T00:00:00Z" } } });
		render(<SkillsPage />);
		const row = screen.getByRole("button", { name: /beta.*近 45 天触发 188 次/ });
		const summary = within(row).getByText(/近 45 天触发 188 次 · 最后触发于/);
		expect(summary.textContent).toMatch(/^近 45 天触发 188 次 · 最后触发于 .+/);
		expect(summary.className).toContain("whitespace-normal");
		expect(screen.getByRole("switch", { name: "启用 beta" })).toBeTruthy();
	});

	it("keeps an older last trigger when the report window count is zero", () => {
		seed({ usageLoaded: true, usageLoading: false, usage: { beta: { count: 0, lastUsedAt: "2025-01-01T00:00:00Z" } } });
		render(<SkillsPage />);
		const row = screen.getByRole("button", { name: /beta.*近 45 天未触发/ });
		expect(within(row).getByText(/近 45 天未触发 · 最后触发于/)).toBeTruthy();
		expect(within(row).queryByText("从未触发")).toBeNull();
		const alphaRow = screen.getByRole("button", { name: /alpha.*近 45 天未触发/ });
		expect(within(alphaRow).getByText("近 45 天未触发")).toBeTruthy();
		expect(alphaRow.textContent).not.toContain("最后触发于");
	});

	it.each([
		{ usageLoaded: false, usageLoading: true, usageError: null, label: "正在读取使用统计…" },
		{ usageLoaded: false, usageLoading: false, usageError: "scan failed", label: "统计不可用" },
	])("does not label unknown row usage as zero: $label", ({ label, ...state }) => {
		seed({ ...state, sort: "name" });
		render(<SkillsPage />);
		const row = screen.getByRole("button", { name: new RegExp(`beta.*${label}`) });
		expect(within(row).getByText(label)).toBeTruthy();
		expect(row.textContent).not.toContain("未触发");
		expect(row.textContent).not.toContain("最后触发于");
	});

	it("keeps warnings and controls in a bounded region separate from the two scroll panes", () => {
		const notice = `读取失败：${"/very-long-project-directory".repeat(80)}`;
		seed({ usageLoaded: true, usageLoading: false, projectConfigNotice: notice, usageError: "complete usage error" });
		render(<SkillsPage />);
		const page = screen.getByTestId("skills-page");
		const controls = screen.getByTestId("skills-controls");
		expect(page.className).toContain("overflow-hidden");
		expect(page.className).not.toContain("overflow-y-auto");
		expect(controls.className).toContain("max-h-[45%]");
		expect(controls.className).toContain("overflow-auto");
		expect(controls.tabIndex).toBe(0);
		expect(within(controls).getByText(notice).textContent).toBe(notice);
		expect(within(controls).getByText(/complete usage error/)).toBeTruthy();
		expect(within(controls).getByRole("radio", { name: "全部状态 2" })).toBeTruthy();
		for (const id of ["skills-list-scroll", "skills-detail-scroll"]) {
			const pane = screen.getByTestId(id);
			expect(pane.className).toContain("overflow-y-auto");
			expect(pane.tabIndex).toBe(0);
			expect(controls.contains(pane)).toBe(false);
		}
		expect(screen.getByTestId("skills-workspace").className).toContain("flex-1");
	});

	it("gives extensions the remaining-height scroll region when switching tabs", () => {
		seed({ usageLoaded: true, usageLoading: false });
		render(<SkillsPage />);
		fireEvent.click(screen.getByRole("radio", { name: "扩展 0" }));
		expect(screen.queryByTestId("skills-workspace")).toBeNull();
		const extensions = screen.getByTestId("extensions-scroll");
		expect(extensions.className).toContain("min-h-0");
		expect(extensions.className).toContain("flex-1");
		expect(extensions.className).toContain("overflow-auto");
		expect(extensions.tabIndex).toBe(0);
		expect(screen.getByTestId("skills-controls").contains(extensions)).toBe(false);
	});
});
