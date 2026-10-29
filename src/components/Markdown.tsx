/** [B] Shared markdown renderer (GFM + syntax highlight), Codex-quiet styling:
 * code blocks use a 1px --line hairline with a language header and a
 * hover-revealed copy button; tables and rules use hairlines; links use
 * --accent. hljs token colors are scoped per theme in index.css. */

import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import React, { Suspense, use, useMemo, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as Schema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkMath from "remark-math";
import { MATH_BLOCK_TAG, rehypeMathBlocks } from "../features/chat/rehypeMathBlocks";
import { normalizeMath } from "../features/chat/mathNormalize";
import { HIGHLIGHT_LANGUAGES, getRehypeKatex, pendingMarkdownAssets } from "../features/chat/markdownAssets";
import { CopyButton } from "./CopyButton";
import { errMsg } from "../lib/dialogs";
import { toast } from "../lib/toast";
import { useSessions } from "../stores/sessions";
import { openFileLink } from "../stores/filePreview";
import { useHomeDir } from "../lib/hooks";
import { decodeFilePath, looksLikeFilePath } from "../lib/fileLinks";
import { useSettings } from "../features/settings/store";
import { FILE_LINK_TAG, rehypeFilePathLinks } from "../features/chat/rehypeFilePathLinks";
import { MarkdownSecretChip } from "../features/privacy/SecretChip";
import { SECRET_CHIP_TAG, rehypeSecretChips } from "../features/privacy/render";
import { VisualizeBlock } from "../features/chat/visualize/VisualizeBlock";
import { VisualizeSnapshot } from "../features/chat/visualize/VisualizeSnapshot";
import { findVisualizeFence, isFenceClosed, parseVisualizeInfo } from "../features/chat/visualize/frame";
import { MermaidBlock } from "../features/chat/MermaidBlock";
import { healStreamingMarkdown, splitStableBlocks } from "../features/chat/streamingMarkdown";
import { useRevealText } from "../features/chat/useRevealText";
import { tNow, useT } from "../stores/language";

/** Per-render context for component overrides (kept stable per Markdown). */
interface MarkdownContextValue {
	/** Session used by visualize follow-up messages; absent in side surfaces. */
	sessionId?: string;
	/** Directory relative file links resolve against; defaults to the session cwd. */
	cwd?: string | null;
	/** Raw markdown text, needed to decide whether a trailing fence is closed. */
	sourceText: string;
	visualizeEnabled: boolean;
	/** The segment's text is still being generated (an unclosed fence is expected). */
	streaming: boolean;
	/** Static image export: expanded code, no buttons, visualize placeholder. */
	exportMode: boolean;
}

const MarkdownContext = React.createContext<MarkdownContextValue>({
	sourceText: "",
	visualizeEnabled: true,
	streaming: false,
	exportMode: false,
});

/** Loose hast-shape fields react-markdown passes via the `node` prop. */
interface HastNodeLike {
	tagName?: string;
	position?: { start?: { offset?: number }; end?: { offset?: number } };
	data?: { meta?: unknown };
	properties?: Record<string, unknown>;
	children?: HastNodeLike[];
}

function extractText(node: React.ReactNode): string {
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (!node) return "";
	if (Array.isArray(node)) return node.map(extractText).join("");
	if (
		React.isValidElement<{ children?: React.ReactNode }>(node) &&
		node.props.children
	) {
		return extractText(node.props.children);
	}
	return "";
}

const COLLAPSED_CODE_LINES = 14;

/**
 * Expanded state of long code blocks, keyed by content. A block that moves
 * between streaming segments or whose virtualized row remounts is a fresh
 * component; this lets it come back as the user left it.
 */
const EXPANDED_MEMORY_LIMIT = 500;
const expandedMemory = new Set<string>();

function codeBlockKey(lang: string, text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return `${lang}:${text.length}:${(h >>> 0).toString(36)}`;
}

function rememberExpanded(key: string, expanded: boolean): void {
	if (!expanded) {
		expandedMemory.delete(key);
		return;
	}
	expandedMemory.delete(key);
	expandedMemory.add(key);
	if (expandedMemory.size > EXPANDED_MEMORY_LIMIT) {
		const oldest = expandedMemory.values().next().value;
		if (oldest !== undefined) expandedMemory.delete(oldest);
	}
}

function PreBlock({
	children,
	node,
	...props
}: React.ComponentPropsWithoutRef<"pre"> & { node?: HastNodeLike }) {
	const { t } = useT();
	const codeChild = React.isValidElement<{ className?: string }>(children)
		? children
		: null;
	const className = codeChild?.props.className ?? "";
	const langMatch =
		/language-([\w-]+)/.exec(className) || /hljs\s+([\w-]+)/.exec(className);
	const lang = langMatch ? langMatch[1] : "";

	const codeText = extractText(children).replace(/\n$/, "");
	const memoKey = codeBlockKey(lang, codeText);
	const [expanded, setExpandedState] = useState(() => expandedMemory.has(memoKey));
	const setExpanded = (next: boolean) => {
		rememberExpanded(memoKey, next);
		setExpandedState(next);
	};
	const lines = codeText.split("\n");
	const totalLines = lines.length;
	const isLong = totalLines > COLLAPSED_CODE_LINES;
	const hiddenCount = totalLines - COLLAPSED_CODE_LINES;

	const mdCtx = React.useContext(MarkdownContext);
	// react-markdown only attaches `node` to overridden components, so the
	// fence meta lives on the <pre> node's hast children, not on code's props.
	const codeNode = node?.children?.find(
		(child) => child.tagName === "code",
	);

	// `visualize` / `visualize wide` fences render the fragment in a sandboxed
	// iframe — but only once the fence is closed; a trailing open fence means
	// the model is still writing it.
	const vizInfo = parseVisualizeInfo(
		lang,
		codeNode?.data?.meta ??
			codeNode?.properties?.dataMeta ??
			codeNode?.properties?.["data-meta"],
	);
	// An unclosed fence in a finished message is the model's partial output:
	// show it as a plain code block instead of a forever-spinning placeholder.
	if (
		vizInfo &&
		mdCtx.visualizeEnabled &&
		(mdCtx.streaming || isFenceClosed(mdCtx.sourceText, node?.position ?? null))
	) {
		if (mdCtx.exportMode) {
			return <VisualizeSnapshot html={codeText} mode={vizInfo.mode} />;
		}
		return (
			<VisualizeBlock
				html={codeText}
				mode={vizInfo.mode}
				streaming={!isFenceClosed(mdCtx.sourceText, node?.position ?? null)}
				sessionId={mdCtx.sessionId}
			/>
		);
	}

	// A closed ```mermaid fence renders as a diagram; an open one (still
	// streaming) stays a plain code block until its closing fence arrives.
	if (
		lang === "mermaid" &&
		!mdCtx.exportMode &&
		isFenceClosed(mdCtx.sourceText, node?.position ?? null)
	) {
		return <MermaidBlock source={codeText} />;
	}

	return (
		<div className="group/codeblock my-2 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] font-mono text-[12px]">
			<div className="flex h-7 items-center justify-between border-b border-[var(--line)] px-3 text-[11px] text-[var(--text-40)]">
				<span className="truncate">{lang || "code"}</span>
				{!mdCtx.exportMode && (
				<CopyButton
					text={codeText}
					label={t("common.copy")}
					copiedLabel={t("common.copied")}
					title={t("components.copyCode")}
					resetMs={2000}
					className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[var(--text-40)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/codeblock:opacity-100"
				/>
				)}
			</div>
			<pre
				{...props}
				className={clsx(
					"overflow-x-auto p-3 text-[12px] leading-5 [&_code]:bg-transparent [&_code]:p-0 [&_code]:rounded-none",
					isLong && !expanded && !mdCtx.exportMode && "max-h-[320px] overflow-hidden",
				)}
			>
				{children}
			</pre>
			{isLong && !mdCtx.exportMode && (
				<div className="flex items-center justify-center border-t border-[var(--line)] px-3 py-1">
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[var(--text-30)] transition-colors hover:text-[var(--text-60)]"
						title={
							expanded
								? t("components.collapseCode")
								: t("components.expandCode", { total: totalLines, hidden: hiddenCount })
						}
					>
						{expanded ? (
							<>
								<ChevronUp size={12} />
								<span>{t("components.collapse")}</span>
							</>
						) : (
							<>
								<ChevronDown size={12} />
								<span>{t("components.expandRemaining", { count: hiddenCount })}</span>
							</>
						)}
					</button>
				</div>
			)}
		</div>
	);
}

function useLinkBase(): { cwd: string | null; home: string | null } {
	const ctx = React.useContext(MarkdownContext);
	const sessionCwd = useSessions((s) =>
		ctx.sessionId ? (s.sessions[ctx.sessionId]?.cwd ?? null) : null,
	);
	const home = useHomeDir();
	return { cwd: ctx.cwd ?? sessionCwd, home };
}

/**
 * Resolve an in-page `#fragment` inside the markdown root that holds the link.
 * remark-rehype already prefixes footnote ids with `user-content-` and
 * rehype-sanitize prefixes ids again, so try the doubly-prefixed form too.
 * Scoping to the root keeps repeated footnote ids in other messages out.
 */
function findInPageTarget(from: HTMLElement, fragment: string): HTMLElement | null {
	let target = fragment;
	try {
		target = decodeURIComponent(fragment);
	} catch {
		/* keep the raw fragment */
	}
	const wanted = new Set([target, `user-content-${target}`]);
	const root = from.closest("[data-md-root]") ?? document;
	for (const el of root.querySelectorAll<HTMLElement>("[id]")) {
		if (wanted.has(el.id)) return el;
	}
	return null;
}

function MarkdownLink({
	href,
	children,
	title,
	id,
}: {
	href?: string;
	children?: React.ReactNode;
	title?: string;
	id?: string;
}) {
	const { cwd, home } = useLinkBase();

	const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault();
		e.stopPropagation();
		if (!href) return;
		try {
			if (href.startsWith("#")) {
				findInPageTarget(e.currentTarget, href.slice(1))?.scrollIntoView({
					block: "center",
				});
			} else if (/^file:\/\//i.test(href)) {
				await openFileLink(href, { cwd, home });
			} else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
				await openUrl(href);
			} else if (looksLikeFilePath(href, { allowRelative: true, allowBare: true })) {
				await openFileLink(href, { cwd, home });
			} else {
				// A relative non-file href has nowhere safe to go: never hand an
				// agent-written path to the system opener (it would execute it).
				toast.error(tNow("components.cannotOpenLink", { href }));
			}
		} catch (err) {
			toast.error(tNow("components.openLinkFailed", { error: errMsg(err) }));
		}
	};

	// A stripped href (e.g. `javascript:`) must not look clickable.
	if (!href) return <span id={id}>{children}</span>;

	return (
		<a
			id={id}
			href={href}
			onClick={handleClick}
			title={title || href}
			className="cursor-pointer text-[var(--accent)] underline decoration-[var(--accent)]/50 underline-offset-2 hover:decoration-[var(--accent)]"
		>
			{children}
		</a>
	);
}

