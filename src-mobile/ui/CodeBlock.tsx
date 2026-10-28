import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { copyText } from "../core/lib/format";
import { toast } from "./Toast";

/** 18-radius code surface with a header row (language + copy capsule); code scrolls sideways, never wraps by default. */
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
			setTimeout(() => setCopied(false), 1500);
		} else {
			toast("复制失败", { kind: "error" });
		}
	};
	return (
		<div className={`overflow-hidden rounded-m-md bg-m-code-bg ${className}`}>
			<div className="flex items-center justify-between pr-1 pl-4">
				<span className="whitespace-nowrap font-m-mono text-m-xs text-m-text-3">{lang || "text"}</span>
				<button
					type="button"
					onClick={onCopy}
					aria-label="复制代码"
					className="flex min-h-11 items-center justify-center px-1"
				>
					<span className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-m-pill bg-m-surface px-3 text-m-xs text-m-text-2 active:bg-m-surface-2">
						{copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
						{copied ? "已复制" : "复制"}
					</span>
				</button>
			</div>
			<pre
				className={`m-selectable m-0 overflow-auto px-4 pt-0.5 pb-4 font-m-mono text-[13px] leading-5 text-m-code-text ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
				style={maxHeight !== undefined ? { maxHeight } : undefined}
			>
				<code className="font-m-mono">{children ?? code}</code>
			</pre>
		</div>
	);
}
