import { describe, expect, it } from "vitest";
import { getWorkspacePalette, WORKSPACE_PALETTES } from "./SessionSidebar";

describe("getWorkspacePalette", () => {
	it("returns dedicated indigo palette for the global workspace", () => {
		expect(getWorkspacePalette("global").folderColor).toBe(
			"text-indigo-600 dark:text-indigo-400",
		);
	});

	it("returns deterministic palette for any workspace id or name", () => {
		const p1 = getWorkspacePalette("omp-workspace");
		const p2 = getWorkspacePalette("omp-workspace");
		expect(p1).toEqual(p2);

		const pZhifan = getWorkspacePalette("zhifan-ui-shell");
		const pUitest = getWorkspacePalette("ompws-uitest");

		expect(WORKSPACE_PALETTES).toContainEqual(p1);
		expect(WORKSPACE_PALETTES).toContainEqual(pZhifan);
		expect(WORKSPACE_PALETTES).toContainEqual(pUitest);
	});

	it("covers all palette options with valid tailwind color classes", () => {
		for (const palette of WORKSPACE_PALETTES) {
			expect(palette.folderColor).toMatch(/^text-(sky|emerald|amber|purple|rose|teal)-600 dark:text-(sky|emerald|amber|purple|rose|teal)-400$/);
		}
	});
});
