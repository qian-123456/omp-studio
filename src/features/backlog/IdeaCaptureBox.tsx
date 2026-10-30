import { ArrowUp, Bug, ImagePlus, Lightbulb, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { BacklogItem, BacklogKind, BacklogRef } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { backlogAdd } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useT } from "../../stores/language";
import { useBacklog } from "./backlogStore";
import { CaptureProjectSelect } from "./CaptureProjectSelect";
import { IdeaEditor, type IdeaEditorHandle } from "./IdeaEditor";
import { ImageThumbs, useImageAttach } from "./IdeaImages";
import { resolveCaptureProject } from "./ideasLogic";
import { docToStored, ensureTokens, insertImages, reconcileDoc, removeImage } from "./ideaTokens";
import { KIND_META } from "./ideaStyles";

const KIND_CONFIG: { kind: BacklogKind; labelKey: string; Icon: typeof Bug }[] = [
	{ kind: "bug", labelKey: "backlog.kindBug", Icon: Bug },
	{ kind: "idea", labelKey: "backlog.kindIdea", Icon: Lightbulb },
];

export interface IdeaCaptureBoxProps {
	/** "panel" = top of the ideas popover; "quick" = global quick-capture layer (adds 「附带当前会话」). */
	variant: "panel" | "quick";
	autoFocus?: boolean;
	onSubmitted?: (item: BacklogItem) => void;
	/** Session the capture belongs to (project default, session ref). Defaults to the selected session. */
	sessionId?: string | null;
}

/**
 * Idle pill that grows into a rounded card on focus / content. Shared by the ideas panel
 * and QuickCapture: same draft (backlog store), same stored format (`[图片: path]` inline tags).
 */
