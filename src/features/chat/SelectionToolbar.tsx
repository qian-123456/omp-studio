/** [B] Floating toolbar on text selection inside the message stream:
 * 引用 (annotation) / 在侧聊中提问 (side chat) / 记到收集箱 (quick capture). */

import { BookmarkPlus, MessageSquareQuote, MessagesSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useComposer } from "../../stores/composer";
import { useUi } from "../../stores/ui";

interface Sel {
	text: string;
	x: number;
	y: number;
}

/** Wraps the message stream; renders the floating toolbar when text is selected. */
export function SelectionToolbar({
	sessionId,
	containerRef,
}: {
	sessionId: string;
	containerRef: React.RefObject<HTMLElement | null>;
}) {
	const [sel, setSel] = useState<Sel | null>(null);
	const addAnnotation = useComposer((s) => s.addAnnotation);
	const requestSideChat = useComposer((s) => s.requestSideChat);
	const setRightTab = useUi((s) => s.setRightTab);
	const openModal = useUi((s) => s.openModal);
	const boxRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const onUp = () => {
			const s = window.getSelection();
			const text = s?.toString().trim() ?? "";
			if (!text || !s || s.rangeCount === 0) {
				setSel(null);
				return;
			}
			const range = s.getRangeAt(0);
			if (!container.contains(range.commonAncestorContainer)) {
				setSel(null);
				return;
			}
			const rect = range.getBoundingClientRect();
			const crect = container.getBoundingClientRect();
			setSel({
				text,
				x: rect.left - crect.left + rect.width / 2,
				y: rect.top - crect.top + container.scrollTop,
			});
		};
		const onDown = (e: MouseEvent) => {
			if (!boxRef.current?.contains(e.target as Node)) setSel(null);
		};
		document.addEventListener("mouseup", onUp);
		document.addEventListener("mousedown", onDown);
		return () => {
			document.removeEventListener("mouseup", onUp);
			document.removeEventListener("mousedown", onDown);
		};
	}, [containerRef]);

	if (!sel) return null;
	const itemCls =
		"flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700";

	return (
		<div
			ref={boxRef}
			style={{ left: sel.x, top: sel.y }}
			className="absolute z-20 flex -translate-x-1/2 -translate-y-full gap-0.5 rounded-md border border-neutral-700 bg-neutral-900 p-0.5 shadow-lg"
		>
			<button
				type="button"
				className={itemCls}
				onClick={() => {
					addAnnotation(sessionId, { source: "message", text: sel.text });
					setSel(null);
					window.getSelection()?.removeAllRanges();
				}}
			>
				<MessageSquareQuote size={12} /> 引用
			</button>
			<button
				type="button"
				className={itemCls}
				onClick={() => {
					requestSideChat(sessionId, sel.text);
					setRightTab("sidechat");
					setSel(null);
					window.getSelection()?.removeAllRanges();
				}}
			>
				<MessagesSquare size={12} /> 在侧聊中提问
			</button>
			<button
				type="button"
				className={itemCls}
				onClick={() => {
					openModal("quick-capture", {
						text: sel.text,
						sessionId,
					});
					setSel(null);
					window.getSelection()?.removeAllRanges();
				}}
			>
				<BookmarkPlus size={12} /> 记到收集箱
			</button>
		</div>
	);
}
