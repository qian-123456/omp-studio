import { useRef } from "react";
import { useT } from "../../stores/language";
import { isEscapeClaimed } from "../../lib/escapeClaim";
import { isComposing } from "../../lib/hooks";
import { LIGHTBOX_SELECTOR, MODAL_SELECTOR } from "../../components/FloatingLayer";
import type { BacklogKind } from "../../lib/contracts";
import { useBacklog } from "./backlogStore";
import { IdeaEditor, type IdeaEditorHandle } from "./IdeaEditor";
import { useImageAttach } from "./IdeaImages";
import { EditProjectSelect } from "./CaptureProjectSelect";
import { ensureTokens, insertImages, reconcileDoc, storedToDoc, type TokenDoc } from "./ideaTokens";
import { KIND_META, KINDS } from "./ideaStyles";

/** Edit buffer → editable doc (buffers saved before inline tokens carry raw `[图片: path]` tags). */
export function bufferDoc(buf: { text: string; images?: string[] }): TokenDoc {
	return buf.images ? ensureTokens({ text: buf.text, images: buf.images }) : storedToDoc(buf.text);
}

function hasOpenOverlay(root: HTMLElement | null): boolean {
	if (document.querySelector(LIGHTBOX_SELECTOR)) return true;
	if (document.querySelector(MODAL_SELECTOR)) return true;
	if (root) {
		const parentLayer = root.closest("[data-layer]");
		for (const layer of document.querySelectorAll("[data-layer]")) {
			if (layer === parentLayer || parentLayer?.contains(layer)) continue;
			if (!parentLayer || (parentLayer.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING)) {
				return true;
			}
		}
	}
	return false;
}

/** In-place editor for one idea: auto-growing, Enter saves, Esc cancels, paste/drop adds image tokens. */
export function IdeaEditBox({
	id,
	kind,
	onKindChange,
	project,
	onProjectChange,
	onSave,
	onCancel,
}: {
	id: string;
	kind: BacklogKind;
	onKindChange: (kind: BacklogKind) => void;
	/** Project dir the idea is filed under while editing; `CAPTURE_PROJECT_NONE` = none. */
	project: string;
	onProjectChange: (dir: string) => void;
	onSave: () => void;
	onCancel: () => void;
}) {
	const { t } = useT();
	const buf = useBacklog((s) => s.editBuffer);
	const setEditBuffer = useBacklog((s) => s.setEditBuffer);
	const boxRef = useRef<HTMLDivElement>(null);
	const ref = useRef<IdeaEditorHandle>(null);
	const attach = useImageAttach((paths) => {
		const b = useBacklog.getState().editBuffer;
		if (!b || b.id !== id) return;
		const r = insertImages(bufferDoc(b), ref.current?.caret() ?? b.text.length, paths);
		ref.current?.placeCaret(r.caret);
		setEditBuffer({ id, text: r.doc.text, images: r.doc.images });
	});
	if (!buf || buf.id !== id) return null;
	return (
		<div ref={boxRef} className="space-y-1.5" data-owns-escape>
			<div {...attach.dropProps} className={`rounded-xl ${attach.dragging ? "outline-dashed outline-1 outline-[var(--accent)]" : ""}`}>
				<IdeaEditor
					ref={ref}
					doc={bufferDoc(buf)}
					autoFocus
					onChange={(d) => {
						const r = reconcileDoc(d);
						setEditBuffer({ id, text: r.text, images: r.images });
					}}
					onPaste={attach.onPaste}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							if (isEscapeClaimed(e.nativeEvent) || isEscapeClaimed(e as unknown as Event)) return;
							if (hasOpenOverlay(boxRef.current)) return;
							onCancel();
							return;
						}
						if (e.key !== "Enter" || e.shiftKey) return;
						e.preventDefault();
						if (!isComposing(e)) onSave();
					}}
					onBlur={(e) => {
						// Window lost focus (app switch / reload): keep the buffer.
						if (!document.hasFocus()) return;
						// If an overlay/lightbox/modal or nested picker is open, keep the buffer.
						if (hasOpenOverlay(boxRef.current)) return;
						// Focus moving to a child of the editor or an opened floating layer: keep the buffer.
						if (
							e.relatedTarget instanceof Element &&
							(boxRef.current?.contains(e.relatedTarget) || e.relatedTarget.closest("[data-layer]"))
						) {
							return;
						}
						onCancel();
					}}
					minHeight={52}
					maxHeight={240}
					boxClass="rounded-xl border-[var(--accent)]"
				/>
				<div className="mt-1 flex items-center justify-between gap-2">
					<div className="text-[10px] text-[var(--text-dim)]">{t("backlog.editBufferHint")}</div>
					<div className="flex shrink-0 items-center gap-1.5">
					<EditProjectSelect value={project} onChange={onProjectChange} />
					<div className="inline-flex shrink-0 items-center rounded-full border border-[var(--border-divider)] p-0.5">
						{KINDS.map((k) => {
							const Icon = KIND_META[k].icon;
							return (
								<button
									key={k}
									type="button"
									aria-pressed={kind === k}
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => onKindChange(k)}
									className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] transition-colors ${
										kind === k
											? KIND_META[k].tone
											: "text-[var(--text-dim)] hover:text-[var(--text)]"
									}`}
								>
									<Icon className="h-3 w-3" />
									{t(KIND_META[k].labelKey)}
								</button>
							);
						})}
					</div>
					</div>
				</div>
			</div>
		</div>
	);
}
