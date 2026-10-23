/**
 * Lazy assets for the markdown renderer: KaTeX (JS + CSS) loads only when a
 * message contains `$$` math, and rarely used highlight.js grammars load only
 * when a fenced block names them. Everything is cached at module level;
 * `pendingMarkdownAssets` returns null when nothing is missing, otherwise a
 * promise the renderer suspends on.
 */
import type { HLJSApi, Language } from "highlight.js";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

type LanguageFn = (hljs: HLJSApi) => Language;

/** Registered grammars; mutated as lazy ones load (read by rehype-highlight on every render). */
export const HIGHLIGHT_LANGUAGES: Record<string, LanguageFn> = {
	bash,
	css,
	diff,
	go,
	ini,
	javascript,
	json,
	markdown,
	plaintext,
	python,
	rust,
	shell,
	sql,
	typescript,
	xml,
	yaml,
};

/** Lazy grammar name → [loader, aliases]; aliases mirror highlight.js's own. */
const LAZY_LANGUAGES: Record<string, [() => Promise<{ default: LanguageFn }>, string[]]> = {
	arduino: [() => import("highlight.js/lib/languages/arduino"), ["ino"]],
	c: [() => import("highlight.js/lib/languages/c"), ["h"]],
	cpp: [() => import("highlight.js/lib/languages/cpp"), ["cc", "c++", "h++", "hpp", "hh", "hxx", "cxx"]],
	csharp: [() => import("highlight.js/lib/languages/csharp"), ["cs", "c#"]],
	graphql: [() => import("highlight.js/lib/languages/graphql"), ["gql"]],
	java: [() => import("highlight.js/lib/languages/java"), ["jsp"]],
	kotlin: [() => import("highlight.js/lib/languages/kotlin"), ["kt", "kts"]],
	less: [() => import("highlight.js/lib/languages/less"), []],
	lua: [() => import("highlight.js/lib/languages/lua"), ["pluto"]],
	makefile: [() => import("highlight.js/lib/languages/makefile"), ["mk", "mak", "make"]],
	objectivec: [() => import("highlight.js/lib/languages/objectivec"), ["mm", "objc", "obj-c", "obj-c++", "objective-c++"]],
	perl: [() => import("highlight.js/lib/languages/perl"), ["pl", "pm"]],
	php: [() => import("highlight.js/lib/languages/php"), []],
	"php-template": [() => import("highlight.js/lib/languages/php-template"), []],
	"python-repl": [() => import("highlight.js/lib/languages/python-repl"), ["pycon"]],
	r: [() => import("highlight.js/lib/languages/r"), []],
	ruby: [() => import("highlight.js/lib/languages/ruby"), ["rb", "gemspec", "podspec", "thor", "irb"]],
	scss: [() => import("highlight.js/lib/languages/scss"), []],
	swift: [() => import("highlight.js/lib/languages/swift"), []],
	vbnet: [() => import("highlight.js/lib/languages/vbnet"), ["vb"]],
	wasm: [() => import("highlight.js/lib/languages/wasm"), []],
};

const LAZY_BY_TOKEN = new Map<string, string>();
for (const [name, [, aliases]] of Object.entries(LAZY_LANGUAGES)) {
	LAZY_BY_TOKEN.set(name, name);
	for (const alias of aliases) LAZY_BY_TOKEN.set(alias, name);
}

const langLoads = new Map<string, Promise<void>>();
function loadLanguage(name: string): Promise<void> | null {
	if (name in HIGHLIGHT_LANGUAGES) return null;
	let p = langLoads.get(name);
	if (!p) {
		p = LAZY_LANGUAGES[name][0]().then(
			(m) => {
				HIGHLIGHT_LANGUAGES[name] = m.default;
			},
			() => {
				// Unloadable grammar: leave the block unhighlighted, as an unknown language was before.
				HIGHLIGHT_LANGUAGES[name] = plaintext;
			},
		);
		langLoads.set(name, p);
	}
	return p;
}

const FENCE_LANG_RE = /(?:^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*|class="language-)([^\s`{"]+)/gm;

// ---- KaTeX -----------------------------------------------------------------

type RehypePlugin = (...args: never[]) => unknown;
let rehypeKatexPlugin: RehypePlugin | null = null;
let katexLoad: Promise<void> | null = null;
/** A failed import must not stay cached as a rejected promise, nor retry in a Suspense loop. */
const KATEX_RETRY_MS = 30_000;
let katexFailedAt = 0;
function loadKatex(): Promise<void> | null {
	if (rehypeKatexPlugin) return null;
	if (!katexLoad && katexFailedAt && Date.now() - katexFailedAt < KATEX_RETRY_MS) return null;
	katexLoad ??= Promise.all([import("rehype-katex"), import("katex/dist/katex.min.css")]).then(
		([m]) => {
			rehypeKatexPlugin = m.default as unknown as RehypePlugin;
			katexFailedAt = 0;
		},
		() => {
			// Formulas render as plain `$$…$$` text until a later retry succeeds.
			katexLoad = null;
			katexFailedAt = Date.now();
		},
	);
	return katexLoad;
}

/** The rehype-katex plugin once loaded, else null. */
export function getRehypeKatex(): RehypePlugin | null {
	return rehypeKatexPlugin;
}

/** Promise for whatever `text` needs and hasn't loaded yet, or null when ready. */
export function pendingMarkdownAssets(text: string): Promise<unknown> | null {
	const pending: Promise<unknown>[] = [];
	if (text.includes("$$")) {
		const k = loadKatex();
		if (k) pending.push(k);
	}
	if (text.includes("`") || text.includes("~") || text.includes("language-")) {
		for (const m of text.matchAll(FENCE_LANG_RE)) {
			const name = LAZY_BY_TOKEN.get(m[1].toLowerCase());
			if (!name) continue;
			const p = loadLanguage(name);
			if (p) pending.push(p);
		}
	}
	return pending.length ? Promise.all(pending) : null;
}
