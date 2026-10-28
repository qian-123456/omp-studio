import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../../../core/lib/format";
import { nav, paths } from "../../../core/nav";
import { toast } from "../../../ui";
import { useChatUi } from "../ChatContext";
import { quoteMarkdown } from "../chatStore";

const BAR_H = 44;
const GAP = 12;
const EDGE = 12;

interface SelectionData {
	text: string;
	top: number;
}

/**
 * Floating capsule toolbar for a text selection inside the thread: 批注到主对话 / 批注到辅助对话 / 复制. It sits
 * below the selection (the system selection menu stays above it) and never steals the selection: buttons cancel
 * pointerdown so the native range survives until an action runs.
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
		const vh = window.visualViewport?.height ?? window.innerHeight;
		const below = rect.bottom + GAP;
		const top = below + BAR_H < vh - EDGE ? below : Math.max(EDGE, rect.top - GAP - BAR_H);
		setSel({ text, top });
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
		"flex h-11 items-center whitespace-nowrap rounded-m-pill px-4 text-m-sm text-m-text active:bg-m-surface-hover";
	return (
		<div
			role="toolbar"
			aria-label="批注选中的文字"
			style={{ top: sel.top }}
			className="pointer-events-none fixed inset-x-0 z-(--z-banner) flex justify-center px-3"
		>
			<div
				onPointerDown={(e) => e.preventDefault()}
				className="pointer-events-auto flex max-w-full items-center rounded-m-pill bg-m-bg-elev p-0.5 shadow-m-pop"
			>
				<button type="button" className={item} onClick={toMain}>
					批注到主对话
				</button>
				<button type="button" className={item} onClick={toSide}>
					批注到辅助对话
				</button>
				<button type="button" className={item} onClick={() => void copy()} aria-label="复制选中文字">
					复制
				</button>
			</div>
		</div>
	);
}
