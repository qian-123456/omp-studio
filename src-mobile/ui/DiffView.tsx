import { memo, useMemo } from "react";

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";

const META_PREFIXES = [
	"diff --git",
	"index ",
	"--- ",
	"+++ ",
	"new file mode",
	"deleted file mode",
	"old mode",
	"new mode",
	"similarity index",
	"rename from",
	"rename to",
	"Binary files",
	"\\ ",
];

export function classifyDiffLine(line: string): DiffLineKind {
	for (const p of META_PREFIXES) if (line.startsWith(p)) return "meta";
	if (line.startsWith("@@")) return "hunk";
	if (line.startsWith("+")) return "add";
	if (line.startsWith("-")) return "del";
	return "ctx";
}

export function looksLikeDiff(text: string): boolean {
	return (
		/^@@ .*@@/m.test(text) || /^diff --git /m.test(text) || (/^--- /m.test(text) && /^\+\+\+ /m.test(text))
	);
}

const KIND_CLASS: Record<DiffLineKind, string> = {
	add: "bg-m-diff-add text-m-text",
	del: "bg-m-diff-del text-m-text",
	hunk: "text-m-accent/70",
	meta: "text-m-text-3",
	ctx: "text-m-text-2",
};

const CHUNK = 100;
const LINE_PX = 18;
const WINDOW_THRESHOLD = 400;

function Lines({ lines }: { lines: readonly string[] }) {
	return (
		<>
			{lines.map((line, i) => (
				<div key={i} className={`h-4.5 whitespace-pre px-3 leading-[18px] ${KIND_CLASS[classifyDiffLine(line)]}`}>
					{line === "" ? " " : line}
				</div>
			))}
		</>
	);
}

export const DiffView = memo(function DiffView({ diff, className = "" }: { diff: string; className?: string }) {
	const lines = useMemo(() => {
		const all = diff.split("\n");
		if (all.length > 1 && all[all.length - 1] === "") all.pop();
		return all;
	}, [diff]);
	const chunks = useMemo(() => {
		if (lines.length <= WINDOW_THRESHOLD) return null;
		const out: string[][] = [];
		for (let i = 0; i < lines.length; i += CHUNK) out.push(lines.slice(i, i + CHUNK));
		return out;
	}, [lines]);
	return (
		<div
			className={`overflow-x-auto rounded-m-md border border-m-border bg-m-code-bg font-m-mono text-m-xs ${className}`}
		>
			<div className="w-max min-w-full py-1">
				{chunks
					? chunks.map((chunk, i) => (
							<div
								key={i}
								style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${chunk.length * LINE_PX}px` }}
							>
								<Lines lines={chunk} />
							</div>
						))
					: <Lines lines={lines} />}
			</div>
		</div>
	);
});
