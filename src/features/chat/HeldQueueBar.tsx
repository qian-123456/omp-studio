/** [B] Post-turn held-queue bar: "有 N 条暂存" + 立即发送(合并) / 继续暂存 /
 * 逐条确认 (editable, deletable, reorderable list). */

import { ArrowDown, ArrowUp, Check, Send, X } from "lucide-react";
import { useState } from "react";
import { useHeldQueue } from "./heldQueue";
import { sendPrompt } from "./send";

export function HeldQueueBar({
	sessionId,
	streaming,
}: {
	sessionId: string;
	streaming: boolean;
}) {
	const items = useHeldQueue((s) => s.queues[sessionId] ?? []);
	const dismissed = useHeldQueue((s) => s.dismissed[sessionId] === true);
	const { update, remove, move, drain, setDismissed } = useHeldQueue();
	const [expanded, setExpanded] = useState(false);
	const [sending, setSending] = useState(false);

	if (streaming || items.length === 0 || dismissed) return null;

	const sendMerged = async () => {
		const merged = drain(sessionId).join("\n\n");
		if (!merged) return;
		setSending(true);
		try {
			await sendPrompt(sessionId, merged);
		} finally {
			setSending(false);
		}
	};

	const sendOne = async (index: number) => {
		const text = items[index];
		if (!text) return;
		setSending(true);
		try {
			await sendPrompt(sessionId, text);
			remove(sessionId, index);
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="shrink-0 border-t border-amber-800/50 bg-amber-950/20 px-3 py-1.5 text-[12px]">
			<div className="flex items-center gap-2">
				<span className="text-amber-300">有 {items.length} 条暂存</span>
				<button
					type="button"
					disabled={sending}
					onClick={() => void sendMerged()}
					className="rounded bg-indigo-600 px-2 py-0.5 text-white hover:bg-indigo-500 disabled:opacity-50"
				>
					立即发送(合并为一条)
				</button>
				<button
					type="button"
					onClick={() => setDismissed(sessionId, true)}
					className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-300 hover:bg-neutral-700"
				>
					继续暂存
				</button>
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-300 hover:bg-neutral-700"
				>
					逐条确认
				</button>
			</div>
			{expanded && (
				<div className="mt-1.5 flex flex-col gap-1">
					{items.map((text, i) => (
						<div
							key={`${i}-${text.length}`}
							className="flex items-start gap-1 rounded border border-neutral-800 bg-neutral-900/60 p-1"
						>
							<textarea
								value={text}
								onChange={(e) => update(sessionId, i, e.target.value)}
								rows={Math.min(4, text.split("\n").length + 1)}
								className="min-w-0 flex-1 resize-none bg-transparent px-1 py-0.5 text-[12px] text-neutral-200 outline-none"
							/>
							<div className="flex shrink-0 flex-col gap-0.5">
								<button
									type="button"
									title="上移"
									onClick={() => move(sessionId, i, -1)}
									className="text-neutral-500 hover:text-neutral-200"
								>
									<ArrowUp size={12} />
								</button>
								<button
									type="button"
									title="下移"
									onClick={() => move(sessionId, i, 1)}
									className="text-neutral-500 hover:text-neutral-200"
								>
									<ArrowDown size={12} />
								</button>
							</div>
							<button
								type="button"
								title="发送此条"
								disabled={sending}
								onClick={() => void sendOne(i)}
								className="shrink-0 rounded bg-indigo-700 p-1 text-white hover:bg-indigo-600 disabled:opacity-50"
							>
								{i === 0 ? <Send size={12} /> : <Check size={12} />}
							</button>
							<button
								type="button"
								title="删除"
								onClick={() => remove(sessionId, i)}
								className="shrink-0 p-1 text-neutral-500 hover:text-red-400"
							>
								<X size={12} />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
