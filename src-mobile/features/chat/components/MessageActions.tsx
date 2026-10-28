import { Copy, GitBranch, Pencil, RotateCcw } from "lucide-react";
import { copyText } from "../../../core/lib/format";
import { BottomSheet, MenuRow, toast } from "../../../ui";
import type { MessageTarget } from "../ChatContext";
import type { ChatController } from "../chatStore";

const ICON = { size: 22, strokeWidth: 1.75 } as const;

/** Long-press / 「更多操作」 sheet of one message (ChatGPT-style flat menu). */
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
					<MenuRow
						icon={<Copy {...ICON} />}
						label="复制"
						onClick={done(() => {
							void copyText(t.text).then((ok) => toast(ok ? "已复制" : "复制失败", { kind: ok ? "success" : "error" }));
						})}
					/>
					{t.role === "user" && (
						<MenuRow icon={<Pencil {...ICON} />} label="编辑并重发" hint="填入输入框，作为新消息发送" onClick={done(() => controller.editResend(t.text))} />
					)}
					{t.role === "assistant" && t.canRetry && (
						<MenuRow icon={<RotateCcw {...ICON} />} label="重新生成" hint="重试上一次回合" onClick={done(() => controller.retry())} />
					)}
					{t.role === "assistant" && t.entryId && (
						<MenuRow
							icon={<GitBranch {...ICON} />}
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
