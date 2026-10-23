/**
 * Rehype plugin (runs after sanitize/highlight): turn file paths the agent
 * mentions in an answer into `file-link` elements so they render as clickable
 * links — plain prose paths and inline-code paths alike.
 *
 * - `<a>` children are left alone (already links).
 * - `<code>` spans that are exactly one path are replaced wholesale.
 * - In prose, only absolute/home paths are matched (see lib/fileLinks).
 * - The original text is kept in `data-file-link-text` so nothing is lost when
 *   the path is relative and cannot be resolved.
 */

import {
	canPreviewFile,
	findFilePaths,
	looksLikeFilePath,
	stripMentionPrefix,
} from "../../lib/fileLinks";

/** Tag emitted by `rehypeFilePathLinks`; markdown maps it to a file link. */
export const FILE_LINK_TAG = "file-link";

interface HastNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}

function textOf(node: HastNode): string {
	if (node.type === "text") return node.value ?? "";
	return (node.children ?? []).map(textOf).join("");
}

function isElement(node: HastNode, tag: string): boolean {
	return node.type === "element" && node.tagName === tag;
}

function linkNode(path: string, fromCode = false): HastNode {
	return {
		type: "element",
		tagName: FILE_LINK_TAG,
		properties: fromCode
			? { dataFileLinkText: path, dataFileLinkCode: "true" }
			: { dataFileLinkText: path },
		children: [{ type: "text", value: path }],
	};
}

/** Split one text node into text / file-link nodes. */
function splitText(value: string): HastNode[] {
	// Only paths the right panel can actually preview become links.
	const matches = findFilePaths(value).filter((m) => canPreviewFile(m.path));
	if (matches.length === 0) return [{ type: "text", value }];
	const out: HastNode[] = [];
	let cursor = 0;
	for (const m of matches) {
		if (m.start > cursor) out.push({ type: "text", value: value.slice(cursor, m.start) });
		out.push(linkNode(m.path));
		cursor = m.end;
	}
	if (cursor < value.length) out.push({ type: "text", value: value.slice(cursor) });
	return out;
}

function walk(node: HastNode): void {
	const children = node.children;
	if (!children || children.length === 0) return;
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.type === "text") {
			const parts = splitText(child.value ?? "");
			if (parts.length > 1) {
				children.splice(i, 1, ...parts);
				i += parts.length - 1;
			}
			continue;
		}
		if (child.type !== "element") continue;
		// Links, headings' anchors and our own output are off limits.
		if (isElement(child, "a") || isElement(child, FILE_LINK_TAG)) continue;
		// Fenced blocks are handled by PreBlock; never restructure their code.
		if (isElement(child, "pre")) continue;
		if (isElement(child, "code")) {
			const cls = child.properties?.className;
			const highlighted =
				Array.isArray(cls) && cls.some((c) => String(c).startsWith("language-"));
			if (highlighted) continue;
			const text = textOf(child).trim();
			const path = stripMentionPrefix(text);
			if (
				canPreviewFile(path) &&
				looksLikeFilePath(path, { allowRelative: true, allowBare: true })
			) {
				// Keep a leading `@` (agent mention syntax) outside the link.
				const replacement =
					path === text
						? [linkNode(path, true)]
						: [{ type: "text", value: "@" }, linkNode(path, true)];
				children.splice(i, 1, ...replacement);
				i += replacement.length - 1;
			}
			continue;
		}
		walk(child);
	}
}

export function rehypeFilePathLinks() {
	return (tree: HastNode) => walk(tree);
}
