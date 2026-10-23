/**
 * [B] 「回传给父会话」 dialog (整理成结论 mode). The side chat writes the settled
 * conclusions after the user's click; the note is edited here and only goes to
 * the parent's composer (as a quote chip) on 「插入主对话输入框」 — never sent.
 */

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { Notice } from "../../components/Notice";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { buildHandbackText } from "./handbackLogic";
import { startHandback, useHandback } from "./handbackRun";
import { HANDBACK_MODAL, insertInParentComposer } from "./sideChatActions";

const BTN = "rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--text)] text-[var(--bg-panel)] hover:opacity-80`;
const BTN_BORDER = `${BTN} border border-[var(--line)] text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]`;

export function HandbackDialog() {
	const modal = useUi((s) => s.modal);
	const closeModal = useUi((s) => s.closeModal);
	const childId = modal?.name === HANDBACK_MODAL && typeof modal.props.childId === "string" ? modal.props.childId : null;
	const run = useHandback((s) => (childId ? s.runs[childId] : undefined));
	const title = useSessions((s) => (childId ? s.sessions[childId]?.title : undefined));
	const [withTranscript, setWithTranscript] = useState(false);

	if (!childId) return null;
	const phase = run?.phase ?? "running";

	const insert = () => {
		if (!run) return;
		const text = buildHandbackText(run.draft, withTranscript ? run.transcript : null);
		if (!insertInParentComposer(childId, text)) {
			toast.error("没有可插入的内容或找不到父会话");
			return;
		}
		closeModal();
		toast.success("已放进主对话输入框，补充几句后再发送");
	};

	return (
		<FloatingLayer
			anchor={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
			placement="center"
			layer="modal"
			onDismiss={closeModal}
			aria-label="回传给父会话"
			className="flex max-h-[calc(100vh-4rem)] w-[560px] max-w-[calc(100vw-2rem)] flex-col gap-3 p-5 shadow-apple-modal"
		>
			<h3 className="text-sm font-semibold text-[var(--text)]">回传给父会话</h3>
			{phase === "running" && (
				<div className="flex items-center gap-2 py-6 text-xs text-[var(--text-60)]">
					<Loader2 size={14} className="animate-spin" />
					辅助对话正在整理结论…关掉这个窗口也会继续，整理的指令会留在辅助对话里。
				</div>
			)}
			{phase === "error" && (
				<Notice tone="danger">
					<span className="whitespace-pre-wrap break-words">整理失败：{run?.error}</span>
				</Notice>
			)}
			{phase === "ready" && run && (
				<>
					<p className="text-[11px] text-[var(--text-40)]">
						下面是辅助对话整理出的结论，可以直接修改。确认后放进主对话输入框，不会自动发送。
					</p>
					<textarea
						value={run.draft}
						onChange={(e) => useHandback.getState().set(childId, { draft: e.target.value })}
						rows={12}
						aria-label="回传内容"
						className="min-h-40 w-full flex-1 resize-y rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2.5 text-xs leading-relaxed text-[var(--text)] outline-none focus:border-[var(--text-30)]"
					/>
					<label className="flex items-center gap-2 text-xs text-[var(--text-60)]">
						<input
							type="checkbox"
							checked={withTranscript}
							onChange={(e) => setWithTranscript(e.target.checked)}
						/>
						同时附上完整对话
					</label>
				</>
			)}
			<div className="flex items-center justify-between gap-2">
				<span className="min-w-0 truncate text-[11px] text-[var(--text-30)]">
					{title ? `辅助对话：${title}` : ""}
				</span>
				<div className="flex shrink-0 items-center gap-2">
					<button type="button" onClick={closeModal} className={BTN_BORDER}>
						取消
					</button>
					<button
						type="button"
						disabled={phase === "running"}
						onClick={() => void startHandback(childId)}
						className={BTN_BORDER}
					>
						重新整理
					</button>
					{phase === "ready" && (
						<button type="button" disabled={!run?.draft.trim()} onClick={insert} className={BTN_PRIMARY}>
							插入主对话输入框
						</button>
					)}
				</div>
			</div>
		</FloatingLayer>
	);
}
