/** [D] Quick-ask scratchpad: one-shot `omp -p` Q&A modal, no session, no tools. */

import { Check, Copy, Loader2, MessageCircleQuestion, X } from "lucide-react";
import { Z_LAYER } from "../../components/FloatingLayer";
import { useEffect, useRef, useState } from "react";
import { copyText, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { quickAsk } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";
import { Markdown } from "../chat/markdown";

/**
 * [D] Global quick-ask modal. Always mounted; opens via `ui.modal === "quick-ask"`,
 * the sidebar header button, or Cmd+Shift+K (registered in SessionSidebar).
 */
export function QuickAskDialog() {
	const modal = useUi((s) => s.modal);
	const closeModal = useUi((s) => s.closeModal);
	const isVisible = modal?.name === "quick-ask";

	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState("");
	const [asking, setAsking] = useState(false);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Bumped per submission so a stale async result cannot clobber a newer question.
	const askSeq = useRef(0);

	const inputRef = useRef<HTMLTextAreaElement>(null);
	useEscapeKey(closeModal, isVisible);

	// Focus input on open.
	useEffect(() => {
		if (isVisible) {
			setError(null);
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [isVisible]);

	if (!isVisible) return null;

	const handleAsk = async () => {
		const q = question.trim();
		if (!q || asking) return;
		const seq = ++askSeq.current;
		setAsking(true);
		setError(null);
		try {
			const out = await quickAsk(q);
			if (askSeq.current === seq) setAnswer(out);
		} catch (err) {
			if (askSeq.current === seq) setError(errMsg(err));
		} finally {
			if (askSeq.current === seq) setAsking(false);
		}
	};

	const handleCopy = async () => {
		try {
			await copyText(answer);
			setCopied(true);
			toast.success("已复制");
			setTimeout(() => setCopied(false), 2000);
		} catch (e) {
			toast.error(`复制失败: ${errMsg(e)}`);
		}
	};

	return (
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-start justify-center bg-[var(--overlay)] pt-20 p-4 backdrop-blur-sm"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) closeModal();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="quick-ask-title"
				className="flex max-h-[min(85vh,700px)] w-[580px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl bg-[var(--bg-panel)] p-5 shadow-apple-modal hairline text-[var(--text)]"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key === "Tab") {
						const controls = Array.from(
							e.currentTarget.querySelectorAll<HTMLElement>(
								'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
							),
						).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
						if (controls.length === 0) return;
						const first = controls[0];
						const last = controls[controls.length - 1];
						if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							last?.focus();
						} else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							first?.focus();
						}
					}
				}}
			>
				<div className="mb-3 flex items-center justify-between shrink-0">
					<div className="flex items-center gap-2">
						<MessageCircleQuestion className="h-4 w-4 text-indigo-400" />
						<h2 id="quick-ask-title" className="text-sm font-semibold text-[var(--text)]">快速提问</h2>
					</div>
					<button
						type="button"
						title="关闭 (Esc)"
						aria-label="关闭对话框"
						onClick={closeModal}
						className="rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{error && (
					<div className="mb-3 shrink-0 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
						{error}
					</div>
				)}

				<textarea
					ref={inputRef}
					autoFocus
					rows={3}
					value={question}
					onChange={(e) => setQuestion(e.target.value)}
					placeholder="输入问题，Enter 提问，Shift+Enter 换行"
					className="w-full resize-none rounded-lg hairline bg-[var(--well-bg)] px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all"
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							if (isComposing(e)) return;
							void handleAsk();
						}
					}}
				/>

				<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-3">
					<button
						type="button"
						onClick={closeModal}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
					>
						取消 (Esc)
					</button>
					<button
						type="button"
						onClick={() => void handleAsk()}
						disabled={asking || !question.trim()}
						className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-40"
					>
						{asking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
						<span>{asking ? "思考中..." : "提问 (Enter)"}</span>
					</button>
				</div>

				{(asking || answer) && (
					<div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg hairline bg-[var(--well-bg)] p-3">
						{answer ? (
							<>
								<div className="mb-2 flex items-center justify-end">
									<button
										type="button"
										onClick={() => void handleCopy()}
										className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
										title="复制回答"
									>
										{copied ? (
											<>
												<Check className="h-3 w-3 text-emerald-400" />
												<span className="text-emerald-400">已复制</span>
											</>
										) : (
											<>
												<Copy className="h-3 w-3" />
												<span>复制</span>
											</>
										)}
									</button>
								</div>
								<Markdown text={answer} />
							</>
						) : (
							<div className="flex items-center gap-2 text-xs text-neutral-500">
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
								<span>正在思考...</span>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
