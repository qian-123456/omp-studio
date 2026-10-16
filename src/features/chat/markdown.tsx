/** [B] Shared markdown renderer (GFM + syntax highlight), Codex-quiet styling:
 * code blocks use a 1px --line hairline with a language header and a
 * hover-revealed copy button; tables and rules use hairlines; links use
 * --accent. hljs token colors are scoped per theme in index.css. */

import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import clsx from "clsx";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as Schema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MATH_BLOCK_TAG, rehypeMathBlocks } from "./rehypeMathBlocks";
import { normalizeMath } from "./mathNormalize";
import { copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";
import { useSettings } from "../settings/store";
import { MarkdownSecretChip } from "../privacy/SecretChip";
import { SECRET_CHIP_TAG, rehypeSecretChips } from "../privacy/render";
import { VisualizeBlock } from "./visualize/VisualizeBlock";
import { isFenceClosed, parseVisualizeInfo } from "./visualize/frame";

/** Per-render context for component overrides (kept stable per Markdown). */
interface MarkdownContextValue {
	/** Session used by visualize follow-up messages; absent in side surfaces. */
	sessionId?: string;
	/** Raw markdown text, needed to decide whether a trailing fence is closed. */
	sourceText: string;
	visualizeEnabled: boolean;
}

const MarkdownContext = React.createContext<MarkdownContextValue>({
	sourceText: "",
	visualizeEnabled: true,
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

function PreBlock({
	children,
	node,
	...props
}: React.ComponentPropsWithoutRef<"pre"> & { node?: HastNodeLike }) {
	const [copied, setCopied] = useState(false);
	const [expanded, setExpanded] = useState(false);

	const codeChild = React.isValidElement<{ className?: string }>(children)
		? children
		: null;
	const className = codeChild?.props.className ?? "";
	const langMatch =
		/language-([\w-]+)/.exec(className) || /hljs\s+([\w-]+)/.exec(className);
	const lang = langMatch ? langMatch[1] : "";

	const codeText = extractText(children).replace(/\n$/, "");
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
	if (vizInfo && mdCtx.visualizeEnabled) {
		return (
			<VisualizeBlock
				html={codeText}
				mode={vizInfo.mode}
				streaming={!isFenceClosed(mdCtx.sourceText, node?.position ?? null)}
				sessionId={mdCtx.sessionId}
			/>
		);
	}

	const handleCopy = async () => {
		try {
			await copyText(codeText);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (e) {
			toast.error(`复制失败: ${errMsg(e)}`);
		}
	};

	return (
		<div className="group/codeblock my-2 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] font-mono text-[12px]">
			<div className="flex h-7 items-center justify-between border-b border-[var(--line)] px-3 text-[11px] text-[var(--text-40)]">
				<span className="truncate">{lang || "code"}</span>
				<button
					type="button"
					onClick={handleCopy}
					className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[var(--text-40)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/codeblock:opacity-100"
					title="复制代码"
				>
					{copied ? (
						<Check size={12} className="text-[var(--status-success)]" />
					) : (
						<Copy size={12} />
					)}
					<span>{copied ? "已复制" : "复制"}</span>
				</button>
			</div>
			<pre
				{...props}
				className={clsx(
					"overflow-x-auto p-3 text-[12px] leading-5 [&_code]:bg-transparent [&_code]:p-0 [&_code]:rounded-none",
					isLong && !expanded && "max-h-[320px] overflow-hidden",
				)}
			>
				{children}
			</pre>
			{isLong && (
				<div className="flex items-center justify-center border-t border-[var(--line)] px-3 py-1">
					<button
						type="button"
						onClick={() => setExpanded((v) => !v)}
						className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[var(--text-30)] transition-colors hover:text-[var(--text-60)]"
						title={
							expanded
								? "收起代码"
								: `共 ${totalLines} 行，展开剩余 ${hiddenCount} 行`
						}
					>
						{expanded ? (
							<>
								<ChevronUp size={12} />
								<span>收起</span>
							</>
						) : (
							<>
								<ChevronDown size={12} />
								<span>展开剩余 {hiddenCount} 行</span>
							</>
						)}
					</button>
				</div>
			)}
		</div>
	);
}

function MarkdownLink({
	href,
	children,
	title,
}: {
	href?: string;
	children?: React.ReactNode;
	title?: string;
}) {
	const handleClick = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (!href) return;
		try {
			if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
				await openUrl(href);
			} else {
				if (href.endsWith(".md")) {
					useUi.getState().openDoc(href);
				} else {
					await openPath(href);
				}
			}
		} catch (err) {
			toast.error(`打开链接失败: ${errMsg(err)}`);
		}
	};

	return (
		<a
			href={href}
			onClick={handleClick}
			title={title || href}
			className="cursor-pointer text-[var(--accent)] underline decoration-[var(--accent)]/50 underline-offset-2 hover:decoration-[var(--accent)]"
		>
			{children}
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
const REHYPE_PLUGINS: NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]> = [
	rehypeRaw,
	[rehypeSanitize, SANITIZE_SCHEMA],
	[rehypeKatex, { throwOnError: false, strict: false }],
	rehypeMathBlocks,
	[rehypeHighlight, { detect: false }],
	rehypeSecretChips,
];

function MarkdownImage({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) {
	if (typeof src !== "string" || !src) return null;
	const resolved = /^(?:https?|data|asset):/i.test(src) ? src : convertFileSrc(src);
	return (
		<img
			src={resolved}
			alt={alt ?? ""}
			loading="lazy"
			className="my-2 max-h-80 max-w-full rounded-xl border border-[var(--line)] object-contain"
		/>
	);
}

/** Display formula in the same framed card as code blocks; copies the LaTeX source. */
function MathBlock({
	children,
	...props
}: React.ComponentPropsWithoutRef<"div"> & { node?: unknown; "data-tex"?: string }) {
	const [copied, setCopied] = useState(false);
	const tex = props["data-tex"] ?? "";
	const handleCopy = async () => {
		try {
			await copyText(tex);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (e) {
			toast.error(`复制失败: ${errMsg(e)}`);
		}
	};
	return (
		<div className="group/codeblock my-2 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)]">
			<div className="flex h-7 items-center justify-between border-b border-[var(--line)] px-3 font-mono text-[11px] text-[var(--text-40)]">
				<span className="truncate">LaTeX</span>
				{tex && (
					<button
						type="button"
						onClick={handleCopy}
						className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[var(--text-40)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/codeblock:opacity-100"
						title="复制 LaTeX 源码"
					>
						{copied ? (
							<Check size={12} className="text-[var(--status-success)]" />
						) : (
							<Copy size={12} />
						)}
						<span>{copied ? "已复制" : "复制"}</span>
					</button>
				)}
			</div>
			<div data-math-body className="overflow-x-auto p-3 [&_.katex-display]:m-0">{children}</div>
		</div>
	);
}

const MARKDOWN_COMPONENTS = {
	pre: PreBlock,
	a: MarkdownLink,
	table: TableBlock,
	img: MarkdownImage,
	[MATH_BLOCK_TAG]: MathBlock,
	[SECRET_CHIP_TAG]: MarkdownSecretChip,
};

export const Markdown = React.memo(function Markdown({
	text,
	sessionId,
}: {
	text: string;
	/** Session for visualize follow-up sends; optional outside chat views. */
	sessionId?: string;
}) {
	// Slice B adds Settings.visualizeEnabled; default ON when absent/not loaded.
	const visualizeEnabled = useSettings(
		(s) =>
			s.settings == null ||
			(s.settings as unknown as Record<string, unknown>).visualizeEnabled !==
				false,
	);
	const ctx = useMemo(
		(): MarkdownContextValue => ({
			sessionId,
			sourceText: text,
			visualizeEnabled,
		}),
		[sessionId, text, visualizeEnabled],
	);
	const mathText = useMemo(() => normalizeMath(text), [text]);
	return (
		<MarkdownContext.Provider value={ctx}>
		<div
			className={clsx(
				"prose-sm max-w-none text-[var(--text)] text-[length:var(--chat-font-size)] [line-height:var(--chat-line-height)]",
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
			<ReactMarkdown
				remarkPlugins={REMARK_PLUGINS}
				rehypePlugins={REHYPE_PLUGINS}
				components={MARKDOWN_COMPONENTS}
			>
				{mathText}
			</ReactMarkdown>
		</div>
		</MarkdownContext.Provider>
	);
});
