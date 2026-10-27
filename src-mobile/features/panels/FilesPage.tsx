import { ChevronRight, File as FileIcon, Folder, Search, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import type { PageProps } from "../../core/nav";
import { CodeBlock, EmptyState, HeaderButton, Markdown, PageHeader, PullToRefresh } from "../../ui";
import { ErrorState, LoadGate, Loading } from "./PanelState";
import { useLayer, useLoad } from "./hooks";
import { breadcrumbs, fenced, fmtSize, langFromPath } from "./pure";

interface DirEntry {
	name: string;
	path: string;
	kind: "dir" | "file";
	size: number;
}
interface DirData {
	path: string;
	parent: string | null;
	roots?: string[];
	entries: DirEntry[];
}
interface FileData {
	path: string;
	size: number;
	binary: boolean;
	truncated: boolean;
	text: string;
}

/** Above this size syntax highlighting is skipped (hljs on 512 KB blocks the main thread). */
const HIGHLIGHT_LIMIT = 150_000;
const q = encodeURIComponent;

export function FilesPage({ route }: PageProps) {
	const id = route.params.id;
	const [dir, setDir] = useState<string | null>(null);
	const [file, setFile] = useState<DirEntry | null>(null);
	const [query, setQuery] = useState("");
	const state = useLoad(
		(signal) => api<DirData>("GET", `/sessions/${q(id)}/files${dir ? `?path=${q(dir)}` : ""}`, undefined, { signal }),
		[id, dir],
	);
	const closeFile = () => setFile(null);
	useLayer(file !== null, closeFile);

	if (file) return <FileViewer sessionId={id} entry={file} onClose={closeFile} />;
	const data = state.data;
	const filteredEntries = useMemo(() => {
		if (!data) return [];
		const qStr = query.trim().toLowerCase();
		if (!qStr) return data.entries;
		return data.entries.filter(
			(e) => e.name.toLowerCase().includes(qStr) || e.path.toLowerCase().includes(qStr),
		);
	}, [data, query]);

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="文件" subtitle={data ? data.path : undefined} />
			{data && (
				<Crumbs
					data={data}
					onOpen={(p) => {
						setDir(p);
						setQuery("");
					}}
				/>
			)}
			<div className="flex items-center gap-2 border-b border-m-border bg-m-surface px-3 py-1.5">
				<Search size={16} className="shrink-0 text-m-text-3" />
				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="搜索文件或目录..."
					className="min-w-0 flex-1 bg-transparent text-m-sm text-m-text outline-none placeholder:text-m-text-3"
				/>
				{query && (
					<button
						type="button"
						aria-label="清空搜索"
						onClick={() => setQuery("")}
						className="p-1 text-m-text-3 active:text-m-text"
					>
						<X size={14} />
					</button>
				)}
			</div>
			<PullToRefresh onRefresh={() => state.reload(true)}>
				<LoadGate state={state}>
					{() =>
						filteredEntries.length === 0 ? (
							<EmptyState title={query ? "没有找到匹配的文件" : "空目录"} />
						) : (
							<ul className="m-0 list-none p-0">
								{filteredEntries.map((e) => (
									<li key={e.path}>
										<button
											type="button"
											onClick={() => {
												if (e.kind === "dir") {
													setDir(e.path);
													setQuery("");
												} else {
													setFile(e);
												}
											}}
											className="flex min-h-12 w-full items-center gap-3 border-b border-m-border px-4 py-2 text-left text-m-text active:bg-m-surface-hover"
										>
											<span className="shrink-0 text-m-text-2">
												{e.kind === "dir" ? <Folder size={20} /> : <FileIcon size={20} />}
											</span>
											<span className="min-w-0 flex-1 break-all text-m-md">{e.name}</span>
											{e.kind === "file" ? (
												<span className="shrink-0 whitespace-nowrap text-m-xs text-m-text-3">{fmtSize(e.size)}</span>
											) : (
												<ChevronRight size={18} className="shrink-0 text-m-text-3" />
											)}
										</button>
									</li>
								))}
							</ul>
						)
					}
				</LoadGate>
			</PullToRefresh>
		</div>
	);
}

