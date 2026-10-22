/** Pure helpers for the in-app user guide: chapter paths, heading ids,
 * callout detection and link / image resolution. */

export type GuideLang = "zh" | "en";
export const GUIDE_LANGS: readonly GuideLang[] = ["zh", "en"];
export const GUIDE_LANG_STORAGE_KEY = "ompws.guide.lang";

export type CalloutKind = "note" | "tip" | "warning";

/** `…/docs/guide/<lang>/<NN-slug>.md` → lang + chapter slug (`NN-slug`). */
export function parseChapterPath(path: string): { lang: GuideLang; slug: string } | null {
	const m = /\/(zh|en)\/([^/]+)\.md$/.exec(path);
	if (!m) return null;
	return { lang: m[1] as GuideLang, slug: m[2] };
}

/** First `# ` heading outside code fences; falls back to the slug. */
export function extractTitle(markdown: string, fallback: string): string {
	let fenced = false;
	for (const line of markdown.split(/\r?\n/)) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		if (fenced) continue;
		const m = /^#\s+(.+?)\s*#*\s*$/.exec(line);
		if (m) return m[1];
	}
	return fallback;
}

/** GitHub-style heading slug: lowercase, drop punctuation, spaces → `-`. CJK is kept. */
export function slugifyHeading(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
		.replace(/\s/g, "-");
}

/** Slugger that appends `-1`, `-2`… to repeated headings, like GitHub. */
export function createSlugger(): (text: string) => string {
	const seen = new Map<string, number>();
	return (text) => {
		const base = slugifyHeading(text);
		const n = seen.get(base);
		if (n === undefined) {
			seen.set(base, 0);
			return base;
		}
		const next = n + 1;
		seen.set(base, next);
		return `${base}-${next}`;
	};
}

const CALLOUT_RE = /^\[!(NOTE|TIP|WARNING)\][ \t]*\r?\n?/i;

/** Detects a leading `[!NOTE]` / `[!TIP]` / `[!WARNING]` marker in a blockquote's first text. */
export function parseCallout(firstText: string): { kind: CalloutKind; rest: string } | null {
	const m = CALLOUT_RE.exec(firstText);
	if (!m) return null;
	return { kind: m[1].toLowerCase() as CalloutKind, rest: firstText.slice(m[0].length) };
}

export type GuideLink =
	| { kind: "anchor"; anchor: string }
	| { kind: "chapter"; slug: string; anchor: string | null }
	| { kind: "external"; url: string }
	| { kind: "none" };

