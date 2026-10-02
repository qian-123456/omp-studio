/** [B] Shared markdown renderer (GFM + syntax highlight), Codex-quiet styling:
 * code blocks use a 1px --line hairline with a language header and a
 * hover-revealed copy button; tables and rules use hairlines; links use
 * --accent. hljs token colors are scoped per theme in index.css. */

import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import clsx from "clsx";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";

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
	...props
}: React.ComponentPropsWithoutRef<"pre">) {
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

const REMARK_PLUGINS: NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]> = [remarkGfm];
const REHYPE_PLUGINS: NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]> = [[rehypeHighlight, { detect: false }]];
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

const MARKDOWN_COMPONENTS = {
	pre: PreBlock,
	a: MarkdownLink,
	table: TableBlock,
	img: MarkdownImage,
};

export const Markdown = React.memo(function Markdown({ text }: { text: string }) {
	return (
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
			)}
		>
			<ReactMarkdown
				remarkPlugins={REMARK_PLUGINS}
				rehypePlugins={REHYPE_PLUGINS}
				components={MARKDOWN_COMPONENTS}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});
