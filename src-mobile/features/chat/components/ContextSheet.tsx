import { BottomSheet, Spinner } from "../../../ui";
import type { ChatController, ComposerState } from "../chatStore";
import { contextTone, formatContextDetail, formatContextPercent, resolveContextPercent } from "../lib/context";
import { isDraftId } from "../lib/drafts";

const TONE_BAR = { neutral: "bg-m-accent", warn: "bg-m-warn", danger: "bg-m-danger" } as const;

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
			<div className="space-y-4 px-5 pb-5 pt-1">
				<div>
					<div className="flex items-baseline justify-between gap-3">
						<span className="whitespace-nowrap text-m-title font-semibold">{formatContextPercent(pct) ?? "未知"}</span>
						<span className="text-right text-m-sm text-m-text-2">{detail ?? "暂无用量数据（会话还没有运行）"}</span>
					</div>
					<div className="mt-2 h-2 overflow-hidden rounded-m-pill bg-m-surface-2">
						<div className={`h-full ${TONE_BAR[contextTone(pct)]}`} style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
					</div>
				</div>
				<p className="text-m-sm text-m-text-2">上下文越满，模型越容易遗忘早期内容。压缩会把较早的对话总结成摘要，腾出空间。</p>
				<button
					type="button"
					disabled={compacting || draft}
					onClick={() => void controller.compact()}
					className="flex min-h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-m-pill bg-m-accent px-4 text-m-md font-medium text-m-accent-text active:opacity-80 disabled:opacity-50"
				>
					{compacting && <Spinner size={16} />}
					{compacting ? "正在压缩上下文" : "压缩上下文"}
				</button>
				{compacting && <p className="text-m-xs text-m-text-3">压缩可能需要几分钟（最长等待 15 分钟），可以关闭此面板，完成后会提示。</p>}
				{draft && <p className="text-m-xs text-m-text-3">新会话还没有内容，发送第一条消息后才能压缩。</p>}
			</div>
		</BottomSheet>
	);
}
