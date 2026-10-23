import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { Z_LAYER, Z_LOCAL } from "../components/FloatingLayer";

/**
 * Stacking guard (docs/LAYERS.md): floating UI must use Z_LAYER / FloatingLayer /
 * `z-(--z-*)`, never a raw z-index. Only the page-local Tailwind classes that map
 * to Z_LOCAL (z-0/10/20/30/40) are allowed.
 */
const SRC = join(__dirname, "..");
const LOCAL_ALLOWED = new Set<number>(Object.values(Z_LOCAL));

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...sourceFiles(p));
		else if (/\.(ts|tsx|css)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
	}
	return out;
}

function violations(): string[] {
	const found: string[] = [];
	for (const file of sourceFiles(SRC)) {
		const rel = relative(SRC, file).split(sep).join("/");
		const lines = readFileSync(file, "utf8").split("\n");
		lines.forEach((line, i) => {
			const at = `${rel}:${i + 1}`;
			if (/(?<![\w-])-?z-\[/.test(line)) found.push(`${at} arbitrary z-[..]: ${line.trim()}`);
			for (const m of line.matchAll(/(?<![\w-])-?z-(\d+)(?![\w-])/g)) {
				if (!LOCAL_ALLOWED.has(Number(m[1]))) found.push(`${at} raw z-${m[1]}: ${line.trim()}`);
			}
			if (/\bzIndex\s*:\s*["'`]?-?\d/.test(line)) found.push(`${at} numeric inline zIndex: ${line.trim()}`);
			if (/(?<![\w-])z-index\s*:\s*-?\d/.test(line)) found.push(`${at} numeric css z-index: ${line.trim()}`);
		});
	}
	return found;
}

describe("z-index guard", () => {
	it("has no raw floating z-index anywhere in src", () => {
		expect(violations()).toEqual([]);
	});

	it("keeps index.css --z-* variables in sync with Z_LOCAL / Z_LAYER", () => {
		const css = readFileSync(join(SRC, "index.css"), "utf8");
		const vars = new Map<string, number>();
		for (const m of css.matchAll(/--z-([a-z-]+):\s*(\d+);/g)) vars.set(m[1], Number(m[2]));
		const expected = new Map<string, number>([
			...Object.entries(Z_LOCAL).map(([k, v]) => [`local-${k}`, v] as [string, number]),
			...Object.entries(Z_LAYER),
		]);
		expect(Object.fromEntries(vars)).toEqual(Object.fromEntries(expected));
	});

	it("keeps every local value below the lowest global tier", () => {
		expect(Math.max(...Object.values(Z_LOCAL))).toBeLessThan(Z_LAYER.pill);
	});
});
