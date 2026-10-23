// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
	openPath: vi.fn(),
	openUrl: vi.fn(),
	revealItemInDir: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/Users/me" }));
const FILES = new Set([
	"/Users/me/omp-workspace/AGENTS.md",
	"/Users/me/.omp/agent/AGENTS.md",
	"/repo/src/a.ts",
	"/Users/me/CodingWiki/wiki/rules.md",
	"/Users/me/projects/omp-workspace/AGENTS.md",
]);
vi.mock("../../lib/ipc", () => ({
	validatePath: async (path: string) => ({
		exists: FILES.has(path),
		isDir: false,
		size: 10,
	}),
	// The backend returns paths relative to the root.
	listWorkspaceFiles: async (root: string) =>
		[...FILES]
			.filter((f) => f.startsWith(`${root}/`))
			.map((f) => f.slice(root.length + 1)),
}));

import { Markdown } from "../../components/Markdown";
import { useFilePreview } from "../../stores/filePreview";
import { useUi } from "../../stores/ui";

describe("Markdown file links", () => {
	beforeEach(() => {
		localStorage.clear();
		useFilePreview.setState({ tabs: [], activePath: null });
		useUi.setState({ rightTab: null, openRightTabs: [], rightOpen: false });
	});

	afterEach(cleanup);

	it("opens an absolute path in the right-panel preview", async () => {
		const { container } = render(
			<Markdown text={"读取 /Users/me/CodingWiki/wiki/rules.md 后回复。"} />,
		);
		const link = container.querySelector<HTMLAnchorElement>(
			'a[href="/Users/me/CodingWiki/wiki/rules.md"]',
		);
		expect(link).not.toBeNull();
		fireEvent.click(link!);
		await waitFor(() => {
			expect(useFilePreview.getState().tabs[0]?.path).toBe(
				"/Users/me/CodingWiki/wiki/rules.md",
			);
		});
		expect(useFilePreview.getState().tabs[0]?.mode).toBe("preview");
		expect(useUi.getState().rightTab).toBe("files");
		expect(useUi.getState().rightOpen).toBe(true);
	});

	it("finds a relative path under home when the cwd has no such file", async () => {
		const { container } = render(
			<Markdown text={"压缩 `omp-workspace/AGENTS.md` 即可"} cwd="/repo" />,
		);
		const link = container.querySelector<HTMLAnchorElement>(
			'a[href="omp-workspace/AGENTS.md"]',
		);
		expect(link).not.toBeNull();
		fireEvent.click(link!);
		await waitFor(() => {
			expect(useFilePreview.getState().tabs[0]?.path).toBe(
				"/Users/me/omp-workspace/AGENTS.md",
			);
		});
	});

	it("falls back to a home/workspace search for a deeper relative path", async () => {
		const { container } = render(
			<Markdown text={"见 `wiki/rules.md`"} cwd="/repo" />,
		);
		const link = container.querySelector<HTMLAnchorElement>('a[href="wiki/rules.md"]');
		fireEvent.click(link!);
		await waitFor(() => {
			expect(useFilePreview.getState().tabs[0]?.path).toBe(
				"/Users/me/CodingWiki/wiki/rules.md",
			);
		});
	});

	it("resolves a repo-prefixed path through a cwd ancestor", async () => {
		const { container } = render(
			<Markdown
				text={"压缩 `omp-workspace/AGENTS.md`"}
				cwd="/Users/me/projects/omp-workspace/.worktrees/fix"
			/>,
		);
		const link = container.querySelector<HTMLAnchorElement>(
			'a[href="omp-workspace/AGENTS.md"]',
		);
		fireEvent.click(link!);
		await waitFor(() => {
			expect(useFilePreview.getState().tabs[0]?.path).toBe(
				"/Users/me/projects/omp-workspace/AGENTS.md",
			);
		});
	});

	it("does not open a tab for a file that cannot be found", async () => {
		const { container } = render(<Markdown text={"`ghost/missing.md`"} cwd="/repo" />);
		const link = container.querySelector<HTMLAnchorElement>('a[href="ghost/missing.md"]');
		fireEvent.click(link!);
		await new Promise((r) => setTimeout(r, 30));
		expect(useFilePreview.getState().tabs).toEqual([]);
	});

	it("opens a `~/…` code span as a preview tab", async () => {
		const { container } = render(<Markdown text={"`~/.omp/agent/AGENTS.md`"} />);
		const link = container.querySelector<HTMLAnchorElement>(
			'a[href="~/.omp/agent/AGENTS.md"]',
		);
		expect(link).not.toBeNull();
		fireEvent.click(link!);
		await waitFor(() => {
			expect(useFilePreview.getState().tabs[0]?.path).toBe(
				"/Users/me/.omp/agent/AGENTS.md",
			);
		});
	});
});
