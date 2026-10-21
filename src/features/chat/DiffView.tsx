/** [B] Diff renderer for toolResult.details.diff (" 38|t", "+40|t", "-41|t")
 * with line-range selection → 批注 → composer annotation (source: "diff"). */

import clsx from "clsx";
import { Columns2, MessageSquarePlus, Rows } from "lucide-react";
import React, { useMemo, useRef, useState } from "react";
import { isComposing } from "../../lib/hooks";
import { useComposer } from "../../stores/composer";
import { claimEscape } from "../../lib/escapeClaim";

export interface DiffLine {
	kind: "ctx" | "add" | "del";
	line: number | null;
	text: string;
}

export function parseDiff(diff: string): DiffLine[] {
	const out: DiffLine[] = [];
	const rawLines = diff.split("\n");

	let oldLine: number | null = null;
	let newLine: number | null = null;
	let hasHunks = false;

	for (const raw of rawLines) {
		if (/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(raw)) {
			hasHunks = true;
			break;
		}
	}

	for (const raw of rawLines) {
		// 1. Private format: " 38|t", "+40|t", "-41|t"
		const mPrivate = /^([ +-]?)(\d*)\|(.*)$/.exec(raw);
		if (mPrivate) {
			const sign = mPrivate[1];
			out.push({
				kind: sign === "+" ? "add" : sign === "-" ? "del" : "ctx",
				line: mPrivate[2] ? Number(mPrivate[2]) : null,
				text: mPrivate[3],
			});
			continue;
		}

		// 2. Standard git diff hunk header: @@ -a,b +c,d @@
		const mHunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/.exec(
			raw,
		);
		if (mHunk) {
			oldLine = parseInt(mHunk[1], 10);
			newLine = parseInt(mHunk[2], 10);
			continue;
		}

		// 3. Lines inside standard git diff hunks
		if (hasHunks && oldLine !== null && newLine !== null) {
			if (raw.startsWith("+") && !raw.startsWith("+++")) {
				out.push({
					kind: "add",
					line: newLine++,
					text: raw.slice(1),
				});
				continue;
			}
			if (raw.startsWith("-") && !raw.startsWith("---")) {
				out.push({
					kind: "del",
					line: oldLine++,
					text: raw.slice(1),
				});
				continue;
			}
			if (raw.startsWith(" ")) {
				out.push({
					kind: "ctx",
					line: newLine++,
					text: raw.slice(1),
				});
				oldLine++;
				continue;
			}
			if (raw.startsWith("\\ No newline at end of file")) {
				continue;
			}
		}

		// 4. File headers before first hunk: skip if standard git diff
		if (
			hasHunks &&
			(raw.startsWith("diff --git") ||
				raw.startsWith("index ") ||
				raw.startsWith("--- ") ||
				raw.startsWith("+++ "))
		) {
			continue;
		}

		// 5. Fallback raw line
		if (raw.trim()) {
			out.push({ kind: "ctx", line: null, text: raw });
		}
	}
	return out;
}

export const TOKEN_RE =
	/(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|import|export|from|if|else|switch|case|default|class|type|interface|enum|async|await|try|catch|finally|for|while|do|break|continue|throw|new|this|typeof|instanceof|void|pub|fn|struct|impl|mut|use|mod|trait|match|where|crate|self|def|elif|lambda|yield|package|go|func)\b|\b\d+(?:\.\d+)?\b)/g;

export function renderHighlightedCode(
	text: string,
	kind: "ctx" | "add" | "del",
): React.ReactNode {
	if (!text) return "\u00A0";
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	const re = new RegExp(TOKEN_RE.source, "g");

	while ((match = re.exec(text)) !== null) {
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}
		const token = match[0];
		const first = token[0];
		if (
			(first === "/" && (token[1] === "/" || token[1] === "*")) ||
			first === "#"
		) {
			parts.push(
				<span key={match.index} className="italic text-[var(--text-40)]">
					{token}
				</span>,
			);
		} else if (first === '"' || first === "'" || first === "`") {
			parts.push(
				<span
					key={match.index}
					className={
						kind === "del"
							? "text-[var(--status-error)]"
							: "text-[var(--status-success)]"
					}
				>
					{token}
				</span>,
			);
		} else if (/^\d/.test(first)) {
			parts.push(
				<span key={match.index} className="text-[var(--status-warning)]">
					{token}
				</span>,
			);
		} else {
			parts.push(
				<span key={match.index} className="font-semibold text-[var(--accent)]">
					{token}
				</span>,
			);
		}
		lastIndex = re.lastIndex;
	}
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}
	return parts;
}

