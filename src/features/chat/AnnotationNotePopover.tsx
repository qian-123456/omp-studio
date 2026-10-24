/** [B] Per-annotation surfaces anchored at a message marker / annotated text:
 * the editable note popover (click) and the read-only hover card (hover). */

import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Anchor, FloatingLayer } from "../../components/FloatingLayer";
import { claimEscape } from "../../lib/escapeClaim";
import { isComposing } from "../../lib/hooks";
import { type Annotation, useComposer } from "../../stores/composer";
import { useT } from "../../stores/language";

const CARD_CLASS =
	"w-[min(360px,calc(100vw-2rem))] !bg-[var(--bg-panel)] text-[12px] px-3 py-2";
const QUOTE_CLASS =
	"max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-[var(--text-60,var(--text-muted))]";

/**
 * Edits one annotation in place. Outside pointerdown or a scroll of `scrollTarget`
 * saves the note and closes; Escape discards and closes; unmounting (session
 * switch) saves what was typed.
 */
export function AnnotationNotePopover({
	anchor,
	storeKey,
	annotation,
	n,
	scrollTarget,
	onClose,
}: {
	anchor: Anchor;
	/** Composer-store key of the list holding the annotation (session id or `sidechat:<id>`). */
	storeKey: string;
	annotation: Annotation;
	n: number;
	scrollTarget?: HTMLElement | null;
	onClose: () => void;
}) {
	const { t } = useT();
	const [draft, setDraft] = useState(annotation.comment ?? "");
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const settled = useRef(false);
	const popRef = useRef<HTMLDivElement>(null);
	const id = annotation.id;

	const finish = useRef((_save: boolean) => {});
	finish.current = (save: boolean) => {
		if (settled.current) return;
		settled.current = true;
		if (save) {
			useComposer.getState().updateAnnotation(storeKey, id, {
				comment: draftRef.current.trim() || undefined,
			});
		}
		onClose();
	};

	useEffect(() => {
		// `popRef` is the actual (portaled) popover element, so containment holds
		// even though it lives outside the anchor's DOM subtree. Pointerdown (not
		// click) on window capture: it fires first and nothing can swallow it.
		const onDown = (e: Event) => {
			if (popRef.current?.contains(e.target as Node)) return;
			finish.current(true);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || isComposing(e)) return;
			claimEscape(e);
			e.stopPropagation();
			finish.current(false);
		};
		const onScroll = () => finish.current(true);
		window.addEventListener("pointerdown", onDown, true);
		document.addEventListener("keydown", onKey, true);
		scrollTarget?.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			window.removeEventListener("pointerdown", onDown, true);
			document.removeEventListener("keydown", onKey, true);
			scrollTarget?.removeEventListener("scroll", onScroll);
		};
	}, [scrollTarget]);

	// Unmount without an explicit close (session switch): keep the typed note.
	// Must not touch `settled`: this cleanup also runs on StrictMode's simulated
	// unmount, and a latched flag would turn every later close path into a no-op.
	useEffect(
		() => () => {
			if (settled.current) return;
			useComposer.getState().updateAnnotation(storeKey, id, {
				comment: draftRef.current.trim() || undefined,
			});
		},
		[storeKey, id],
	);

	return (
		<FloatingLayer anchor={anchor} placement="bottom-start" className={CARD_CLASS}>
			<div ref={popRef} data-testid="annotation-note-popover">
				<div className="text-[11px] text-[var(--text-40,var(--text-dim))]">
					<span className="tabular-nums">{n}.</span> {t("chat.annotation.sourceMessage")}
				</div>
				<div className={`mt-0.5 ${QUOTE_CLASS}`}>{annotation.text}</div>
				<textarea
					autoFocus
					rows={2}
					value={draft}
					placeholder={t("chat.annotation.inputPlaceholderShort")}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (isComposing(e)) return;
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							e.stopPropagation();
							finish.current(true);
						}
					}}
					className="mt-1.5 w-full resize-none rounded-md border border-[var(--line,var(--border))] bg-[var(--bg)] px-2 py-1 text-[12px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-30,var(--text-dim))] focus:border-[var(--text-30,var(--border))]"
				/>
				<div className="mt-1.5 flex justify-end">
					<button
						type="button"
						onClick={() => {
							settled.current = true;
							useComposer.getState().removeAnnotation(storeKey, id);
							onClose();
						}}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-40,var(--text-dim))] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
					>
						<Trash2 size={12} />
						{t("common.delete")}
					</button>
				</div>
			</div>
		</FloatingLayer>
	);
}

/** Read-only quote + note, shown while hovering a marker or its annotated text. */
export function AnnotationHoverCard({
	anchor,
	annotation,
	n,
}: {
	anchor: Anchor;
	annotation: Annotation;
	n: number;
}) {
	const { t } = useT();
	return (
		<FloatingLayer
			anchor={anchor}
			layer="hovercard"
			placement="bottom-start"
			className={`${CARD_CLASS} pointer-events-none`}
		>
			<div data-testid="annotation-hover-card">
				<div className="text-[11px] text-[var(--text-40,var(--text-dim))]">
					<span className="tabular-nums">{n}.</span> {t("chat.annotation.sourceMessage")}
				</div>
				<div className={`mt-0.5 ${QUOTE_CLASS}`}>{annotation.text}</div>
				{annotation.comment && (
					<div className="mt-1 whitespace-pre-wrap break-words text-[11px] text-[var(--text-40,var(--text-dim))]">
						{t("chat.annotation.notePrefix", { comment: annotation.comment })}
					</div>
				)}
			</div>
		</FloatingLayer>
	);
}
