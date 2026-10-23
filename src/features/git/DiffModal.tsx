import clsx from "clsx";
import {
	ChevronRight,
	Columns2,
	MessageSquarePlus,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	Rows,
	Send,
	WrapText,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z_LAYER } from "../../components/FloatingLayer";
import {
	type UnifiedSplitRow,
	buildUnifiedSplitRows,
	renderHighlightedCode,
} from "../../lib/diff";
import { errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { dispatchPrompt } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useUi } from "../../stores/ui";
import {
	type DiffFile,
	type DiffLine,
	describeSelectionSegments,
	groupDiffFiles,
	isFileHeaderMeta,
	parseUnifiedDiff,
} from "./diff";

const isMac =
	typeof navigator !== "undefined" &&
	/Macintosh|Mac OS X|macOS/i.test(navigator.userAgent);

const ROW_STYLE: Record<DiffLine["kind"], string> = {
	add: "bg-emerald-500/15 text-emerald-400",
	del: "bg-rose-500/15 text-rose-400",
	ctx: "text-neutral-300",
	hunk: "bg-[#0A84FF]/10 text-sky-400/80",
	meta: "text-neutral-500",
};

const STATUS_LABEL: Record<DiffFile["status"], string | null> = {
	added: "新增",
	deleted: "删除",
	renamed: "重命名",
	modified: null,
};

const STATUS_STYLE: Record<DiffFile["status"], string> = {
	added: "text-emerald-400 bg-emerald-500/10",
	deleted: "text-rose-400 bg-rose-500/10",
	renamed: "text-sky-400 bg-sky-500/10",
	modified: "",
};

/** Diff rows rendered per increment; large diffs paginate via "show more". */
const RENDER_CHUNK = 2000;
/** Min content width (px) for two readable split columns when the user has no saved choice. */
const SPLIT_MIN_WIDTH = 1100;
const SIDEBAR_WIDTH = 264;

/** Per-file render rows; all indices point into the flat parsed `lines`. */
interface FileRows {
	unified: number[];
	split: UnifiedSplitRow[];
}

function splitPath(path: string): { dir: string; base: string } {
	const i = path.lastIndexOf("/");
	return i < 0 ? { dir: "", base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) };
}

function Counts({ adds, dels }: { adds: number; dels: number }) {
	return (
		<span className="shrink-0 font-mono tabular-nums text-[11px]">
			<span className="text-emerald-400">+{adds}</span>{" "}
			<span className="text-rose-400">−{dels}</span>
		</span>
	);
}

function StatusBadge({ file }: { file: DiffFile }) {
	const label = file.binary ? "二进制" : STATUS_LABEL[file.status];
	if (!label) return null;
	return (
		<span
			className={clsx(
				"shrink-0 rounded px-1 py-px text-[10px] font-sans",
				file.binary ? "text-neutral-400 bg-neutral-500/15" : STATUS_STYLE[file.status],
			)}
		>
			{label}
		</span>
	);
}

/** Line number gutter cell with the hover "+" annotation button. */
function Gutter({
	nos,
	onAdd,
	group,
}: {
	nos: (number | undefined)[];
	onAdd: (() => void) | null;
	group: "row" | "left" | "right";
}) {
	return (
		<div className="relative flex shrink-0 select-none self-stretch">
			{nos.map((n, k) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed gutter columns
					key={k}
					className={clsx(
						"w-12 pr-2 text-right text-neutral-500 tabular-nums",
						group === "row" && "group-hover/row:text-neutral-400",
						group === "left" && "group-hover/left:text-neutral-400",
						group === "right" && "group-hover/right:text-neutral-400",
					)}
				>
					{n ?? ""}
				</span>
			))}
			{onAdd && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onAdd();
					}}
					className={clsx(
						"press-scale absolute left-1 top-0.5 flex h-4 w-4 items-center justify-center rounded-md bg-[#0A84FF] text-white shadow hover:bg-[#0A84FF]/90 opacity-0 transition-opacity focus-within:opacity-100",
						group === "row" && "group-hover/row:opacity-100",
						group === "left" && "group-hover/left:opacity-100",
						group === "right" && "group-hover/right:opacity-100",
					)}
					title="为此行添加批注"
					aria-label="为此行添加批注"
				>
					<Plus size={10} />
				</button>
			)}
		</div>
	);
}

