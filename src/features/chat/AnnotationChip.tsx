/** [B] Composer annotation chip: one compact "N 条批注" pill. Hover or keyboard
 * focus opens a popover above it listing every quote, with inline comment edit,
 * delete and (for message quotes) locate-in-transcript actions. */

import { ArrowLeftRight, LocateFixed, MessageSquareQuote, Pencil, Trash2, X } from "lucide-react";
import { type FocusEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { isComposing } from "../../lib/hooks";
import { type Annotation, useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { claimEscape } from "../../lib/escapeClaim";
import { setQuoteOccurrenceHint } from "./annotationLocate";
import { AnnotationImageButton, AnnotationImageStrip, useAnnotationImages } from "./AnnotationImages";
import { tNow, useT } from "../../stores/language";

/** Grace period so the pointer can cross the (zero-gap) seam between chip and popover. */
const HOVER_CLOSE_DELAY_MS = 120;

function sourceLabel(source: Annotation["source"]): string {
	switch (source) {
		case "message": return tNow("chat.annotation.sourceMessage");
		case "diff": return tNow("chat.annotation.sourceDiff");
		case "doc": return tNow("chat.annotation.sourceDoc");
		case "terminal": return tNow("chat.annotation.sourceTerminal");
	}
}

/** Entry header: quotes from messages are labelled as such; others show their location. */
function entryLabel(a: Annotation): string {
	if (a.label) return a.label;
	if (a.source === "message") return sourceLabel("message");
	const where = [a.file, a.lines].filter(Boolean).join(" ");
	return where || sourceLabel(a.source);
}

const iconBtn =
	"shrink-0 rounded p-1 text-[var(--text-30,var(--text-dim))] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] transition-colors";

function AnnotationEntry({
	sessionId,
	index,
	annotation: a,
	editing,
	anchorSessionId,
	onEdit,
	onRemove,
	onMove,
	moveLabel,
}: {
	sessionId: string;
	/** 1-based position in the passed list (the number used by `[n]` blocks). */
	index: number;
	annotation: Annotation;
	editing: boolean;
	/** Session whose stream "locate" scrolls (differs from sessionId for side-chat annotations). */
	anchorSessionId: string;
	onEdit: (id: string | null) => void;
	onRemove: () => void;
	/** Moves this annotation to the other annotation list (main ⇄ side chat). */
	onMove?: (id: string) => void;
	/** Tooltip/aria for the move button. */
	moveLabel?: string;
}) {
	const { t } = useT();
	const updateAnnotation = useComposer((s) => s.updateAnnotation);
	const removeAnnotation = useComposer((s) => s.removeAnnotation);
	const scrollToItem = useLive((s) => s.scrollToItem);
	const [draft, setDraft] = useState("");
	// Enter/Esc unmount the input, which can also fire blur; only the first commit counts.
	const settledRef = useRef(true);
	const [draftImages, setDraftImages] = useState<string[]>([]);
	// Mirrors draftImages synchronously: an addition that lands right before a deferred save must be seen by it.
	const draftImagesRef = useRef<string[]>([]);
	const setDraftImagesSynced = useCallback((next: string[]) => {
		draftImagesRef.current = next;
		setDraftImages(next);
	}, []);
	// After the editor closed (e.g. the native picker stole focus) additions go straight to the store.
	const changeImages = useCallback(
		(next: string[]) => {
			setDraftImagesSynced(next);
			if (settledRef.current) {
				useComposer.getState().updateAnnotation(sessionId, a.id, {
					images: next.length > 0 ? next : undefined,
				});
			}
		},
		[sessionId, a.id],
	);
	const closeWhenIdleRef = useRef(false);
	const finishRef = useRef<(save: boolean) => void>(() => {});
	const imageInput = useAnnotationImages(editing ? draftImages : (a.images ?? []), changeImages, () => {
		if (closeWhenIdleRef.current) {
			closeWhenIdleRef.current = false;
			finishRef.current(true);
		}
	});

	const startEdit = () => {
		setDraft(a.comment ?? "");
		setDraftImagesSynced(a.images ?? []);
		settledRef.current = false;
		onEdit(a.id);
	};

	const finish = (save: boolean) => {
		if (settledRef.current) return;
		// An image is still being saved/picked: stay in edit mode and save once it landed.
		if (save && imageInput.pendingRef.current > 0) {
			closeWhenIdleRef.current = true;
			return;
		}
		settledRef.current = true;
		// Esc: pending results belong to the discarded edit.
		if (!save) imageInput.invalidate();
		if (save) {
			updateAnnotation(sessionId, a.id, {
				comment: draft.trim() || undefined,
				images: draftImagesRef.current.length > 0 ? draftImagesRef.current : undefined,
			});
		}
		onEdit(null);
	};
	finishRef.current = finish;

	// Edit opened from outside (marker badge): seed the draft once the entry is mounted.
	useEffect(() => {
		if (editing && settledRef.current) {
			setDraft(a.comment ?? "");
			setDraftImagesSynced(a.images ?? []);
			settledRef.current = false;
		}
	}, [editing, a.comment, a.images]);

	return (
		<li className="flex gap-2 px-3 py-2">
			<div className="min-w-0 flex-1 text-[12px]">
				<div className="text-[11px] text-[var(--text-40,var(--text-dim))]">
					<span className="tabular-nums">{index}.</span> {entryLabel(a)}
				</div>
				<div
					className="mt-0.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-[var(--text-60,var(--text-muted))]"
				>
					{a.text}
				</div>
				{editing ? (
					<>
					<textarea
						autoFocus
						rows={2}
						value={draft}
						placeholder={t("chat.annotation.inputPlaceholder")}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								e.stopPropagation();
								finish(true);
							} else if (e.key === "Escape") {
								claimEscape(e);
								e.stopPropagation();
								finish(false);
							}
						}}
						onBlur={() => finish(true)}
						onPaste={imageInput.onPaste}
						className="mt-1 w-full resize-none rounded-md border border-[var(--line,var(--border))] bg-[var(--bg)] px-2 py-1 text-[12px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-30,var(--text-dim))] focus:border-[var(--text-30,var(--border))]"
					/>
					<AnnotationImageStrip paths={draftImages} onRemove={imageInput.remove} className="mt-1" />
					<div className="mt-1 flex items-center">
						<AnnotationImageButton onClick={imageInput.pick} busy={imageInput.busy} />
					</div>
					</>
				) : (
					<>
						{a.comment && (
							<div className="mt-1 whitespace-pre-wrap break-words text-[11px] text-[var(--text-40,var(--text-dim))]">
								{t("chat.annotation.notePrefix", { comment: a.comment })}
							</div>
						)}
						<AnnotationImageStrip paths={a.images} className="mt-1" />
					</>
				)}
			</div>
			<div className="flex shrink-0 items-start gap-0.5 pt-px">
				{a.itemId && (
					<button
						type="button"
						aria-label={t("chat.annotation.locateOriginal")}
						title={t("chat.annotation.locateOriginal")}
						onClick={() => {
							setQuoteOccurrenceHint(a.itemId!, a.text, a.occurrence, a.answerPart);
							scrollToItem(anchorSessionId, a.itemId!, a.text);
						}}
						className={iconBtn}
					>
						<LocateFixed size={12} />
					</button>
				)}
				<button type="button" aria-label={t("chat.annotation.editNote")} title={t("chat.annotation.editNote")} onClick={startEdit} className={iconBtn}>
					<Pencil size={12} />
				</button>
				{onMove && moveLabel && (
					<button
						type="button"
						aria-label={moveLabel}
						title={moveLabel}
						onClick={() => {
							onMove(a.id);
							// Moving removes the entry from this list; reset state like onRemove.
							onRemove();
						}}
						className={iconBtn}
					>
						<ArrowLeftRight size={12} />
					</button>
				)}
				<button
					type="button"
					aria-label={t("chat.annotation.deleteNote")}
					title={t("chat.annotation.deleteNote")}
					onClick={() => {
						removeAnnotation(sessionId, a.id);
						onRemove();
					}}
					className={iconBtn}
				>
					<Trash2 size={12} />
				</button>
			</div>
		</li>
	);
}

