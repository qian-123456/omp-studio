import { ChevronDown, Paperclip } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImagePreviewModal } from "../../components/ImagePreviewModal";
import { exceedsLines, useLineClampOverflow } from "../../lib/useLineClamp";
import { getImageTokenPalette } from "../chat/imageTokens";
import { splitTokens, storedToDoc, type TokenDoc } from "./ideaTokens";
import { useT, tNow } from "../../stores/language";
export interface IdeaEditorHandle {
	/** Current caret offset in the text (end of text when unfocused). */
	caret(): number;
	/** Focus and place the caret at `pos` once the next doc update has rendered. */
	placeCaret(pos: number): void;
}

const previewImages = (images: string[]) =>
	images.map((path, i) => ({ path, marker: tNow("backlog.imageMarker", { index: i + 1 }) }));

/**
 * Auto-growing multi-line textarea. Image tokens (`🖼️ #N`) are painted as coloured chips
 * by an overlay that mirrors the text; clicking a chip previews the image. Text itself
 * stays plain so caret, selection, IME and undo keep native behaviour.
 */
export const IdeaEditor = forwardRef<
	IdeaEditorHandle,
	{
		doc: TokenDoc;
		onChange: (doc: TokenDoc) => void;
		placeholder?: string;
		autoFocus?: boolean;
		minHeight: number;
		maxHeight: number;
		onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
		onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
		onBlur?: () => void;
		onFocus?: () => void;
		/** Applied to both layers so glyph metrics and wrapping stay identical. */
		boxClass?: string;
		/** Font size / line height for both layers (default 12px / 20px). */
		textClass?: string;
		/** Textarea background (default `bg-[var(--bg)]`). */
		bgClass?: string;
	}
>(function IdeaEditor(
	{ doc, onChange, placeholder, autoFocus, minHeight, maxHeight, onKeyDown, onPaste, onBlur, onFocus, boxClass = "", textClass = "text-xs leading-5", bgClass = "bg-[var(--bg)]" },
	ref,
) {
	const { t } = useT();
	const taRef = useRef<HTMLTextAreaElement>(null);
	const pendingCaret = useRef<number | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [preview, setPreview] = useState<number | null>(null);

	useImperativeHandle(
		ref,
		() => ({
			caret: () => taRef.current?.selectionStart ?? doc.text.length,
			placeCaret: (pos) => {
				pendingCaret.current = pos;
			},
		}),
		[doc.text.length],
	);

	useLayoutEffect(() => {
		const ta = taRef.current;
		if (!ta) return;
		ta.style.height = "auto";
		const full = ta.scrollHeight;
		ta.style.height = `${Math.min(Math.max(full, minHeight), maxHeight)}px`;
		ta.style.overflowY = full > maxHeight ? "auto" : "hidden";
		if (pendingCaret.current !== null) {
			const pos = Math.min(pendingCaret.current, ta.value.length);
			pendingCaret.current = null;
			ta.focus();
			ta.setSelectionRange(pos, pos);
		}
	}, [doc.text, minHeight, maxHeight]);

	const segments = useMemo(() => splitTokens(doc.text), [doc.text]);
	// Both layers share every property that can change glyph advances or wrapping. Without
	// this the transparent textarea (which owns the caret) and the visible overlay drift apart
	// (kerning/ligatures split differently across chip spans; a classic scrollbar narrows only
	// the textarea's wrap width), leaving the caret far right of the painted text until the
	// next reflow. The textarea scrollbar is hidden so its content box equals the overlay's.
	const base = `w-full whitespace-pre-wrap break-words border px-2.5 py-1.5 ${textClass} [font-kerning:none] [font-variant-ligatures:none] [tab-size:4] [word-break:normal] ${boxClass}`;

	return (
		<div className="relative">
			<textarea
				ref={taRef}
				value={doc.text}
				autoFocus={autoFocus}
				spellCheck={false}
				rows={1}
				placeholder={placeholder}
				onChange={(e) => onChange({ text: e.target.value, images: doc.images })}
				onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
				onKeyDown={onKeyDown}
				onPaste={onPaste}
				onBlur={onBlur}
				onFocus={onFocus}
				className={`${base} block resize-none ${bgClass} text-transparent caret-[var(--text)] placeholder:text-[var(--text-dim)] [scrollbar-width:none] focus:outline-none [&::-webkit-scrollbar]:hidden`}
				style={{ minHeight }}
			/>
			<div aria-hidden className={`${base} pointer-events-none absolute inset-0 overflow-hidden border-transparent text-[var(--text)]`}>
				<div style={{ transform: `translateY(${-scrollTop}px)` }}>
					{segments.map((s, i) => {
						if (s.kind === "text") return <span key={`t${i}-${s.value.length}`}>{s.value}</span>;
						const path = doc.images[s.index - 1];
						if (!path) return <span key={`m${i}`}>{s.raw}</span>;
						const hex = getImageTokenPalette(s.index).hex;
						return (
							<span
								key={`i${i}-${s.index}`}
								className="pointer-events-auto cursor-pointer rounded-sm underline decoration-2 underline-offset-[3px]"
								style={{ color: hex, textDecorationColor: hex, backgroundColor: `${hex}22` }}
								title={t("backlog.clickToPreview", { path })}
								onMouseDown={(e) => {
									e.preventDefault();
									setPreview(s.index - 1);
								}}
							>
								{s.raw}
							</span>
						);
					})}
					{doc.text.endsWith("\n") ? "\u200b" : null}
				</div>
			</div>
			{preview !== null && (
				<ImagePreviewModal images={previewImages(doc.images)} initialIndex={preview} onClose={() => setPreview(null)} />
			)}
		</div>
	);
});