export interface SplitCell {
	line: number | null;
	text: string;
	kind: "ctx" | "add" | "del";
	origIdx: number;
}

export interface SplitRow {
	left: SplitCell | null;
	right: SplitCell | null;
}

export function buildSplitRows(lines: DiffLine[]): SplitRow[] {
	const rows: SplitRow[] = [];
	let i = 0;
	while (i < lines.length) {
		const cur = lines[i];
		if (cur.kind === "ctx") {
			rows.push({
				left: { line: cur.line, text: cur.text, kind: "ctx", origIdx: i },
				right: { line: cur.line, text: cur.text, kind: "ctx", origIdx: i },
			});
			i++;
		} else {
			const dels: SplitCell[] = [];
			const adds: SplitCell[] = [];
			while (
				i < lines.length &&
				(lines[i].kind === "del" || lines[i].kind === "add")
			) {
				if (lines[i].kind === "del") {
					dels.push({
						line: lines[i].line,
						text: lines[i].text,
						kind: "del",
						origIdx: i,
					});
				} else {
					adds.push({
						line: lines[i].line,
						text: lines[i].text,
						kind: "add",
						origIdx: i,
					});
				}
				i++;
			}
			const count = Math.max(dels.length, adds.length);
			for (let k = 0; k < count; k++) {
				rows.push({
					left: dels[k] ?? null,
					right: adds[k] ?? null,
				});
			}
		}
	}
	return rows;
}

/** Rows rendered before the 「展开剩余 N 行」 control; keeps huge diffs cheap. */
const DIFF_ROW_CAP = 200;

/** Added / removed line counts (context lines excluded). */
export function diffCounts(lines: DiffLine[]): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	for (const l of lines) {
		if (l.kind === "add") adds += 1;
		else if (l.kind === "del") dels += 1;
	}
	return { adds, dels };
}