/** Classify a markdown href: in-page anchor, `./NN-slug.md#x` chapter link, or external URL. */
export function resolveGuideLink(href: string | undefined): GuideLink {
	if (!href) return { kind: "none" };
	if (href.startsWith("#")) return { kind: "anchor", anchor: safeDecode(href.slice(1)) };
	if (/^https?:\/\//i.test(href)) return { kind: "external", url: href };
	const m = /^(?:\.\/|\.\.\/(?:zh|en)\/)?([^/#?]+)\.md(?:#(.*))?$/.exec(href);
	if (m) return { kind: "chapter", slug: m[1], anchor: m[2] ? safeDecode(m[2]) : null };
	return { kind: "none" };
}

function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/** `../images/x.png` → `x.png` (null when the src is not a guide image). */
export function guideImageName(src: string | undefined): string | null {
	if (!src) return null;
	const m = /(?:^|\/)images\/([^/?#]+)$/.exec(src);
	return m ? m[1] : null;
}

// --- mdast transforms (remark plugins) ---

interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	data?: { hProperties?: Record<string, unknown> };
}

function nodeText(node: MdNode): string {
	if (typeof node.value === "string") return node.value;
	return (node.children ?? []).map(nodeText).join("");
}

function walk(node: MdNode, fn: (n: MdNode) => void): void {
	fn(node);
	for (const c of node.children ?? []) walk(c, fn);
}

/** Remark plugin: heading ids (GitHub-style slugs, deduplicated per document). */
export function remarkHeadingIds() {
	return (tree: object) => {
		const slug = createSlugger();
		// Boundary cast: unified hands over an mdast Root, which structurally matches MdNode.
		const root = tree as MdNode;
		walk(root, (n) => {
			if (n.type !== "heading") return;
			n.data = { ...n.data, hProperties: { ...n.data?.hProperties, id: slug(nodeText(n)) } };
		});
	};
}

/** Remark plugin: `> [!NOTE]` blockquotes get `data-callout`; the marker text is stripped. */
export function remarkCallouts() {
	return (tree: object) => {
		const root = tree as MdNode; // same boundary cast as remarkHeadingIds
		walk(root, (n) => {
			if (n.type !== "blockquote") return;
			const para = n.children?.[0];
			const first = para?.type === "paragraph" ? para.children?.[0] : undefined;
			if (!para || !first || first.type !== "text" || first.value === undefined) return;
			const parsed = parseCallout(first.value);
			if (!parsed) return;
			if (parsed.rest) first.value = parsed.rest;
			else para.children = para.children?.slice(1);
			if (!para.children?.length) n.children = n.children?.slice(1);
			n.data = { ...n.data, hProperties: { ...n.data?.hProperties, dataCallout: parsed.kind } };
		});
	};
}

export interface GuideHeading {
	level: number;
	text: string;
	id: string;
}

/** Extracts H2 and H3 headings from markdown outside code fences, with matching slug ids. */
export function extractHeadings(markdown: string): GuideHeading[] {
	const slug = createSlugger();
	const headings: GuideHeading[] = [];
	let fenced = false;
	for (const rawLine of markdown.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (/^(```|~~~)/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;
		const m = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line);
		if (m) {
			const level = m[1].length;
			const text = m[2].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
			headings.push({
				level,
				text,
				id: slug(text),
			});
		}
	}
	return headings;
}

export function estimateReadingStats(markdown: string): { words: number; minutes: number } {
	const clean = markdown
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`]+`/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[#*>\-_|]/g, " ")
		.trim();
	const cjk = (clean.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length;
	const latinWords = (clean.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ").match(/\b\w+\b/g) ?? []).length;
	const totalWords = cjk + latinWords;
	const minutes = Math.max(1, Math.ceil(totalWords / 300));
	return { words: totalWords, minutes };
}

export interface GuideSearchResult {
	slug: string;
	chapterTitle: string;
	matchText: string;
	headingId?: string;
}

export function searchGuideChapters(
	chapters: Array<{ slug: string; title: string; markdown: string }>,
	query: string,
): GuideSearchResult[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const results: GuideSearchResult[] = [];

	for (const chap of chapters) {
		const lines = chap.markdown.split(/\r?\n/);
		let currentHeadingId: string | undefined;
		const slugger = createSlugger();

		for (let i = 0; i < lines.length; i++) {
			const raw = lines[i];
			const trimmed = raw.trim();
			const hMatch = /^(#{1,3})\s+(.+?)\s*#*$/.exec(trimmed);
			if (hMatch) {
				const headingText = hMatch[2].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
				if (hMatch[1].length > 1) {
					currentHeadingId = slugger(headingText);
				} else {
					currentHeadingId = undefined;
				}
			}

			if (trimmed.toLowerCase().includes(q)) {
				const snippet = trimmed
					.replace(/^[#*>\-\d.]+\s+/, "")
					.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
					.replace(/`([^`]+)`/g, "$1")
					.trim();
				if (snippet.length > 0 && !snippet.startsWith("```")) {
					results.push({
						slug: chap.slug,
						chapterTitle: chap.title,
						matchText: snippet,
						headingId: currentHeadingId,
					});
					if (results.length >= 30) return results;
				}
			}
		}
	}
	return results;
}
