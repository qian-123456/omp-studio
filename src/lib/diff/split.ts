export interface ChatDiffLine {
	kind: "ctx" | "add" | "del";
	line: number | null;
	text: string;
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

/** Split row algorithm for chat-style diff lines. */
export function buildSplitRows(lines: ChatDiffLine[]): SplitRow[] {
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

export interface UnifiedDiffLineLike {
	kind: "add" | "del" | "ctx" | "hunk" | "meta";
	text: string;
	oldNo?: number;
	newNo?: number;
	file?: string;
}

export interface UnifiedSplitCell {
	lineNo?: number;
	text: string;
	kind: "ctx" | "add" | "del";
	origIdx: number;
}

export type UnifiedSplitRow =
	| {
			type: "header";
			line: UnifiedDiffLineLike;
			origIdx: number;
	  }
	| {
			type: "diff";
			left: UnifiedSplitCell | null;
			right: UnifiedSplitCell | null;
	  };

/** Split row algorithm for unified diff lines (supporting headers and dual line numbers). */
export function buildUnifiedSplitRows(
	lines: UnifiedDiffLineLike[],
): UnifiedSplitRow[] {
	const rows: UnifiedSplitRow[] = [];
	let i = 0;
	while (i < lines.length) {
		const cur = lines[i];
		if (cur.kind === "meta" || cur.kind === "hunk") {
			rows.push({
				type: "header",
				line: cur,
				origIdx: i,
			});
			i++;
		} else if (cur.kind === "ctx") {
			rows.push({
				type: "diff",
				left: {
					lineNo: cur.oldNo,
					text: cur.text,
					kind: "ctx",
					origIdx: i,
				},
				right: {
					lineNo: cur.newNo,
					text: cur.text,
					kind: "ctx",
					origIdx: i,
				},
			});
			i++;
		} else {
			const dels: UnifiedSplitCell[] = [];
			const adds: UnifiedSplitCell[] = [];
			while (
				i < lines.length &&
				(lines[i].kind === "del" || lines[i].kind === "add")
			) {
				const item = lines[i];
				if (item.kind === "del") {
					dels.push({
						lineNo: item.oldNo,
						text: item.text,
						kind: "del",
						origIdx: i,
					});
				} else {
					adds.push({
						lineNo: item.newNo,
						text: item.text,
						kind: "add",
						origIdx: i,
					});
				}
				i++;
			}
			const count = Math.max(dels.length, adds.length);
			for (let k = 0; k < count; k++) {
				rows.push({
					type: "diff",
					left: dels[k] ?? null,
					right: adds[k] ?? null,
				});
			}
		}
	}
	return rows;
}
