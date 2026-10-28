import { X } from "lucide-react";
import { useEffect, useRef } from "react";
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
 * Drag the handle/header down, tap the scrim, press Escape or go back to close.
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
		if (!el) return;
		el.style.transition = "";
		if (dy > CLOSE_DISTANCE || d.v > CLOSE_VELOCITY) {
			// Keep the dragged offset; the exit transition continues from it.
			onClose();
		} else {
			el.style.transform = "";
		}
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
					maxHeight: "calc(var(--m-vh, 100dvh) - var(--m-safe-top) - 12px)",
					height: fullHeight ? "calc(var(--m-vh, 100dvh) - var(--m-safe-top) - 12px)" : undefined,
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
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
				{footer != null && <div className="shrink-0 px-4 pt-2 pb-3">{footer}</div>}
			</div>
		</div>,
		document.body,
	);
}
