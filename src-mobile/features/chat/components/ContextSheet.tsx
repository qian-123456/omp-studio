import { BottomSheet, Button } from "../../../ui";
import type { ChatController, ComposerState } from "../chatStore";
import { contextTone, formatContextDetail, formatContextPercent, resolveContextPercent } from "../lib/context";
import { isDraftId } from "../lib/drafts";

const TONE_BAR = { neutral: "bg-m-accent", warn: "bg-m-warn", danger: "bg-m-danger" } as const;

/** Compact sheet behind 「上下文 N%」: usage bar, what compaction does, 压缩上下文. */
export function ContextSheet({
	open,
	onClose,
	cstate,
	compacting,
	controller,
}: {
	open: boolean;
	onClose: () => void;
	cstate: ComposerState | null;
	compacting: boolean;
	controller: ChatController;
}) {
	const pct = cstate ? resolveContextPercent(cstate) : null;
	const detail = cstate ? formatContextDetail(cstate) : null;
	const draft = isDraftId(controller.id);
	return (
		<BottomSheet open={open} onClose={onClose} title="上下文用量">
			<div className="flex flex-col gap-5 px-5 pt-2 pb-5">
				<div className="rounded-m-lg bg-m-card p-5 shadow-m-card">
					<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
						<span className="text-m-display whitespace-nowrap">{formatContextPercent(pct) ?? "未知"}</span>
						<span className="text-m-sm break-words text-m-text-3">{detail ?? "会话还没有运行，暂无用量"}</span>
					</div>
					<div className="mt-4 h-2 overflow-hidden rounded-m-pill bg-m-surface-2">
						<div
							className={`h-full rounded-m-pill transition-[width] duration-(--m-dur) ease-m ${TONE_BAR[contextTone(pct)]}`}
							style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
						/>
					</div>
				</div>
				<p className="px-1 text-m-sm text-m-text-2">上下文越满，模型越容易忘记早先的内容。压缩会把较早的对话总结成摘要，腾出空间。</p>
				<Button variant="accent" block busy={compacting} disabled={draft} onClick={() => void controller.compact()}>
					{compacting ? "正在压缩上下文" : "压缩上下文"}
				</Button>
				{compacting && <p className="px-1 text-m-xs text-m-text-3">压缩可能需要几分钟，可以先关闭这里，完成后会提示。</p>}
				{draft && <p className="px-1 text-m-xs text-m-text-3">新会话还没有内容，发送第一条消息后才能压缩。</p>}
			</div>
		</BottomSheet>
	);
}
