import { Check, Copy } from "lucide-react";
import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { copyText } from "../core/lib/format";
import { toast } from "./Toast";

const PREVIEW_LINES = 24;

/** Preserve highlighted token elements when splitting code into numbered rows. */
function highlightedLines(content: ReactNode): ReactNode[][] {
	const lines: ReactNode[][] = [[]];
	Children.forEach(content, (child, childIndex) => {
		if (typeof child === "string" || typeof child === "number") {
			String(child).split("\n").forEach((part, index) => {
				if (index > 0) lines.push([]);
				lines[lines.length - 1]?.push(part);
			});
		} else if (isValidElement<{ children?: ReactNode }>(child)) {
			highlightedLines(child.props.children).forEach((parts, index) => {
				if (index > 0) lines.push([]);
				lines[lines.length - 1]?.push(cloneElement(child, { key: `${childIndex}-${index}` }, ...parts));
			});
		}
	});
	return lines;
}

/** Code scrolls sideways by default; long blocks expand in place. */
export function CodeBlock({
	code,
	lang,
	children,
	className = "",
	maxHeight,
	wrap = false,
	lineNumbers = false,
	headerActions,
}: {
	code: string;
	lang?: string;
	children?: ReactNode;
	className?: string;
	maxHeight?: number;
	wrap?: boolean;
	lineNumbers?: boolean;
	headerActions?: ReactNode;
}) {
	const [copied, setCopied] = useState(false);
	const [wordWrap, setWordWrap] = useState(wrap);
	const [expanded, setExpanded] = useState(false);
	const copyTimer = useRef<number | undefined>(undefined);
	const preRef = useRef<HTMLPreElement>(null);
	useEffect(() => setWordWrap(wrap), [wrap]);
	useEffect(() => () => window.clearTimeout(copyTimer.current), []);
	const lines = useMemo(() => {
		const result = highlightedLines(children ?? code);
		if (code.endsWith("\n") && result.length === code.split("\n").length && result.length > 1) result.pop();
		return result;
	}, [children, code]);
	const collapsible = lines.length > PREVIEW_LINES;
	const collapsed = collapsible && !expanded;
	const lineGroups = useMemo(() => {
		const shown = collapsed ? lines.slice(0, PREVIEW_LINES) : lines;
		if (shown.length <= 400) return [{ offset: 0, lines: shown }];
		const groups: { offset: number; lines: ReactNode[][] }[] = [];
		for (let offset = 0; offset < shown.length; offset += 100) {
			groups.push({ offset, lines: shown.slice(offset, offset + 100) });
		}
		return groups;
	}, [lines, collapsed]);
	const onCopy = async () => {
		const ok = await copyText(code);
		if (ok) {
			setCopied(true);
			window.clearTimeout(copyTimer.current);
			copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
		} else {
			toast("复制失败", { kind: "error" });
		}
	};
	return (
		<div className={`min-w-0 overflow-hidden rounded-m-md bg-m-code-bg ${className}`}>
			<div className="flex flex-wrap items-center justify-between gap-x-2 px-3">
				<span className="break-all font-m-mono text-m-xs text-m-text-3">{lang || "text"}</span>
				{headerActions}
				<div className="ml-auto flex shrink-0 items-center">
					<button
						type="button"
						aria-pressed={wordWrap}
						onClick={() => setWordWrap((value) => !value)}
						className="flex min-h-11 min-w-11 shrink-0 items-center whitespace-nowrap rounded-m-pill px-2 text-m-xs text-m-text-2 active:bg-m-surface-2"
					>
						自动换行{wordWrap ? "：开" : "：关"}
					</button>
					<button
						type="button"
						onClick={onCopy}
						aria-label="复制代码"
						className="flex min-h-11 min-w-11 shrink-0 items-center justify-center px-1"
					>
						<span className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-m-pill bg-m-surface px-3 text-m-xs text-m-text-2 active:bg-m-surface-2">
							{copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
							{copied ? "已复制" : "复制"}
						</span>
					</button>
				</div>
			</div>
			<pre
				ref={preRef}
				className="m-selectable m-0 overflow-auto px-4 pt-0.5 pb-4 font-m-mono text-[13px] leading-5 text-m-code-text"
				style={{ maxHeight: collapsed ? Math.min(maxHeight ?? Infinity, PREVIEW_LINES * 20 + 18) : maxHeight }}
			>
				<code className={`block min-w-full font-m-mono ${wordWrap ? "w-full" : "w-max"}`}>
					{lineGroups.map((group) => (
						<span
							key={group.offset}
							className="block"
							style={lineGroups.length > 1 ? { contentVisibility: "auto", containIntrinsicSize: `auto ${group.lines.length * 20}px` } : undefined}
						>
							{group.lines.map((parts, index) => (
								<span key={index} className="flex min-h-5">
									{lineNumbers && (
										<span aria-hidden="true" className="mr-3 shrink-0 select-none text-right text-m-text-3" style={{ width: `${String(lines.length).length}ch` }}>
											{group.offset + index + 1}
										</span>
									)}
									<span className={wordWrap ? "min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre"}>
										{parts.length > 0 ? parts : " "}
									</span>
								</span>
							))}
						</span>
					))}
				</code>
			</pre>
			{collapsible && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => {
						setExpanded((value) => !value);
						if (preRef.current) preRef.current.scrollTop = 0;
					}}
					className="flex min-h-11 min-w-11 w-full items-center justify-center whitespace-nowrap px-4 text-m-xs text-m-accent active:bg-m-surface-hover"
				>
					{expanded ? "收起" : `展开全部 ${lines.length} 行`}
				</button>
			)}
		</div>
	);
}