export function AnnotationChip({
	sessionId,
	annotations,
	anchorSessionId,
	onMove,
	moveLabel,
}: {
	/** Composer-store key for this annotation list (a session id, or `sidechat:<id>`). */
	sessionId: string;
	/** Text annotations only (see `textAnnotationsOf`); index + 1 is the quote number. */
	annotations: Annotation[];
	/** Session whose message stream the "locate" action scrolls; defaults to `sessionId`. */
	anchorSessionId?: string;
	/** Moves an annotation to the other list (main ⇄ side chat); hides the button when absent. */
	onMove?: (id: string) => void;
	/** Tooltip/aria for the move button, e.g. "移到辅助对话". */
	moveLabel?: string;
}) {
	const { t } = useT();
	const removeAnnotation = useComposer((s) => s.removeAnnotation);
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const popRef = useRef<HTMLOListElement>(null);
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const hoverTimer = useRef<number | undefined>(undefined);

	useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

	const anchorRef = useRef<HTMLElement | null>(null);
	anchorRef.current = anchor;
	const anchorRefs = useMemo(() => [anchorRef], []);

	const enterHover = () => {
		window.clearTimeout(hoverTimer.current);
		setHovered(true);
	};
	const leaveHover = () => {
		window.clearTimeout(hoverTimer.current);
		hoverTimer.current = window.setTimeout(() => setHovered(false), HOVER_CLOSE_DELAY_MS);
	};

	// Focus stays "in" while focus moves between chip and popover; leaving both closes it.
	const onFocusOut = (e: FocusEvent<HTMLElement>) => {
		const next = e.relatedTarget as Node | null;
		if (next && (anchor?.contains(next) || popRef.current?.contains(next))) return;
		setFocused(false);
	};

	// An input inside the popover keeps it open even when the pointer leaves.
	const open = hovered || focused || editingId !== null;

	return (
		<>
			<div
				ref={setAnchor}
				onMouseEnter={enterHover}
				onMouseLeave={leaveHover}
				onFocus={() => setFocused(true)}
				onBlur={onFocusOut}
				className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-[var(--line,var(--border))] bg-[var(--bg)] py-0.5 pl-2 pr-1 text-[11px] text-[var(--text-60,var(--text-muted))] transition-colors hover:border-[var(--text-30,var(--border))] hover:text-[var(--text)]"
			>
				<button
					type="button"
					aria-expanded={open}
					aria-label={t("chat.annotation.countNotes", { count: annotations.length })}
					className="flex min-w-0 items-center gap-1 outline-none"
				>
					<MessageSquareQuote size={12} className="shrink-0" />
					<span className="truncate">{t("chat.annotation.countNotes", { count: annotations.length })}</span>
				</button>
				<button
					type="button"
					aria-label={t("chat.annotation.clearNotes")}
					title={t("chat.annotation.clearNotes")}
					onClick={() => {
						for (const a of annotations) removeAnnotation(sessionId, a.id);
						setEditingId(null);
						setFocused(false);
					}}
					className="shrink-0 rounded-full p-0.5 text-[var(--text-30,var(--text-dim))] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
				>
					<X size={10} />
				</button>
			</div>
			<FloatingLayer
				anchor={open ? anchor : null}
				placement="top-start"
				offset={0}
				onDismiss={() => {
					setHovered(false);
					setFocused(false);
					setEditingId(null);
				}}
				ignoreRefs={anchorRefs}
				deferEscapeToEditors
				onMouseEnter={enterHover}
				onMouseLeave={leaveHover}
				className="w-[min(420px,calc(100vw-2rem))] !bg-[var(--bg-panel)] text-[12px]"
			>
				<ol ref={popRef} onFocus={() => setFocused(true)} onBlur={onFocusOut} className="divide-y divide-[var(--line,var(--border))]">
					{annotations.map((a, i) => (
						<AnnotationEntry
							key={a.id}
							sessionId={sessionId}
							index={i + 1}
							annotation={a}
							editing={editingId === a.id}
							anchorSessionId={anchorSessionId ?? sessionId}
							onMove={onMove}
							moveLabel={moveLabel}
							onEdit={(id) => {
								setEditingId(id);
								// Enter/Esc unmount the focused input; without this the popover could stay pinned open.
								if (id === null) setFocused(false);
							}}
							onRemove={() => {
								setEditingId(null);
								setFocused(false);
							}}
						/>
					))}
				</ol>
			</FloatingLayer>
		</>
	);
}
