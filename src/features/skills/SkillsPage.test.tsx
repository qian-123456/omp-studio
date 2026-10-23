// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillItem } from "../../lib/contracts";
import { SkillsPage } from "./SkillsPage";
import { useSkillsStore } from "./store";

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

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
		expect(screen.getByText("alpha")).toBeTruthy();
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
		fireEvent.click(screen.getAllByTitle("移到废纸篓")[0]);
		await screen.findByRole("button", { name: "取消" });
		const confirms = screen.getAllByRole("button", { name: "移到废纸篓" });
		const confirm = confirms[confirms.length - 1];
		fireEvent.click(confirm);
		expect(trashSkill).toHaveBeenCalled();
		expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
		await act(async () => resolve());
		expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
	});

	it("states the global scope next to the controls", () => {
		seed({ usageLoaded: true, usageLoading: false });
		render(<SkillsPage />);
		expect(screen.getAllByText("对所有项目生效").length).toBeGreaterThan(0);
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
		expect(screen.getByText("alpha")).toBeTruthy();
	});
});