/** A file path the agent wrote (inline code or prose): opens the right-panel preview. */
function MarkdownFileLink(props: {
	"data-file-link-text"?: string;
	"data-file-link-code"?: string;
	children?: React.ReactNode;
}) {
	const raw = props["data-file-link-text"] ?? extractText(props.children).trim();
	const fromCode = props["data-file-link-code"] === "true";
	const { cwd, home } = useLinkBase();
	const { t } = useT();
	const handleClick = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		try {
			await openFileLink(raw, { cwd, home });
		} catch (err) {
			toast.error(tNow("components.openFileFailed", { error: errMsg(err) }));
		}
	};
	return (
		<a
			href={raw}
			onClick={handleClick}
			title={t("components.previewOnRight", { raw })}
			className={clsx(
				"cursor-pointer text-[var(--accent)] underline decoration-[var(--accent)]/50 underline-offset-2 hover:decoration-[var(--accent)]",
				fromCode &&
					"rounded bg-[var(--well-bg)] px-1 py-0.5 font-mono text-[length:var(--chat-code-font-size)] no-underline hover:underline",
			)}
		>
			{props.children ?? raw}
		</a>
	);
}

function TableBlock({
	children,
	className,
	node: _node,
	...props
}: React.ComponentPropsWithoutRef<"table"> & { node?: unknown }) {
	return (
		<div className="my-3 w-full overflow-x-auto">
			<table
				className={clsx(
					"w-full border-collapse text-[0.9em] !my-0",
					className,
				)}
				{...props}
			>
				{children}
			</table>
		</div>
	);
}

