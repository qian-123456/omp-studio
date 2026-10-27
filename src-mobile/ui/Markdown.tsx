import { Children, createContext, isValidElement, memo, useContext } from "react";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components, Options } from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { useHighlightPlugins } from "./highlight";
import { openImage } from "./ImageViewer";
import "./markdown.css";

/** Allows http(s), mailto, tel, fragments and relative URLs; rejects javascript:, data:, vbscript: and any other scheme. */
export function safeHref(href?: string): string | null {
	if (!href) return null;
	const trimmed = href.trim();
	if (!trimmed) return null;
	// Browsers ignore whitespace/control characters inside the scheme ("java\tscript:").
	const compact = trimmed.replace(/[\u0000-\u0020\u007f]/g, "");
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
	if (!scheme) return trimmed;
	const name = (scheme[1] ?? "").toLowerCase();
	return name === "http" || name === "https" || name === "mailto" || name === "tel" ? trimmed : null;
}

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,/i;

/** Allows http(s), raster data: images and same-origin `/api/` paths. */
export function safeSrc(src?: string): string | null {
	if (!src) return null;
	const trimmed = src.trim();
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	if (DATA_IMAGE.test(trimmed)) return trimmed;
	if (trimmed.startsWith("/api/")) return trimmed;
	return null;
}

interface HastLike {
	type: string;
	value?: string;
	children?: HastLike[];
}

function hastText(node: HastLike | undefined): string {
	if (!node) return "";
	if (node.type === "text") return node.value ?? "";
	return (node.children ?? []).map(hastText).join("");
}

const OpenImageContext = createContext<((src: string) => void) | undefined>(undefined);

function MdPre({ children, node }: ComponentProps<"pre"> & { node?: HastLike }) {
	const codeEl = Children.toArray(children).find(isValidElement) as
		| { props: { className?: string; children?: ReactNode } }
		| undefined;
	const className = codeEl?.props.className ?? "";
	const lang = /(?:^|\s)language-([^\s]+)/.exec(className)?.[1];
	const code = hastText(node).replace(/\n$/, "");
	return (
		<CodeBlock code={code} lang={lang} className="my-2">
			{codeEl?.props.children}
		</CodeBlock>
	);
}

function MdCode({ children, className }: ComponentProps<"code">) {
	return <code className={className}>{children}</code>;
}

function MdLink({ href, children }: ComponentProps<"a">) {
	const safe = safeHref(href);
	if (!safe) return <span>{children}</span>;
	return (
		<a href={safe} target="_blank" rel="noopener noreferrer">
			{children}
		</a>
	);
}

function MdImage({ src, alt }: ComponentProps<"img">) {
	const open = useContext(OpenImageContext);
	const safe = safeSrc(typeof src === "string" ? src : undefined);
	if (!safe) return alt ? <span>{alt}</span> : null;
	return (
		<img
			src={safe}
			alt={alt ?? ""}
			loading="lazy"
			className="max-w-full cursor-zoom-in rounded-m-md"
			onClick={() => (open ? open(safe) : openImage({ src: safe, alt }))}
		/>
	);
}

function MdTable({ children }: ComponentProps<"table">) {
	return (
		<div className="m-md-table">
			<table>{children}</table>
		</div>
	);
}

const COMPONENTS: Components = { pre: MdPre, code: MdCode, a: MdLink, img: MdImage, table: MdTable };
const REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkGfm, remarkCjkFriendly];
// Identity: URLs are validated by safeHref/safeSrc (the default transform would strip data: images).
const urlTransform: NonNullable<Options["urlTransform"]> = (url) => url;

function MarkdownImpl({
	text,
	className = "",
	streaming = false,
	onOpenImage,
}: {
	text: string;
	className?: string;
	streaming?: boolean;
	onOpenImage?: (src: string) => void;
}) {
	const rehypePlugins = useHighlightPlugins(!streaming);
	return (
		<OpenImageContext.Provider value={onOpenImage}>
			<div className={`m-md ${className}`}>
				<ReactMarkdown
					remarkPlugins={REMARK_PLUGINS}
					rehypePlugins={rehypePlugins}
					components={COMPONENTS}
					urlTransform={urlTransform}
				>
					{text}
				</ReactMarkdown>
			</div>
		</OpenImageContext.Provider>
	);
}

export const Markdown = memo(
	MarkdownImpl,
	(a, b) =>
		a.text === b.text &&
		a.streaming === b.streaming &&
		a.className === b.className &&
		a.onOpenImage === b.onOpenImage,
);
