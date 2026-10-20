/**
 * Pure helpers for turning file paths written in agent answers into openable
 * links. Kept free of Tauri/store imports so the matching rules are testable.
 *
 * Rules (deliberately conservative — a false link is worse than a plain path):
 * - In prose only absolute (`/…`) and home (`~/…`) paths are linked.
 * - In inline code relative paths (`./x`, `src/x.ts`) are linked too.
 * - The last segment must carry a file extension; directories stay plain.
 * - URLs, globs, placeholders and paths with whitespace never match.
 */

import { basename } from "./paths";

/** Extensions we can show in the right-panel preview (UTF-8 text). */
const READABLE_EXTENSIONS: Record<string, true> = {
	md: true,
	markdown: true,
	mdx: true,
	txt: true,
	text: true,
	log: true,
	json: true,
	jsonc: true,
	jsonl: true,
	ndjson: true,
	yaml: true,
	yml: true,
	toml: true,
	ini: true,
	cfg: true,
	conf: true,
	env: true,
	csv: true,
	tsv: true,
	html: true,
	htm: true,
	css: true,
	scss: true,
	less: true,
	js: true,
	jsx: true,
	mjs: true,
	cjs: true,
	ts: true,
	tsx: true,
	vue: true,
	svelte: true,
	astro: true,
	py: true,
	rb: true,
	go: true,
	rs: true,
	java: true,
	kt: true,
	kts: true,
	swift: true,
	c: true,
	h: true,
	cc: true,
	cpp: true,
	hpp: true,
	cs: true,
	php: true,
	sh: true,
	bash: true,
	zsh: true,
	fish: true,
	sql: true,
	xml: true,
	svg: true,
	tex: true,
	bib: true,
	lua: true,
	r: true,
	jl: true,
	ex: true,
	exs: true,
	erl: true,
	hs: true,
	scala: true,
	clj: true,
	dart: true,
	proto: true,
	graphql: true,
	gql: true,
	diff: true,
	patch: true,
	lock: true,
};

/** Image formats the right-panel preview can render directly. */
const IMAGE_EXTENSIONS: Record<string, true> = {
	png: true,
	jpg: true,
	jpeg: true,
	gif: true,
	webp: true,
	bmp: true,
	avif: true,
	ico: true,
	svg: true,
};

/** Extensionless files that are still human-readable. */
const READABLE_NAMES: Record<string, true> = {
	dockerfile: true,
	makefile: true,
	license: true,
	licence: true,
	readme: true,
	changelog: true,
	procfile: true,
	gemfile: true,
	rakefile: true,
};

const EXT_RE = /\.[A-Za-z0-9]{1,12}$/;
const TRAILING_JUNK_RE = /[.,;:!?。，；：！？、)\]}>）】」』”’]+$/;

/** Agents write `@path` (mention syntax); the `@` is not part of the path. */
export function stripMentionPrefix(path: string): string {
	return path.replace(/^@(?=\/|~\/)/, "");
}

/** A trailing `:line` / `:line:col` editor suffix is not part of the path. */
export function stripLineSuffix(path: string): string {
	return path.replace(/:\d+(?::\d+)?$/, "");
}

/** How the right panel should show a file: rendered text, an image, or nowhere. */
export function previewKind(path: string): "text" | "image" | "external" {
	const base = basename(path).toLowerCase();
	const ext = /\.([a-z0-9]+)$/.exec(base);
	if (ext && IMAGE_EXTENSIONS[ext[1]]) return "image";
	if (READABLE_NAMES[base]) return "text";
	if (ext && READABLE_EXTENSIONS[ext[1]]) return "text";
	return "external";
}

/** Whether the right panel can preview this file as UTF-8 text (so it can be edited too). */
export function isPreviewableFile(path: string): boolean {
	return previewKind(path) === "text";
}

/**
 * Whether a whole token (inline code, link href) denotes a file path.
 * `allowRelative` is for code spans, where a literal path is unambiguous.
 */
export function looksLikeFilePath(
	token: string,
	opts: { allowRelative?: boolean; allowBare?: boolean } = {},
): boolean {
	const raw = stripMentionPrefix(token.trim());
	if (!raw || /\s/.test(raw)) return false;
	if (/^(?:https?|mailto|data|javascript|tel):/i.test(raw)) return false;
	// Globs, templates and shell metacharacters are not concrete files.
	if (/[*?{}<>"`'|\\$]/.test(raw)) return false;
	if (raw.includes("\0")) return false;

	let path = stripLineSuffix(raw);
	if (/^file:\/\//i.test(path)) path = path.slice("file://".length);
	const absolute = path.startsWith("/") || path.startsWith("~/");
	const dotRelative = path.startsWith("./") || path.startsWith("../");
	if (!absolute && !dotRelative && !opts.allowRelative) return false;
	if (!path.includes("/")) {
		if (!opts.allowBare) return false;
		const base = basename(path).toLowerCase();
		if (READABLE_NAMES[base]) return true;
		const ext = /\.([a-z0-9]+)$/.exec(base);
		return !!ext && READABLE_EXTENSIONS[ext[1]] === true;
	}

	const segments = path.split("/").filter(Boolean);
	if (segments.length < 2) return false;
	return EXT_RE.test(segments[segments.length - 1]);
}

/**
 * Resolve a link target to an absolute path (`~` expanded when the home dir is
 * known; the backend also accepts a leading `~/`). Returns "" when a relative
 * path has no base directory.
 */
export function resolveFilePath(
	raw: string,
	opts: { cwd?: string | null; home?: string | null } = {},
): string {
	let path = stripMentionPrefix(raw.trim());
	if (/^file:\/\//i.test(path)) {
		path = path.slice("file://".length);
		try {
			path = decodeURIComponent(path);
		} catch {
			/* keep the raw value */
		}
	}
	path = stripLineSuffix(path).replace(/[?#].*$/, "").replace(/\/+$/, "");
	if (!path) return "";
	if (path === "~") return opts.home ?? path;
	if (path.startsWith("~/")) {
		const rest = path.slice(2);
		return opts.home ? `${opts.home.replace(/\/+$/, "")}/${rest}` : path;
	}
	if (path.startsWith("/")) return path;
	if (!opts.cwd) return "";
	const base = opts.cwd.replace(/\/+$/, "");
	const rel = path.replace(/^\.\//, "");
	return `${base}/${rel}`;
}

export interface FilePathMatch {
	start: number;
	end: number;
	path: string;
}

/**
 * Find absolute/home paths embedded in prose. ASCII-only path characters keep
 * CJK punctuation and following prose out of the token; trailing sentence
 * punctuation is trimmed afterwards.
 */
export function findFilePaths(text: string): FilePathMatch[] {
	const out: FilePathMatch[] = [];
	const re = /(?:~\/|\/)[A-Za-z0-9._~\/@%+\-=]+/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const start = match.index;
		const prev = start > 0 ? text[start - 1] : "";
		// Do not cut a path out of a URL or a longer token. `@` is allowed
		// before a path: it is the agent's mention prefix (`@~/x.md`).
		if (prev && /[A-Za-z0-9_.:~\/%+\-=]/.test(prev)) continue;
		const token = match[0].replace(TRAILING_JUNK_RE, "");
		if (!looksLikeFilePath(token)) continue;
		out.push({ start, end: start + token.length, path: token });
	}
	return out;
}
