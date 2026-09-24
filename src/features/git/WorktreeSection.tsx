import { GitBranch, Trash2 } from "lucide-react";
import { useState } from "react";
import type { WorktreeInfo } from "../../lib/contracts";
import { useSessions } from "../../stores/sessions";
import { basename } from "./helpers";
import { removeWorktreeFlow } from "./removeWorktree";
import { errMsg } from "./ui";

/** Worktrees of the repo with dirty flags, session labels and 清理. */
export function WorktreeSection({
	repo,
	worktrees,
	current,
	onChanged,
}: {
	repo: string;
	worktrees: WorktreeInfo[];
	current: string;
	onChanged: () => void;
}) {
	const sessions = useSessions((s) => s.sessions);
	const [error, setError] = useState<string | null>(null);

	const clean = async (wt: WorktreeInfo) => {
		setError(null);
		try {
			if (await removeWorktreeFlow(repo, wt)) onChanged();
		} catch (e) {
			setError(errMsg(e));
		}
	};

	return (
		<section className="px-3 py-2">
			<div className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-300">
				<GitBranch size={13} /> Worktree
			</div>
			{error && <div className="mb-1 text-[11px] text-rose-400">{error}</div>}
			<ul className="space-y-1">
				{worktrees.map((wt, i) => {
					const main = i === 0;
					const labels = wt.sessionIds.map((id) => sessions[id]?.label ?? id.slice(0, 6));
					return (
						<li key={wt.path} className="group rounded px-1 py-0.5 text-xs hover:bg-neutral-800/60">
							<div className="flex items-center gap-1.5">
								<span className="min-w-0 flex-1 truncate text-neutral-200" title={wt.path}>
									{main ? "主工作区" : basename(wt.path)}
									{wt.path === current && <span className="ml-1 text-[10px] text-indigo-400">当前</span>}
								</span>
								{wt.dirty && <span className="text-[10px] text-amber-400" title="有未提交的改动">● 有改动</span>}
								{!main && (
									<button
										type="button"
										onClick={() => clean(wt)}
										className="flex items-center gap-0.5 text-[11px] text-neutral-500 opacity-0 hover:text-rose-300 group-hover:opacity-100"
									>
										<Trash2 size={11} /> 清理
									</button>
								)}
							</div>
							<div className="truncate text-[10px] text-neutral-500">
								{wt.branch ?? `detached ${wt.head.slice(0, 8)}`}
								{labels.length > 0 && ` · ${labels.join(" ")}`}
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
