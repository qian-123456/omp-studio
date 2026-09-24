/** Unified diff parsing for the diff modal. */

export type DiffLineKind = "add" | "del" | "ctx" | "hunk" | "meta";

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
	oldNo?: number;
	newNo?: number;
	/** File (new path) the line belongs to. */
	file?: string;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parse `git diff` / `git show` output into typed, numbered lines. */
export function parseUnifiedDiff(text: string): DiffLine[] {
	const out: DiffLine[] = [];
	let file: string | undefined;
	let oldNo = 0;
	let newNo = 0;
	let inHunk = false;
	const lines = text.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			inHunk = false;
			const m = / b\/(.+)$/.exec(line);
			file = m?.[1];
			out.push({ kind: "meta", text: line, file });
			continue;
		}
		const hunk = HUNK_RE.exec(line);
		if (hunk) {
			inHunk = true;
			oldNo = Number(hunk[1]);
			newNo = Number(hunk[2]);
			out.push({ kind: "hunk", text: line, file });
			continue;
		}
		if (!inHunk) {
			if (line.startsWith("+++ ")) {
				const p = line.slice(4);
				if (p !== "/dev/null") file = p.replace(/^b\//, "");
			}
			out.push({ kind: "meta", text: line, file });
			continue;
		}
		if (line.startsWith("+")) {
			out.push({ kind: "add", text: line.slice(1), newNo: newNo++, file });
		} else if (line.startsWith("-")) {
			out.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, file });
		} else if (line.startsWith("\\")) {
			out.push({ kind: "meta", text: line, file });
		} else if (line.startsWith(" ") || line === "") {
			out.push({
				kind: "ctx",
				text: line.slice(1),
				oldNo: oldNo++,
				newNo: newNo++,
				file,
			});
		} else {
			// Next commit header in `git show` output, etc.
			inHunk = false;
			out.push({ kind: "meta", text: line, file });
		}
	}
	return out;
}

/** Summarize a selected range of diff lines for an annotation. */
export function describeSelection(
	lines: DiffLine[],
	from: number,
	to: number,
): { file?: string; lines?: string; text: string } {
	const [a, b] = from <= to ? [from, to] : [to, from];
	const picked = lines
		.slice(a, b + 1)
		.filter((l) => l.kind === "add" || l.kind === "del" || l.kind === "ctx");
	const nums = picked
		.map((l) => l.newNo ?? l.oldNo)
		.filter((n): n is number => n !== undefined);
	const lo = nums.length ? Math.min(...nums) : undefined;
	const hi = nums.length ? Math.max(...nums) : undefined;
	const range = lo === undefined ? undefined : lo === hi ? `${lo}` : `${lo}-${hi}`;
	const prefix = { add: "+", del: "-", ctx: " " } as Record<string, string>;
	return {
		file: picked[0]?.file,
		lines: range,
		text: picked.map((l) => `${prefix[l.kind]}${l.text}`).join("\n"),
	};
}
