import {
	Children,
	createContext,
	isValidElement,
	memo,
	useContext,
	useMemo,
	type ComponentProps,
	type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import type { Components, ExtraProps, Options } from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { useHighlightPlugins } from "./highlight";
import { openImage } from "./ImageViewer";
import { MermaidBlock } from "./MermaidBlock";
import {
	findVisualizeFence,
	healStreamingMarkdown,
	isFenceClosed,
	splitStableBlocks,
} from "./streamingMarkdown";
import { parseVisualizeInfo, VisualizeBlock } from "./visualize";
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
	if (/^https?:\/\//i.test(trimmed) || DATA_IMAGE.test(trimmed)) return trimmed;
	if (trimmed.startsWith("/api/")) return trimmed;
	return null;
}

function hastText(node: ExtraProps["node"]): string {
	if (!node) return "";
	let out = "";
	const visit = (n: unknown) => {
		if (n && typeof n === "object") {
			if ("value" in n && typeof n.value === "string") {
				out += n.value;
			}
			if ("children" in n && Array.isArray(n.children)) {
				for (const c of n.children) visit(c);
			}
		}
	};
	visit(node);
	return out;
}

const OpenImageContext = createContext<((src: string) => void) | undefined>(undefined);

interface MarkdownContextValue {
	sourceText: string;
	streaming: boolean;
	sessionId?: string;
	onSendFollowUp?: (prompt: string) => void;
	visualizeEnabled: boolean;
}

const MarkdownContext = createContext<MarkdownContextValue>({
	sourceText: "",
	streaming: false,
	visualizeEnabled: true,
});

function MdPre({ children, node }: ComponentProps<"pre"> & ExtraProps) {
	const mdCtx = useContext(MarkdownContext);
	const codeEl = Children.toArray(children).find(isValidElement) as
		| { props: { className?: string; children?: ReactNode } }
		| undefined;
	const className = codeEl?.props.className ?? "";
	const lang = /(?:^|\s)language-([^\s]+)/.exec(className)?.[1];
	const code = hastText(node).replace(/\n$/, "");

	let meta: unknown;
	if (node?.children) {
		for (const c of node.children) {
			if (c.type === "element" && c.tagName === "code") {
				if ("data" in c && c.data && typeof c.data === "object" && "meta" in c.data) {
					meta = c.data.meta;
				} else if (c.properties) {
					meta = c.properties.dataMeta ?? c.properties["data-meta"];
				}
				break;
			}
		}
	}
	const vizInfo = parseVisualizeInfo(lang, meta);
	if (vizInfo && mdCtx.visualizeEnabled) {
		const closed = isFenceClosed(mdCtx.sourceText, node?.position ?? null);
		if (closed) {
			return (
				<VisualizeBlock
					html={code}
					mode={vizInfo.mode}
					onSendFollowUp={mdCtx.onSendFollowUp}
				/>
			);
		}
		return (
			<CodeBlock code={code} lang={lang} className="my-4">
				{codeEl?.props.children}
			</CodeBlock>
		);
	}

	if (lang === "mermaid") {
		const closed = isFenceClosed(mdCtx.sourceText, node?.position ?? null);
		if (closed) {
			return <MermaidBlock source={code} />;
		}
		return (
			<CodeBlock code={code} lang={lang} className="my-4">
				{codeEl?.props.children}
			</CodeBlock>
		);
	}

	return (
		<CodeBlock code={code} lang={lang} className="my-4">
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
const urlTransform: NonNullable<Options["urlTransform"]> = (url) => url;

const MarkdownSegment = memo(function MarkdownSegment({
	text,
	streaming,
	sessionId,
	onSendFollowUp,
	visualizeEnabled = true,
}: {
	text: string;
	streaming: boolean;
	sessionId?: string;
	onSendFollowUp?: (prompt: string) => void;
	visualizeEnabled?: boolean;
}) {
	const rehypePlugins = useHighlightPlugins(!streaming);
	const ctxValue = useMemo<MarkdownContextValue>(
		() => ({
			sourceText: text,
			streaming,
			sessionId,
			onSendFollowUp,
			visualizeEnabled,
		}),
		[text, streaming, sessionId, onSendFollowUp, visualizeEnabled],
	);

	return (
		<MarkdownContext.Provider value={ctxValue}>
			<ReactMarkdown
				remarkPlugins={REMARK_PLUGINS}
				rehypePlugins={rehypePlugins}
				components={COMPONENTS}
				urlTransform={urlTransform}
			>
				{text}
			</ReactMarkdown>
		</MarkdownContext.Provider>
	);
});

export interface MarkdownProps {
	text: string;
	className?: string;
	streaming?: boolean;
	onOpenImage?: (src: string) => void;
	sessionId?: string;
	onSendFollowUp?: (prompt: string) => void;
	visualizeEnabled?: boolean;
}

function MarkdownImpl({
	text,
	className = "",
	streaming = false,
	onOpenImage,
	sessionId,
	onSendFollowUp,
	visualizeEnabled = true,
}: MarkdownProps) {
	const { head, tail } = useMemo(() => {
		const vizAt = findVisualizeFence(text);
		if (vizAt >= 0) {
			const rest = text.slice(vizAt);
			return {
				head: text.slice(0, vizAt),
				tail: streaming ? healStreamingMarkdown(rest) : rest,
			};
		}
		if (!streaming) return { head: "", tail: text };
		const split = splitStableBlocks(text);
		return { head: split.head, tail: healStreamingMarkdown(split.tail) };
	}, [streaming, text]);

	return (
		<OpenImageContext.Provider value={onOpenImage}>
			<div className={`m-md ${className}`}>
				{head ? (
					<MarkdownSegment
						key="head"
						text={head}
						streaming={false}
						sessionId={sessionId}
						onSendFollowUp={onSendFollowUp}
						visualizeEnabled={visualizeEnabled}
					/>
				) : null}
				<MarkdownSegment
					key="tail"
					text={tail}
					streaming={streaming}
					sessionId={sessionId}
					onSendFollowUp={onSendFollowUp}
					visualizeEnabled={visualizeEnabled}
				/>
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
		a.onOpenImage === b.onOpenImage &&
		a.sessionId === b.sessionId &&
		a.onSendFollowUp === b.onSendFollowUp &&
		a.visualizeEnabled === b.visualizeEnabled,
);
