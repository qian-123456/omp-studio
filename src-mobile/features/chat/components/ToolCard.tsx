import {
	Bot,
	CircleAlert,
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
import type { ToolItem } from "../../../core/types";
import { DiffView, looksLikeDiff, Spinner } from "../../../ui";
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
							<div className="mb-1 text-m-xs text-m-text-3">{tool.status === "error" ? "错误" : "结果"}</div>
							{tool.result && looksLikeDiff(tool.result) ? (
								<DiffView diff={tool.result} />
							) : (
								<Pre text={tool.result || "（无输出）"} err={tool.status === "error"} />
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
});
