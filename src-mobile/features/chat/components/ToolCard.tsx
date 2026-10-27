import { ChevronRight } from "lucide-react";
import { memo, useState } from "react";
import type { ToolItem } from "../../../core/types";
import { DiffView, looksLikeDiff, Spinner } from "../../../ui";
import { argSummary, prettyArgs } from "../lib/turns";

/** Open state survives virtualized remounts of the row. */
const openKeys = new Set<string>();
const RESULT_CAP = 8000;
const ARGS_CAP = 4000;

export type ToolState = "run" | "ok" | "bad" | "none";

/** A persisted call without a result is only "running" while its turn is; otherwise it shows no state. */
export function toolState(t: ToolItem, turnRunning: boolean): ToolState {
	if (t.status === "error") return "bad";
	if (t.status === "running") return turnRunning ? "run" : "none";
	return "ok";
}

function StateBadge({ state }: { state: ToolState }) {
	if (state === "run")
		return (
			<span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-m-pill bg-m-surface-2 px-2 py-0.5 text-m-xs text-m-text-2">
				<Spinner size={12} />
				运行中
			</span>
		);
	if (state === "bad")
		return <span className="shrink-0 whitespace-nowrap rounded-m-pill bg-m-diff-del px-2 py-0.5 text-m-xs text-m-danger">失败</span>;
	if (state === "ok") return <span className="shrink-0 whitespace-nowrap text-m-xs text-m-success">✓</span>;
	return null;
}

function Pre({ text, err }: { text: string; err?: boolean }) {
	const [all, setAll] = useState(false);
	const cut = !all && text.length > RESULT_CAP;
	return (
		<>
			<pre className={`m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-m-sm bg-m-code-bg p-2 font-m-mono text-m-xs ${err ? "text-m-danger" : "text-m-text"}`}>
				{cut ? text.slice(0, RESULT_CAP) : text}
			</pre>
			{cut && (
				<button
					type="button"
					onClick={() => setAll(true)}
					className="mt-1 min-h-9 whitespace-nowrap rounded-m-pill border border-m-border px-3 text-m-xs text-m-text-2 active:bg-m-surface-hover"
				>
					显示全部（{text.length} 字符）
				</button>
			)}
		</>
	);
}

export const ToolCard = memo(function ToolCard({ id, tool, state }: { id: string; tool: ToolItem; state: ToolState }) {
	const [open, setOpen] = useState(openKeys.has(id));
	const toggle = () => {
		setOpen((o) => {
			if (o) openKeys.delete(id);
			else openKeys.add(id);
			return !o;
		});
	};
	const args = prettyArgs(tool.args);
	const hasResult = tool.status !== "running" || tool.result !== "";
	return (
		<div className="my-1.5 rounded-m-md border border-m-border bg-m-surface">
			<button
				type="button"
				onClick={toggle}
				aria-expanded={open}
				className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-m-sm"
			>
				<ChevronRight size={14} className={`shrink-0 text-m-text-3 transition-transform ${open ? "rotate-90" : ""}`} />
				<span className="shrink-0 whitespace-nowrap font-m-mono font-medium">{tool.name}</span>
				<span className="min-w-0 flex-1 truncate text-m-xs text-m-text-3">{argSummary(tool.args)}</span>
				<StateBadge state={state} />
			</button>
			{open && (
				<div className="space-y-1.5 border-t border-m-border px-3 py-2">
					{args && (
						<>
							<div className="text-m-xs text-m-text-3">参数</div>
							<Pre text={args.length > ARGS_CAP ? `${args.slice(0, ARGS_CAP)}\n（参数过长，已截断）` : args} />
						</>
					)}
					{hasResult && (
						<>
							<div className="text-m-xs text-m-text-3">结果</div>
							{tool.result && looksLikeDiff(tool.result) ? (
								<DiffView diff={tool.result} />
							) : (
								<Pre text={tool.result || "（无输出）"} err={tool.status === "error"} />
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
});