/** `text` cut to at most `n` characters, never inside an image token. */
function cutText(text: string, n: number): string {
	let acc = 0;
	let out = "";
	for (const s of splitTokens(text)) {
		const raw = s.kind === "text" ? s.value : s.raw;
		if (acc + raw.length > n) return s.kind === "text" ? out + raw.slice(0, n - acc) : out;
		out += raw;
		acc += raw.length;
	}
	return out;
}

/** Read-only rendering of stored idea text: image tags become coloured paperclip chips. */
export function IdeaTextView({
	stored,
	refImages,
	className = "",
	expanded: expandedProp,
	onToggle,
	onOverflowChange,
}: {
	stored: string;
	refImages: readonly string[];
	className?: string;
	/** Controlled expansion: when given, the built-in 展开 button is hidden and the parent renders its own. */
	expanded?: boolean;
	/**
	 * With `expanded`: collapsed overflowing text is cut so "…" plus a chevron button end the
	 * last line right after the visible text; expanded text ends with the chevron too.
	 */
	onToggle?: () => void;
	/** Reports whether the text exceeds the 3-line clamp. */
	onOverflowChange?: (overflowing: boolean) => void;
}) {
	const { t } = useT();
	const doc = useMemo(() => storedToDoc(stored, refImages), [stored, refImages]);
	const [preview, setPreview] = useState<number | null>(null);
	const [localExpanded, setLocalExpanded] = useState(false);
	const controlled = expandedProp !== undefined;
	const expanded = controlled ? expandedProp : localExpanded;
	const inline = controlled && onToggle !== undefined;
	const wrapRef = useRef<HTMLDivElement>(null);
	const pRef = useRef<HTMLParagraphElement>(null);
	const probeRef = useRef<HTMLParagraphElement>(null);
	const visRef = useRef<HTMLParagraphElement>(null);
	const [width, setWidth] = useState(0);
	const [cut, setCut] = useState<number | null>(null);
	// Measured unclamped and re-measured on resize; a block that fits is never clamped, so no
	// ellipsis appears without hidden text behind it.
	const overflowing = useLineClampOverflow(pRef, "line-clamp-3", 3, [doc.text]);
	const truncate = inline && overflowing && !expanded;
	useEffect(() => {
		onOverflowChange?.(overflowing);
	}, [overflowing, onOverflowChange]);
	useLayoutEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
		ro.observe(el);
		setWidth(Math.round(el.clientWidth));
		return () => ro.disconnect();
	}, []);
	// Largest prefix whose "…" + chevron slot still fits in 3 lines (probe mirrors the visible <p>).
	// biome-ignore lint/correctness/useExhaustiveDependencies: width retriggers on resize
	useLayoutEffect(() => {
		const probe = probeRef.current;
		if (!truncate || !probe) {
			setCut(null);
			return;
		}
		const lh = Number.parseFloat(getComputedStyle(probe).lineHeight) || 20;
		const fits = (n: number) => {
			probe.textContent = `${cutText(doc.text, n).trimEnd()}…\u2003\u2002`;
			return !exceedsLines(probe.scrollHeight, lh, 3);
		};
		let lo = 0;
		let hi = doc.text.length;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (fits(mid)) lo = mid;
			else hi = mid - 1;
		}
		setCut(lo);
	}, [truncate, doc.text, width]);
	// Chips are wider than the probe's raw token text: shrink until the real render fits.
	useLayoutEffect(() => {
		const vis = visRef.current;
		if (!truncate || cut === null || cut === 0 || !vis) return;
		const lh = Number.parseFloat(getComputedStyle(vis).lineHeight) || 20;
		if (exceedsLines(vis.scrollHeight, lh, 3)) setCut(cut - 1);
	}, [truncate, cut]);
	const toggle = (
		<button
			type="button"
			onClick={onToggle}
			className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full align-middle text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
			title={expanded ? t("common.collapse") : t("backlog.expandAll")}
			aria-label={expanded ? t("common.collapse") : t("backlog.expandAll")}
		>
			<ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
		</button>
	);
	const renderSegments = (text: string) =>
		splitTokens(text).map((s, i) => {
			if (s.kind === "text") return <span key={`t${i}-${s.value.length}`}>{s.value}</span>;
			const path = doc.images[s.index - 1];
			if (!path) return null;
			const hex = getImageTokenPalette(s.index).hex;
			return (
				<button
					key={`i${i}-${s.index}`}
					type="button"
					onClick={() => setPreview(s.index - 1)}
					title={t("backlog.clickToPreview", { path })}
					className="mx-0.5 inline-flex items-center gap-0.5 rounded px-1 align-baseline text-[11px] font-medium hover:brightness-125"
					style={{ color: hex, backgroundColor: `${hex}22` }}
				>
					<Paperclip className="h-3 w-3" />#{s.index}
				</button>
			);
		});
	const base = "whitespace-pre-wrap break-words";
	return (
		<div ref={wrapRef} className="relative">
			{/* Full text: the visible block, or (while truncated) an invisible natural-height measurer. */}
			<p
				ref={pRef}
				className={`${base} ${
					truncate
						? "pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
						: !expanded && overflowing && !inline
							? "line-clamp-3"
							: ""
				} ${className}`}
				aria-hidden={truncate || undefined}
			>
				{renderSegments(doc.text)}
				{inline && overflowing && expanded ? toggle : null}
			</p>
			{inline && (
				<p
					ref={probeRef}
					aria-hidden
					className={`${base} pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden ${className}`}
				/>
			)}
			{truncate && cut !== null && (
				<p ref={visRef} className={`${base} ${className}`}>
					{renderSegments(cutText(doc.text, cut).trimEnd())}…{toggle}
				</p>
			)}
			{overflowing && !controlled && (
				<button
					type="button"
					onClick={() => setLocalExpanded((v) => !v)}
					className="mt-0.5 text-[10px] text-sky-400 hover:underline"
				>
					{expanded ? t("common.collapse") : t("backlog.expandAll")}
				</button>
			)}
			{preview !== null && (
				<ImagePreviewModal images={previewImages(doc.images)} initialIndex={preview} onClose={() => setPreview(null)} />
			)}
		</div>
	);
}
