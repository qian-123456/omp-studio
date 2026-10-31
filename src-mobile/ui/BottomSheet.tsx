import { X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";
import { useOverlay, usePresence } from "./overlay";

const CLOSE_DISTANCE = 96;
const CLOSE_VELOCITY = 0.6;
const EXIT_MS = 320;

/**
 * Bottom sheet (docs/MOBILE_DESIGN.md §3).
 * - Default: menu sheet, auto height, grab handle + centred title.
 * - `fullHeight`: page sheet (Gemini settings layout) — handle, close circle, large left title.
 * Drag the header or pull content down at its scroll boundary to close.
 */
export function BottomSheet({
	open,
	onClose,
	title,
	subtitle,
	children,
	footer,
	fullHeight = false,
	headerRight,
	className = "",
}: {
	open: boolean;
	onClose: () => void;
	title?: ReactNode;
	subtitle?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	fullHeight?: boolean;
	/** Extra controls next to the close button (page sheets only). */
	headerRight?: ReactNode;
	className?: string;
}) {
	const { mounted, visible } = usePresence(open, EXIT_MS);
	useOverlay(open, onClose);
	const sheetRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{
		id: number; startX: number; startY: number; lastY: number; lastT: number;
		v: number; active: boolean; content: boolean; touch: boolean; target: HTMLElement;
	} | null>(null);
	const interactive = "button,a,input,textarea,select,label,[contenteditable]:not([contenteditable='false']),[role='slider']";
	const moveDrag = useCallback((x: number, y: number, time: number) => {
		const d = drag.current;
		if (!d) return false;
		if (!d.active && d.content) {
			// Leave nested scroll containers in control until every vertical boundary is at the top.
			let node: HTMLElement | null = d.target;
			while (node && contentRef.current?.contains(node)) {
				if (node.scrollTop > 0) {
					d.startX = x; d.startY = y; d.lastY = y; d.lastT = time;
					return false;
				}
				node = node.parentElement;
			}
			const dy = y - d.startY;
			if (dy <= 6 || dy <= Math.abs(x - d.startX)) return false;
			d.active = true;
			if (sheetRef.current) sheetRef.current.style.transition = "none";
		}
		const dt = time - d.lastT;
		if (dt > 0) d.v = (y - d.lastY) / dt;
		d.lastY = y;
		d.lastT = time;
		if (sheetRef.current) sheetRef.current.style.transform = `translateY(${Math.max(0, y - d.startY)}px)`;
		return true;
	}, []);
	const finishDrag = useCallback((y: number, time: number, cancelled: boolean) => {
		const d = drag.current;
		drag.current = null;
		const el = sheetRef.current;
		if (!d || !el) return;
		el.style.transition = "";
		// Inline transforms must never override the CSS exit or the next opening.
		el.style.transform = "";
		const dy = Math.max(0, y - d.startY);
		const velocity = time - d.lastT < 100 ? d.v : 0;
		if (!cancelled && d.active && dy > 0 && (dy > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY)) onClose();
	}, [onClose]);

	useEffect(() => {
		drag.current = null;
		const el = sheetRef.current;
		if (el) {
			el.style.transition = "";
			el.style.transform = "";
			if (open && mounted) el.focus({ preventScroll: true });
		}
	}, [open, mounted]);

	useEffect(() => {
		const content = contentRef.current;
		if (!open || !content) return;
		const onStart = (e: TouchEvent) => {
			if (e.touches.length !== 1) {
				if (drag.current?.touch) finishDrag(drag.current.lastY, e.timeStamp, true);
				return;
			}
			const target = e.target;
			if (!(target instanceof HTMLElement) || target.closest(interactive) || drag.current) return;
			const t = e.touches[0];
			drag.current = { id: t.identifier, startX: t.clientX, startY: t.clientY, lastY: t.clientY, lastT: e.timeStamp, v: 0, active: false, content: true, touch: true, target };
		};
		const onTouchMove = (e: TouchEvent) => {
			const d = drag.current;
			if (!d?.touch) return;
			const t = Array.from(e.touches).find(touch => touch.identifier === d.id);
			if (!t) return;
			if (!e.cancelable) { finishDrag(t.clientY, e.timeStamp, true); return; }
			if (moveDrag(t.clientX, t.clientY, e.timeStamp)) e.preventDefault();
		};
		const onEnd = (e: TouchEvent) => {
			const d = drag.current;
			if (!d?.touch) return;
			const t = Array.from(e.changedTouches).find(touch => touch.identifier === d.id);
			if (t) finishDrag(t.clientY, e.timeStamp, e.type === "touchcancel");
		};
		content.addEventListener("touchstart", onStart, { passive: true });
		content.addEventListener("touchmove", onTouchMove, { passive: false });
		content.addEventListener("touchend", onEnd);
		content.addEventListener("touchcancel", onEnd);
		return () => {
			content.removeEventListener("touchstart", onStart);
			content.removeEventListener("touchmove", onTouchMove);
			content.removeEventListener("touchend", onEnd);
			content.removeEventListener("touchcancel", onEnd);
			if (drag.current?.touch) finishDrag(drag.current.lastY, performance.now(), true);
		};
	}, [open, mounted, moveDrag, finishDrag]);

	if (!mounted) return null;

	const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		const content = e.currentTarget === contentRef.current;
		// Native non-passive touch events handle content without also moving it via pointer events.
		if (!open || drag.current || (content && e.pointerType === "touch")) return;
		if (e.button !== 0 && e.pointerType === "mouse") return;
		const target = e.target;
		if (!(target instanceof HTMLElement) || target.closest(interactive)) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, active: !content, content, touch: false, target };
		if (!content && sheetRef.current) sheetRef.current.style.transition = "none";
	};
	const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d || d.touch || d.id !== e.pointerId) return;
		if (moveDrag(e.clientX, e.clientY, e.timeStamp)) e.preventDefault();
	};
	const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d || d.touch || d.id !== e.pointerId) return;
		finishDrag(e.clientY, e.timeStamp, e.type !== "pointerup");
		if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
	};

	const handle = <div aria-hidden className="mx-auto mt-2 h-[5px] w-9 rounded-m-pill bg-m-border-strong" />;

	return createPortal(
		<div className="fixed inset-0 z-(--z-sheet)">
			<div
				aria-hidden
				onClick={onClose}
				className={`absolute inset-0 bg-m-scrim transition-opacity duration-(--m-dur) ease-m ${visible ? "opacity-100" : "opacity-0"}`}
			/>
			<div
				ref={sheetRef}
				role="dialog"
				aria-modal="true"
				aria-label={typeof title === "string" ? title : undefined}
				tabIndex={-1}
				className={`absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-m-xl bg-m-bg-elev text-m-text outline-none transition-transform duration-(--m-dur-sheet) ease-m-sheet ${visible ? "translate-y-0" : "translate-y-full"} ${className}`}
				style={{
					boxSizing: "border-box",
					// --m-vh is the visual height; add keyboard inset back for this body-fixed box.
					maxHeight: "calc(var(--m-vh, 100dvh) + var(--m-kb, 0px) - var(--m-safe-top) - 12px)",
					height: fullHeight ? "calc(var(--m-vh, 100dvh) + var(--m-kb, 0px) - var(--m-safe-top) - 12px)" : undefined,
					paddingBottom: "calc(var(--m-safe-bottom) + var(--m-kb, 0px))",
				}}
			>
				<div
					className="shrink-0 touch-none select-none"
					onPointerDown={onDown}
					onPointerMove={onMove}
					onPointerUp={onUp}
					onPointerCancel={onUp}
					onLostPointerCapture={onUp}
				>
					{handle}
					{fullHeight ? (
						<>
							<div className="flex items-center justify-end gap-1 px-3 pt-1">
								{headerRight}
								<IconButton variant="filled" icon={<X size={20} />} label="关闭" onClick={onClose} />
							</div>
							{title != null && (
								<div className="px-5 pt-1 pb-3">
									<h2 className="text-m-title font-medium break-words">{title}</h2>
									{subtitle != null && <div className="mt-1 text-m-sm break-words text-m-text-3">{subtitle}</div>}
								</div>
							)}
						</>
					) : title != null ? (
						<div className="px-12 pt-3 pb-2 text-center">
							<h2 className="text-m-md font-semibold break-words">{title}</h2>
							{subtitle != null && <div className="mt-0.5 text-m-xs break-words text-m-text-3">{subtitle}</div>}
						</div>
					) : (
						<div className="h-3" />
					)}
				</div>
				<div
					ref={contentRef}
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
					onPointerDown={onDown}
					onPointerMove={onMove}
					onPointerUp={onUp}
					onPointerCancel={onUp}
					onLostPointerCapture={onUp}
				>{children}</div>
				{footer != null && <div className="shrink-0 px-4 pt-2 pb-3">{footer}</div>}
			</div>
		</div>,
		document.body,
	);
}
