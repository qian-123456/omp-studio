import clsx from "clsx";
import { MessageSquarePlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useComposer } from "../../stores/composer";
import { useUi } from "../../stores/ui";
import { type DiffLine, describeSelection, parseUnifiedDiff } from "./diff";

const ROW_STYLE: Record<DiffLine["kind"], string> = {
	add: "bg-emerald-950/60 text-emerald-200",
	del: "bg-rose-950/60 text-rose-200",
	ctx: "text-neutral-300",
	hunk: "bg-indigo-950/50 text-indigo-300",
	meta: "text-neutral-500",
};

/**
 * Full-screen diff viewer. Click a line, shift-click another to select a
 * range, then "批注" adds a diff annotation to the selected session.
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
	const sessionId = useUi((s) => s.selectedSessionId);
	const addAnnotation = useComposer((s) => s.addAnnotation);

	useEffect(() => {
		load()
			.then(setText)
			.catch((e) => setError(String(e)));
	}, [load]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const lines = useMemo(() => (text ? parseUnifiedDiff(text) : []), [text]);
	const inSel = (i: number) => sel && i >= Math.min(...sel) && i <= Math.max(...sel);

	const onLineClick = (i: number, shift: boolean) => {
		const l = lines[i];
		if (l.kind === "meta" || l.kind === "hunk") return;
		setSel(shift && sel ? [sel[0], i] : [i, i]);
	};

	const submit = () => {
		if (!sel || !sessionId) return;
		const d = describeSelection(lines, sel[0], sel[1]);
		addAnnotation(sessionId, { source: "diff", ...d, comment: comment.trim() || undefined });
		setNote(`已添加批注${d.file ? `：${d.file}` : ""}${d.lines ? ` 第 ${d.lines} 行` : ""}`);
		setSel(null);
		setComment("");
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
			<div
				className="flex h-full max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
					<span className="min-w-0 flex-1 truncate font-mono text-neutral-200">{title}</span>
					{note && <span className="text-xs text-emerald-400">{note}</span>}
					<button type="button" onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-800">
						<X size={16} />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-5">
					{error && <div className="p-3 text-rose-400">{error}</div>}
					{text === null && !error && <div className="p-3 text-neutral-500">加载中…</div>}
					{text !== null && lines.length === 0 && <div className="p-3 text-neutral-500">没有差异</div>}
					{lines.map((l, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: static diff lines
							key={i}
							onClick={(e) => onLineClick(i, e.shiftKey)}
							className={clsx(
								"flex cursor-default whitespace-pre",
								ROW_STYLE[l.kind],
								inSel(i) && "outline outline-1 outline-amber-400/70",
							)}
						>
							<span className="w-10 shrink-0 select-none pr-1 text-right text-neutral-600">{l.oldNo ?? ""}</span>
							<span className="w-10 shrink-0 select-none pr-2 text-right text-neutral-600">{l.newNo ?? ""}</span>
							<span className="select-none pr-1 text-neutral-600">
								{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
							</span>
							<span>{l.text}</span>
						</div>
					))}
				</div>
				{sel && (
					<div className="flex items-end gap-2 border-t border-neutral-800 p-2">
						{sessionId ? (
							<>
								<textarea
									value={comment}
									onChange={(e) => setComment(e.target.value)}
									placeholder="对所选行的批注（会附加到当前会话的输入框）"
									rows={2}
									className="min-w-0 flex-1 resize-none rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200 outline-none focus:border-indigo-500"
								/>
								<button
									type="button"
									onClick={submit}
									className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500"
								>
									<MessageSquarePlus size={14} /> 批注
								</button>
							</>
						) : (
							<span className="text-xs text-neutral-500">先在左侧选择一个会话，才能添加批注</span>
						)}
						<button type="button" onClick={() => setSel(null)} className="px-2 py-1.5 text-xs text-neutral-400">
							取消
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