interface MdastLike {
	type: string;
	value?: string;
	children?: MdastLike[];
}

/** Inline raw `<br>` (common in model-written table cells) would show as literal text; turn it into a hard break. */
function remarkInlineBr() {
	const walk = (node: MdastLike) => {
		if (!node.children) return;
		for (let i = 0; i < node.children.length; i++) {
			const child = node.children[i];
			if (child.type === "html" && /^<br\s*\/?>$/i.test(child.value ?? "")) {
				node.children[i] = { type: "break" };
			} else {
				walk(child);
			}
		}
	};
	return (tree: MdastLike) => walk(tree);
}

// Only `$$…$$` is math: single-dollar math would garble prose like "$5 and $10".
const REMARK_PLUGINS: NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]> = [
	remarkGfm,
	remarkInlineBr,
	// CommonMark flanking rules leave `**“引号”**` next to CJK text unrendered.
	remarkCjkFriendly,
	[remarkMath, { singleDollarTextMath: false }],
];
/** Strict allowlist for model-written inline HTML (details/summary, kbd, sub/sup, mark…).
 * Runs before katex/highlight so only remark-math / fenced-language classes survive. */
const SANITIZE_SCHEMA: Schema = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
	// `file:` links open in the file preview (MarkdownLink); `file:`/`data:`
	// image sources are handled by MarkdownImage. `javascript:` etc. stay blocked.
	protocols: {
		...defaultSchema.protocols,
		href: [...(defaultSchema.protocols?.href ?? []), "file"],
		src: [...(defaultSchema.protocols?.src ?? []), "file", "data"],
	},
	attributes: {
		...defaultSchema.attributes,
		code: [
			...(defaultSchema.attributes?.code ?? []).filter(
				(a) => !(Array.isArray(a) && a[0] === "className"),
			),
			["className", /^language-./, "math-inline", "math-display"],
		],
		details: ["open"],
	},
};

