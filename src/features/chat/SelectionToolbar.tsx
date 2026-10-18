/** [B] Floating bubble on text selection inside the message stream:
 * 批注 (quote annotation: a multi-line comment box; in the main chat a segmented
 * control picks the main or side-chat composer, inside a side chat it always
 * stages into that side chat's own composer; dismissing it with a
 * non-empty comment silently stages that comment as an annotation — Esc is
 * the only explicit discard) / 记到收集箱 (quick capture). */

import { ArrowUp, BookmarkPlus, CornerUpLeft, MessageSquareQuote } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { SelectionBubble } from "../../components/SelectionBubble";
import { isComposing } from "../../lib/hooks";
import { Segmented } from "../../components/Segmented";
import { type AnnotationTarget, useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { resolveAnnotationKey, revealSideChatFor } from "../sidechat/annotationRoute";
import { MAX_SIDE_CHAT_DEPTH } from "../sidechat/depth";
import { useSideChatView } from "../sidechat/viewStore";
import { decideEnterKey } from "./sendKeys";
import { showSendToMainBubbleAction } from "../sidechat/handbackLogic";
import { stageInParent } from "../sidechat/sideChatActions";
import { useDisplayPrefs } from "../../stores/displayPrefs";
import { claimEscape } from "../../lib/escapeClaim";

/** Custom Highlight API name painting the quoted text while its comment is typed. */
const PENDING_HIGHLIGHT = "annotation-pending";

/** Tallest the comment box grows before it scrolls instead of expanding. */
const COMMENT_MAX_HEIGHT = 160;

interface Sel {
	text: string;
	itemId?: string;
	/** Viewport-space bounding rect of the selection; re-measured on scroll while commenting. */
	rect: DOMRect;
	/** Detached copy of the selected range: the browser selection moves into the comment input. */
	range: Range;
}

function BubbleAction({
	icon,
	label,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex h-7 items-center gap-1 whitespace-nowrap rounded px-2 text-[12px] text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
		>
			<span className="shrink-0 opacity-70">{icon}</span>
			{label}
		</button>
	);
}

/** Wraps the message stream; renders the floating bubble when text is selected. */
export function SelectionToolbar({
	sessionId,
	containerRef,
	compact = false,
}: {
	sessionId: string;
	containerRef: React.RefObject<HTMLElement | null>;
	/** Rendered inside the right-hand side-chat panel: no target choice, annotations stay in this chat. */
	compact?: boolean;
}) {
	const [sel, setSel] = useState<Sel | null>(null);
	const [commenting, setCommenting] = useState(false);
	const [draft, setDraft] = useState("");
	const addAnnotation = useComposer((s) => s.addAnnotation);
	const focusComposer = useComposer((s) => s.focusComposer);
	const annotationTarget = useComposer((s) => s.annotationTarget);
	const setAnnotationTarget = useComposer((s) => s.setAnnotationTarget);
	// Where the text was selected decides the target: the right-panel side chat has no choice;
	// the main area (even when it shows a side-chat session) offers 主对话/辅助对话.
	const inSideChat = compact;
	const isSideKind = useSessions((s) => s.sessions[sessionId]?.kind === "side");
	const tooDeep = useSessions(
		(s) => (s.sessions[sessionId]?.forkDepth ?? 0) >= MAX_SIDE_CHAT_DEPTH,
	);
	const openModal = useUi((s) => s.openModal);
	const handbackMode = useDisplayPrefs((s) => s.sideChatHandback);
	const showSendToMain = showSendToMainBubbleAction(handbackMode, isSideKind);
	const boxRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const selRef = useRef<Sel | null>(null);
	selRef.current = sel;
	// Dismissal runs from native listeners; refs give it the latest snapshot
	// even when it fires inside the same event that just updated the draft.
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const commentingRef = useRef(commenting);
	commentingRef.current = commenting;

	const clearSel = useCallback(() => {
		// Snapshot-clear synchronously: a second dismiss in the same event (e.g.
		// send's click followed by mouseup) must see "nothing open" and no-op.
		selRef.current = null;
		draftRef.current = "";
		commentingRef.current = false;
		setSel(null);
		setCommenting(false);
		setDraft("");
	}, []);

	// A depth-capped parent cannot fork another side chat: fall back to main.
	const target: AnnotationTarget = tooDeep ? "main" : annotationTarget;
	const destKey = useCallback(
		() =>
			resolveAnnotationKey({
				sessionId,
				inSideChat,
				target: tooDeep ? "main" : useComposer.getState().annotationTarget,
				view: useSideChatView.getState(),
			}),
		[sessionId, inSideChat, tooDeep],
	);


	/** Quote + typed comment staged into the composer (no focus side-effects). */
	const stageDraft = useCallback(() => {
		const sel = selRef.current;
		const comment = draftRef.current.trim();
		if (!sel || !commentingRef.current || !comment) return;
		const body = {
			source: "message" as const,
			text: sel.text,
			itemId: sel.itemId,
			comment,
		};
		const dest = destKey();
		useComposer.getState().addAnnotation(dest, body);
		if (dest !== sessionId) revealSideChatFor(sessionId);
	}, [destKey, sessionId]);

	/**
	 * Close the bubble. `mode` = "discard" never stages (Esc, send, capture);
	 * "stage" (any other dismissal while a non-empty comment box was open)
	 * silently keeps the typed comment as an annotation.
	 */
	const dismiss = useCallback(
		(mode: "stage" | "discard" = "stage") => {
			if (mode === "stage") stageDraft();
			clearSel();
			const cur = window.getSelection();
			if (cur && !cur.isCollapsed && containerRef.current?.contains(cur.anchorNode)) {
				cur.removeAllRanges();
			}
		},
		[clearSel, stageDraft, containerRef],
	);

	const startComment = () => {
		setDraft("");
		setCommenting(true);
	};

	const submitQuote = () => {
		if (!sel) return;
		const comment = draft.trim();
		const body = {
			source: "message" as const,
			text: sel.text,
			itemId: sel.itemId,
			comment: comment || undefined,
		};
		// Main chat: the remembered target; inside a side chat: always its own composer.
		const dest = destKey();
		addAnnotation(dest, body);
		if (dest !== sessionId) revealSideChatFor(sessionId);
		focusComposer(dest);
		dismiss("discard");
		// Staged into another chat's composer: that panel focuses itself via focusNonce.
		if (dest !== sessionId) return;
		setTimeout(() => {
			const ta =
				document.querySelector<HTMLTextAreaElement>(
					`textarea[data-composer="${sessionId}"]`,
				) ?? document.querySelector<HTMLTextAreaElement>("textarea");
			ta?.focus();
		}, 0);
	};
	// Move focus into the comment input once it is shown (the bubble is already
	// positioned at this point, so the input is focusable).
	useEffect(() => {
		if (commenting) inputRef.current?.focus();
	}, [commenting]);

	// Auto-growing comment box: one line tall at first, expands with the text
	// up to COMMENT_MAX_HEIGHT, then scrolls (mirrors the main Composer).
	useEffect(() => {
		const ta = inputRef.current;
		if (!commenting || !ta) return;
		ta.style.height = "auto";
		ta.style.height = `${Math.min(ta.scrollHeight, COMMENT_MAX_HEIGHT)}px`;
		ta.style.overflowY = ta.scrollHeight > COMMENT_MAX_HEIGHT ? "auto" : "hidden";
	}, [commenting, draft]);

	// Paint the quoted text while the comment is typed; the Highlight is
	// removed on dismiss/unmount via the effect cleanup.
	const pendingRange = commenting ? sel?.range : undefined;
	useEffect(() => {
		if (!pendingRange || typeof CSS === "undefined" || !("highlights" in CSS)) return;
		CSS.highlights.set(PENDING_HIGHLIGHT, new Highlight(pendingRange));
		return () => {
			CSS.highlights.delete(PENDING_HIGHLIGHT);
		};
	}, [pendingRange]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let pressStartedOutside = false;
		const isInteractiveInput = (node: EventTarget | null) => {
			if (!(node instanceof Element)) return false;
			return (
				node instanceof HTMLInputElement ||
				node instanceof HTMLTextAreaElement ||
				(node instanceof HTMLElement && node.isContentEditable) ||
				Boolean(node.closest("input, textarea, [data-composer]"))
			);
		};
		const onUp = (e: MouseEvent) => {
			if (isInteractiveInput(e.target)) return;
			// Focusing the comment input moves the browser selection into it; that
			// must not re-derive (or clear) the captured selection.
			if (boxRef.current?.contains(e.target as Node)) return;
			if (boxRef.current?.contains(document.activeElement)) return;
			// A press that began outside the stream is never a new stream selection.
			// If the browser kept the old selection anyway, drop it now.
			if (pressStartedOutside) {
				pressStartedOutside = false;
				const cur = window.getSelection();
				if (cur && !cur.isCollapsed && cur.anchorNode && container.contains(cur.anchorNode)) {
					cur.removeAllRanges();
				}
				dismiss("stage");
				return;
			}
			const s = window.getSelection();
			const text = s?.toString().trim() ?? "";
			if (!text || !s || s.rangeCount === 0) {
				dismiss("stage");
				return;
			}
			const range = s.getRangeAt(0);
			if (!container.contains(range.commonAncestorContainer)) {
				dismiss("stage");
				return;
			}
			const rect = range.getBoundingClientRect();
			const node = range.commonAncestorContainer;
			const msgEl = (node instanceof Element ? node : node.parentElement)?.closest(
				'[id^="msg-"]',
			);
			const rawItemId = msgEl?.id.startsWith("msg-") ? msgEl.id.slice(4) : undefined;
			const itemId = rawItemId && rawItemId !== "live" ? rawItemId : undefined;
			setSel({ text, itemId, rect, range: range.cloneRange() });
		};
		const onDown = (e: Event) => {
			if (isInteractiveInput(e.target)) return;
			const inBox = boxRef.current?.contains(e.target as Node) ?? false;
			pressStartedOutside = !inBox && !container.contains(e.target as Node);
			if (inBox) return;
			// A click on non-selectable blank space leaves the old selection in
			// place (and the following mouseup would re-show the bubble for it).
			// The bubble may already be gone (e.g. closed by scrolling) while the
			// browser selection lingers, so key off the selection itself.
			const s = window.getSelection();
			if (
				s &&
				!s.isCollapsed &&
				((s.anchorNode && container.contains(s.anchorNode)) ||
					(s.focusNode && container.contains(s.focusNode)))
			) {
				s.removeAllRanges();
			}
			dismiss("stage");
		};
		const onScroll = () => {
			const cur = selRef.current;
			if (!cur) return;
			// Never close while the comment is being typed: re-anchor to the moved text.
			if (boxRef.current?.contains(document.activeElement)) {
				setSel({ ...cur, rect: cur.range.getBoundingClientRect() });
				return;
			}
			dismiss("stage");
		};
		// Capture on window: runs before any element (or React handler) can stop
		// propagation, so no kind of blank area can swallow the dismissal.
		document.addEventListener("mouseup", onUp);
		window.addEventListener("mousedown", onDown, true);
		window.addEventListener("pointerdown", onDown, true);
		container.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			document.removeEventListener("mouseup", onUp);
			window.removeEventListener("mousedown", onDown, true);
			window.removeEventListener("pointerdown", onDown, true);
			container.removeEventListener("scroll", onScroll);
		};
	}, [containerRef, dismiss]);

	useEffect(() => {
		if (!sel) return;
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Escape" || isComposing({ nativeEvent: e, key: e.key })) return;
			// Claim the key so it does not also abort a running turn.
			claimEscape(e);
			// Esc is an explicit discard: a typed comment is dropped, not staged.
			dismiss("discard");
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [sel, dismiss]);

	if (!sel) return null;

	return (
		<SelectionBubble anchor={sel.rect} ref={boxRef}>
			{commenting ? (
				<div className={inSideChat ? "flex items-end gap-1.5 px-1.5 py-1" : "flex flex-col gap-1.5 px-1.5 py-1"}>
					<textarea
						ref={inputRef}
						rows={1}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key !== "Enter") return;
							// Same keys as the main Composer's "enter" mode: Enter sends,
							// Shift+Enter (and IME composition) stay a newline.
							const decision = decideEnterKey(
								{
									key: e.key,
									shiftKey: e.shiftKey,
									metaKey: e.metaKey,
									ctrlKey: e.ctrlKey,
									altKey: e.altKey,
									isComposing: isComposing(e),
								},
								"enter",
							);
							if (decision === "send" || decision === "send-alternate") {
								e.preventDefault();
								submitQuote();
							}
						}}
						placeholder="添加批注（Enter 发送，Shift+Enter 换行）…"
						aria-label="添加批注"
						className={`min-w-0 resize-none rounded-xl bg-transparent px-2.5 py-1.5 text-[12px] leading-[1.4] text-[var(--text)] outline-none placeholder:text-[var(--text-30)] ${inSideChat ? "w-60" : "w-72"}`}
					/>
					<div className={inSideChat ? "flex shrink-0 items-center pb-1" : "flex items-center justify-between gap-3 px-1 pb-0.5"}>
						{!inSideChat && (
							<Segmented<AnnotationTarget>
								size="sm"
								pill
								aria-label="批注目标"
								value={target}
								onChange={setAnnotationTarget}
								options={[
									{ value: "main", label: "主对话", title: "批注进入主会话输入框" },
									{
										value: "sidechat",
										label: "辅助对话",
										title: tooDeep
											? `已达侧聊嵌套上限（${MAX_SIDE_CHAT_DEPTH} 层）`
											: "批注暂存到右侧辅助对话输入框",
										disabled: tooDeep,
									},
								]}
							/>
						)}
						<button
							type="button"
							aria-label="确认批注"
							title="确认批注 (Enter)"
							onClick={submitQuote}
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg-panel)] transition-opacity hover:opacity-80"
						>
							<ArrowUp size={13} strokeWidth={2.5} />
						</button>
					</div>
				</div>
			) : (
				<>
					<BubbleAction icon={<MessageSquareQuote size={12} />} label="批注" onClick={startComment} />
					<BubbleAction
						icon={<BookmarkPlus size={12} />}
						label="记到收集箱"
						onClick={() => {
							openModal("quick-capture", { text: sel.text, sessionId });
							dismiss("discard");
						}}
					/>
					{showSendToMain && (
						<BubbleAction
							icon={<CornerUpLeft size={12} />}
							label="发到主对话"
							onClick={() => {
								stageInParent(sessionId, sel.text);
								dismiss("discard");
							}}
						/>
					)}
				</>
			)}
		</SelectionBubble>
	);
}
