/** [B] Post-turn held-queue bar: "有 N 条暂存" + 立即发送(合并) / 继续暂存 /
 * 逐条确认 (editable, deletable, reorderable list). */

import { ArrowDown, ArrowUp, Send, X } from "lucide-react";
import { useState } from "react";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { type HeldItem, useHeldQueue } from "./heldQueue";
import { sendPrompt } from "./send";
const EMPTY_LIST: HeldItem[] = [];
export function HeldQueueBar({
	sessionId,
	streaming,
}: {
	sessionId: string;
	streaming: boolean;
}) {
	const items = useHeldQueue((s) => s.queues[sessionId] ?? EMPTY_LIST);
	const dismissed = useHeldQueue((s) => s.dismissed[sessionId] === true);
	const { update, remove, move, clear, setDismissed } = useHeldQueue();
	const [expanded, setExpanded] = useState(false);
	const [sending, setSending] = useState(false);

	if (items.length === 0 || dismissed) return null;

	const sendMerged = async () => {
		if (streaming) return;
		const currentTexts = items.map((i) => i.text.trim()).filter(Boolean);
		const merged = currentTexts.join("\n\n---\n\n");
		if (!merged) return;
		setSending(true);
		try {
			await sendPrompt(sessionId, merged);
			clear(sessionId);
			toast.success("已合并发送暂存消息");
		} catch (err) {
			if (!isResumeCancelled(err))
				toast.error(`发送失败: ${errMsg(err)}`);
		} finally {
			setSending(false);
		}
	};

	const sendOne = async (index: number) => {
		if (streaming) return;
		const item = items[index];
		if (!item || !item.text.trim()) return;
		setSending(true);
		try {
			await sendPrompt(sessionId, item.text.trim());
			remove(sessionId, index);
			toast.success("已发送暂存消息");
		} catch (err) {
			if (!isResumeCancelled(err))
				toast.error(`发送失败: ${errMsg(err)}`);
		} finally {
			setSending(false);
		}
	};

	const handleClearAll = async () => {
		const ok = await confirmDialog(
			`确定要清空全部 ${items.length} 条暂存消息吗？清空后无法恢复。`,
			{ danger: true, okLabel: "清空暂存" },
		);
		if (ok) {
			clear(sessionId);
			toast.success("已清空暂存消息");
		}
	};
	const handleRemoveOne = async (index: number) => {
		const item = items[index];
		if (!item) return;
		const preview = item.text.trim().slice(0, 30);
		const label = preview
			? `「${preview}${item.text.length > 30 ? "…" : ""}」`
			: "该条暂存消息";
		const ok = await confirmDialog(`确定要删除${label}吗？`, {
			danger: true,
			okLabel: "删除",
		});
		if (ok) {
			remove(sessionId, index);
			toast.info("已删除暂存消息");
		}
	};


	return (
		<div className="shrink-0 border-t border-neutral-800 bg-neutral-900/90 px-3 py-1.5 text-[12px] text-neutral-300 backdrop-blur-md">
			<div className="flex items-center gap-2">
				<span className="font-medium text-neutral-200">排队队列 ({items.length})</span>
				{streaming && (
					<span className="text-[11px] text-neutral-400">
						（回合进行中，将按序执行）
					</span>
				)}
				<button
					type="button"
					disabled={sending || streaming}
					onClick={() => void sendMerged()}
					title={streaming ? "回合进行中，结束后可发送" : "合并为一条并立即发送"}
					className="rounded bg-indigo-600 px-2 py-0.5 text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
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
					{expanded ? "收起" : "逐条确认"}
				</button>
				<button
					type="button"
					onClick={() => void handleClearAll()}
					className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-400 hover:bg-red-950/60 hover:text-red-300"
				>
					清空
				</button>
			</div>
			{expanded && (
				<div className="mt-1.5 flex flex-col gap-1">
					{items.map((item, i) => (
						<div
							key={item.id}
							className="flex items-start gap-1 rounded border border-neutral-800 bg-neutral-900/60 p-1"
						>
							<textarea
								value={item.text}
								onChange={(e) => update(sessionId, i, e.target.value)}
								rows={Math.min(4, item.text.split("\n").length + 1)}
								className="min-w-0 flex-1 resize-none bg-transparent px-1 py-0.5 text-[12px] text-neutral-200 outline-none"
							/>
							<div className="flex shrink-0 flex-col gap-0.5">
								<button
									type="button"
									aria-label="上移"
									title="上移"
									onClick={() => move(sessionId, i, -1)}
									className="text-neutral-500 hover:text-neutral-200"
								>
									<ArrowUp size={12} />
								</button>
								<button
									type="button"
									aria-label="下移"
									title="下移"
									onClick={() => move(sessionId, i, 1)}
									className="text-neutral-500 hover:text-neutral-200"
								>
									<ArrowDown size={12} />
								</button>
							</div>
							<button
								type="button"
								aria-label="发送此条"
								title={streaming ? "回合进行中，结束后可发送" : "发送此条"}
								disabled={sending || streaming}
								onClick={() => void sendOne(i)}
								className="shrink-0 rounded bg-indigo-700 p-1 text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<Send size={12} />
							</button>
							<button
								type="button"
								aria-label="删除此条"
								title="删除"
								onClick={() => void handleRemoveOne(i)}
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
