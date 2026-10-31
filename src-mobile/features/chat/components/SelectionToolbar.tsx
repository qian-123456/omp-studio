import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyText } from "../../../core/lib/format";
import { nav, paths } from "../../../core/nav";
import { toast } from "../../../ui";
import { useChatUi } from "../ChatContext";
import { quoteMarkdown } from "../chatStore";

interface SelectionData {
	text: string;
}

/**
 * Capsule actions for a thread text selection, fixed above the composer and keyboard rather than
 * beside the native selection menu. A body portal keeps keyboard offsets in layout-viewport
 * coordinates; pointerdown cancellation preserves the native range until an action runs.
 */
export function SelectionToolbar({
	containerRef,
	sessionId,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
	sessionId: string;
}) {
	const { controller } = useChatUi();
	const [sel, setSel] = useState<SelectionData | null>(null);
	const pending = useRef(0);

	const check = useCallback(() => {
		const s = window.getSelection();
		const container = containerRef.current;
		if (!s || s.isCollapsed || !s.rangeCount || !container) {
			setSel(null);
			return;
		}
		const range = s.getRangeAt(0);
		const text = s.toString().trim();
		if (!text || !container.contains(range.commonAncestorContainer)) {
			setSel(null);
			return;
		}
		const rect = range.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) {
			setSel(null);
			return;
		}
		setSel({ text });
	}, [containerRef]);

	useEffect(() => {
		// Coalesce the selectionchange storm while handles are dragged.
		const schedule = () => {
			window.clearTimeout(pending.current);
			pending.current = window.setTimeout(check, 120);
		};
		document.addEventListener("selectionchange", schedule);
		return () => {
			document.removeEventListener("selectionchange", schedule);
			window.clearTimeout(pending.current);
		};
	}, [check]);

	if (!sel) return null;

	const finish = () => {
		window.getSelection()?.removeAllRanges();
		setSel(null);
	};

	const toMain = () => {
		controller.stageAnnotation(sel.text);
		finish();
	};

	const toSide = () => {
		try {
			sessionStorage.setItem(`omp:sidechat-draft:${sessionId}`, `${quoteMarkdown(sel.text)}\n\n`);
		} catch {
			/* storage unavailable: the side chat simply opens empty */
		}
		finish();
		nav.push(paths.sidechat(sessionId));
	};

	const copy = async () => {
		const ok = await copyText(sel.text);
		toast(ok ? "已复制" : "复制失败", { kind: ok ? "success" : "error" });
		finish();
	};

	const item =
		"flex min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-m-pill px-3 text-m-sm text-m-text active:bg-m-surface-hover";
	return createPortal(
		<div
			role="toolbar"
			aria-label="批注选中的文字"
			style={{ bottom: "calc(var(--m-safe-bottom) + var(--m-kb, 0px) + 72px)" }}
			className="pointer-events-none fixed inset-x-0 z-(--z-banner) flex justify-center px-3"
		>
			<div
				onPointerDown={(e) => e.preventDefault()}
				className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center rounded-m-pill bg-m-bg-elev p-0.5 shadow-m-pop"
			>
				<button type="button" className={item} onClick={toMain} aria-label="批注到主对话">
					主对话
				</button>
				<button type="button" className={item} onClick={toSide} aria-label="批注到辅助对话">
					辅助对话
				</button>
				<button type="button" className={item} onClick={() => void copy()} aria-label="复制选中文字">
					复制
				</button>
			</div>
		</div>,
		document.body,
	);
}
