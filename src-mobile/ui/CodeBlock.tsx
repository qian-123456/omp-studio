import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { copyText } from "../core/lib/format";
import { toast } from "./Toast";

export function CodeBlock({
	code,
	lang,
	children,
	className = "",
	maxHeight,
	wrap = false,
}: {
	code: string;
	lang?: string;
	children?: ReactNode;
	className?: string;
	maxHeight?: number;
	wrap?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const onCopy = async () => {
		const ok = await copyText(code);
		if (ok) {
			setCopied(true);
			toast("已复制", { kind: "success" });
			setTimeout(() => setCopied(false), 1500);
		} else {
			toast("复制失败", { kind: "error" });
		}
	};
	return (
		<div className={`overflow-hidden rounded-m-md border border-m-border bg-m-code-bg ${className}`}>
			<div className="flex min-h-11 items-center justify-between border-b border-m-border pl-3">
				<span className="whitespace-nowrap font-m-mono text-m-xs text-m-text-3">{lang ?? "text"}</span>
				<button
					type="button"
					onClick={onCopy}
					aria-label="复制代码"
					className="flex min-h-11 min-w-11 items-center justify-center gap-1 whitespace-nowrap px-3 text-m-xs text-m-text-2 active:bg-m-surface-hover"
				>
					{copied ? <Check size={14} /> : <Copy size={14} />}
					{copied ? "已复制" : "复制"}
				</button>
			</div>
			<pre
				className={`m-0 overflow-auto px-3 py-2.5 font-m-mono text-m-sm leading-relaxed text-m-text ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
				style={maxHeight !== undefined ? { maxHeight } : undefined}
			>
				<code className="font-m-mono">{children ?? code}</code>
			</pre>
		</div>
	);
}