/** react-markdown's default transform drops `file:` hrefs and `data:`/`file:` image sources. */
export function markdownUrlTransform(url: string, key?: string, node?: { tagName?: string }): string {
	if (/^file:\/\//i.test(url) && (key === "href" || key === "src")) return url;
	if (key === "src" && node?.tagName === "img" && /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);/i.test(url)) {
		return url;
	}
	return defaultUrlTransform(url);
}
type RehypePlugins = NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;
const HIGHLIGHT_OPTIONS = { detect: false, languages: HIGHLIGHT_LANGUAGES };
const REHYPE_PLUGINS_BASE: RehypePlugins = [
	rehypeRaw,
	[rehypeSanitize, SANITIZE_SCHEMA],
	rehypeMathBlocks,
	[rehypeHighlight, HIGHLIGHT_OPTIONS],
	rehypeSecretChips,
	rehypeFilePathLinks,
];
/** Same pipeline with KaTeX in front of rehypeMathBlocks (built once, after KaTeX loads). */
let rehypePluginsWithKatex: RehypePlugins | null = null;
function rehypePlugins(): RehypePlugins {
	const katex = getRehypeKatex();
	if (!katex) return REHYPE_PLUGINS_BASE;
	rehypePluginsWithKatex ??= [
		...REHYPE_PLUGINS_BASE.slice(0, 2),
		[katex, { throwOnError: false, strict: false }],
		...REHYPE_PLUGINS_BASE.slice(2),
	] as RehypePlugins;
	return rehypePluginsWithKatex;
}

