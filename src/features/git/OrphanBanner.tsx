import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorktreeInfo } from "../../lib/contracts";
import { gitScanOrphans } from "../../lib/ipc";
import { shortPath } from "./helpers";
import { removeWorktreeFlow } from "./removeWorktree";
import { errMsg, useHomeDir } from "./ui";

// Dismissal lasts for the app run.
let dismissed = false;

/** Dismissible "发现 N 个孤儿 worktree" banner with per-item 回收. */
export function OrphanBanner() {
	const [orphans, setOrphans] = useState<WorktreeInfo[]>([]);
	const [hidden, setHidden] = useState(dismissed);
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const home = useHomeDir();

	useEffect(() => {
		if (dismissed) return;
		gitScanOrphans()
			.then(setOrphans)
			.catch(() => setOrphans([]));
	}, []);

	if (hidden || orphans.length === 0) return null;

	const reclaim = async (wt: WorktreeInfo) => {
		setError(null);
		try {
			if (await removeWorktreeFlow(wt.path, wt)) {
				setOrphans((list) => list.filter((o) => o.path !== wt.path));
			}
		} catch (e) {
			setError(errMsg(e));
		}
	};

	return (
		<div className="m-2 rounded border border-amber-700/60 bg-amber-950/40 p-2 text-xs text-amber-200">
			<div className="flex items-center gap-1.5">
				<AlertTriangle size={13} />
				<button type="button" className="flex-1 text-left" onClick={() => setExpanded(!expanded)}>
					发现 {orphans.length} 个孤儿 worktree（没有会话在使用）{expanded ? "▾" : "▸"}
				</button>
				<button
					type="button"
					title="忽略"
					onClick={() => {
						dismissed = true;
						setHidden(true);
					}}
					className="text-amber-400/70 hover:text-amber-200"
				>
					<X size={13} />
				</button>
			</div>
			{error && <div className="mt-1 text-rose-300">{error}</div>}
			{expanded && (
				<ul className="mt-1.5 space-y-1">
					{orphans.map((o) => (
						<li key={o.path} className="flex items-center gap-1.5">
							<span className="min-w-0 flex-1 truncate" title={o.path}>
								{shortPath(o.path, home)}
								{o.dirty && <span className="ml-1 text-amber-400">● 有改动</span>}
							</span>
							<button
								type="button"
								onClick={() => reclaim(o)}
								className="shrink-0 rounded bg-amber-800/60 px-1.5 py-0.5 text-[11px] hover:bg-amber-700/60"
							>
								回收
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
