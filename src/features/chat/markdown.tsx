/** [B] Shared markdown renderer (GFM + syntax highlight). */

import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark.css";
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
	const isLong = totalLines > 30;
	const hiddenCount = totalLines - 10;

	const handleCopy = async () => {
		try {
			await copyText(codeText);
			setCopied(true);
			toast.success("代码已复制");
			setTimeout(() => setCopied(false), 2000);
		} catch (e) {
			toast.error(`复制失败: ${errMsg(e)}`);
		}
	};

	return (
		<div className="group relative my-2 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 font-mono text-[12px]">
			<div className="flex items-center justify-between border-b border-neutral-800/80 bg-neutral-900/60 px-3 py-1 text-[11px] text-neutral-400">
				<div className="flex items-center gap-2">
					<span className="font-semibold uppercase tracking-wider text-neutral-400">
						{lang || "code"}
					</span>
					<span className="text-[10px] text-neutral-500">
						({totalLines} 行)
					</span>
				</div>
				<button
					type="button"
					onClick={handleCopy}
					className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus:opacity-100 transition-colors"
					title="复制代码"
				>
					{copied ? (
						<>
							<Check size={12} className="text-emerald-400" />
							<span className="text-emerald-400">已复制</span>
						</>
					) : (
						<>
							<Copy size={12} />
							<span>复制</span>
						</>
					)}
				</button>
			</div>
			<div className="relative">
				<pre
					{...props}
					className={clsx(
						"overflow-x-auto p-3 text-[12px] leading-relaxed transition-all [&_code]:bg-transparent [&_code]:p-0 [&_code]:rounded-none",
						isLong && !expanded && "max-h-[220px] overflow-hidden select-none",
					)}
				>
					{children}
				</pre>
				{isLong && !expanded && (
					<div className="absolute inset-x-0 bottom-0 flex h-24 items-end justify-center bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-transparent pb-2">
						<button
							type="button"
							onClick={() => setExpanded(true)}
							className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-800/90 px-3 py-1 text-[11px] font-medium text-neutral-200 shadow-md backdrop-blur transition-colors hover:bg-neutral-700 hover:text-white focus:opacity-100"
							title={`共 ${totalLines} 行，展开剩余 ${hiddenCount} 行`}
						>
							<ChevronDown size={12} />
							<span>展开 {hiddenCount} 行</span>
						</button>
					</div>
				)}
			</div>
			{isLong && expanded && (
				<div className="flex items-center justify-end border-t border-neutral-800/60 bg-neutral-900/40 px-3 py-1">
					<button
						type="button"
						onClick={() => setExpanded(false)}
						className="flex items-center gap-1 text-[11px] text-neutral-400 transition-colors hover:text-neutral-200 focus:opacity-100"
					>
						<ChevronUp size={12} />
						<span>收起代码</span>
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
			className="text-indigo-400 underline decoration-indigo-400/50 underline-offset-2 hover:text-indigo-300 hover:decoration-indigo-300 cursor-pointer"
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

export function Markdown({ text }: { text: string }) {
	return (
		<div
			className={clsx(
				"prose-sm max-w-none leading-relaxed text-neutral-200 text-[length:var(--chat-font-size)]",
				"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				// Headings
				"[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-neutral-100",
				"[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3.5 [&_h2]:mb-2 [&_h2]:text-neutral-100",
				"[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-neutral-200",
				"[&_h4]:text-sm [&_h4]:font-medium [&_h4]:mt-2.5 [&_h4]:mb-1 [&_h4]:text-neutral-200",
				"[&_h5]:text-sm [&_h5]:font-medium [&_h5]:mt-2 [&_h5]:mb-1 [&_h5]:text-neutral-200",
				"[&_h6]:text-sm [&_h6]:font-medium [&_h6]:mt-2 [&_h6]:mb-1 [&_h6]:text-neutral-200",
				// Paragraphs & text
				"[&_p]:my-2 [&_p]:leading-relaxed",
				"[&_strong]:font-semibold [&_strong]:text-neutral-100",
				// Lists
				"[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2",
				"[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2",
				"[&_li]:my-0.5",
				"[&_li>p]:my-0.5",
				"[&_ul_ul]:my-0.5 [&_ol_ol]:my-0.5 [&_ul_ol]:my-0.5 [&_ol_ul]:my-0.5",
				// Tables
				"[&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_table]:text-[0.9em]",
				"[&_th]:border [&_th]:border-neutral-700 [&_th]:bg-neutral-800/60 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-neutral-200",
				"[&_td]:border [&_td]:border-neutral-800 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-neutral-300",
				"[&_tbody_tr:hover]:bg-neutral-800/30",
				// Divider & quotes
				"[&_hr]:my-4 [&_hr]:border-neutral-800",
				"[&_blockquote]:my-2.5 [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-700 [&_blockquote]:pl-3 [&_blockquote]:text-neutral-400",
				// Inline code & pre block overrides
				"[&_code]:rounded [&_code]:bg-neutral-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[length:var(--chat-code-font-size)] [&_code]:font-mono",
				"[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none",
			)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
				components={{
					pre: PreBlock,
					a: MarkdownLink,
					table: TableBlock,
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}
