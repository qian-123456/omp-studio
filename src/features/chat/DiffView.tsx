/** [B] Diff renderer for toolResult.details.diff (" 38|t", "+40|t", "-41|t")
 * with line-range selection → 批注 → composer annotation (source: "diff"). */

import clsx from "clsx";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { useComposer } from "../../stores/composer";

interface DiffLine {
	kind: "ctx" | "add" | "del";
	line: number | null;
	text: string;
}

export function parseDiff(diff: string): DiffLine[] {
	const out: DiffLine[] = [];
	for (const raw of diff.split("\n")) {
		const m = /^([ +-]?)(\d*)\|(.*)$/.exec(raw);
		if (!m) {
			if (raw.trim()) out.push({ kind: "ctx", line: null, text: raw });
			continue;
		}
		const sign = m[1];
		out.push({
			kind: sign === "+" ? "add" : sign === "-" ? "del" : "ctx",
			line: m[2] ? Number(m[2]) : null,
			text: m[3],
		});
	}
	return out;
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
	// Selection is a contiguous range of rendered rows [anchor, end].
	const [anchor, setAnchor] = useState<number | null>(null);
	const [end, setEnd] = useState<number | null>(null);
	const [comment, setComment] = useState("");
	const [commenting, setCommenting] = useState(false);

	const lo = anchor !== null && end !== null ? Math.min(anchor, end) : anchor;
	const hi = anchor !== null && end !== null ? Math.max(anchor, end) : anchor;
	const selected = new Set<number>();
	if (lo !== null && hi !== null) for (let i = lo; i <= hi; i++) selected.add(i);

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

	return (
		<div className="text-[12px]">
			<div className="overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950 font-mono">
				{lines.map((l, i) => (
					<button
						key={i}
						type="button"
						onClick={() =>
							anchor === null || (end !== null && anchor !== null)
								? (setAnchor(i), setEnd(null))
								: setEnd(i)
						}
						className={clsx(
							"flex w-full text-left",
							l.kind === "add" && "bg-emerald-950/50 text-emerald-300",
							l.kind === "del" && "bg-red-950/50 text-red-300",
							l.kind === "ctx" && "text-neutral-400",
							selected.has(i) && "outline outline-1 outline-indigo-500",
						)}
					>
						<span className="w-10 shrink-0 select-none pr-2 text-right text-neutral-600">
							{l.line ?? ""}
						</span>
						<span className="w-4 shrink-0 select-none">
							{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
						</span>
						<span className="whitespace-pre-wrap break-all">{l.text}</span>
					</button>
				))}
			</div>
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
						placeholder="批注内容…"
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
							className="rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300"
						>
							取消
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
