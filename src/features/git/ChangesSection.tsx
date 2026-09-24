import clsx from "clsx";
import { FileDiff } from "lucide-react";
import type { GitSummary } from "../../lib/contracts";
import { useUi } from "../../stores/ui";
import { isMarkdown, joinPath } from "./helpers";

const STATUS_STYLE: Record<string, string> = {
	M: "text-amber-400",
	A: "text-emerald-400",
	D: "text-rose-400",
	R: "text-sky-400",
	"??": "text-emerald-300",
};

/** 变更: changed files with +/-; md opens in DocView, others open a diff. */
export function ChangesSection({
	summary,
	toplevel,
	onDiff,
}: {
	summary: GitSummary;
	toplevel: string;
	onDiff: (path?: string) => void;
}) {
	const openDoc = useUi((s) => s.openDoc);
	const files = summary.files;
	return (
		<section className="border-b border-neutral-800 px-3 py-2">
			<div className="mb-1 flex items-center text-xs font-medium text-neutral-300">
				<span className="flex-1">
					变更 {files.length > 0 && <span className="text-neutral-500">({files.length})</span>}
				</span>
				{files.length > 0 && (
					<button type="button" onClick={() => onDiff()} className="text-[11px] text-neutral-400 hover:text-neutral-200">
						全部 diff
					</button>
				)}
			</div>
			{files.length === 0 && <div className="py-1 text-xs text-neutral-500">工作区干净，没有未提交的改动</div>}
			<ul className="space-y-px">
				{files.map((f) => {
					const md = isMarkdown(f.path) && f.status !== "D";
					return (
						<li key={f.path} className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-800/60">
							<span className={clsx("w-4 shrink-0 font-mono text-[10px]", STATUS_STYLE[f.status] ?? "text-neutral-400")}>
								{f.status === "??" ? "U" : f.status}
							</span>
							<button
								type="button"
								title={md ? "在文档视图中打开" : "查看 diff"}
								onClick={() => (md ? openDoc(joinPath(toplevel, f.path)) : onDiff(f.path))}
								className="min-w-0 flex-1 truncate text-left text-neutral-300"
							>
								{f.path}
							</button>
							<span className="shrink-0 font-mono text-[10px] text-emerald-500">+{f.added}</span>
							<span className="shrink-0 font-mono text-[10px] text-rose-500">-{f.deleted}</span>
							{md && (
								<button
									type="button"
									title="查看 diff"
									onClick={() => onDiff(f.path)}
									className="shrink-0 text-neutral-500 opacity-0 hover:text-neutral-200 group-hover:opacity-100"
								>
									<FileDiff size={12} />
								</button>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
