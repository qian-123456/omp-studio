import { memo, useMemo } from "react";
import { CodeBlock } from "./CodeBlock";

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

export const DiffView = memo(function DiffView({
	diff,
	className = "",
	lineNumbers = false,
}: {
	diff: string;
	className?: string;
	lineNumbers?: boolean;
}) {
	const content = useMemo(() => {
		const lines = diff.split("\n");
		if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
		return lines.flatMap((line, index) => [
			<span key={index} className={`inline-block min-w-full ${KIND_CLASS[classifyDiffLine(line)]}`}>
				{line || " "}
			</span>,
			index < lines.length - 1 ? "\n" : null,
		]);
	}, [diff]);
	return (
		<CodeBlock code={diff} lang="diff" className={className} lineNumbers={lineNumbers}>
			{content}
		</CodeBlock>
	);
});
