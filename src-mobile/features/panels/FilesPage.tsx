import { ArrowUp, Code2, Eye, File as FileIcon, Folder, Search, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import type { PageProps } from "../../core/nav";
import { CodeBlock, EmptyState, IconButton, ListGroup, ListRow, Markdown, PageHeader, PullToRefresh } from "../../ui";
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
const ICON = { size: 22, strokeWidth: 1.75 } as const;

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

	const data = state.data;
	const entries = useMemo(() => {
		if (!data) return [];
		const needle = query.trim().toLowerCase();
		if (!needle) return data.entries;
		return data.entries.filter((e) => e.name.toLowerCase().includes(needle) || e.path.toLowerCase().includes(needle));
	}, [data, query]);

	if (file) return <FileViewer sessionId={id} entry={file} onClose={closeFile} />;

	const openDir = (p: string) => {
		setDir(p);
		setQuery("");
	};

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="文件" subtitle="只读浏览" />
			{data && <Crumbs data={data} onOpen={openDir} />}
			<div className="shrink-0 px-4 pt-1 pb-2">
				<label className="flex min-h-11 items-center gap-2 rounded-m-pill bg-m-surface px-4">
					<Search size={18} strokeWidth={1.75} className="shrink-0 text-m-text-3" />
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="在当前目录中查找"
						aria-label="在当前目录中查找"
						className="min-h-11 min-w-0 flex-1 bg-transparent text-m-md text-m-text outline-none placeholder:text-m-text-3 [&::-webkit-search-cancel-button]:hidden"
					/>
					{query && (
						<button
							type="button"
							aria-label="清空"
							onClick={() => setQuery("")}
							className="-mr-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill text-m-text-3 active:bg-m-surface-hover"
						>
							<X size={18} />
						</button>
					)}
				</label>
			</div>
			<PullToRefresh onRefresh={() => state.reload(true)}>
				<LoadGate state={state}>
					{(d) =>
						entries.length === 0 ? (
							<EmptyState
								icon={<Folder {...ICON} />}
								title={query ? "没有找到匹配的文件" : "这个目录是空的"}
							/>
						) : (
							<div className="pt-2" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 24px)" }}>
								<ListGroup>
									{d.parent && !query && (
										<ListRow icon={<ArrowUp {...ICON} />} title="上一级" onClick={() => openDir(d.parent as string)} chevron={false} />
									)}
									{entries.map((e) =>
										e.kind === "dir" ? (
											<ListRow
												key={e.path}
												icon={<Folder {...ICON} />}
												title={<span className="break-all">{e.name}</span>}
												onClick={() => openDir(e.path)}
											/>
										) : (
											<ListRow
												key={e.path}
												icon={<FileIcon {...ICON} />}
												title={<span className="break-all">{e.name}</span>}
												right={fmtSize(e.size)}
												onClick={() => setFile(e)}
												chevron={false}
											/>
										),
									)}
								</ListGroup>
							</div>
						)
					}
				</LoadGate>
			</PullToRefresh>
		</div>
	);
}

/** Horizontally scrollable capsule breadcrumb; scrolled to the deepest segment. */
function Crumbs({ data, onOpen }: { data: DirData; onOpen: (path: string) => void }) {
	const segs = useMemo(() => breadcrumbs(data.path, data.roots), [data.path, data.roots]);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (el) el.scrollLeft = el.scrollWidth;
	}, [data.path]);
	return (
		<nav aria-label="路径" ref={ref} className="m-noscrollbar flex shrink-0 items-center gap-2 overflow-x-auto px-4 py-1">
			{segs.map((s, i) => {
				const last = i === segs.length - 1;
				return (
					<button
						key={s.path}
						type="button"
						aria-current={last ? "location" : undefined}
						onClick={() => !last && onOpen(s.path)}
						className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
					>
						<span
							className={`flex h-9 items-center rounded-m-pill px-4 text-m-sm whitespace-nowrap ${
								last ? "bg-m-accent-soft font-medium text-m-accent-soft-text" : "bg-m-surface text-m-text-2 active:bg-m-surface-2"
							}`}
						>
							{s.name}
						</span>
					</button>
				);
			})}
		</nav>
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
				title="文件预览"
				subtitle={fmtSize(entry.size)}
				onBack={onClose}
				right={
					<>
						{lang === "markdown" && (
							<IconButton
								variant="filled"
								icon={preview ? <Code2 size={20} strokeWidth={1.75} /> : <Eye size={20} strokeWidth={1.75} />}
								label={preview ? "查看源码" : "预览排版"}
								onClick={() => setPreview((v) => !v)}
							/>
						)}
						<IconButton
							variant={wrap ? "tinted" : "filled"}
							pressed={wrap}
							icon={<WrapText size={20} strokeWidth={1.75} />}
							label={wrap ? "关闭自动换行" : "开启自动换行"}
							onClick={() => setWrap((v) => !v)}
						/>
					</>
				}
			/>
			<div
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2"
				style={{ paddingBottom: "calc(var(--m-safe-bottom) + 24px)" }}
			>
				<h1 className="m-selectable mb-2 px-1 text-m-lg font-medium break-all text-m-text">{entry.name}</h1>
				<div className="m-selectable mb-3 px-1 font-m-mono text-m-xs break-all text-m-text-3">{entry.path}</div>
				{state.loading && <Loading />}
				{state.error !== null && <ErrorState message={state.error} onRetry={() => void state.reload()} />}
				{state.data && <FileBody file={state.data} lang={lang} wrap={wrap} preview={preview} />}
			</div>
		</div>
	);
}

function FileBody({ file, lang, wrap, preview }: { file: FileData; lang?: string; wrap: boolean; preview: boolean }) {
	if (file.binary) return <EmptyState icon={<FileIcon {...ICON} />} title="无法预览" hint={`二进制文件（${fmtSize(file.size)}）`} />;
	if (!file.text) return <EmptyState icon={<FileIcon {...ICON} />} title="空文件" />;
	const wrapCls = wrap ? "[&_pre]:whitespace-pre-wrap [&_pre]:break-words" : "";
	return (
		<>
			{file.truncated && (
				<div className="mb-3 rounded-m-md bg-m-warn-bg px-4 py-3 text-m-sm text-m-warn">
					文件较大（{fmtSize(file.size)}），只显示前 512 KB
				</div>
			)}
			{preview && lang === "markdown" ? (
				<div className="m-selectable">
					<Markdown text={file.text} />
				</div>
			) : file.text.length > HIGHLIGHT_LIMIT ? (
				<CodeBlock code={file.text} lang={lang} wrap={wrap} className="m-selectable" />
			) : (
				<div className={`m-selectable ${wrapCls}`}>
					<Markdown text={fenced(file.text, lang)} />
				</div>
			)}
		</>
	);
}