/** Absolute filesystem path for a local image source (`file://`, `~/`, or cwd-relative). */
function localImagePath(src: string, cwd: string | null, home: string | null): string {
	if (/^file:\/\//i.test(src)) {
		try {
			return decodeURIComponent(new URL(src).pathname);
		} catch {
			return src.replace(/^file:\/\//i, "");
		}
	}
	const path = decodeFilePath(src);
	if (path.startsWith("~/") && home) return `${home.replace(/\/$/, "")}/${path.slice(2)}`;
	if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) || !cwd) return path;
	return `${cwd.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;
}

/**
 * Remote (`http(s)`) images are never fetched on render: an answer could
 * otherwise beacon the reader's IP to any host just by being displayed.
 * They show as a placeholder and only load after an explicit click; local
 * (`file:`, `~/`, cwd-relative, asset-scope) images still render immediately.
 */
function MarkdownImage({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) {
	const { cwd, home } = useLinkBase();
	const { t } = useT();
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const [loadedRemote, setLoadedRemote] = useState<string | null>(null);
	if (typeof src !== "string" || !src) return null;
	const remote = /^https?:\/\//i.test(src);
	const inlineData = /^data:/i.test(src);
	if (remote && loadedRemote !== src) {
		return (
			<button
				type="button"
				onClick={() => setLoadedRemote(src)}
				title={t("components.loadRemoteImage", { src })}
				className="my-1 inline-flex max-w-full items-start gap-1.5 rounded-full border border-[var(--line)] bg-[var(--well-bg)] px-3 py-1 text-left text-[12px] text-[var(--accent)] transition-colors hover:bg-[var(--ghost-hover)]"
			>
				<span className="shrink-0">{t("components.remoteImage")}</span>
				<span className="min-w-0 break-all">{alt || src}</span>
			</button>
		);
	}
	if (failedSrc === src) {
		// Unloadable (outside the asset scope, missing, offline): keep the path reachable.
		const open = async () => {
			try {
				if (inlineData) return;
				if (remote) await openUrl(src);
				else await openFileLink(src, { cwd, home });
			} catch (err) {
				toast.error(tNow("components.openImageFailed", { error: errMsg(err) }));
			}
		};
		return (
			<button
				type="button"
				onClick={open}
				title={inlineData ? alt : src}
				className="my-1 inline-flex max-w-full items-start gap-1.5 rounded-full border border-[var(--line)] bg-[var(--well-bg)] px-3 py-1 text-left text-[12px] text-[var(--accent)] transition-colors hover:bg-[var(--ghost-hover)]"
			>
				<span className="shrink-0">{t("components.image")}</span>
				<span className="min-w-0 break-all">{alt || (inlineData ? t("components.cannotDisplay") : src)}</span>
			</button>
		);
	}
	const resolved = remote || inlineData ? src : convertFileSrc(localImagePath(src, cwd, home));
	return (
		<img
			src={resolved}
			alt={alt ?? ""}
			loading="lazy"
			referrerPolicy={remote ? "no-referrer" : undefined}
			onError={() => setFailedSrc(src)}
			className="my-2 max-h-80 max-w-full rounded-xl border border-[var(--line)] object-contain"
		/>
	);
}

/** Display formula in the same framed card as code blocks; copies the LaTeX source. */
function MathBlock({
	children,
	...props
}: React.ComponentPropsWithoutRef<"div"> & { node?: unknown; "data-tex"?: string }) {
	const tex = props["data-tex"] ?? "";
	const { t } = useT();
	return (
		<div className="group/codeblock my-2 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)]">
			<div className="flex h-7 items-center justify-between border-b border-[var(--line)] px-3 font-mono text-[11px] text-[var(--text-40)]">
				<span className="truncate">LaTeX</span>
				{tex && (
					<CopyButton
						text={tex}
						label={t("common.copy")}
						copiedLabel={t("common.copied")}
						title={t("components.copyLatex")}
						resetMs={2000}
						className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[var(--text-40)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/codeblock:opacity-100"
					/>
				)}
			</div>
			<div data-math-body className="overflow-x-auto p-3 [&_.katex-display]:m-0">{children}</div>
		</div>
	);
}

function MarkdownListItem({
	children,
	node: _node,
	...props
}: React.ComponentPropsWithoutRef<"li"> & { node?: unknown }) {
	return (
		<li {...props}>
			{React.Children.map(children, (child) =>
				typeof child === "string" ? <span>{child}</span> : child,
			)}
		</li>
	);
}

const MARKDOWN_COMPONENTS = {
	pre: PreBlock,
	a: MarkdownLink,
	table: TableBlock,
	li: MarkdownListItem,
	[FILE_LINK_TAG]: MarkdownFileLink,
	img: MarkdownImage,
	[MATH_BLOCK_TAG]: MathBlock,
	[SECRET_CHIP_TAG]: MarkdownSecretChip,
};

/** One parsed run of markdown. Memoized so finished streaming blocks (the
 * `head`) are never re-parsed while only the live tail changes. Renders no
 * wrapper element: its blocks are direct children of the Markdown root. */
const MarkdownSegment = React.memo(function MarkdownSegment({
	text,
	sessionId,
	cwd,
	visualizeEnabled,
	streaming,
	exportMode,
}: {
	text: string;
	sessionId?: string;
	cwd?: string | null;
	visualizeEnabled: boolean;
	streaming: boolean;
	exportMode: boolean;
}) {
	// react-markdown parses the normalized text, so node offsets (used to check
	// whether a trailing fence is closed) index into it, not into the raw text.
	const mathText = useMemo(() => normalizeMath(text), [text]);
	const ctx = useMemo(
		(): MarkdownContextValue => ({
			sessionId,
			cwd,
			sourceText: mathText,
			visualizeEnabled,
			streaming,
			exportMode,
		}),
		[sessionId, cwd, mathText, visualizeEnabled, streaming, exportMode],
	);
	return (
		<MarkdownContext.Provider value={ctx}>
			<Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}>
				<MarkdownBody text={mathText} />
			</Suspense>
		</MarkdownContext.Provider>
	);
});

/** Suspends until KaTeX / extra highlight grammars needed by `text` have loaded. */
function MarkdownBody({ text }: { text: string }) {
	const pending = pendingMarkdownAssets(text);
	if (pending) use(pending);
	return (
		<ReactMarkdown
			remarkPlugins={REMARK_PLUGINS}
			rehypePlugins={rehypePlugins()}
			components={MARKDOWN_COMPONENTS}
			urlTransform={markdownUrlTransform}
		>
			{text}
		</ReactMarkdown>
	);
}

export const Markdown = React.memo(function Markdown({
	text: rawText,
	sessionId,
	cwd,
	streaming = false,
	exportMode = false,
}: {
	text: string;
	/** Session for visualize follow-up sends; optional outside chat views. */
	sessionId?: string;
	/** Base directory for relative file links; defaults to the session cwd. */
	cwd?: string | null;
	/** The text is still being generated: reveal it frame by frame and repair
	 * the unfinished tail so it renders like its finished form. */
	streaming?: boolean;
	/** Static rendering for image export: code fully expanded without buttons,
	 * visualize blocks replaced by a placeholder. */
	exportMode?: boolean;
}) {
	const revealed = useRevealText(rawText, streaming);
	const { head, tail } = useMemo(() => {
		// A visualize block must never move between segments (that would remount
		// its iframe), so everything before the first one is the head and the
		// block plus whatever follows stays in one tree, streaming or not.
		const vizAt = findVisualizeFence(revealed);
		if (vizAt >= 0) {
			const rest = revealed.slice(vizAt);
			return {
				head: revealed.slice(0, vizAt),
				tail: streaming ? healStreamingMarkdown(rest) : rest,
			};
		}
		if (!streaming) return { head: "", tail: revealed };
		const split = splitStableBlocks(revealed);
		return { head: split.head, tail: healStreamingMarkdown(split.tail) };
	}, [streaming, revealed]);
	// Slice B adds Settings.visualizeEnabled; default ON when absent/not loaded.
	const visualizeEnabled = useSettings(
		(s) =>
			s.settings == null ||
			(s.settings as unknown as Record<string, unknown>).visualizeEnabled !==
				false,
	);
	return (
		<div
			data-md-root
			className={clsx(
				"prose-sm max-w-none text-[var(--text)] text-[length:var(--chat-font-size)] [line-height:var(--chat-line-height)]",
				// Long URLs / inline code wrap instead of widening the message column;
				// code blocks and tables keep their own horizontal scroll boxes.
				"min-w-0 [overflow-wrap:anywhere]",
				// `anywhere` would let tables shrink to fit instead of scrolling sideways.
				"[&_table]:[overflow-wrap:normal]",
				"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				// Headings
				"[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-[var(--text)]",
				"[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3.5 [&_h2]:mb-2 [&_h2]:text-[var(--text)]",
				"[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[var(--text)]",
				"[&_h4]:text-sm [&_h4]:font-medium [&_h4]:mt-2.5 [&_h4]:mb-1 [&_h4]:text-[var(--text)]",
				"[&_h5]:text-sm [&_h5]:font-medium [&_h5]:mt-2 [&_h5]:mb-1 [&_h5]:text-[var(--text)]",
				"[&_h6]:text-sm [&_h6]:font-medium [&_h6]:mt-2 [&_h6]:mb-1 [&_h6]:text-[var(--text)]",
				// Paragraphs & text
				"[&_p]:my-2",
				"[&_strong]:font-semibold [&_strong]:text-[var(--text)]",
				// Lists
				"[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2",
				"[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2",
				"[&_li]:my-0.5",
				"[&_li>p]:my-0.5",
				"[&_ul_ul]:my-0.5 [&_ol_ol]:my-0.5 [&_ul_ol]:my-0.5 [&_ol_ul]:my-0.5",
				// Tables (hairlines)
				"[&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_table]:text-[0.9em]",
				"[&_th]:border [&_th]:border-[var(--line)] [&_th]:bg-[var(--ghost-hover)] [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-[var(--text)]",
				"[&_td]:border [&_td]:border-[var(--line)] [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-[var(--text-60)]",
				"[&_tbody_tr:hover]:bg-[var(--ghost-hover)]",
				// Divider & quotes
				"[&_hr]:my-4 [&_hr]:border-[var(--line)]",
				"[&_blockquote]:my-2.5 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--line)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-60)]",
				// Inline code & pre block overrides
				"[&_code]:rounded [&_code]:bg-[var(--well-bg)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[length:var(--chat-code-font-size)] [&_code]:font-mono",
				"[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none",
				// Math: KaTeX never wraps, so a long formula scrolls inside its own block
				// instead of widening the whole message stream.
				"[&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden",
			)}
		>
			{head && (
				<MarkdownSegment
					key="head"
					text={head}
					sessionId={sessionId}
					cwd={cwd}
					visualizeEnabled={visualizeEnabled}
					streaming={false}
					exportMode={exportMode}
				/>
			)}
			<MarkdownSegment
				key="tail"
				text={tail}
				sessionId={sessionId}
				cwd={cwd}
				visualizeEnabled={visualizeEnabled}
				streaming={streaming}
				exportMode={exportMode}
			/>
		</div>
	);
});
