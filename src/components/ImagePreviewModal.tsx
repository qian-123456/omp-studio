import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z_LAYER } from "./FloatingLayer";
import { claimEscape } from "../lib/escapeClaim";

export interface PreviewImageItem {
	path: string;
	name?: string;
	marker?: string;
}

interface ImagePreviewModalProps {
	images: PreviewImageItem[];
	initialIndex?: number;
	onClose: () => void;
}

export function ImagePreviewModal({
	images,
	initialIndex = 0,
	onClose,
}: ImagePreviewModalProps) {
	const [index, setIndex] = useState(
		Math.max(0, Math.min(initialIndex, images.length - 1)),
	);
	const touchStartX = useRef<number | null>(null);
	const touchDeltaX = useRef<number>(0);
	const wheelCooldown = useRef<number>(0);
	const [failedPath, setFailedPath] = useState<string | null>(null);

	const count = images.length;
	const current = images[index];

	const prev = () => {
		setIndex((i) => (i > 0 ? i - 1 : count - 1));
	};

	const next = () => {
		setIndex((i) => (i < count - 1 ? i + 1 : 0));
	};

	// Keyboard navigation
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				claimEscape(e);
				onClose();
			} else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
				if (count > 1) {
					e.preventDefault();
					prev();
				}
			} else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
				if (count > 1) {
					e.preventDefault();
					next();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [count, onClose]);

	if (!current || count === 0) return null;

	const handleWheel = (e: React.WheelEvent) => {
		if (count <= 1) return;
		const now = Date.now();
		if (now - wheelCooldown.current < 250) return;
		if (Math.abs(e.deltaX) > 30) {
			wheelCooldown.current = now;
			if (e.deltaX > 0) {
				next();
			} else {
				prev();
			}
		}
	};

	const onTouchStart = (e: React.TouchEvent) => {
		touchStartX.current = e.touches[0].clientX;
		touchDeltaX.current = 0;
	};

	const onTouchMove = (e: React.TouchEvent) => {
		if (touchStartX.current !== null) {
			touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
		}
	};

	const onTouchEnd = () => {
		if (touchStartX.current !== null && count > 1) {
			if (touchDeltaX.current < -50) {
				next();
			} else if (touchDeltaX.current > 50) {
				prev();
			}
		}
		touchStartX.current = null;
		touchDeltaX.current = 0;
	};

	return createPortal(
		<div
			data-layer="lightbox"
			role="dialog"
			aria-modal="true"
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] p-4 select-none"
			style={{ zIndex: Z_LAYER.lightbox }}
			onClick={onClose}
			onWheel={handleWheel}
			onTouchStart={onTouchStart}
			onTouchMove={onTouchMove}
			onTouchEnd={onTouchEnd}
		>
			{/* Top Bar: Counter & Close */}
			<div className="absolute top-4 left-0 right-0 z-20 flex items-center justify-between px-6 pointer-events-none">
				{/* Image indicator pill */}
				<div className="flex items-center gap-2 rounded-full bg-black/75 px-3 py-1 text-xs font-mono font-medium text-white/90 backdrop-blur-md border border-white/10 shadow-sm pointer-events-auto">
					<span>🖼️</span>
					<span>
						{index + 1} / {count}
					</span>
					{current.marker && (
						<span className="text-white/40">({current.marker})</span>
					)}
				</div>

				{/* Close button */}
				<button
					type="button"
					onClick={onClose}
					className="flex h-9 w-9 items-center justify-center rounded-full bg-black/75 text-white/80 backdrop-blur-md border border-white/10 shadow-sm hover:scale-110 hover:bg-black hover:text-white transition-all cursor-pointer pointer-events-auto"
					title="关闭 (Esc)"
				>
					<X size={18} strokeWidth={2} />
				</button>
			</div>

			{/* Left Arrow Button */}
			{count > 1 && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						prev();
					}}
					className="absolute left-6 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white/80 backdrop-blur-md border border-white/10 shadow-lg hover:scale-110 hover:bg-black/90 hover:text-white transition-all cursor-pointer group"
					title="上一张 (←)"
				>
					<ChevronLeft
						size={24}
						strokeWidth={2.5}
						className="group-hover:-translate-x-0.5 transition-transform"
					/>
				</button>
			)}

			{/* Main Image Container */}
			<div
				className="relative max-h-[85vh] max-w-[85vw] flex items-center justify-center overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-2 shadow-apple-modal transition-transform duration-200"
				onClick={(e) => e.stopPropagation()}
			>
				{failedPath === current.path ? (
					<div className="flex min-h-32 min-w-64 max-w-full flex-col items-center justify-center gap-1 px-6 py-8 text-center text-[13px] text-[var(--text-60)]">
						<span>无法加载这张图片</span>
						<span className="select-text break-all text-[12px] text-[var(--text-40)]">
							{current.path}
						</span>
					</div>
				) : (
					<img
						key={current.path}
						src={convertFileSrc(current.path)}
						alt={`图片 ${index + 1}`}
						onError={() => setFailedPath(current.path)}
						className="max-h-[78vh] max-w-full rounded-xl object-contain animate-in fade-in zoom-in-95 duration-150"
					/>
				)}
			</div>

			{/* Right Arrow Button */}
			{count > 1 && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						next();
					}}
					className="absolute right-6 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white/80 backdrop-blur-md border border-white/10 shadow-lg hover:scale-110 hover:bg-black/90 hover:text-white transition-all cursor-pointer group"
					title="下一张 (→)"
				>
					<ChevronRight
						size={24}
						strokeWidth={2.5}
						className="group-hover:translate-x-0.5 transition-transform"
					/>
				</button>
			)}

			{/* Bottom Thumbnail Strip (if > 1 image) */}
			{count > 1 && (
				<div
					className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-2xl bg-black/75 p-2 backdrop-blur-md border border-white/10 shadow-lg"
					onClick={(e) => e.stopPropagation()}
				>
					{images.map((img, i) => (
						<button
							key={img.path || i}
							type="button"
							onClick={() => setIndex(i)}
							className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border transition-all cursor-pointer ${
								i === index
									? "border-amber-400 scale-105 shadow-md ring-2 ring-amber-400/30"
									: "border-white/10 opacity-60 hover:opacity-100 hover:scale-100"
							}`}
							title={`跳转到第 ${i + 1} 张`}
						>
							<img
								src={convertFileSrc(img.path)}
								alt={`第 ${i + 1} 张`}
								className="h-full w-full object-cover"
							/>
						</button>
					))}
				</div>
			)}
		</div>,
		document.body,
	);
}
