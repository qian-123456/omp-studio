import { GitBranch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths, type PageProps } from "../../core/nav";
import { sessionName } from "../../core/lib/format";
import { PageHeader, PullToRefresh } from "../../ui";
import { ActionSheet, useSessionActions, type SheetItem } from "./ActionSheets";
import { ModeSwitch } from "./ModeSwitch";
import { branchChoice, searchPath, type BranchHit, type SearchResult } from "./search";
import { searchIds } from "./tree";
import { TreeView } from "./TreeView";
import { startTreeSync, useTree } from "./treeStore";

const DEBOUNCE_MS = 300;

export function SearchPage(_props: PageProps) {
	const [query, setQuery] = useState("");
	const [archived, setArchived] = useState(false);
	const [result, setResult] = useState<SearchResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [chooser, setChooser] = useState<{ title: string; items: SheetItem[] } | null>(null);
	const mode = useTree((s) => s.mode);
	const seq = useRef(0);
	const { openActions, node } = useSessionActions();

	useEffect(() => {
		void useTree.getState().load();
		return startTreeSync();
	}, []);

	useEffect(() => {
		const q = query.trim();
		const my = ++seq.current;
		if (!q) {
			setResult(null);
			setError(null);
			return;
		}
		const t = setTimeout(() => {
			api<SearchResult>("GET", searchPath(q, mode, archived))
				.then((r) => {
					if (my !== seq.current) return;
					setResult({ sessions: r.sessions ?? [], branches: r.branches ?? [] });
					setError(null);
				})
				.catch((e) => {
					if (my === seq.current) setError(errorMessage(e));
				});
		}, DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [query, mode, archived]);

	const filterIds = useMemo(() => (result ? searchIds(result.sessions) : null), [result]);

	const openBranch = (b: BranchHit) => {
		const c = branchChoice(b);
		if (c.kind === "open") {
			nav.push(paths.chat(c.id));
			return;
		}
		const names = new Map((result?.sessions ?? []).map((s) => [s.id, sessionName(s)]));
		setChooser({
			title: c.title,
			items: c.ids.map((id) => ({ key: id, label: names.get(id) || id, run: () => nav.push(paths.chat(id)) })),
		});
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<PageHeader title="搜索" />
			<div className="flex shrink-0 flex-col gap-2 border-b border-m-border px-3 py-2">
				<input
					autoFocus
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="搜索会话、分支"
					autoComplete="off"
					aria-label="搜索会话、分支"
					className="min-h-11 rounded-m-md border border-m-border bg-m-surface px-3 text-m-md text-m-text outline-none focus:border-m-accent"
				/>
				<div className="flex items-center justify-between gap-2">
					<ModeSwitch />
					<label className="flex min-h-11 items-center gap-2 whitespace-nowrap text-m-sm text-m-text-2">
						<input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-5 accent-[var(--m-accent)]" />
						包含已归档
					</label>
				</div>
			</div>
			<PullToRefresh onRefresh={() => useTree.getState().load()}>
				{error && <div className="select-text break-words p-6 text-center text-m-sm text-m-danger">搜索失败：{error}</div>}
				{result && result.branches.length > 0 && (
					<section>
						<div className="flex min-h-11 items-center gap-2 border-b border-m-border px-4 text-m-sm font-semibold text-m-text">
							分支
							<span className="inline-flex h-6 min-w-6 items-center justify-center rounded-m-pill bg-m-surface px-2 text-m-xs text-m-text-2">
								{result.branches.length}
							</span>
						</div>
						{result.branches.map((b) => (
							<button
								key={`${b.workspaceId ?? ""}|${b.branch}`}
								type="button"
								onClick={() => openBranch(b)}
								className="flex min-h-14 w-full items-center gap-3 border-b border-m-border px-4 py-2 text-left active:bg-m-surface-hover"
							>
								<GitBranch size={18} className="shrink-0 text-m-text-2" />
								<span className="min-w-0 flex-1">
									<span className="block break-all text-m-md text-m-text">{b.branch}</span>
									<span className="block text-m-xs text-m-text-3">{b.count} 个会话</span>
								</span>
							</button>
						))}
					</section>
				)}
				<TreeView searching filterIds={filterIds} onMore={openActions} />
			</PullToRefresh>
			<ActionSheet open={chooser !== null} title={chooser?.title} items={chooser?.items ?? []} onClose={() => setChooser(null)} />
			{node}
		</div>
	);
}
