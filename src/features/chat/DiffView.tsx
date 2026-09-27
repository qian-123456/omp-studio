/** [B] Diff renderer for toolResult.details.diff (" 38|t", "+40|t", "-41|t")
 * with line-range selection → 批注 → composer annotation (source: "diff"). */

import clsx from "clsx";
import { Columns2, MessageSquarePlus, Rows } from "lucide-react";
import React, { useState } from "react";
import { isComposing } from "../../lib/hooks";
import { useComposer } from "../../stores/composer";

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
				<span key={match.index} className="italic text-neutral-500">
					{token}
				</span>,
			);
		} else if (first === '"' || first === "'" || first === "`") {
			parts.push(
				<span
					key={match.index}
					className={kind === "del" ? "text-[#ff7b72]" : "text-[#6be585]"}
				>
					{token}
				</span>
			);
		} else if (/^\d/.test(first)) {
			parts.push(
				<span key={match.index} className="text-[#FF9F0A]">
					{token}
				</span>
			);
		} else {
			parts.push(
				<span key={match.index} className="font-semibold text-[#BF5AF2]">
					{token}
				</span>
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

export function DiffView({
	diff,
	file,
	sessionId,
}: {
	diff: string;
	file?: string;
	sessionId: string;
}) {
	const lines = parseDiff(diff);
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
			.map((l) => l.text)
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

	const splitRows = viewMode === "split" ? buildSplitRows(lines) : [];

	return (
		<div className="text-[12px]">
			{/* View mode toggle toolbar */}
			<div className="mb-1 flex items-center justify-between text-[11px] text-neutral-400">
				<span className="text-[10px] text-neutral-500">
					{lines.length} 行改动（点击行号添加批注，拖选代码可复制）
				</span>
				<div className="flex items-center rounded-lg bg-[var(--well-bg)] p-0.5 text-[10px] hairline">
					<button
						type="button"
						onClick={() => setViewMode("unified")}
						className={clsx(
							"press-scale flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] transition-colors",
							viewMode === "unified"
								? "bg-[var(--bg-active-fill)] font-medium text-[var(--text)] shadow-sm"
								: "text-neutral-400 hover:text-neutral-200",
						)}
						title="单栏视图 (Unified)"
					>
						<Rows size={11} /> Unified
					</button>
					<button
						type="button"
						onClick={() => setViewMode("split")}
						className={clsx(
							"press-scale flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] transition-colors",
							viewMode === "split"
								? "bg-[var(--bg-active-fill)] font-medium text-[var(--text)] shadow-sm"
								: "text-neutral-400 hover:text-neutral-200",
						)}
						title="左右双栏分栏对比 (Split)"
					>
						<Columns2 size={11} /> Split
					</button>
				</div>
			</div>

			{viewMode === "unified" ? (
				<div className="overflow-x-auto rounded-xl hairline bg-[var(--bg)] font-mono text-[12px] leading-5">
					{lines.map((l, i) => (
						<div
							key={i}
							className={clsx(
								"flex w-full select-text transition-colors hover:bg-[var(--bg-active-fill)]",
								l.kind === "add" && "bg-[rgba(48,209,88,0.12)] text-[#6be585]",
								l.kind === "del" && "bg-[rgba(255,69,58,0.12)] text-[#ff7b72]",
								l.kind === "ctx" && "text-neutral-300",
								selected.has(i) && "outline outline-1 outline-[#0A84FF]/80",
							)}
						>
							<div
								role="button"
								tabIndex={0}
								onClick={() => toggleSelect(i)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										toggleSelect(i);
									}
								}}
								className="flex w-12 shrink-0 cursor-pointer select-none items-center justify-end pr-2 text-right text-neutral-500 font-mono tabular-nums hover:text-[#0A84FF]"
								title="点击选中行添加批注"
								aria-label={`选中第 ${l.line ?? i + 1} 行添加批注`}
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
				<div className="overflow-x-auto rounded-xl hairline bg-[var(--bg)] font-mono text-[11px] leading-5">
					<div className="grid grid-cols-2 divide-x divide-[var(--border-divider)]">
						{splitRows.map((row, idx) => (
							<React.Fragment key={idx}>
								{/* Left column (Original / Deleted) */}
								<div
									className={clsx(
										"flex min-w-0 select-text transition-colors hover:bg-[var(--bg-active-fill)]",
										row.left?.kind === "del" &&
											"bg-[rgba(255,69,58,0.12)] text-[#ff7b72]",
										row.left?.kind === "ctx" && "text-neutral-300",
										!row.left && "bg-neutral-950/40 select-none",
										row.left &&
											selected.has(row.left.origIdx) &&
											"outline outline-1 outline-[#0A84FF]/80",
									)}
								>
									{row.left ? (
										<>
											<div
												role="button"
												tabIndex={0}
												onClick={() => toggleSelect(row.left!.origIdx)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														toggleSelect(row.left!.origIdx);
													}
												}}
												className="flex w-10 shrink-0 cursor-pointer select-none items-center justify-end pr-1 text-right text-neutral-500 font-mono tabular-nums hover:text-[#0A84FF]"
												title="点击选中行"
												aria-label={`选中第 ${row.left.line ?? row.left.origIdx + 1} 行`}
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
										<div className="h-5 w-full select-none bg-neutral-900/20" />
									)}
								</div>

								{/* Right column (New / Added) */}
								<div
									className={clsx(
										"flex min-w-0 select-text transition-colors hover:bg-[var(--bg-active-fill)]",
										row.right?.kind === "add" &&
											"bg-[rgba(48,209,88,0.12)] text-[#6be585]",
										row.right?.kind === "ctx" && "text-neutral-300",
										!row.right && "bg-neutral-950/40 select-none",
										row.right &&
											selected.has(row.right.origIdx) &&
											"outline outline-1 outline-[#0A84FF]/80",
									)}
								>
									{row.right ? (
										<>
											<div
												role="button"
												tabIndex={0}
												onClick={() =>
													toggleSelect(row.right!.origIdx)
												}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														toggleSelect(row.right!.origIdx);
													}
												}}
												className="flex w-10 shrink-0 cursor-pointer select-none items-center justify-end pr-1 text-right text-neutral-500 font-mono tabular-nums hover:text-[#0A84FF]"
												title="点击选中行"
												aria-label={`选中第 ${row.right.line ?? row.right.origIdx + 1} 行`}
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
										<div className="h-5 w-full select-none bg-neutral-900/20" />
									)}
								</div>
							</React.Fragment>
						))}
					</div>
				</div>
			)}

			{lo !== null && !commenting && (
				<button
					type="button"
					className="mt-1.5 press-scale flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
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
								e.preventDefault();
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
						className="w-full rounded-xl hairline bg-[var(--bg-panel)] px-2.5 py-1.5 text-[12px] text-neutral-200 outline-none focus:ring-1 focus:ring-[#0A84FF]/50 transition-colors"
					/>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={submit}
							className="press-scale rounded-lg bg-[#0A84FF] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#0A84FF]/90 transition-colors"
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
							className="press-scale rounded-lg px-2.5 py-1 text-[11px] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
						>
							取消
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