function Crumbs({ data, onOpen }: { data: DirData; onOpen: (path: string) => void }) {
	const segs = useMemo(() => breadcrumbs(data.path, data.roots), [data.path, data.roots]);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (el) el.scrollLeft = el.scrollWidth;
	}, [data.path]);
	return (
		<div ref={ref} className="flex shrink-0 items-center overflow-x-auto border-b border-m-border px-2">
			{data.parent && (
				<button
					type="button"
					aria-label="上一级目录"
					onClick={() => onOpen(data.parent as string)}
					className="min-h-11 shrink-0 whitespace-nowrap rounded-m-pill px-3 text-m-sm text-m-accent active:bg-m-surface-hover"
				>
					↑ 上一级
				</button>
			)}
			{segs.map((s, i) => (
				<span key={s.path} className="flex shrink-0 items-center">
					{i > 0 && <ChevronRight size={14} className="text-m-text-3" />}
					<button
						type="button"
						onClick={() => onOpen(s.path)}
						className={`min-h-11 whitespace-nowrap px-2 text-m-sm active:bg-m-surface-hover ${
							i === segs.length - 1 ? "font-semibold text-m-text" : "text-m-text-2"
						}`}
					>
						{s.name}
					</button>
				</span>
			))}
		</div>
	);
}

function FileViewer({ sessionId, entry, onClose }: { sessionId: string; entry: DirEntry; onClose: () => void }) {
	const [wrap, setWrap] = useState(true);
	const [preview, setPreview] = useState(false);
	const state = useLoad(
		(signal) => api<FileData>("GET", `/sessions/${q(sessionId)}/file?path=${q(entry.path)}`, undefined, { signal }),
		[sessionId, entry.path],
	);
	const lang = langFromPath(entry.path);
	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader
				title={entry.name}
				subtitle={fmtSize(entry.size)}
				onBack={onClose}
				right={
					<>
						{lang === "markdown" && (
							<button
								type="button"
								onClick={() => setPreview((v) => !v)}
								className="min-h-11 whitespace-nowrap rounded-m-pill px-3 text-m-sm text-m-accent active:bg-m-surface-hover"
							>
								{preview ? "源码" : "预览"}
							</button>
						)}
						<HeaderButton
							icon={<WrapText size={20} className={wrap ? "text-m-accent" : "text-m-text-3"} />}
							label={wrap ? "关闭自动换行" : "开启自动换行"}
							onClick={() => setWrap((v) => !v)}
						/>
					</>
				}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
				{state.loading && <Loading />}
				{state.error !== null && <ErrorState message={state.error} onRetry={() => void state.reload()} />}
				{state.data && <FileBody file={state.data} lang={lang} wrap={wrap} preview={preview} />}
			</div>
		</div>
	);
}

function FileBody({ file, lang, wrap, preview }: { file: FileData; lang?: string; wrap: boolean; preview: boolean }) {
	if (file.binary) return <EmptyState title="无法预览" hint={`二进制文件（${fmtSize(file.size)}）`} />;
	if (!file.text) return <EmptyState title="空文件" />;
	const wrapCls = wrap ? "[&_pre]:whitespace-pre-wrap [&_pre]:break-words" : "";
	return (
		<>
			{file.truncated && (
				<div className="mb-3 rounded-m-md border border-m-border bg-m-surface px-3 py-2 text-m-sm text-m-text-2">
					文件较大（{fmtSize(file.size)}），仅显示前 512 KB
				</div>
			)}
			{preview && lang === "markdown" ? (
				<Markdown text={file.text} />
			) : file.text.length > HIGHLIGHT_LIMIT ? (
				<CodeBlock code={file.text} lang={lang} wrap={wrap} />
			) : (
				<div className={wrapCls}>
					<Markdown text={fenced(file.text, lang)} />
				</div>
			)}
		</>
	);
}
