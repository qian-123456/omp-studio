import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { nav, paths } from "../../../core/nav";
import { toast } from "../../../ui";
import { useChatUi } from "../ChatContext";

type Target = "main" | "sidechat";

interface SelectionData {
	text: string;
	top: number;
	left: number;
	width: number;
}

export function SelectionToolbar({
	containerRef,
	sessionId,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
	sessionId: string;
}) {
	const { controller } = useChatUi();
	const [sel, setSel] = useState<SelectionData | null>(null);
	const [target, setTarget] = useState<Target>("main");
	const [comment, setComment] = useState("");
	const [commenting, setCommenting] = useState(false);
	const commentingRef = useRef(false);
	commentingRef.current = commenting;
	const bubbleRef = useRef<HTMLDivElement | null>(null);

	const clear = useCallback(() => {
		setSel(null);
		setCommenting(false);
		setComment("");
	}, []);

	const checkSelection = useCallback(() => {
		if (commentingRef.current) return;
		const s = window.getSelection();
		if (!s || s.isCollapsed || !s.rangeCount) {
			setSel(null);
			return;
		}
		const container = containerRef.current;
		if (!container) return;

		const range = s.getRangeAt(0);
		// Check that the selection is inside container
		if (!container.contains(range.commonAncestorContainer)) {
			setSel(null);
			return;
		}

		const text = s.toString().trim();
		if (!text) {
			setSel(null);
			return;
		}

		const rect = range.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) {
			setSel(null);
			return;
		}

		// Calculate position: above selection if room, otherwise below
		const spaceAbove = rect.top;
		const bubbleHeight = 120;
		const top = spaceAbove > bubbleHeight + 10 ? rect.top - bubbleHeight - 6 : rect.bottom + 6;
		const left = Math.max(12, Math.min(window.innerWidth - 290, rect.left + rect.width / 2 - 140));

		setSel({
			text,
			top: Math.max(10, top),
			left,
			width: Math.min(280, window.innerWidth - 24),
		});
	}, [containerRef]);

	useEffect(() => {
		const handleSelectionChange = () => {
			checkSelection();
		};

		const handlePointerUp = () => {
			// Small timeout to let selection settle on touch devices
			setTimeout(checkSelection, 50);
		};

		document.addEventListener("selectionchange", handleSelectionChange);
		document.addEventListener("pointerup", handlePointerUp);
		return () => {
			document.removeEventListener("selectionchange", handleSelectionChange);
			document.removeEventListener("pointerup", handlePointerUp);
		};
	}, [checkSelection]);

	const submit = () => {
		if (!sel) return;
		const quote = sel.text;
		const c = comment.trim();

		if (target === "main") {
			controller.stageAnnotation(quote, c);
			toast("已将批注添加到主对话输入框", { kind: "success" });
		} else {
			// Side chat
			const formatted = c ? `> ${quote}\n\n${c}` : `> ${quote}\n\n`;
			try {
				sessionStorage.setItem(`omp:sidechat-draft:${sessionId}`, formatted);
			} catch {
				/* ignore */
			}
			toast("已发送到辅助对话", { kind: "success" });
			nav.push(paths.sidechat(sessionId));
		}

		// Clear selection natively without preventing browser defaults
		const s = window.getSelection();
		if (s) s.removeAllRanges();
		clear();
	};

	if (!sel) return null;

	return (
		<div
			ref={bubbleRef}
			role="dialog"
			aria-label="文本批注"
			style={{
				position: "fixed",
				top: sel.top,
				left: sel.left,
				width: sel.width,
				zIndex: 50,
			}}
			className="rounded-m-lg border border-m-border bg-m-bg-elev p-2.5 shadow-m-pop transition-all animate-in fade-in"
		>
			<div className="mb-2 flex items-center justify-between gap-1">
				<div className="flex items-center gap-1" role="radiogroup" aria-label="批注目标">
					<button
						type="button"
						role="radio"
						aria-checked={target === "main"}
						onClick={() => setTarget("main")}
						className={`flex h-7 items-center gap-1 rounded-m-pill px-2.5 text-m-xs font-medium ${
							target === "main" ? "bg-m-accent text-m-accent-text" : "bg-m-surface text-m-text-2 active:bg-m-surface-hover"
						}`}
					>
						主对话
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={target === "sidechat"}
						onClick={() => setTarget("sidechat")}
						className={`flex h-7 items-center gap-1 rounded-m-pill px-2.5 text-m-xs font-medium ${
							target === "sidechat"
								? "bg-m-accent text-m-accent-text"
								: "bg-m-surface text-m-text-2 active:bg-m-surface-hover"
						}`}
					>
						辅助对话
					</button>
				</div>
				<button
					type="button"
					aria-label="关闭"
					onClick={clear}
					className="flex h-7 w-7 items-center justify-center rounded-full text-m-text-3 active:bg-m-surface-hover"
				>
					<X size={14} />
				</button>
			</div>

			<div className="mb-2 max-h-12 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-m-surface px-2 py-1 font-m-mono text-m-xs text-m-text-2">
				“{sel.text}”
			</div>

			<input
				type="text"
				value={comment}
				onFocus={() => setCommenting(true)}
				onChange={(e) => setComment(e.target.value)}
				placeholder="写下你的批注（可选）…"
				className="mb-2 min-h-8 w-full rounded-m-md border border-m-border bg-m-bg px-2.5 text-m-xs text-m-text outline-none placeholder:text-m-text-3 focus:border-m-accent"
			/>

			<div className="flex items-center justify-end gap-1.5">
				<button
					type="button"
					onClick={clear}
					className="flex h-7 items-center rounded-m-pill px-2.5 text-m-xs text-m-text-3 active:bg-m-surface-hover"
				>
					取消
				</button>
				<button
					type="button"
					onClick={submit}
					className="flex h-7 items-center gap-1 rounded-m-pill bg-m-accent px-3 text-m-xs font-medium text-m-accent-text active:opacity-80"
				>
					<Check size={12} />
					引用发送
				</button>
			</div>
		</div>
	);
}
