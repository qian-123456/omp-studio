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
					className={kind === "del" ? "text-red-200" : "text-emerald-300"}
				>
					{token}
				</span>,
			);
		} else if (/^\d/.test(first)) {
			parts.push(
				<span key={match.index} className="text-amber-300">
					{token}
				</span>,
			);
		} else {
			parts.push(
				<span key={match.index} className="font-semibold text-purple-400">
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
				<div className="flex items-center rounded border border-neutral-800 bg-neutral-900/80 p-0.5">
					<button
						type="button"
						onClick={() => setViewMode("unified")}
						className={clsx(
							"flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors",
							viewMode === "unified"
								? "bg-neutral-800 font-medium text-neutral-200"
								: "text-neutral-500 hover:text-neutral-300",
						)}
						title="单栏视图 (Unified)"
					>
						<Rows size={11} /> Unified
					</button>
					<button
						type="button"
						onClick={() => setViewMode("split")}
						className={clsx(
							"flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors",
							viewMode === "split"
								? "bg-neutral-800 font-medium text-neutral-200"
								: "text-neutral-500 hover:text-neutral-300",
						)}
						title="左右双栏分栏对比 (Split)"
					>
						<Columns2 size={11} /> Split
					</button>
				</div>
			</div>

			{viewMode === "unified" ? (
				<div className="overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950 font-mono text-[12px] leading-5">
					{lines.map((l, i) => (
						<div
							key={i}
							className={clsx(
								"flex w-full select-text transition-colors hover:bg-neutral-900/50",
								l.kind === "add" && "bg-emerald-950/40 text-emerald-300",
								l.kind === "del" && "bg-red-950/40 text-red-300",
								l.kind === "ctx" && "text-neutral-400",
								selected.has(i) && "outline outline-1 outline-indigo-500",
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
								className="flex w-12 shrink-0 cursor-pointer select-none items-center justify-end pr-2 text-right text-neutral-600 hover:text-indigo-400"
								title="点击选中行添加批注"
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
				<div className="overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950 font-mono text-[11px] leading-5">
					<div className="grid grid-cols-2 divide-x divide-neutral-800">
						{splitRows.map((row, idx) => (
							<React.Fragment key={idx}>
								{/* Left column (Original / Deleted) */}
								<div
									className={clsx(
										"flex min-w-0 select-text transition-colors hover:bg-neutral-900/50",
										row.left?.kind === "del" &&
											"bg-red-950/40 text-red-300",
										row.left?.kind === "ctx" && "text-neutral-400",
										!row.left && "bg-neutral-950/60",
										row.left &&
											selected.has(row.left.origIdx) &&
											"outline outline-1 outline-indigo-500",
									)}
								>
									{row.left ? (
										<>
											<div
												role="button"
												tabIndex={0}
												onClick={() => toggleSelect(row.left!.origIdx)}
												className="flex w-10 shrink-0 cursor-pointer select-none items-center justify-end pr-1 text-right text-neutral-600 hover:text-indigo-400"
												title="点击选中行"
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
										"flex min-w-0 select-text transition-colors hover:bg-neutral-900/50",
										row.right?.kind === "add" &&
											"bg-emerald-950/40 text-emerald-300",
										row.right?.kind === "ctx" && "text-neutral-400",
										!row.right && "bg-neutral-950/60",
										row.right &&
											selected.has(row.right.origIdx) &&
											"outline outline-1 outline-indigo-500",
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
												className="flex w-10 shrink-0 cursor-pointer select-none items-center justify-end pr-1 text-right text-neutral-600 hover:text-indigo-400"
												title="点击选中行"
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
					onClick={() => setCommenting(true)}
					className="mt-1 flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
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
						className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[12px] text-neutral-200 outline-none focus:border-indigo-500"
					/>
					<div className="flex gap-1">
						<button
							type="button"
							onClick={submit}
							className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] text-white hover:bg-indigo-500"
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
							className="rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
						>
							取消
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
