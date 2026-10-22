// Builds the standalone user guide website: docs/guide/{zh,en}/*.md -> site/guide/index.html
// Markdown is rendered with react-markdown (already a dependency) + remark-gfm + rehype-highlight.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const here = dirname(fileURLToPath(import.meta.url));
const guideDir = process.env.GUIDE_DIR ?? join(here, "..", "..", "docs", "guide");
const LANGS = ["zh", "en"];
const CALLOUT_LABELS = {
	zh: { note: "注意", tip: "提示", warning: "警告" },
	en: { note: "Note", tip: "Tip", warning: "Warning" },
};

function hastText(node) {
	if (node.type === "text") return node.value;
	return (node.children ?? []).map(hastText).join("");
}

// GitHub-style slug (lowercase, strip punctuation, spaces -> hyphens, keep CJK).
function slugify(text) {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "")
		.replace(/ /g, "-");
}

function walk(node, fn) {
	fn(node);
	for (const c of node.children ?? []) walk(c, fn);
}

function rehypeGuide({ lang, slug }) {
	return (tree) => {
		const seen = new Map();
		const route = (anchor) => `#/${lang}/${slug}${anchor ? `/${anchor}` : ""}`;
		const wrapTables = (parent) => {
			if (!parent.children) return;
			parent.children = parent.children.map((c) => {
				wrapTables(c);
				if (c.type === "element" && c.tagName === "table") {
					return { type: "element", tagName: "div", properties: { className: ["table-wrap"] }, children: [c] };
				}
				return c;
			});
		};
		walk(tree, (n) => {
			if (n.type !== "element") return;
			if (/^h[1-6]$/.test(n.tagName)) {
				const base = slugify(hastText(n));
				const count = seen.get(base) ?? 0;
				seen.set(base, count + 1);
				n.properties = { ...n.properties, id: count ? `${base}-${count}` : base };
			}
			if (n.tagName === "a" && typeof n.properties?.href === "string") {
				const href = n.properties.href;
				const cross = href.match(/^\.\/(\d\d-[^/#]+?)\.md(?:#(.*))?$/);
				if (cross) n.properties.href = `#/${lang}/${cross[1]}${cross[2] ? `/${cross[2]}` : ""}`;
				else if (href.startsWith("#") && !href.startsWith("#/")) n.properties.href = route(href.slice(1));
			}
			if (n.tagName === "img" && typeof n.properties?.src === "string") {
				n.properties.src = n.properties.src.replace(/^(\.\.\/)+images\//, "images/");
			}
			if (n.tagName === "blockquote") {
				const p = n.children.find((c) => c.type === "element" && c.tagName === "p");
				const first = p?.children?.[0];
				const m = first?.type === "text" && first.value.match(/^\s*\[!(NOTE|TIP|WARNING)\]\s*/i);
				if (m) {
					const kind = m[1].toLowerCase();
					first.value = first.value.slice(m[0].length);
					n.properties = { ...n.properties, className: ["callout", `callout-${kind}`] };
					n.children.unshift({
						type: "element",
						tagName: "div",
						properties: { className: ["callout-title"] },
						children: [{ type: "text", value: CALLOUT_LABELS[lang][kind] }],
					});
				}
			}
		});
		wrapTables(tree);
	};
}

function render(md, lang, slug) {
	return renderToStaticMarkup(
		createElement(
			Markdown,
			{
				remarkPlugins: [remarkGfm],
				rehypePlugins: [[rehypeHighlight, { detect: false, ignoreMissing: true }], [rehypeGuide, { lang, slug }]],
			},
			md,
		),
	);
}

const data = {};
for (const lang of LANGS) {
	data[lang] = [];
	const dir = join(guideDir, lang);
	if (!existsSync(dir)) continue;
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
		const md = readFileSync(join(dir, file), "utf8");
		const slug = file.replace(/\.md$/, "");
		const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? slug).trim();
		data[lang].push({ slug, title, html: render(md, lang, slug) });
	}
}

const imagesSrc = join(guideDir, "images");
if (existsSync(imagesSrc)) {
	mkdirSync(join(here, "images"), { recursive: true });
	cpSync(imagesSrc, join(here, "images"), { recursive: true });
}

const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const html = readFileSync(join(here, "template.html"), "utf8").replace("/*__DATA__*/null", () => json);
writeFileSync(join(here, "index.html"), html);
console.log(`guide: ${LANGS.map((l) => `${l}=${data[l].length}`).join(" ")} -> site/guide/index.html`);
