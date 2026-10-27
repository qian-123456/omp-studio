/** Pure helpers for the files/git panels (no React, no network). */

export function fmtSize(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1048576).toFixed(1)} MB`;
}

export interface Crumb {
	name: string;
	path: string;
}

/**
 * Breadcrumb segments for an absolute directory path. Segments above the deepest root that
 * contains `path` are dropped (the server rejects them anyway); with no matching root every
 * segment is kept.
 */
export function breadcrumbs(path: string, roots: readonly string[] = []): Crumb[] {
	const segs: Crumb[] = [];
	let acc = "";
	for (const name of path.split("/").filter(Boolean)) {
		acc += `/${name}`;
		segs.push({ name, path: acc });
	}
	let root: string | undefined;
	for (const r of roots) {
		if ((path === r || path.startsWith(`${r}/`)) && (!root || r.length > root.length)) root = r;
	}
	return root ? segs.filter((s) => s.path.length >= root.length) : segs;
}

const LANG_BY_EXT: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	mts: "typescript",
	cts: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	json: "json",
	jsonc: "json",
	py: "python",
	rs: "rust",
	go: "go",
	css: "css",
	scss: "css",
	html: "xml",
	htm: "xml",
	xml: "xml",
	svg: "xml",
	vue: "xml",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	yml: "yaml",
	yaml: "yaml",
	sql: "sql",
	md: "markdown",
	markdown: "markdown",
	toml: "ini",
	ini: "ini",
	cfg: "ini",
	diff: "diff",
	patch: "diff",
};

export function langFromPath(path: string): string | undefined {
	const base = path.slice(path.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	if (dot <= 0 && base !== ".gitignore") return undefined;
	return LANG_BY_EXT[base.slice(dot + 1).toLowerCase()];
}

/** Wrap `text` in a Markdown code fence longer than any backtick run inside it. */
export function fenced(text: string, lang?: string): string {
	let longest = 0;
	for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
	const fence = "`".repeat(Math.max(3, longest + 1));
	return `${fence}${lang ?? ""}\n${text}\n${fence}`;
}

export interface GitFile {
	path: string;
	status: string;
	index?: string;
	worktree?: string;
	staged: boolean;
	unstaged: boolean;
}

export interface GitGroups {
	staged: GitFile[];
	unstaged: GitFile[];
	untracked: GitFile[];
}

/** Split porcelain status rows: a file edited after staging appears in both staged and unstaged. */
export function groupGitStatus(files: readonly GitFile[]): GitGroups {
	const out: GitGroups = { staged: [], unstaged: [], untracked: [] };
	for (const f of files) {
		const untracked = f.status === "??";
		if (f.staged) out.staged.push(f);
		if (untracked) out.untracked.push(f);
		else if (f.unstaged) out.unstaged.push(f);
	}
	return out;
}

export function splitPath(path: string): { name: string; dir: string } {
	const i = path.lastIndexOf("/");
	return i < 0 ? { name: path, dir: "" } : { name: path.slice(i + 1), dir: path.slice(0, i) };
}

export function statusTone(status: string): "warn" | "success" | "danger" | "accent" | "neutral" {
	switch (status) {
		case "M":
			return "warn";
		case "A":
			return "success";
		case "D":
			return "danger";
		case "R":
			return "accent";
		default:
			return "neutral";
	}
}
