import { ChevronLeft, GitBranch, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths, type PageProps } from "../../core/nav";
import type { SpaceMode } from "../../core/types";
import { sessionName } from "../../core/lib/format";
import { Button, Chip, EmptyState, IconButton, PullToRefresh, Spinner } from "../../ui";
import { ActionSheet, useSessionActions, type SheetItem } from "./ActionSheets";
import { ModeSwitch } from "./ModeSwitch";
import { branchChoice, searchPath, type BranchHit, type SearchResult } from "./search";
import { SessionRow } from "./SessionRow";
import { startTreeSync, useTree } from "./treeStore";

const DEBOUNCE_MS = 300;

export function SearchPage(_props: PageProps) {
	const [query, setQuery] = useState("");
	const [archived, setArchived] = useState(false);
	const [result, setResult] = useState<(SearchResult & { query: string; mode: SpaceMode; archived: boolean }) | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [chooser, setChooser] = useState<{ title: string; items: SheetItem[] } | null>(null);
	const mode = useTree((s) => s.mode);
	const seq = useRef(0);
	const request = useRef<AbortController | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const { openActions, node } = useSessionActions();

	useEffect(() => {
		void useTree.getState().load();
		return startTreeSync();
	}, []);

	const search = useCallback(async () => {
		const q = query.trim();
		const my = ++seq.current;
		request.current?.abort();
		if (!q) { setResult(null); setLoading(false); return; }
		const controller = new AbortController();
		request.current = controller;
		setLoading(true);
		setError(null);
		try {
			const r = await api<SearchResult>("GET", searchPath(q, mode, archived), undefined, { signal: controller.signal });
			if (my === seq.current && !controller.signal.aborted) setResult({ sessions: r.sessions ?? [], branches: r.branches ?? [], query: q, mode, archived });
		} catch (e) {
			if (my === seq.current && !controller.signal.aborted) setError(errorMessage(e));
		} finally {
			if (my === seq.current && !controller.signal.aborted) setLoading(false);
		}
	}, [query, mode, archived]);

	useEffect(() => {
		++seq.current;
		request.current?.abort();
		setError(null);
		setChooser(null);
		const hasQuery = query.trim().length > 0;
		if (!hasQuery) setResult(null);
		setLoading(hasQuery);
		const timer = hasQuery ? setTimeout(() => void search(), DEBOUNCE_MS) : undefined;
		return () => {
			clearTimeout(timer);
			++seq.current;
			request.current?.abort();
		};
	}, [query, search]);

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
	const visibleResult = hasQuery && result?.mode === mode && result.archived === archived ? result : null;

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
							onChange={(e) => { ++seq.current; request.current?.abort(); setQuery(e.target.value); }}
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
									++seq.current; request.current?.abort();
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
				{hasQuery && loading && <div role="status" className="flex items-center justify-center gap-2 px-6 py-4 text-m-sm text-m-text-3"><Spinner size={18} />{visibleResult ? `正在搜索，保留“${visibleResult.query}”的结果` : "正在搜索"}</div>}
				{hasQuery && error && <div role="alert" className="flex flex-col items-center gap-4 px-6 py-6 text-center"><p className="m-selectable text-m-sm break-words text-m-danger">搜索失败：{error}</p><Button onClick={() => void search()}>重试</Button></div>}
				{visibleResult && visibleResult.branches.length > 0 && (
					<section className="pb-2">
						<h3 className="px-5 pt-4 pb-1.5 text-m-xs font-medium whitespace-nowrap text-m-text-3">分支 · {visibleResult.branches.length}</h3>
						{visibleResult.branches.map((b) => (
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
				{visibleResult && (
					<>
						<h3 className="px-5 pt-4 pb-0.5 text-m-xs font-medium whitespace-nowrap text-m-text-3">会话 · {visibleResult.sessions.length}</h3>
						{visibleResult.sessions.map((session) => <SessionRow key={session.id} s={session} onMore={openActions} highlightQuery={visibleResult.query} />)}
						{!loading && !error && !visibleResult.sessions.length && !visibleResult.branches.length && <EmptyState icon={<Search size={26} />} title="没有匹配的会话" hint="尝试其他关键词，或切换空间与归档范围" />}
					</>
				)}
			</PullToRefresh>
			<ActionSheet open={chooser !== null} title={chooser?.title} items={chooser?.items ?? []} onClose={() => setChooser(null)} />
			{node}
		</div>
	);
}
