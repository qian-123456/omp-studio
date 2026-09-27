import clsx from "clsx";
import { Columns2, MessageSquarePlus, Plus, Rows, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildUnifiedSplitRows, renderHighlightedCode } from "../../lib/diff";
import { errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { dispatchPrompt } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useUi } from "../../stores/ui";
import {
	type DiffLine,
	describeSelectionSegments,
	parseUnifiedDiff,
} from "./diff";

const ROW_STYLE: Record<DiffLine["kind"], string> = {
	add: "bg-emerald-950/60 text-emerald-200",
	del: "bg-rose-950/60 text-rose-200",
	ctx: "text-neutral-300",
	hunk: "bg-indigo-950/50 text-indigo-300",
	meta: "text-neutral-500",
};

/**
 * Full-screen diff viewer.
 * Supports Unified / Split view toggle, keyword syntax highlighting,
 * line number hover "+" annotation button, and multi-segment cross-hunk selection.
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
	const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

	const sessionId = useUi((s) => s.selectedSessionId);
	const addAnnotation = useComposer((s) => s.addAnnotation);

	useEscapeKey(onClose);

	useEffect(() => {
		load()
			.then(setText)
			.catch((e) => setError(errMsg(e)));
	}, [load]);

	const lines = useMemo(() => (text ? parseUnifiedDiff(text) : []), [text]);
	const splitRows = useMemo(() => {
		if (viewMode !== "split") return [];
		return buildUnifiedSplitRows(lines);
	}, [lines, viewMode]);

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

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
				onMouseDown={(e) => e.stopPropagation()}
			>
				{/* Top Bar */}
				<div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
					<span className="min-w-0 flex-1 truncate font-mono text-neutral-200">
						{title}
					</span>
					{note && <span className="text-xs text-emerald-400">{note}</span>}

					{/* View mode toggle */}
					<div className="flex items-center rounded border border-neutral-800 bg-neutral-950 p-0.5 text-xs">
						<button
							type="button"
							onClick={() => setViewMode("unified")}
							className={clsx(
								"flex items-center gap-1 rounded px-2 py-0.5 transition-colors",
								viewMode === "unified"
									? "bg-neutral-800 font-medium text-neutral-200"
									: "text-neutral-500 hover:text-neutral-300",
							)}
							title="单栏合并视图 (Unified)"
						>
							<Rows size={13} /> Unified
						</button>
						<button
							type="button"
							onClick={() => setViewMode("split")}
							className={clsx(
								"flex items-center gap-1 rounded px-2 py-0.5 transition-colors",
								viewMode === "split"
									? "bg-neutral-800 font-medium text-neutral-200"
									: "text-neutral-500 hover:text-neutral-300",
							)}
							title="双栏对比视图 (Split)"
						>
							<Columns2 size={13} /> Split
						</button>
					</div>

					<button
						type="button"
						title="关闭 (Esc)"
						aria-label="关闭 (Esc)"
						onClick={onClose}
						className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					>
						<X size={16} />
					</button>
				</div>

				{/* Diff Content Area */}
				<div className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-5">
					{error && <div className="p-3 text-rose-400">{error}</div>}
					{text === null && !error && (
						<div className="p-3 text-neutral-500">加载中…</div>
					)}
					{text !== null && lines.length === 0 && (
						<div className="p-3 text-neutral-500">没有差异</div>
					)}

					{/* Unified View */}
					{viewMode === "unified" &&
						lines.map((l, i) => {
							const isHeader = l.kind === "meta" || l.kind === "hunk";
							return (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: static diff lines
									key={i}
									onClick={(e) => onLineClick(i, e.shiftKey)}
									className={clsx(
										"group/row flex cursor-default whitespace-pre select-text transition-colors",
										ROW_STYLE[l.kind],
										inSel(i) && "outline outline-1 outline-amber-400/70",
									)}
								>
									{/* Gutter with line numbers and hover + button */}
									<div className="relative flex shrink-0 select-none w-20">
										<span className="w-10 pr-1 text-right text-neutral-600 group-hover/row:text-neutral-500">
											{l.oldNo ?? ""}
										</span>
										<span className="w-10 pr-2 text-right text-neutral-600 group-hover/row:text-neutral-500">
											{l.newNo ?? ""}
										</span>
										{!isHeader && (
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													setSel([i, i]);
												}}
												className="absolute left-1 top-0.5 hidden h-4 w-4 items-center justify-center rounded bg-indigo-600 text-white shadow hover:bg-indigo-500 group-hover/row:flex"
												title="为此行添加批注 (+)"
												aria-label="为此行添加批注"
											>
												<Plus size={10} />
											</button>
										)}
									</div>

									{/* Prefix (+/-) */}
									<span className="select-none pr-1 text-neutral-600 shrink-0">
										{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
									</span>

									{/* Code line with syntax highlighting */}
									<span className="select-text min-w-0 flex-1">
										{renderHighlightedCode(l.text, l.kind)}
									</span>
								</div>
							);
						})}

					{/* Split View */}
					{viewMode === "split" &&
						splitRows.map((row, i) => {
							if (row.type === "header") {
								return (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: static diff rows
										key={`header-${i}`}
										className={clsx(
											"flex w-full select-text px-3 py-0.5 font-mono text-[11px]",
											ROW_STYLE[row.line.kind],
										)}
									>
										<span className="font-semibold">{row.line.text}</span>
									</div>
								);
							}

							const left = row.left;
							const right = row.right;

							return (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: static diff rows
									key={`split-${i}`}
									className="grid grid-cols-2 divide-x divide-neutral-800"
								>
									{/* Left Column (Old / Deletion) */}
									<div
										onClick={(e) =>
											left && onLineClick(left.origIdx, e.shiftKey)
										}
										className={clsx(
											"group/left flex min-w-0 cursor-default select-text transition-colors",
											left
												? left.kind === "del"
													? "bg-rose-950/60 text-rose-200"
													: "text-neutral-300"
												: "bg-neutral-950/40 select-none",
											left &&
												inSel(left.origIdx) &&
												"outline outline-1 outline-amber-400/70",
										)}
									>
										{left ? (
											<>
												<div className="relative flex shrink-0 select-none w-10">
													<span className="w-10 pr-2 text-right text-neutral-600 group-hover/left:text-neutral-500">
														{left.lineNo ?? ""}
													</span>
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															setSel([left.origIdx, left.origIdx]);
														}}
														className="absolute left-1 top-0.5 hidden h-4 w-4 items-center justify-center rounded bg-indigo-600 text-white shadow hover:bg-indigo-500 group-hover/left:flex"
														title="为此行添加批注 (+)"
														aria-label="为此行添加批注"
													>
														<Plus size={10} />
													</button>
												</div>
												<span className="select-none pr-1 text-neutral-600 shrink-0">
													{left.kind === "del" ? "-" : " "}
												</span>
												<span className="select-text min-w-0 flex-1 truncate">
													{renderHighlightedCode(left.text, left.kind)}
												</span>
											</>
										) : (
											<span className="text-transparent">{"\u00A0"}</span>
										)}
									</div>

									{/* Right Column (New / Addition) */}
									<div
										onClick={(e) =>
											right && onLineClick(right.origIdx, e.shiftKey)
										}
										className={clsx(
											"group/right flex min-w-0 cursor-default select-text transition-colors",
											right
												? right.kind === "add"
													? "bg-emerald-950/60 text-emerald-200"
													: "text-neutral-300"
												: "bg-neutral-950/40 select-none",
											right &&
												inSel(right.origIdx) &&
												"outline outline-1 outline-amber-400/70",
										)}
									>
										{right ? (
											<>
												<div className="relative flex shrink-0 select-none w-10">
													<span className="w-10 pr-2 text-right text-neutral-600 group-hover/right:text-neutral-500">
														{right.lineNo ?? ""}
													</span>
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															setSel([right.origIdx, right.origIdx]);
														}}
														className="absolute left-1 top-0.5 hidden h-4 w-4 items-center justify-center rounded bg-indigo-600 text-white shadow hover:bg-indigo-500 group-hover/right:flex"
														title="为此行添加批注 (+)"
														aria-label="为此行添加批注"
													>
														<Plus size={10} />
													</button>
												</div>
												<span className="select-none pr-1 text-neutral-600 shrink-0">
													{right.kind === "add" ? "+" : " "}
												</span>
												<span className="select-text min-w-0 flex-1 truncate">
													{renderHighlightedCode(right.text, right.kind)}
												</span>
											</>
										) : (
											<span className="text-transparent">{"\u00A0"}</span>
										)}
									</div>
								</div>
							);
						})}
				</div>

				{/* Selection & Annotation Bar */}
				{sel && (
					<div className="flex flex-col gap-2 border-t border-neutral-800 p-2.5 bg-neutral-950/60">
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
									className="min-w-0 w-full resize-none rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200 outline-none focus:border-indigo-500"
								/>
								<div className="flex items-center justify-between gap-2">
									<div className="text-[11px] text-neutral-500">
										提示：按{" "}
										<kbd className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-300 font-mono">
											Cmd+Enter
										</kbd>{" "}
										提交并关闭
									</div>
									<div className="flex items-center gap-1.5">
										<button
											type="button"
											onClick={() => setSel(null)}
											className="rounded px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
										>
											取消
										</button>
										<button
											type="button"
											onClick={() => submitAnnotation(false)}
											className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
											title="加入当前会话草稿箱，保持弹窗开启"
										>
											仅加到草稿
										</button>
										<button
											type="button"
											disabled={sending}
											onClick={sendToAgent}
											className="flex items-center gap-1 rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-40"
											title="立即发送给 Agent 审查"
										>
											<Send size={13} /> {sending ? "发送中…" : "发给 Agent"}
										</button>
										<button
											type="button"
											onClick={() => submitAnnotation(true)}
											className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
											title="添加批注并关闭窗口 (Cmd+Enter)"
										>
											<MessageSquarePlus size={14} /> 批注并关闭
										</button>
									</div>
								</div>
							</>
						) : (
							<div className="flex items-center justify-between">
								<span className="text-xs text-neutral-500">
									先在左侧选择一个会话，才能添加批注
								</span>
								<button
									type="button"
									onClick={() => setSel(null)}
									className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
								>
									取消
								</button>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
