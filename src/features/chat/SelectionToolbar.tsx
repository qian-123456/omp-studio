/** [B] Floating toolbar on text selection inside the message stream:
 * 引用 (annotation) / 在侧聊中提问 (side chat) / 记到收集箱 (quick capture). */

import { BookmarkPlus, Copy, MessageSquareQuote, MessagesSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useUi } from "../../stores/ui";
interface Sel {
	text: string;
	itemId?: string;
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
	const [isAnnotating, setIsAnnotating] = useState(false);
	const [comment, setComment] = useState("");
	const addAnnotation = useComposer((s) => s.addAnnotation);
	const focusComposer = useComposer((s) => s.focusComposer);
	const requestSideChat = useComposer((s) => s.requestSideChat);
	const setRightTab = useUi((s) => s.setRightTab);
	const openModal = useUi((s) => s.openModal);
	const boxRef = useRef<HTMLDivElement>(null);

	const commitAnnotation = () => {
		if (!sel) return;
		addAnnotation(sessionId, {
			source: "message",
			text: sel.text,
			itemId: sel.itemId,
			comment: comment.trim() || undefined,
		});
		focusComposer(sessionId);
		setSel(null);
		setIsAnnotating(false);
		setComment("");
		window.getSelection()?.removeAllRanges();
		toast.success("已添加引用");
		setTimeout(() => {
			const ta =
				document.querySelector<HTMLTextAreaElement>(
					`textarea[data-composer="${sessionId}"]`,
				) ?? document.querySelector<HTMLTextAreaElement>("textarea");
			ta?.focus();
		}, 0);
	};
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
			const node = range.commonAncestorContainer;
			const msgEl = (node instanceof Element ? node : node.parentElement)?.closest(
				'[id^="msg-"]',
			);
			const rawItemId = msgEl?.id.startsWith("msg-") ? msgEl.id.slice(4) : undefined;
			const itemId = rawItemId && rawItemId !== "live" ? rawItemId : undefined;
			setSel({
				text,
				itemId,
				x: rect.left - crect.left + rect.width / 2,
				y: rect.top - crect.top + container.scrollTop,
			});
		};
		const onDown = (e: MouseEvent) => {
			if (!boxRef.current?.contains(e.target as Node)) {
				setSel(null);
				setIsAnnotating(false);
				setComment("");
			}
		};
		const onScroll = () => {
			setSel(null);
			setIsAnnotating(false);
			setComment("");
		};
		document.addEventListener("mouseup", onUp);
		document.addEventListener("mousedown", onDown);
		container.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			document.removeEventListener("mouseup", onUp);
			document.removeEventListener("mousedown", onDown);
			container.removeEventListener("scroll", onScroll);
		};
	}, [containerRef]);

	useEffect(() => {
		if (!sel) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (isComposing({ nativeEvent: e, key: e.key })) return;
				if (isAnnotating) {
					setIsAnnotating(false);
				} else {
					setSel(null);
					window.getSelection()?.removeAllRanges();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [sel, isAnnotating]);

	if (!sel) return null;
	const itemCls =
		"flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-700";

	return (
		<div
			ref={boxRef}
			style={{ left: sel.x, top: sel.y }}
			className="absolute z-20 flex -translate-x-1/2 -translate-y-full gap-0.5 rounded-md border border-neutral-700 bg-neutral-900 p-0.5 shadow-lg"
		>
			{isAnnotating ? (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						commitAnnotation();
					}}
					className="flex items-center gap-1.5 p-1"
				>
					<input
						autoFocus
						type="text"
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Escape") {
								e.preventDefault();
								setIsAnnotating(false);
							} else if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								commitAnnotation();
							}
						}}
						placeholder="添加批注（可选，Enter 确认）…"
						className="w-48 rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
					/>
					<button
						type="button"
						onClick={commitAnnotation}
						className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-500 transition-colors"
					>
						引用
					</button>
					<button
						type="button"
						onClick={() => setIsAnnotating(false)}
						className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors"
					>
						取消
					</button>
				</form>
			) : (
				<>
					<button
						type="button"
						className={itemCls}
						onClick={async () => {
							await copyText(sel.text);
							toast.success("已复制到剪贴板");
							setSel(null);
							window.getSelection()?.removeAllRanges();
						}}
					>
						<Copy size={12} /> 复制
					</button>
					<button
						type="button"
						className={itemCls}
						onClick={() => {
							setIsAnnotating(true);
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
				</>
			)}
		</div>
	);
}
