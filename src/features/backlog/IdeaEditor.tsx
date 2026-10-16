import { Paperclip } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImagePreviewModal } from "../../components/ImagePreviewModal";
import { getImageTokenPalette } from "../chat/Composer";
import { splitTokens, storedToDoc, type TokenDoc } from "./ideaTokens";

export interface IdeaEditorHandle {
	/** Current caret offset in the text (end of text when unfocused). */
	caret(): number;
	/** Focus and place the caret at `pos` once the next doc update has rendered. */
	placeCaret(pos: number): void;
}

const previewImages = (images: string[]) => images.map((path, i) => ({ path, marker: `图片 #${i + 1}` }));

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
		/** Applied to both layers so glyph metrics and wrapping stay identical. */
		boxClass?: string;
	}
>(function IdeaEditor(
	{ doc, onChange, placeholder, autoFocus, minHeight, maxHeight, onKeyDown, onPaste, onBlur, boxClass = "" },
	ref,
) {
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
	const base = `w-full whitespace-pre-wrap break-words border px-2.5 py-1.5 text-xs leading-5 ${boxClass}`;

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
				className={`${base} block resize-none bg-[var(--bg)] text-transparent caret-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none`}
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
								title={`${path}（点击预览）`}
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

/** Read-only rendering of stored idea text: image tags become coloured paperclip chips. */
export function IdeaTextView({
	stored,
	refImages,
	className = "",
}: {
	stored: string;
	refImages: readonly string[];
	className?: string;
}) {
	const doc = useMemo(() => storedToDoc(stored, refImages), [stored, refImages]);
	const [preview, setPreview] = useState<number | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [overflowing, setOverflowing] = useState(false);
	const pRef = useRef<HTMLParagraphElement>(null);
	// Measure only while clamped; once expanded keep the toggle so it can collapse again.
	useLayoutEffect(() => {
		const p = pRef.current;
		if (p && !expanded) setOverflowing(p.scrollHeight > p.clientHeight + 1);
	}, [doc.text, expanded]);
	return (
		<div>
			<p ref={pRef} className={`whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-3"} ${className}`}>
				{splitTokens(doc.text).map((s, i) => {
					if (s.kind === "text") return <span key={`t${i}-${s.value.length}`}>{s.value}</span>;
					const path = doc.images[s.index - 1];
					if (!path) return null;
					const hex = getImageTokenPalette(s.index).hex;
					return (
						<button
							key={`i${i}-${s.index}`}
							type="button"
							onClick={() => setPreview(s.index - 1)}
							title={`${path}（点击预览）`}
							className="mx-0.5 inline-flex items-center gap-0.5 rounded px-1 align-baseline text-[11px] font-medium hover:brightness-125"
							style={{ color: hex, backgroundColor: `${hex}22` }}
						>
							<Paperclip className="h-3 w-3" />#{s.index}
						</button>
					);
				})}
			</p>
			{(overflowing || expanded) && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-0.5 text-[10px] text-sky-400 hover:underline"
				>
					{expanded ? "收起" : "展开全文"}
				</button>
			)}
			{preview !== null && (
				<ImagePreviewModal images={previewImages(doc.images)} initialIndex={preview} onClose={() => setPreview(null)} />
			)}
		</div>
	);
}