/**
 * Full-screen diff viewer.
 * Per-file sections with sticky headers and a file list sidebar, Unified / Split view,
 * optional soft wrap, keyword syntax highlighting, line number hover "+" annotation button,
 * and multi-segment cross-hunk selection.
 */
export function DiffModal({
	title,
	load,
	onClose,
}: {
	title: string;
	load: () => Promise<string>;
	onClose: () => void;
}) {
	const [text, setText] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sel, setSel] = useState<[number, number] | null>(null);
	const [comment, setComment] = useState("");
	const [note, setNote] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [visibleCount, setVisibleCount] = useState(RENDER_CHUNK);
	const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [activeFile, setActiveFile] = useState(0);
	const [pendingJump, setPendingJump] = useState<number | null>(null);
	const [dialogWidth, setDialogWidth] = useState(0);

	const dialogRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const sectionRefs = useRef<(HTMLElement | null)[]>([]);
	const scrollRaf = useRef(0);

	const sessionId = useUi((s) => s.selectedSessionId);
	const savedViewMode = useUi((s) => s.diffViewMode);
	const setSavedViewMode = useUi((s) => s.setDiffViewMode);
	const wrapPref = useUi((s) => s.diffWrap);
	const setWrap = useUi((s) => s.setDiffWrap);
	const addAnnotation = useComposer((s) => s.addAnnotation);

	useEscapeKey(onClose);
	useEffect(() => {
		let alive = true;
		load()
			.then((t) => {
				if (alive) setText(t);
			})
			.catch((e) => {
				if (alive) setError(errMsg(e));
			});
		return () => {
			alive = false;
		};
	}, [load]);

	useLayoutEffect(() => {
		const el = dialogRef.current;
		if (!el) return;
		setDialogWidth(el.clientWidth);
		const ro = new ResizeObserver(() => setDialogWidth(el.clientWidth));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const lines = useMemo(() => (text ? parseUnifiedDiff(text) : []), [text]);
	const files = useMemo(() => groupDiffFiles(lines), [lines]);
	// Build both views' row lists once per diff so toggling views never re-parses.
	const fileRows = useMemo<FileRows[]>(
		() =>
			files.map((f) => {
				// The preamble (e.g. `git show` commit header) has no per-file header to replace its meta.
				const keep = (l: DiffLine) => f.path === null || !isFileHeaderMeta(l);
				const unified: number[] = [];
				for (let i = f.start; i < f.end; i++) if (keep(lines[i])) unified.push(i);
				const split: UnifiedSplitRow[] = [];
				for (const row of buildUnifiedSplitRows(lines.slice(f.start, f.end))) {
					if (row.type === "header") {
						if (keep(row.line)) split.push({ ...row, origIdx: row.origIdx + f.start });
					} else {
						split.push({
							type: "diff",
							left: row.left && { ...row.left, origIdx: row.left.origIdx + f.start },
							right: row.right && { ...row.right, origIdx: row.right.origIdx + f.start },
						});
					}
				}
				return { unified, split };
			}),
		[files, lines],
	);

	const realFiles = files.filter((f) => f.path !== null);
	const multiFile = realFiles.length > 1;
	const showSidebar = multiFile && sidebarOpen;
	const totals = realFiles.reduce(
		(acc, f) => ({ adds: acc.adds + f.adds, dels: acc.dels + f.dels }),
		{ adds: 0, dels: 0 },
	);
	const contentWidth = dialogWidth - (showSidebar ? SIDEBAR_WIDTH : 0);
	const viewMode: "unified" | "split" =
		savedViewMode ?? (contentWidth >= SPLIT_MIN_WIDTH ? "split" : "unified");
	// Split always soft-wraps: with horizontal scrolling the old column grows to its
	// longest line and pushes the new column off-screen.
	const wrap = wrapPref || viewMode === "split";

	// Re-paginate from the top when a new diff loads or the view switches.
	useEffect(() => {
		setVisibleCount(RENDER_CHUNK);
		setCollapsed(new Set());
	}, [text]);
	useEffect(() => {
		setVisibleCount(RENDER_CHUNK);
	}, [viewMode]);

	const rowsOf = (fi: number) =>
		viewMode === "unified" ? fileRows[fi].unified.length : fileRows[fi].split.length;
	// Row budget per file under incremental rendering; collapsed files consume none.
	const budgets: number[] = [];
	let budgetLeft = visibleCount;
	let totalRows = 0;
	for (let fi = 0; fi < files.length; fi++) {
		const n = collapsed.has(fi) ? 0 : rowsOf(fi);
		totalRows += n;
		budgets.push(Math.min(n, budgetLeft));
		budgetLeft = Math.max(0, budgetLeft - n);
	}
	const remaining = Math.max(0, totalRows - visibleCount);

	const jumpTo = (fi: number) => {
		let before = 0;
		for (let k = 0; k < fi; k++) if (!collapsed.has(k)) before += rowsOf(k);
		if (before >= visibleCount) setVisibleCount(before + RENDER_CHUNK);
		setActiveFile(fi);
		setPendingJump(fi);
	};
	useEffect(() => {
		if (pendingJump === null) return;
		const el = sectionRefs.current[pendingJump];
		const box = scrollRef.current;
		if (el && box) box.scrollTop = el.offsetTop;
		setPendingJump(null);
	}, [pendingJump]);

	const onScroll = () => {
		cancelAnimationFrame(scrollRaf.current);
		scrollRaf.current = requestAnimationFrame(() => {
			const box = scrollRef.current;
			if (!box) return;
			const y = box.scrollTop + 8;
			let current = 0;
			sectionRefs.current.forEach((el, fi) => {
				if (el && el.offsetTop <= y) current = fi;
			});
			setActiveFile(current);
		});
	};
	useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);

	const toggleCollapsed = (fi: number) =>
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(fi)) next.delete(fi);
			else next.add(fi);
			return next;
		});

	const inSel = (i: number) =>
		sel !== null && i >= Math.min(...sel) && i <= Math.max(...sel);

	const onLineClick = (i: number, shift: boolean) => {
		// Ignore clicks when the user is dragging to select text for copying
		const selection = window.getSelection()?.toString();
		if (selection && selection.length > 0) return;

		const l = lines[i];
		if (!l || l.kind === "meta" || l.kind === "hunk") return;
		setSel(shift && sel ? [sel[0], i] : [i, i]);
	};

	const codeClass = wrap
		? "whitespace-pre-wrap [overflow-wrap:anywhere]"
		: "whitespace-pre";

	const renderSeparator = (l: DiffLine, key: string, span: boolean) => (
		<div
			key={key}
			className={clsx(
				"select-text px-3 font-mono text-[11px]",
				span && "col-span-2",
				codeClass,
				ROW_STYLE[l.kind],
			)}
		>
			{l.text}
		</div>
	);

	const renderUnified = (fi: number): ReactNode =>
		fileRows[fi].unified.slice(0, budgets[fi]).map((i) => {
			const l = lines[i];
			if (l.kind === "meta" || l.kind === "hunk") return renderSeparator(l, `u-${i}`, false);
			return (
				<div
					key={`u-${i}`}
					onClick={(e) => onLineClick(i, e.shiftKey)}
					className={clsx(
						"group/row flex cursor-default select-text transition-colors",
						ROW_STYLE[l.kind],
						inSel(i) && "outline outline-1 -outline-offset-1 outline-[#0A84FF]/80",
					)}
				>
					<Gutter nos={[l.oldNo, l.newNo]} onAdd={() => setSel([i, i])} group="row" />
					<span className="select-none pr-1 text-neutral-600 shrink-0">
						{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
					</span>
					<span className={clsx("select-text min-w-0 flex-1 pr-3", codeClass)}>
						{renderHighlightedCode(l.text, l.kind)}
					</span>
				</div>
			);
		});

	const renderCell = (
		cell: Extract<UnifiedSplitRow, { type: "diff" }>["left"],
		side: "left" | "right",
		key: string,
	) => {
		const changed = side === "left" ? "del" : "add";
		if (!cell)
			return <div key={key} className="bg-neutral-950/40 select-none" />;
		return (
			<div
				key={key}
				onClick={(e) => onLineClick(cell.origIdx, e.shiftKey)}
				className={clsx(
					"flex min-w-0 cursor-default select-text transition-colors",
					side === "left" ? "group/left" : "group/right hairline-l",
					cell.kind === changed
						? side === "left"
							? "bg-[rgba(255,69,58,0.12)] text-rose-400"
							: "bg-[rgba(48,209,88,0.12)] text-emerald-400"
						: "text-neutral-300",
					inSel(cell.origIdx) && "outline outline-1 -outline-offset-1 outline-[#0A84FF]/80",
				)}
			>
				<Gutter
					nos={[cell.lineNo]}
					onAdd={() => setSel([cell.origIdx, cell.origIdx])}
					group={side}
				/>
				<span className="select-none pr-1 text-neutral-500 shrink-0">
					{cell.kind === changed ? (side === "left" ? "-" : "+") : " "}
				</span>
				<span className={clsx("select-text min-w-0 flex-1 pr-3", codeClass)}>
					{renderHighlightedCode(cell.text, cell.kind)}
				</span>
			</div>
		);
	};

	const renderSplit = (fi: number): ReactNode =>
		fileRows[fi].split.slice(0, budgets[fi]).flatMap((row) => {
			if (row.type === "header") return [renderSeparator(row.line, `h-${row.origIdx}`, true)];
			const k = `${row.left?.origIdx ?? "x"}-${row.right?.origIdx ?? "x"}`;
			return [renderCell(row.left, "left", `l-${k}`), renderCell(row.right, "right", `r-${k}`)];
		});

	const modeButton = (mode: "unified" | "split") => (
		<button
			type="button"
			onClick={() => setSavedViewMode(mode)}
			className={clsx(
				"press-scale flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors",
				viewMode === mode
					? "bg-[var(--bg-active-fill)] text-[var(--text)] shadow-sm"
					: "text-neutral-400 hover:text-neutral-200",
			)}
			title={mode === "unified" ? "单栏合并视图 (Unified)" : "双栏对比视图 (Split)"}
		>
			{mode === "unified" ? <Rows size={13} /> : <Columns2 size={13} />}
			{mode === "unified" ? "Unified" : "Split"}
		</button>
	);

	const submitAnnotation = (closeAfter = true) => {
		if (!sel || !sessionId) return;
		const segments = describeSelectionSegments(lines, sel[0], sel[1]);
		if (segments.length === 0) return;

		for (const seg of segments) {
			addAnnotation(sessionId, {
				source: "diff",
				...seg,
				comment: comment.trim() || undefined,
			});
		}

		const fileDesc = segments[0]?.file ? `：${segments[0].file}` : "";
		if (segments.length > 1) {
			toast.success(`已添加 ${segments.length} 条分段批注${fileDesc}`);
		} else {
			toast.success(`已添加批注${fileDesc}`);
		}

		setSel(null);
		setComment("");
		if (closeAfter) {
			onClose();
		} else {
			const lineRanges = segments
				.map((s) => s.lines)
				.filter(Boolean)
				.join(", ");
			setNote(
				`已添加${segments.length > 1 ? ` ${segments.length} 条分段` : ""}批注${fileDesc}${lineRanges ? ` 第 ${lineRanges} 行` : ""}`,
			);
		}
	};

	const sendToAgent = async () => {
		if (!sel || !sessionId || sending) return;
		const segments = describeSelectionSegments(lines, sel[0], sel[1]);
		if (segments.length === 0) return;

		const parts = segments.map((d, idx) => {
			const fileDesc = d.file ? `文件: ${d.file}` : `差异: ${title}`;
			const lineDesc = d.lines ? ` 第 ${d.lines} 行` : "";
			return `### 片段 ${idx + 1} (${fileDesc}${lineDesc})\n\`\`\`diff\n${d.text}\n\`\`\``;
		});
		const userComment = comment.trim() ? `批注说明：${comment.trim()}\n\n` : "";
		const promptText = `请处理以下代码差异批注：\n${userComment}${parts.join("\n\n")}`;

		setSending(true);
		try {
			await dispatchPrompt(sessionId, promptText);
			toast.success(
				segments.length > 1
					? `已发送 ${segments.length} 个分段批注给 Agent`
					: "已发送批注给 Agent",
			);
			setSel(null);
			setComment("");
			onClose();
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setSending(false);
		}
	};

	// Portal to <body>: the right aside creates a containing block for `fixed`
	// descendants, which would otherwise clamp this dialog to the panel width.
	return createPortal(
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className={clsx(
				"fixed inset-0 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-3",
				// Overlay title bar: keep the dialog below the macOS traffic lights.
				isMac && "pt-10",
			)}
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-[var(--bg-panel)] shadow-apple-modal hairline text-neutral-200"
				onMouseDown={(e) => e.stopPropagation()}
			>
				{/* Top Bar */}
				<div className="flex items-center gap-2 hairline-b bg-[var(--bg-panel)]/90 backdrop-blur-md px-4 py-2.5 text-sm">
					{multiFile && (
						<button
							type="button"
							onClick={() => setSidebarOpen((v) => !v)}
							className="press-scale rounded-lg p-1.5 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
							title={sidebarOpen ? "隐藏文件列表" : "显示文件列表"}
							aria-label={sidebarOpen ? "隐藏文件列表" : "显示文件列表"}
						>
							{sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
						</button>
					)}
					<span className="min-w-0 flex-1 truncate font-mono text-[var(--text)] font-medium">
						{title}
					</span>
					{realFiles.length > 0 && (
						<span className="flex shrink-0 items-center gap-2 text-xs text-neutral-400">
							<span>{realFiles.length} 个文件</span>
							<Counts adds={totals.adds} dels={totals.dels} />
						</span>
					)}
					{note && <span className="text-xs text-[#30D158] font-mono">{note}</span>}

					<button
						type="button"
						onClick={() => setWrap(!wrapPref)}
						disabled={viewMode === "split"}
						aria-pressed={wrap}
						className={clsx(
							"press-scale flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs hairline transition-colors disabled:cursor-default disabled:opacity-60",
							wrap
								? "bg-[var(--bg-active-fill)] text-[var(--text)]"
								: "text-neutral-400 hover:text-neutral-200",
						)}
						title={
							viewMode === "split"
								? "双栏视图总是自动换行，保证左右两栏都能看全"
								: "长行自动换行；关闭时可横向滚动"
						}
					>
						<WrapText size={13} /> 自动换行
					</button>

					{/* View mode toggle - Apple Segmented Control */}
					<div className="flex items-center rounded-lg bg-[var(--well-bg)] p-0.5 text-xs hairline">
						{modeButton("unified")}
						{modeButton("split")}
					</div>

					<button
						type="button"
						title="关闭 (Esc)"
						aria-label="关闭 (Esc)"
						onClick={onClose}
						className="press-scale rounded-lg p-1.5 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
					>
						<X size={16} />
					</button>
				</div>

				<div className="flex min-h-0 flex-1">
					{/* File list sidebar */}
					{showSidebar && (
						<nav
							className="shrink-0 overflow-y-auto hairline-r py-1.5 text-xs"
							style={{ width: SIDEBAR_WIDTH }}
						>
							{files.map((f, fi) => {
								if (f.path === null) return null;
								const { dir, base } = splitPath(f.path);
								return (
									<button
										type="button"
										key={`${fi}-${f.path}`}
										onClick={() => jumpTo(fi)}
										title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
										className={clsx(
											"flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
											activeFile === fi
												? "bg-[var(--bg-active-fill)] text-[var(--text)]"
												: "text-neutral-300 hover:bg-[var(--bg-hover)]",
										)}
									>
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate font-medium">{base}</span>
											{dir && <span className="truncate text-[10.5px] text-neutral-500">{dir}</span>}
										</span>
										<StatusBadge file={f} />
										<Counts adds={f.adds} dels={f.dels} />
									</button>
								);
							})}
						</nav>
					)}

					{/* Diff Content Area */}
					<div
						ref={scrollRef}
						onScroll={onScroll}
						className="relative min-w-0 flex-1 overflow-y-auto font-mono text-[12.5px] leading-5"
					>
						{error && <div className="p-3 text-rose-400">{error}</div>}
						{text === null && !error && (
							<div className="p-3 text-neutral-500">加载中…</div>
						)}
						{text !== null && lines.length === 0 && (
							<div className="p-3 text-neutral-500">没有差异</div>
						)}

						{files.map((f, fi) => {
							const isCollapsed = collapsed.has(fi);
							const { dir, base } = splitPath(f.path ?? "");
							return (
								<section
									key={`${fi}-${f.path ?? ""}`}
									ref={(el) => {
										sectionRefs.current[fi] = el;
									}}
									className="hairline-b"
								>
									{f.path !== null && (
										<div className="sticky top-0 z-10 flex items-center gap-2 hairline-b bg-[var(--bg-panel)] px-3 py-1.5 font-sans text-xs">
											<button
												type="button"
												onClick={() => toggleCollapsed(fi)}
												className="press-scale rounded p-0.5 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-100"
												title={isCollapsed ? "展开此文件" : "折叠此文件"}
												aria-label={isCollapsed ? "展开此文件" : "折叠此文件"}
												aria-expanded={!isCollapsed}
											>
												<ChevronRight
													size={14}
													className={clsx("transition-transform", !isCollapsed && "rotate-90")}
												/>
											</button>
											<span className="min-w-0 truncate font-mono" title={f.path}>
												{f.oldPath && (
													<span className="text-neutral-500">{f.oldPath} → </span>
												)}
												<span className="text-neutral-500">{dir}</span>
												<span className="font-medium text-[var(--text)]">{base}</span>
											</span>
											<StatusBadge file={f} />
											<span className="flex-1" />
											<Counts adds={f.adds} dels={f.dels} />
										</div>
									)}
									{!isCollapsed && budgets[fi] > 0 && (
										<div className={clsx(!wrap && "overflow-x-auto")}>
											<div
												className={clsx(
													!wrap && "w-max min-w-full",
													viewMode === "split" && "grid grid-cols-2",
												)}
											>
												{viewMode === "unified" ? renderUnified(fi) : renderSplit(fi)}
											</div>
										</div>
									)}
								</section>
							);
						})}

						{/* Incremental rendering for very large diffs */}
						{remaining > 0 && (
							<div className="flex justify-center py-3">
								<button
									type="button"
									onClick={() =>
										setVisibleCount((c) => c + RENDER_CHUNK)
									}
									className="press-scale rounded-lg hairline bg-[var(--bg-active-fill)] px-4 py-1.5 text-xs text-neutral-300 hover:bg-[var(--bg-hover)] transition-colors"
								>
									显示更多（还有 {remaining} 行）
								</button>
							</div>
						)}
					</div>
				</div>

				{/* Selection & Annotation Bar */}
				{sel && (
					<div className="flex flex-col gap-2.5 hairline-t bg-[var(--bg)]/90 backdrop-blur-md p-3">
						{sessionId ? (
							<>
								<textarea
									autoFocus
									value={comment}
									onChange={(e) => setComment(e.target.value)}
									onKeyDown={(e) => {
										if (isComposing(e)) return;
										if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
											e.preventDefault();
											submitAnnotation(true);
										}
									}}
									placeholder="对所选行的批注（支持 Cmd+Enter 快速提交并关闭）"
									rows={2}
									className="min-w-0 w-full resize-none rounded-xl hairline bg-[var(--bg-panel)] p-2.5 text-xs text-neutral-200 outline-none focus:ring-1 focus:ring-[#0A84FF]/50 transition-colors"
								/>
								<div className="flex items-center justify-between gap-2">
									<div className="text-[11px] text-neutral-400">
										提示：按{" "}
										<kbd className="rounded-md hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-neutral-300 font-mono text-[10px]">
											Cmd+Enter
										</kbd>{" "}
										提交并关闭
									</div>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => setSel(null)}
											className="press-scale rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
										>
											取消
										</button>
										<button
											type="button"
											onClick={() => submitAnnotation(false)}
											className="press-scale rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs text-neutral-300 hover:bg-[var(--bg-hover)] transition-colors"
											title="加入当前会话草稿箱，保持弹窗开启"
										>
											仅加到草稿
										</button>
										<button
											type="button"
											disabled={sending}
											onClick={sendToAgent}
											className="press-scale flex items-center gap-1 rounded-lg bg-[#FF9F0A] px-3 py-1 text-xs font-medium text-white hover:bg-[#FF9F0A]/90 disabled:opacity-40 transition-colors"
											title="立即发送给 Agent 审查"
										>
											<Send size={13} /> {sending ? "发送中…" : "发给 Agent"}
										</button>
										<button
											type="button"
											onClick={() => submitAnnotation(true)}
											className="press-scale flex items-center gap-1.5 rounded-lg bg-[#0A84FF] px-3 py-1 text-xs font-medium text-white hover:bg-[#0A84FF]/90 transition-colors"
											title="添加批注并关闭窗口 (Cmd+Enter)"
										>
											<MessageSquarePlus size={14} /> 批注并关闭
										</button>
									</div>
								</div>
							</>
						) : (
							<div className="flex items-center justify-between">
								<span className="text-xs text-neutral-400">
									先在左侧选择一个会话，才能添加批注
								</span>
								<button
									type="button"
									onClick={() => setSel(null)}
									className="press-scale rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] transition-colors"
								>
									取消
								</button>
							</div>
						)}
					</div>
				)}
			</div>
		</div>,
		document.body,
	);
}
