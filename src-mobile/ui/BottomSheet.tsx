import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlay, usePresence } from "./overlay";

const CLOSE_DISTANCE = 96;
const CLOSE_VELOCITY = 0.6;

export function BottomSheet({
	open,
	onClose,
	title,
	children,
	footer,
	fullHeight = false,
	className = "",
}: {
	open: boolean;
	onClose: () => void;
	title?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	fullHeight?: boolean;
	className?: string;
}) {
	const { mounted, visible } = usePresence(open);
	useOverlay(open, onClose);
	const sheetRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ id: number; startY: number; lastY: number; lastT: number; v: number } | null>(null);

	useEffect(() => {
		if (open && mounted) sheetRef.current?.focus({ preventScroll: true });
	}, [open, mounted]);

	if (!mounted) return null;

	const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0 && e.pointerType === "mouse") return;
		if ((e.target as HTMLElement).closest("button,a,input,textarea,select")) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		drag.current = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
		if (sheetRef.current) sheetRef.current.style.transition = "none";
	};
	const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d || d.id !== e.pointerId) return;
		const dy = Math.max(0, e.clientY - d.startY);
		const dt = e.timeStamp - d.lastT;
		if (dt > 0) d.v = (e.clientY - d.lastY) / dt;
		d.lastY = e.clientY;
		d.lastT = e.timeStamp;
		if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
	};
	const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d || d.id !== e.pointerId) return;
		drag.current = null;
		const dy = Math.max(0, e.clientY - d.startY);
		const el = sheetRef.current;
		if (el) {
			el.style.transition = "";
			if (dy > CLOSE_DISTANCE || d.v > CLOSE_VELOCITY) {
				// Keep the dragged offset; the exit transition continues from it.
				onClose();
			} else {
				el.style.transform = "";
			}
		}
	};

	return createPortal(
		<div className="fixed inset-0 z-(--z-sheet)">
			<div
				aria-hidden
				onClick={onClose}
				className={`absolute inset-0 bg-m-scrim transition-opacity duration-240 ease-(--m-ease) ${visible ? "opacity-100" : "opacity-0"}`}
			/>
			<div
				ref={sheetRef}
				role="dialog"
				aria-modal="true"
				tabIndex={-1}
				className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-m-lg bg-m-bg-elev text-m-text shadow-m-pop outline-none transition-transform duration-240 ease-(--m-ease) ${visible ? "translate-y-0" : "translate-y-full"} ${className}`}
				style={{
					maxHeight: "calc(var(--m-vh, 100dvh) * 0.85)",
					height: fullHeight ? "calc(var(--m-vh, 100dvh) * 0.85)" : undefined,
					paddingBottom: "var(--m-safe-bottom)",
				}}
			>
				<div
					className="shrink-0 touch-none select-none"
					onPointerDown={onDown}
					onPointerMove={onMove}
					onPointerUp={onUp}
					onPointerCancel={onUp}
				>
					<div className="mx-auto mt-2 h-1 w-10 rounded-m-pill bg-m-border" />
					{title != null && (
						<div className="px-4 pb-2 pt-3 text-center text-m-md font-semibold">{title}</div>
					)}
					{title == null && <div className="h-2" />}
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
				{footer != null && <div className="shrink-0 border-t border-m-border px-4 py-2">{footer}</div>}
			</div>
		</div>,
		document.body,
	);
}
