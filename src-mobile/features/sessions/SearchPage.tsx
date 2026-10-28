import { ChevronLeft, GitBranch, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths, type PageProps } from "../../core/nav";
import { sessionName } from "../../core/lib/format";
import { Button, Chip, EmptyState, IconButton, PullToRefresh, Spinner } from "../../ui";
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
	const [loading, setLoading] = useState(false);
	const [chooser, setChooser] = useState<{ title: string; items: SheetItem[] } | null>(null);
	const mode = useTree((s) => s.mode);
	const seq = useRef(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const { openActions, node } = useSessionActions();

	useEffect(() => {
		void useTree.getState().load();
		return startTreeSync();
	}, []);

	const search = useCallback(async () => {
		const q = query.trim();
		const my = ++seq.current;
		if (!q) return;
		setLoading(true);
		setError(null);
		try {
			const r = await api<SearchResult>("GET", searchPath(q, mode, archived));
			if (my === seq.current) setResult({ sessions: r.sessions ?? [], branches: r.branches ?? [] });
		} catch (e) {
			if (my === seq.current) setError(errorMessage(e));
		} finally {
			if (my === seq.current) setLoading(false);
		}
	}, [query, mode, archived]);

	useEffect(() => {
		++seq.current;
		setResult(null);
		setError(null);
		setLoading(query.trim().length > 0);
		const t = setTimeout(() => void search(), DEBOUNCE_MS);
		return () => {
			clearTimeout(t);
			++seq.current;
		};
	}, [query, search]);

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

	const hasQuery = query.trim().length > 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-m-bg">
			<header className="shrink-0" style={{ paddingTop: "var(--m-safe-top)" }}>
				<div className="flex h-16 items-center gap-1 pr-4 pl-2">
					<IconButton icon={<ChevronLeft size={24} strokeWidth={1.75} />} label="返回" onClick={() => nav.back()} />
					<label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-m-pill bg-m-surface pr-1 pl-4 focus-within:ring-2 focus-within:ring-m-accent">
						<Search size={20} strokeWidth={1.75} className="shrink-0 text-m-text-3" />
						<input
							ref={inputRef}
							autoFocus
							type="search"
							enterKeyHint="search"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="搜索会话、分支、目录"
							autoComplete="off"
							aria-label="搜索会话、分支、目录"
							className="min-w-0 flex-1 bg-transparent text-m-md text-m-text outline-none placeholder:text-m-text-3 [&::-webkit-search-cancel-button]:hidden"
						/>
						{hasQuery && (
							<IconButton
								size="sm"
								icon={<X size={18} strokeWidth={1.75} className="text-m-text-2" />}
								label="清空"
								onClick={() => {
									setQuery("");
									inputRef.current?.focus();
								}}
							/>
						)}
					</label>
				</div>
				<div className="flex items-center gap-2 px-4 pb-1">
					<ModeSwitch />
					<Chip active={archived} onClick={() => setArchived((v) => !v)}>
						包含已归档
					</Chip>
				</div>
			</header>
			<PullToRefresh onRefresh={() => Promise.all([useTree.getState().load(), search()])} className="pb-[calc(var(--m-safe-bottom)+24px)]">
				{!hasQuery && (
					<EmptyState
						icon={<Search size={26} strokeWidth={1.75} />}
						title="搜索会话"
						hint="按标题、分支、目录或最后的回复查找当前空间里的会话"
					/>
				)}
				{loading && <div role="status" className="flex items-center justify-center gap-2 px-6 py-10 text-m-sm text-m-text-3"><Spinner size={18} />正在搜索</div>}
				{error && <div role="alert" className="flex flex-col items-center gap-4 px-6 py-10 text-center"><p className="m-selectable text-m-sm break-words text-m-danger">搜索失败：{error}</p><Button onClick={() => void search()}>重试</Button></div>}
				{hasQuery && result && !loading && !error && result.branches.length > 0 && (
					<section className="pb-2">
						<h3 className="px-5 pt-4 pb-1.5 text-m-xs font-medium whitespace-nowrap text-m-text-3">分支 · {result.branches.length}</h3>
						{result.branches.map((b) => (
							<div key={`${b.workspaceId ?? ""}|${b.branch}`} className="px-2">
								<button
									type="button"
									onClick={() => openBranch(b)}
									className="flex min-h-12 w-full items-center gap-3 rounded-m-md px-3 py-2.5 text-left active:bg-m-surface-hover"
								>
									<GitBranch size={20} strokeWidth={1.75} className="shrink-0 text-m-text-2" />
									<span className="min-w-0 flex-1 text-m-sm break-all text-m-text">{b.branch}</span>
									<span className="shrink-0 text-m-xs whitespace-nowrap text-m-text-3">{b.count} 个会话</span>
								</button>
							</div>
						))}
					</section>
				)}
				{hasQuery && result && !loading && !error && (
					<>
						<h3 className="px-5 pt-4 pb-0.5 text-m-xs font-medium whitespace-nowrap text-m-text-3">会话 · {result.sessions.length}</h3>
						<TreeView searching filterIds={filterIds} onMore={openActions} />
					</>
				)}
			</PullToRefresh>
			<ActionSheet open={chooser !== null} title={chooser?.title} items={chooser?.items ?? []} onClose={() => setChooser(null)} />
			{node}
		</div>
	);
}