export function IdeaCaptureBox({ variant, autoFocus, onSubmitted, sessionId }: IdeaCaptureBoxProps) {
	const { t } = useT();
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const sessions = useSessions((s) => s.sessions);
	const targetSessionId = sessionId === undefined ? selectedSessionId : sessionId;
	const targetSession = targetSessionId ? sessions[targetSessionId] : undefined;
	const currentProject = targetSession?.cwd ?? null;

	const { text, kind, images } = useBacklog((s) => s.draft);
	const setDraft = useBacklog((s) => s.setDraft);
	const setLastKind = useBacklog((s) => s.setLastKind);
	const doc = useMemo(() => ensureTokens({ text, images }), [text, images]);

	const [focused, setFocused] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [attachSession, setAttachSession] = useState(true);
	const wrapRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<IdeaEditorHandle>(null);

	const attach = useImageAttach((paths) => {
		const d = useBacklog.getState().draft;
		const r = insertImages(
			ensureTokens({ text: d.text, images: d.images }),
			editorRef.current?.caret() ?? d.text.length,
			paths,
		);
		editorRef.current?.placeCaret(r.caret);
		setDraft({ text: r.doc.text, images: r.doc.images });
	});

	const hasContent = docToStored(doc).length > 0;
	const expanded = focused || hasContent;

	const submit = async () => {
		const stored = docToStored(doc);
		if (!stored || submitting) return;
		setSubmitting(true);
		try {
			const refs: BacklogRef[] = [];
			if (variant === "quick" && attachSession && targetSessionId) {
				refs.push({ kind: "session", sessionId: targetSessionId, path: null, text: null, lines: null });
			}
			const item = await backlogAdd(
				stored,
				kind,
				refs,
				resolveCaptureProject(useBacklog.getState().captureProject, currentProject),
			);
			useBacklog.getState().clearDraft();
			await useBacklog.getState().load();
			setFocused(false);
			if (wrapRef.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
			onSubmitted?.(item);
		} catch (err) {
			toast.error(t("backlog.saveFailed", { error: errMsg(err) }));
		} finally {
			setSubmitting(false);
		}
	};

	const sendButton = (
		<button
			type="button"
			onClick={() => void submit()}
			disabled={!hasContent || submitting}
			title={t("backlog.captureEnterTitle")}
			aria-label={t("backlog.captureAriaLabel")}
			className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)] transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-25 disabled:hover:opacity-25"
		>
			{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
		</button>
	);

	const imageButton = (
		<button
			type="button"
			onClick={attach.pick}
			title={t("backlog.addImageTitle")}
			aria-label={t("backlog.addImageAriaLabel")}
			className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
		>
			<ImagePlus className="h-4 w-4" />
		</button>
	);

	if (variant === "quick") {
		return (
			<div
				ref={wrapRef}
				{...attach.dropProps}
				onFocus={() => setFocused(true)}
				onBlur={(e) => {
					if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setFocused(false);
				}}
				className={`flex flex-col bg-transparent ${attach.dragging ? "outline-dashed outline-1 outline-[var(--accent)]" : ""}`}
			>
				<div>
					<IdeaEditor
						ref={editorRef}
						doc={doc}
						autoFocus={autoFocus}
						onChange={(d) => {
							const r = reconcileDoc(d);
							setDraft({ text: r.text, images: r.images });
						}}
						onPaste={attach.onPaste}
						onKeyDown={(e) => {
							if (e.key !== "Enter" || e.shiftKey) return;
							e.preventDefault();
							if (isComposing(e)) return;
							void submit();
						}}
						placeholder={t("backlog.capturePlaceholder")}
						minHeight={72}
						maxHeight={220}
						textClass="text-[13px] leading-relaxed"
						bgClass="bg-transparent"
						boxClass="border-transparent"
					/>
					{images.length > 0 && (
						<div className="pt-2">
							<ImageThumbs
								paths={doc.images}
								onRemove={(p) => {
									const r = removeImage(doc, doc.images.indexOf(p) + 1);
									setDraft({ text: r.text, images: r.images });
								}}
							/>
						</div>
					)}
				</div>
				<div
					className="mt-3.5 flex items-center justify-between gap-2"
					onMouseDown={(e) => {
						if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
					}}
				>
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						{imageButton}
						<div className="inline-flex shrink-0 items-center rounded-full border border-[var(--border-divider)] p-0.5 bg-[var(--well-bg)]">
							{KIND_CONFIG.map(({ kind: k, labelKey, Icon }) => (
								<button
									key={k}
									type="button"
									onClick={() => {
										setDraft({ kind: k });
										setLastKind(k);
									}}
									aria-pressed={kind === k}
									className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium transition-colors ${
										kind === k
											? KIND_META[k].tone
											: "text-[var(--text-dim)] hover:text-[var(--text)]"
									}`}
								>
									<Icon className="h-3 w-3" />
									{t(labelKey)}
								</button>
							))}
						</div>
						<CaptureProjectSelect currentProject={currentProject} showIcon />
						{targetSessionId && (
							<label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-1 text-[12px] text-[var(--text-dim)] hover:text-[var(--text)] select-none">
								<input
									type="checkbox"
									checked={attachSession}
									onChange={(e) => setAttachSession(e.target.checked)}
									className="h-3.5 w-3.5 rounded border-[var(--border-divider)] accent-[var(--accent)]"
								/>
								<span className="whitespace-nowrap" title={targetSession?.title || targetSessionId}>
									{t("backlog.attachCurrentSession")}
								</span>
							</label>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						{sendButton}
					</div>
				</div>
				{attach.fileInput}
			</div>
		);
	}

	return (
		<div
			ref={wrapRef}
			{...attach.dropProps}
			onFocus={() => setFocused(true)}
			onBlur={(e) => {
				if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setFocused(false);
			}}
			className={`border transition-[border-color,box-shadow] focus-within:border-[color-mix(in_srgb,var(--text-dim)_30%,transparent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--text-dim)_10%,transparent)] border-[color-mix(in_srgb,var(--border-divider)_45%,transparent)] bg-[var(--well-bg)] ${
				expanded ? "rounded-[18px] px-2 pb-2 pt-1.5" : "rounded-full px-1.5 py-1"
			} ${attach.dragging ? "outline-dashed outline-1 outline-[var(--accent)]" : ""}`}
		>
			{expanded && images.length > 0 && (
				<div className="px-2 pb-1 pt-1">
					<ImageThumbs
						paths={doc.images}
						onRemove={(p) => {
							const r = removeImage(doc, doc.images.indexOf(p) + 1);
							setDraft({ text: r.text, images: r.images });
						}}
					/>
				</div>
			)}
			<div className="flex items-center gap-1">
				{!expanded && imageButton}
				<div className="min-w-0 flex-1">
					<IdeaEditor
						ref={editorRef}
						doc={doc}
						autoFocus={autoFocus}
						onChange={(d) => {
							const r = reconcileDoc(d);
							setDraft({ text: r.text, images: r.images });
						}}
						onPaste={attach.onPaste}
						onKeyDown={(e) => {
							if (e.key !== "Enter" || e.shiftKey) return;
							e.preventDefault();
							if (isComposing(e)) return;
							void submit();
						}}
						placeholder={t("backlog.capturePlaceholder")}
						minHeight={32}
						maxHeight={160}
						bgClass="bg-transparent"
						boxClass="border-transparent"
					/>
				</div>
				{!expanded && sendButton}
			</div>
			{expanded && (
				// Keep focus in the editor while pressing pills, otherwise the card would collapse mid-click.
				<div
					className="mt-1 flex flex-wrap items-center gap-1.5 px-0.5"
					onMouseDown={(e) => {
						if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
					}}
				>
					<div className="flex min-w-0 items-center gap-1.5">
						{imageButton}
						<CaptureProjectSelect currentProject={currentProject} showIcon />
						<div className="inline-flex shrink-0 items-center rounded-full border border-[var(--border-divider)] p-0.5">
							{KIND_CONFIG.map(({ kind: k, labelKey, Icon }) => (
								<button
									key={k}
									type="button"
									onClick={() => {
										setDraft({ kind: k });
										setLastKind(k);
									}}
									aria-pressed={kind === k}
									className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] transition-colors ${
										kind === k
											? KIND_META[k].tone
											: "text-[var(--text-dim)] hover:text-[var(--text)]"
									}`}
								>
									<Icon className="h-3 w-3" />
									{t(labelKey)}
								</button>
							))}
						</div>
					</div>
					{sendButton}
				</div>
			)}
			{attach.fileInput}
		</div>
	);
}
