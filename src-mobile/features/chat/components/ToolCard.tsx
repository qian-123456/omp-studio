import {
	Bot,
	CircleAlert,
	ChevronRight,
	Check,
	FilePen,
	FileText,
	Globe,
	ListChecks,
	Search,
	SquareTerminal,
	Wrench,
	type LucideIcon,
} from "lucide-react";
import { memo, useState } from "react";
import { copyText } from "../../../core/lib/format";
import type { ToolItem } from "../../../core/types";
import { Button, DiffView, looksLikeDiff, Markdown, Spinner, toast } from "../../../ui";
import { prettyArgs, toolLine, type ToolKind } from "../lib/turns";

/** Open state survives remounts of the row. */
const openKeys = new Set<string>();
/** Very long results render in steps; 「显示全部」 always reveals the rest. */
const RESULT_CAP = 8000;

export type ToolState = "run" | "ok" | "bad" | "none";

/** A persisted call without a result is only "running" while its turn is; otherwise it shows no state. */
export function toolState(t: ToolItem, turnRunning: boolean): ToolState {
	if (t.status === "error") return "bad";
	if (t.status === "running") return turnRunning ? "run" : "none";
	return "ok";
}

const KIND_ICON: Record<ToolKind, LucideIcon> = {
	shell: SquareTerminal,
	read: FileText,
	edit: FilePen,
	search: Search,
	web: Globe,
	agent: Bot,
	todo: ListChecks,
	other: Wrench,
};

function StateMark({ state }: { state: ToolState }) {
	if (state === "run") return <Spinner size={14} className="text-m-text-3" />;
	if (state === "bad")
		return (
			<span className="inline-flex items-center gap-1 whitespace-nowrap text-m-xs text-m-danger">
				<CircleAlert size={16} strokeWidth={1.75} aria-hidden />
				失败
			</span>
		);
	if (state === "ok") return <Check size={16} strokeWidth={1.75} aria-label="完成" className="text-m-text-3" />;
	return null;
}

/** Monospace block: wraps (full text, no sideways scrolling for prose output). */
function Pre({ text, err }: { text: string; err?: boolean }) {
	const [all, setAll] = useState(false);
	const cut = !all && text.length > RESULT_CAP;
	return (
		<>
			<pre
				className={`m-selectable m-0 whitespace-pre-wrap break-words font-m-mono text-m-xs leading-5 ${err ? "text-m-danger" : "text-m-text-2"}`}
			>
				{cut ? text.slice(0, RESULT_CAP) : text}
			</pre>
			{cut && (
				<button
					type="button"
					onClick={() => setAll(true)}
					className="mt-2 min-h-11 min-w-11 whitespace-nowrap rounded-m-pill bg-m-surface-2 px-4 text-m-xs text-m-text-2 active:opacity-80"
				>
					显示全部（共 {text.length} 字）
				</button>
			)}
		</>
	);
}

/** Only structured or explicitly identified code uses syntax highlighting; prose stays intact. */
function Result({ text, tool }: { text: string; tool: ToolItem }) {
	let lang = "";
	try {
		const value: unknown = JSON.parse(text);
		if (value !== null && typeof value === "object") lang = "json";
	} catch { /* Non-JSON output remains plain unless the source identifies code. */ }
	const args = tool.args && typeof tool.args === "object" ? tool.args as Record<string, unknown> : {};
	const path = String(args.path ?? args.file_path ?? "");
	const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
	const languages: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", rs: "rust", json: "json", sh: "bash", css: "css", html: "html", yaml: "yaml", yml: "yaml", sql: "sql" };
	if (!lang && /^(read|read_file)$/.test(tool.name) && ext) lang = languages[ext] ?? "";
	if (!lang) return <Pre text={text} err={tool.status === "error"} />;
	const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1)));
	return <Markdown text={`${fence}${lang}\n${text}\n${fence}`} className="m-md-quiet" visualizeEnabled={false} />;
}

/**
 * One tool call inside an expanded 「已运行 N 个步骤」 group: icon, verb + target in a readable line and a quiet
 * status. Tap reveals arguments and result in an 18-radius surface block.
 */
export const ToolCard = memo(function ToolCard({ id, tool, state }: { id: string; tool: ToolItem; state: ToolState }) {
	const [open, setOpen] = useState(openKeys.has(id));
	const toggle = () => {
		setOpen((o) => {
			if (o) openKeys.delete(id);
			else openKeys.add(id);
			return !o;
		});
	};
	const line = toolLine(tool.name, tool.args);
	const Icon = KIND_ICON[line.kind];
	const args = prettyArgs(tool.args);
	const hasResult = tool.status !== "running" || tool.result !== "";
	return (
		<div>
			<button
				type="button"
				onClick={toggle}
				aria-expanded={open}
				className="-mx-2 flex min-h-11 w-[calc(100%+16px)] items-start gap-3 rounded-m-md px-2 py-2.5 text-left active:bg-m-surface-hover"
			>
				<Icon size={18} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-m-text-3" />
				<span className="min-w-0 flex-1 text-m-sm text-m-text-2">
					<span className="font-medium text-m-text">{line.verb}</span>
					{line.target && <span className="break-words [overflow-wrap:anywhere]"> {line.target}</span>}
				</span>
				<span className="mt-0.5 flex shrink-0 items-center">
					<StateMark state={state} />
				</span>
				<ChevronRight size={16} strokeWidth={1.75} aria-hidden className={`mt-0.5 shrink-0 text-m-text-3 transition-transform ${open ? "rotate-90" : ""}`} />
			</button>
			{open && (
				<div className="mt-1 mb-2 space-y-3 rounded-m-md bg-m-surface p-4">
					<div className="whitespace-nowrap font-m-mono text-m-xs text-m-text-3">{tool.name}</div>
					{args && (
						<div>
							<div className="mb-1 text-m-xs text-m-text-3">参数</div>
							<Pre text={args} />
						</div>
					)}
					{hasResult && (
						<div>
							<div className="mb-1 flex items-center justify-between gap-2 text-m-xs text-m-text-3">
								<span>{tool.status === "error" ? "错误" : "结果"}</span>
								<Button size="sm" variant="ghost" onClick={() => void copyText(tool.result).then((ok) => toast(ok ? "已复制" : "复制失败", { kind: ok ? "success" : "error" }))}>复制完整输出</Button>
							</div>
							{tool.result && looksLikeDiff(tool.result) ? (
								<DiffView diff={tool.result} />
							) : (
								<Result text={tool.result || "（无输出）"} tool={tool} />
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
});
