import { Copy, GitBranch, Pencil, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { copyText } from "../../../core/lib/format";
import { BottomSheet, toast } from "../../../ui";
import type { MessageTarget } from "../ChatContext";
import type { ChatController } from "../chatStore";

function Row({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint?: string; onClick: () => void }) {
	return (
		<button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-3 px-5 text-left active:bg-m-surface-hover">
			<span className="text-m-text-2">{icon}</span>
			<span className="min-w-0 flex-1">
				<span className="block text-m-md">{label}</span>
				{hint && <span className="block text-m-xs text-m-text-3">{hint}</span>}
			</span>
		</button>
	);
}

export function MessageActionsSheet({ target, onClose, controller }: { target: MessageTarget | null; onClose: () => void; controller: ChatController }) {
	const t = target;
	const done = (fn: () => void) => () => {
		onClose();
		fn();
	};
	return (
		<BottomSheet open={t !== null} onClose={onClose} title="消息操作">
			{t && (
				<div className="pb-2">
					<Row
						icon={<Copy size={20} />}
						label="复制"
						onClick={done(() => {
							void copyText(t.text).then((ok) => toast(ok ? "已复制" : "复制失败", { kind: ok ? "success" : "error" }));
						})}
					/>
					{t.role === "user" && (
						<Row icon={<Pencil size={20} />} label="编辑并重发" hint="填入输入框，作为新消息发送" onClick={done(() => controller.editResend(t.text))} />
					)}
					{t.role === "assistant" && t.canRetry && (
						<Row icon={<RotateCcw size={20} />} label="重新生成" hint="重试上一次回合" onClick={done(() => controller.retry())} />
					)}
					{t.role === "assistant" && t.entryId && (
						<Row
							icon={<GitBranch size={20} />}
							label="从这里分支"
							hint="复制到这条回复为止的对话，开新会话继续"
							onClick={done(() => controller.forkFrom(t.entryId as string, t.text.slice(0, 40)))}
						/>
					)}
				</div>
			)}
		</BottomSheet>
	);
}