export function DiffView({
	diff,
	file,
	sessionId,
}: {
	diff: string;
	file?: string;
	sessionId: string;
}) {
	const lines = useMemo(() => parseDiff(diff), [diff]);
	const counts = useMemo(() => diffCounts(lines), [lines]);
	const rootRef = useRef<HTMLDivElement>(null);
	const [showAll, setShowAll] = useState(false);
	const visibleLines = useMemo(
		() => (showAll ? lines : lines.slice(0, DIFF_ROW_CAP)),
		[lines, showAll],
	);
	const addAnnotation = useComposer((s) => s.addAnnotation);
	const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

	// Selection is a contiguous range of rendered rows [anchor, end].
	const [anchor, setAnchor] = useState<number | null>(null);
	const [end, setEnd] = useState<number | null>(null);
	const [comment, setComment] = useState("");
	const [commenting, setCommenting] = useState(false);

	const lo = anchor !== null && end !== null ? Math.min(anchor, end) : anchor;
	const hi = anchor !== null && end !== null ? Math.max(anchor, end) : anchor;
	const selected = new Set<number>();
	if (lo !== null && hi !== null) for (let i = lo; i <= hi; i++) selected.add(i);

	const toggleSelect = (i: number) => {
		if (anchor === null || (end !== null && anchor !== null)) {
			setAnchor(i);
			setEnd(null);
		} else {
			setEnd(i);
		}
	};

	const lineRange = () => {
		const nums = [...selected]
			.map((i) => lines[i]?.line)
			.filter((n): n is number => n !== null && n !== undefined)
			.sort((a, b) => a - b);
		if (nums.length === 0) return undefined;
		return nums[0] === nums[nums.length - 1]
			? `${nums[0]}`
			: `${nums[0]}-${nums[nums.length - 1]}`;
	};

	const submit = () => {
		if (lo === null || hi === null) return;
		const text = lines
			.slice(lo, hi + 1)
			.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`)
			.join("\n");
		addAnnotation(sessionId, {
			source: "diff",
			text,
			file,
			lines: lineRange(),
			comment: comment || undefined,
		});
		setAnchor(null);
		setEnd(null);
		setComment("");
		setCommenting(false);
	};

	const splitRows = useMemo(
		() => (viewMode === "split" ? buildSplitRows(visibleLines) : []),
		[viewMode, visibleLines],
	);

	// Roving tabindex: the gutter is one Tab stop, arrows move between lines.
	const [focusIdx, setFocusIdx] = useState(0);
	const gutterProps = (i: number, line: number | null) => ({
		role: "button" as const,
		tabIndex: i === focusIdx ? 0 : -1,
		"data-diff-idx": i,
		onFocus: () => setFocusIdx(i),
		onClick: () => toggleSelect(i),
		onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleSelect(i);
			} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				const next = rootRef.current?.querySelector<HTMLElement>(
					`[data-diff-idx="${i + (e.key === "ArrowDown" ? 1 : -1)}"]`,
				);
				if (next) {
					e.preventDefault();
					next.focus();
				}
			}
		},
		className:
			"flex w-12 shrink-0 cursor-pointer select-none items-center justify-end pr-2 text-right text-[var(--text-30)] font-mono tabular-nums hover:text-[var(--accent)]",
		title: "点击选中行添加批注",
		"aria-label": `选中第 ${line ?? i + 1} 行添加批注`,
	});

	return (
		<div ref={rootRef} className="text-[12px]">
			{/* View mode toggle — quiet ghost buttons */}
			<div className="mb-1 flex items-center justify-between text-[11px] text-[var(--text-30)]">
				<span className="text-[10px] text-[var(--text-30)]">
					<span className="text-[var(--status-success)]">+{counts.adds}</span>{" "}
					<span className="text-[var(--status-error)]">−{counts.dels}</span>
					（点击行号添加批注，拖选代码可复制）
				</span>
				<div className="flex items-center gap-0.5 text-[10px]">
					<button
						type="button"
						onClick={() => setViewMode("unified")}
						className={clsx(
							"flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors",
							viewMode === "unified"
								? "bg-[var(--ghost-hover)] text-[var(--text-60)]"
								: "text-[var(--text-30)] hover:text-[var(--text-60)]",
						)}
						title="单栏视图"
					>
						<Rows size={11} /> 单栏
					</button>
					<button
						type="button"
						onClick={() => setViewMode("split")}
						className={clsx(
							"flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors",
							viewMode === "split"
								? "bg-[var(--ghost-hover)] text-[var(--text-60)]"
								: "text-[var(--text-30)] hover:text-[var(--text-60)]",
						)}
						title="左右双栏分栏对比"
					>
						<Columns2 size={11} /> 分栏
					</button>
				</div>
			</div>

			{viewMode === "unified" ? (
				<div className="overflow-x-auto rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] font-mono text-[12px] leading-5">
					{visibleLines.map((l, i) => (
						<div
							key={i}
							className={clsx(
								"flex w-full select-text transition-colors hover:bg-[var(--ghost-hover)]",
								l.kind === "add" &&
									"bg-[color-mix(in_oklab,var(--status-success)_12%,transparent)] text-[var(--status-success)]",
								l.kind === "del" &&
									"bg-[color-mix(in_oklab,var(--status-error)_12%,transparent)] text-[var(--status-error)]",
								l.kind === "ctx" && "text-[var(--text-60)]",
								selected.has(i) &&
									"outline outline-1 -outline-offset-1 outline-[var(--accent)]",
							)}
						>
							<div
								{...gutterProps(i, l.line)}
							>
								<span className="w-7">{l.line ?? ""}</span>
								<span className="w-3 text-center">
									{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
								</span>
							</div>
							<div className="min-w-0 flex-1 select-text whitespace-pre-wrap break-all px-1.5 py-0.5">
								{renderHighlightedCode(l.text, l.kind)}
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="overflow-x-auto rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] font-mono text-[11px] leading-5">
					<div className="grid grid-cols-2 divide-x divide-[var(--line)]">
						{splitRows.map((row, idx) => (
							<React.Fragment key={idx}>
								{/* Left column (Original / Deleted) */}
								<div
									className={clsx(
										"flex min-w-0 select-text transition-colors hover:bg-[var(--ghost-hover)]",
										row.left?.kind === "del" &&
											"bg-[color-mix(in_oklab,var(--status-error)_12%,transparent)] text-[var(--status-error)]",
										row.left?.kind === "ctx" && "text-[var(--text-60)]",
										!row.left && "bg-[var(--ghost-hover)] select-none",
										row.left &&
											selected.has(row.left.origIdx) &&
											"outline outline-1 -outline-offset-1 outline-[var(--accent)]",
									)}
								>
									{row.left ? (
										<>
											<div
												{...gutterProps(row.left.origIdx, row.left.line)}
												className="flex w-10 shrink-0 cursor-pointer select-none items-center justify-end pr-1 text-right text-[var(--text-30)] font-mono tabular-nums hover:text-[var(--accent)]"
											>
												<span className="w-6">
													{row.left.line ?? ""}
												</span>
												<span className="w-2.5 text-center">
													{row.left.kind === "del" ? "-" : " "}
												</span>
											</div>
											<div className="min-w-0 flex-1 select-text whitespace-pre-wrap break-all px-1">
												{renderHighlightedCode(
													row.left.text,
													row.left.kind,
												)}
											</div>
										</>
									) : (
										<div className="h-5 w-full select-none bg-[var(--ghost-hover)]" />
									)}
								</div>

								{/* Right column (New / Added) */}
								<div
									className={clsx(
										"flex min-w-0 select-text transition-colors hover:bg-[var(--ghost-hover)]",
										row.right?.kind === "add" &&
											"bg-[color-mix(in_oklab,var(--status-success)_12%,transparent)] text-[var(--status-success)]",
										row.right?.kind === "ctx" && "text-[var(--text-60)]",
										!row.right && "bg-[var(--ghost-hover)] select-none",
										row.right &&
											selected.has(row.right.origIdx) &&
											"outline outline-1 -outline-offset-1 outline-[var(--accent)]",
									)}
								>
									{row.right ? (
										<>
											<div
												{...gutterProps(row.right.origIdx, row.right.line)}
												className="flex w-10 shrink-0 cursor-pointer select-none items-center justify-end pr-1 text-right text-[var(--text-30)] font-mono tabular-nums hover:text-[var(--accent)]"
											>
												<span className="w-6">
													{row.right.line ?? ""}
												</span>
												<span className="w-2.5 text-center">
													{row.right.kind === "add" ? "+" : " "}
												</span>
											</div>
											<div className="min-w-0 flex-1 select-text whitespace-pre-wrap break-all px-1">
												{renderHighlightedCode(
													row.right.text,
													row.right.kind,
												)}
											</div>
										</>
									) : (
										<div className="h-5 w-full select-none bg-[var(--ghost-hover)]" />
									)}
								</div>
							</React.Fragment>
						))}
					</div>
				</div>
			)}

			{!showAll && lines.length > visibleLines.length && (
				<button
					type="button"
					onClick={() => setShowAll(true)}
					className="mt-1 rounded-md border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
				>
					展开剩余 {lines.length - visibleLines.length} 行
				</button>
			)}

			{lo !== null && !commenting && (
				<button
					type="button"
					onClick={() => setCommenting(true)}
					className="mt-1.5 flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-40)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
				>
					<MessageSquarePlus size={12} /> 批注选中行
				</button>
			)}

			{commenting && (
				<div className="mt-1 flex flex-col gap-1">
					<textarea
						autoFocus
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Escape") {
								claimEscape(e);
								setCommenting(false);
								setAnchor(null);
								setEnd(null);
							} else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								e.preventDefault();
								submit();
							}
						}}
						placeholder="批注内容 (⌘+Enter 提交，Esc 取消)…"
						rows={2}
						className="w-full rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors"
					/>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={submit}
							className="rounded bg-[var(--accent)] px-3 py-1 text-[11px] font-medium text-[var(--bg)] transition-opacity hover:opacity-90"
						>
							添加批注
						</button>
						<button
							type="button"
							onClick={() => {
								setCommenting(false);
								setAnchor(null);
								setEnd(null);
							}}
							className="rounded px-2.5 py-1 text-[11px] text-[var(--text-40)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						>
							取消
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
