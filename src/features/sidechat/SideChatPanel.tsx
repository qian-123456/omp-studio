/** [B] Right tab: side-chat forks of the selected session. */

import clsx from "clsx";
import { ArrowUp, ChevronDown, Loader2, MoreHorizontal, Plus } from "lucide-react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { ModelMenuContent } from "../../components/ModelSelect";
import { ThinkingLevelPicker } from "../../components/ThinkingLevelPicker";
import { type ClipboardEvent, type DragEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { errMsg } from "../../lib/dialogs";
import { importImageFile, saveClipboardImage } from "../../lib/ipc";
import { isComposing } from "../../lib/hooks";
import { type ModelOption, resolveCurrentModel, resolveThinkingLevels, toModelKey } from "../../lib/models";
import { toast } from "../../lib/toast";
import { type Annotation, type ComposerImage, sideChatAnnKey, useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { composeSelection, parseSelection, RESOLVABLE_ROLES, roleIdOf } from "../../components/modelSelectLogic";
import { ensureSettings, useSettings } from "../settings/store";
import { startNewSession } from "../sessions/newSession";
import { SessionView } from "../chat/SessionView";
import { AnnotationChip } from "../chat/AnnotationChip";
import { AddMenuPopover } from "../chat/AddMenuPopover";
const SketchPad = lazy(() =>
	import("../chat/sketch/SketchPad").then((m) => ({ default: m.SketchPad })),
);
import { AttachmentThumb } from "../chat/ImageChips";
import { textAnnotationsOf } from "../chat/annotations";
import { moveToMain } from "./annotationRoute";
import { MAX_SIDE_CHAT_DEPTH } from "./depth";
import {
	resolveSideChatModel,
	sideChatModelLabel,
	sideChatSelectorUsable,
} from "./modelDefault";
import { SIDE_CHAT_TAB_ACTIONS, sendFirstMessage } from "./sideChatActions";
import { visibleSideChatActions } from "./handbackLogic";
import { useDisplayPrefs } from "../../stores/displayPrefs";
import { isBlankTab, resolveActiveTab, useSideChatView } from "./viewStore";
import { useTypeToFocus } from "../chat/useTypeToFocus";
import { useT } from "../../stores/language";
import {
	imageFileToBase64,
	isSideChatImagePath,
	insertSideChatImageMarker,
	removeSideChatImageToken,
	sideChatPreviewText,
} from "./sideChatAttachments";


 
const EMPTY_IMAGES: ComposerImage[] = [];
const NO_MODELS: ModelOption[] = [];
const EMPTY_ANNS: Annotation[] = [];

/** Right tab body: the active side-chat tab of the selected session (thread or blank new chat). */
export function SideChatPanel() {
	const { t } = useT();
	const parentId = useUi((s) => s.selectedSessionId);
	const sessions = useSessions((s) => s.sessions);
	const tabs = useSideChatView((s) => (parentId ? s.openTabs[parentId] : undefined));
	const stored = useSideChatView((s) => (parentId ? s.openChild[parentId] : undefined));
	const active = resolveActiveTab(tabs, stored);

	// Drop tabs whose session no longer exists (deleted from the sidebar).
	useEffect(() => {
		if (!parentId || !tabs || Object.keys(sessions).length === 0) return;
		for (const id of tabs) {
			if (!isBlankTab(id) && !sessions[id]) useSideChatView.getState().closeTab(parentId, id);
		}
	}, [parentId, tabs, sessions]);

	// Nothing open for this parent while the group is showing: offer ONE blank new chat.
	// Re-reads the store: this effect can run twice with the same stale `active`
	// (StrictMode double-invoke, or a second panel mount) and must not add a second blank tab.
	useEffect(() => {
		if (!parentId || active || useUi.getState().rightTab !== "sidechat") return;
		const view = useSideChatView.getState();
		if (resolveActiveTab(view.openTabs[parentId], view.openChild[parentId])) return;
		view.openBlankTab(parentId);
	}, [parentId, active]);

	if (!parentId) {
		return <div className="p-3 text-xs text-[var(--text-40)]">{t("sidechat.needSessionFirst")}</div>;
	}
	if (!active) return null;
	if (isBlankTab(active)) return <NewSideChat key={active} parentId={parentId} tabId={active} />;
	return <SideChatThread key={active} childId={active} />;
}

/** An existing side chat: a compact thread view plus a 更多 menu for the extra actions. */
function SideChatThread({ childId }: { childId: string }) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);
	const handbackMode = useDisplayPrefs((s) => s.sideChatHandback);

	// Opening / switching to a side-chat thread puts the caret in its composer.
	useEffect(() => {
		const timer = setTimeout(() => {
			document.querySelector<HTMLTextAreaElement>(`textarea[data-composer="${CSS.escape(childId)}"]`)?.focus();
		}, 50);
		return () => clearTimeout(timer);
	}, [childId]);
	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 justify-end px-2 pt-1.5">
				<button
					ref={btnRef}
					type="button"
					aria-label={t("shell.moreActions")}
					title={t("shell.moreActions")}
					onClick={() => setOpen((v) => !v)}
					className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
				>
					<MoreHorizontal size={15} />
				</button>
				<FloatingLayer
					anchor={open ? btnRef.current : null}
					layer="menu"
					placement="bottom-end"
					offset={4}
					ignoreRefs={[btnRef]}
					onDismiss={() => setOpen(false)}
					className="min-w-36 py-1 text-xs"
				>
					{visibleSideChatActions(SIDE_CHAT_TAB_ACTIONS, handbackMode).map((a) => (
						<button
							key={a.key}
							type="button"
							onClick={() => {
								setOpen(false);
								void a.run(childId);
							}}
							className="flex w-full items-center px-3 py-1.5 text-left text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						>
							{a.label}
						</button>
					))}
				</FloatingLayer>
			</div>
			<div className="min-h-0 flex-1">
				<SessionView key={childId} sessionId={childId} compact />
			</div>
		</div>
	);
}

/** A blank new side chat: nothing exists on the backend until the first message is sent. */
function NewSideChat({ parentId, tabId }: { parentId: string; tabId: string }) {
	const { t } = useT();
	const selectedId = parentId;
	const sessions = useSessions((s) => s.sessions);
	const sideChatDrafts = useComposer((s) => s.sideChatDrafts);
	const setSideChatDraft = useComposer((s) => s.setSideChatDraft);
	const clearSideChatDraft = useComposer((s) => s.clearSideChatDraft);
	// The draft belongs to this blank tab.
	const question = sideChatDrafts[tabId] ?? "";
	const setQuestion = (val: string) => setSideChatDraft(tabId, val);
	const [busy, setBusy] = useState(false);
	/** First message while the session is being created: shown as a pending bubble. */
	const pendingQuestion = useSideChatView((s) => s.pending[tabId] ?? null);
	const [error, setError] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const images = useComposer((s) => s.images[tabId] ?? EMPTY_IMAGES);
	const [attachingImages, setAttachingImages] = useState(0);
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const [sketchOpen, setSketchOpen] = useState(false);
	const addBtnRef = useRef<HTMLButtonElement>(null);
	const attachmentRef = useRef<HTMLDivElement | null>(null);
	const selectionRef = useRef({ start: 0, end: 0 });
	const nativeDropRef = useRef<(paths: string[]) => void>(() => {});
	const rememberSelection = (textarea: HTMLTextAreaElement) => {
		selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
	};
	const registerImagePath = async (path: string, name?: string, importPath = true) => {
		const storedPath = importPath ? await importImageFile(path).catch(() => path) : path;
		const currentText = useComposer.getState().sideChatDrafts[tabId] ?? "";
		const currentImages = useComposer.getState().images[tabId] ?? EMPTY_IMAGES;
		useComposer.getState().addImage(tabId, storedPath, name);
		const { text: nextText, cursor } = insertSideChatImageMarker(
			currentText,
			`🖼️#${currentImages.length + 1}`,
			selectionRef.current.start,
			selectionRef.current.end,
		);
		setSideChatDraft(tabId, nextText);
		selectionRef.current = { start: cursor, end: cursor };
		setTimeout(() => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			textarea.focus();
			textarea.setSelectionRange(cursor, cursor);
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
		}, 0);
	};
	const addImageFile = async (file: File | Blob) => {
		const path = await saveClipboardImage(await imageFileToBase64(file));
		await registerImagePath(path, file instanceof File ? file.name : undefined, false);
	};
	const processImageFiles = async (files: readonly File[]) => {
		setAttachingImages((count) => count + files.length);
		try {
			for (const file of files) {
				if (file.type.startsWith("image/") || isSideChatImagePath(file.name)) {
					await addImageFile(file);
				}
			}
		} catch (err) {
			toast.error(t("sidechat.imageAttachFailed", { error: errMsg(err) }));
		} finally {
			setAttachingImages((count) => Math.max(0, count - files.length));
		}
	};
	const pickImages = async () => {
		if (textareaRef.current) rememberSelection(textareaRef.current);
		try {
			const selected = await openDialog({
				multiple: true,
				directory: false,
				title: t("sidechat.addImage"),
				filters: [{
					name: t("sidechat.imageFiles"),
					extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "heif"],
				}],
			});
			if (!selected) return;
			const paths = typeof selected === "string" ? [selected] : selected;
			setAttachingImages((count) => count + paths.length);
			try {
				for (const path of paths) {
					if (!isSideChatImagePath(path)) continue;
					await registerImagePath(path, path.split(/[\\/]/u).pop());
				}
			} finally {
				setAttachingImages((count) => Math.max(0, count - paths.length));
			}
		} catch (err) {
			toast.error(t("sidechat.imageAttachFailed", { error: errMsg(err) }));
		}
	};
	const insertSketch = async (dataUrl: string) => {
		setSketchOpen(false);
		if (textareaRef.current) rememberSelection(textareaRef.current);
		try {
			const blob = await (await fetch(dataUrl)).blob();
			setAttachingImages((count) => count + 1);
			try {
				await addImageFile(new File([blob], `sketch-${Date.now()}.png`, { type: "image/png" }));
			} finally {
				setAttachingImages((count) => Math.max(0, count - 1));
			}
		} catch (err) {
			toast.error(t("sidechat.imageAttachFailed", { error: errMsg(err) }));
		}
	};
	const removeImage = (index: number) => {
		const currentImages = useComposer.getState().images[tabId] ?? EMPTY_IMAGES;
		const image = currentImages[index];
		if (!image) return;
		useComposer.getState().setImages(
			tabId,
			currentImages.filter((_, imageIndex) => imageIndex !== index),
		);
		setSideChatDraft(
			tabId,
			removeSideChatImageToken(question, index + 1),
		);
	};
	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = Array.from(event.clipboardData.items)
			.filter((item) => item.kind === "file")
			.map((item) => item.getAsFile())
			.filter((file): file is File => !!file && (file.type.startsWith("image/") || isSideChatImagePath(file.name)));
		if (!files.length) return;
		event.preventDefault();
		rememberSelection(event.currentTarget);
		void processImageFiles(files);
	};
	const onDrop = (event: DragEvent<HTMLDivElement>) => {
		if (!Array.from(event.dataTransfer.types).includes("Files")) return;
		event.preventDefault();
		setIsDraggingOver(false);
		if (textareaRef.current) rememberSelection(textareaRef.current);
		void processImageFiles(Array.from(event.dataTransfer.files));
	};
	const onDragOver = (event: DragEvent<HTMLDivElement>) => {
		if (!Array.from(event.dataTransfer.types).includes("Files")) return;
		event.preventDefault();
		setIsDraggingOver(true);
	};
	useEffect(() => {
		nativeDropRef.current = (paths) => {
			if (textareaRef.current) rememberSelection(textareaRef.current);
			setAttachingImages((count) => count + paths.length);
			void (async () => {
				try {
					for (const path of paths) {
						if (isSideChatImagePath(path)) {
							await registerImagePath(path, path.split(/[\\/]/u).pop());
						}
					}
				} catch (err) {
					toast.error(t("sidechat.imageAttachFailed", { error: errMsg(err) }));
				} finally {
					setAttachingImages((count) => Math.max(0, count - paths.length));
				}
			})();
		};
	});
	useEffect(() => {
		const hitTest = (position: { x: number; y: number }) => {
			const target = attachmentRef.current;
			if (!target) return false;
			const scale = window.devicePixelRatio || 1;
			const rect = target.getBoundingClientRect();
			return position.x / scale >= rect.left && position.x / scale <= rect.right &&
				position.y / scale >= rect.top && position.y / scale <= rect.bottom;
		};
		let unlisten: (() => void) | undefined;
		let disposed = false;
		getCurrentWebview().onDragDropEvent((event) => {
			const payload = event.payload;
			if (payload.type === "enter" || payload.type === "over") {
				setIsDraggingOver(hitTest(payload.position));
			} else if (payload.type === "drop") {
				setIsDraggingOver(false);
				if (hitTest(payload.position) && payload.paths.length > 0) {
					nativeDropRef.current(payload.paths);
				}
			} else {
				setIsDraggingOver(false);
			}
		}).then((stop) => {
			if (disposed) stop();
			else unlisten = stop;
		}).catch((err) => console.warn("[sidechat] drag-drop listener failed", err));
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, []);
	const catalog = useModelOptions();
	const models = catalog ?? NO_MODELS;
	const dedicatedSetting = useSettings((s) => s.settings?.sideChatModel);
	// "" = no per-panel override: use the dedicated setting, else inherit the parent.
	const [selectedModel, setSelectedModel] = useState("");
	// "" = no override: the dedicated setting's level, else the parent session's.
	const [thinking, setThinking] = useState("");
	const [modelOpen, setModelOpen] = useState(false);
	const modelMenuRef = useRef<HTMLDivElement>(null);
	const [thinkingOpen, setThinkingOpen] = useState(false);
	const parentThinking = useLive((s) => {
		const v = selectedId ? s.sessions[selectedId]?.state?.thinkingLevel : undefined;
		return typeof v === "string" ? v : undefined;
	});
	// Parent's live model capabilities (`thinking`): used when inheriting the parent model.
	const parentLiveThinking = useLive((s) => {
		const m = selectedId ? s.sessions[selectedId]?.state?.model : undefined;
		return m && typeof m === "object" ? (m as Record<string, unknown>).thinking : undefined;
	});


	useEffect(() => {
		void useModelCatalog.getState().refresh();
		ensureSettings();
	}, []);

	const effective = useMemo(
		() => resolveSideChatModel(selectedModel, dedicatedSetting, catalog),
		[selectedModel, dedicatedSetting, catalog],
	);
	const dedicatedPick = useMemo(
		() => parseSelection(dedicatedSetting),
		[dedicatedSetting],
	);
	const dedicatedUsable =
		dedicatedPick.selector !== "" && sideChatSelectorUsable(dedicatedPick.selector, catalog);
	const dedicatedLabel = dedicatedUsable ? sideChatModelLabel(dedicatedSetting, catalog) : "";
	const effectiveThinking = thinking || effective.level || parentThinking || "auto";

	const parent = sessions[parentId];
	const tooDeep = (parent?.forkDepth ?? 0) >= MAX_SIDE_CHAT_DEPTH;
	const parentModel = useMemo(
		() => resolveCurrentModel(parent?.model, models),
		[parent?.model, models],
	);
	const activeModel = useMemo(
		() => (effective.selector ? resolveCurrentModel(effective.selector, models) : parentModel),
		[effective.selector, models, parentModel],
	);
	const effectiveOption = models.find(
		(m) => toModelKey(m.provider, m.id) === activeModel.value,
	);
	// Live capabilities only describe the parent's model; use them only when inheriting it.
	const resolvedLevels = resolveThinkingLevels(
		effective.selector ? undefined : parentLiveThinking,
		effectiveOption?.thinking,
		effectiveThinking,
	);
	// Unknown capabilities (role selectors, catalog without `thinking`): offer the
	// standard ladder instead of a lone current level.
	const thinkingLevels =
		resolvedLevels.length > 1
			? resolvedLevels
			: Array.from(
					new Set([
						"auto",
						"off",
						"minimal",
						"low",
						"medium",
						"high",
						"xhigh",
						...resolvedLevels,
					]),
				);
	const effectiveRole = roleIdOf(effective.selector);
	const baseModelName = effectiveRole
		? RESOLVABLE_ROLES[effectiveRole]
		: (activeModel.label || activeModel.id || t("models.selectModel"));
	const displayModelName = baseModelName;
	const annKey = selectedId ? sideChatAnnKey(selectedId) : "";
	const stagedAll = useComposer((s) => s.annotations[annKey]) ?? EMPTY_ANNS;
	const stagedAnns = useMemo(() => textAnnotationsOf(stagedAll), [stagedAll]);
	// SelectionToolbar bumps this nonce each time it stages into our key.
	const stagedFocusNonce = useComposer((s) => (annKey ? s.focusNonce[annKey] : 0));


	// Focus whichever question input is mounted when a new annotation is staged
	// (also on first mount right after staging; a bumped-but-unconsumed nonce
	// never drops). Staged annotations live in the store, so nothing is lost
	// when this panel unmounts or the parent changes.
	const lastFocusNonceRef = useRef(0);
	useEffect(() => {
		const nonce = stagedFocusNonce ?? 0;
		if (!nonce || nonce === lastFocusNonceRef.current) return;
		lastFocusNonceRef.current = nonce;
		setTimeout(() => {
			const input = textareaRef.current;
			input?.focus();
		}, 50);
	}, [stagedFocusNonce, tabId, stagedAnns.length]);

	useEffect(() => {
		setError(null);
	}, [tabId]);

	// Opening (or switching to) a blank side chat puts the caret in its input.
	useEffect(() => {
		const timer = setTimeout(() => textareaRef.current?.focus(), 0);
		return () => clearTimeout(timer);
	}, [tabId]);
	useTypeToFocus(textareaRef, true);

	const send = async () => {
		const q = question.trim();
		if (busy || attachingImages > 0 || (!q && stagedAnns.length === 0 && images.length === 0)) return;
		// omp `--model` accepts a `provider/id:thinking` suffix; the dedicated
		// setting's stored level applies unless the thinking picker overrides it.
		const modelArg = effective.selector
			? composeSelection(effective.selector, effectiveThinking === "auto" ? null : effectiveThinking)
			: null;
		setBusy(true);
		setError(null);
		// The input empties at once (the message shows as a pending bubble);
		// the draft comes back if creation or the first ask fails.
		clearSideChatDraft(tabId);
		if (textareaRef.current) textareaRef.current.style.height = "auto";
		try {
			await sendFirstMessage({
				parentId,
				tabId,
				text: q,
				annotations: stagedAll,
				model: modelArg,
				images,
			});
		} catch (err) {
			const msg = errMsg(err);
			// The request may settle after the user has started another draft.
			if (!useComposer.getState().sideChatDrafts[tabId]) setSideChatDraft(tabId, question);
			setError(msg);
			toast.error(t("sidechat.sendSideChatMessageFailed", { error: msg }));
		} finally {
			setBusy(false);
		}
	};
	const canSend =
		!busy &&
		attachingImages === 0 &&
		(question.trim().length > 0 || stagedAnns.length > 0 || images.length > 0);

	return (
		<div data-session-view={tabId} className="flex h-full flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{pendingQuestion ? (
					<div className="mb-2 ml-auto flex max-w-[85%] flex-col items-end gap-1">
						<div className="whitespace-pre-wrap rounded-2xl bg-[var(--bg-hover)] px-3 py-2 text-[13px] text-[var(--text)]">
							{sideChatPreviewText(pendingQuestion) || pendingQuestion}
						</div>
						{images.length > 0 && (
							<div className="flex flex-wrap justify-end gap-1.5">
								{images.map((image, index) => (
									<AttachmentThumb
									key={image.id || `${index + 1}-${image.path}`}
									path={image.path}
									index={index + 1}
									showIndex
									variant="bubble"
								/>
								))}
							</div>
						)}
						<div className="flex items-center gap-1 text-[10px] text-[var(--text-40)]">
							<Loader2 size={10} className="animate-spin" />
							{t("sidechat.creatingSideChat")}
						</div>
					</div>
				) : (
					<div className="py-4 text-center text-[11px] text-[var(--text-40)]">
						{t("sidechat.newChatGuide")}
					</div>
				)}
			</div>

			<div className="shrink-0 px-3 pb-3 pt-2">
				{tooDeep ? (
					<div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-3 text-center">
						<div className="text-[12px] font-medium text-[var(--text)]">
							{t("sidechat.depthLimitTitle")}
						</div>
						<div className="text-[11px] leading-relaxed text-[var(--text-40)]">
							{t("sidechat.depthLimitDesc")}
						</div>
						<button
							type="button"
							onClick={() => void startNewSession()}
							className="mt-1 flex items-center gap-1.5 rounded-md bg-[var(--text)] px-3 py-1.5 text-[12px] font-medium text-[var(--bg-panel)] hover:opacity-90 transition-opacity"
						>
							<Plus size={13} />
							{t("sidechat.newMainSession")}
						</button>
					</div>
				) : (
					<>
						{error && (
							<div className="mb-2 text-[11px] text-[var(--status-error)]">{error}</div>
						)}

						<div
							ref={attachmentRef}
							onDragOver={onDragOver}
							onDragLeave={() => setIsDraggingOver(false)}
							onDrop={onDrop}
							className={clsx(
								"relative rounded-[22px] border bg-[var(--bg-panel)] transition-colors duration-150",
								isDraggingOver
									? "border-[var(--text-30,var(--border))]"
									: "border-[var(--line,var(--border))]",
							)}
						>
							{images.length > 0 && (
								<div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2.5">
									{images.map((image, index) => (
										<AttachmentThumb
											key={image.id || `${index + 1}-${image.path}`}
											path={image.path}
											index={index + 1}
											showIndex
											variant="strip"
											onRemove={() => removeImage(index)}
										/>
									))}
								</div>
							)}
							{/* Staged annotations chip: hover to review/edit, move or delete. */}
							{stagedAnns.length > 0 && (
								<div className="px-3 pt-2.5">
									<AnnotationChip
										sessionId={annKey}
										anchorSessionId={selectedId}
										annotations={stagedAnns}
										onMove={(id) => moveToMain(annKey, parentId, id)}
										moveLabel={t("sidechat.moveToMain")}
									/>
								</div>
							)}

							<textarea
								ref={textareaRef}
								value={question}
								onChange={(e) => {
									setQuestion(e.target.value);
									rememberSelection(e.currentTarget);
									e.target.style.height = "auto";
									e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
								}}
								onSelect={(e) => rememberSelection(e.currentTarget)}
								onPaste={onPaste}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										if (isComposing(e)) return;
										e.preventDefault();
										void send();
									}
								}}
								placeholder={t("sidechat.inputPlaceholder")}
								rows={1}
								className="w-full resize-none bg-transparent px-4 pt-3 pb-1.5 font-sans text-[var(--chat-font-size,14px)] leading-[1.35] text-[var(--text)] placeholder:text-[var(--text-30,var(--text-dim))] outline-none max-h-36 min-h-[40px]"
							/>

							<div className="flex min-w-0 items-end justify-between gap-2 px-2.5 pb-2 text-[12px]">
								<button
									ref={addBtnRef}
									type="button"
									disabled={busy || attachingImages > 0}
									onClick={() => setAddMenuOpen((v) => !v)}
									title={t("chat.addMenu.add")}
									aria-label={t("chat.addMenu.add")}
									aria-expanded={addMenuOpen}
									className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-60,var(--text-muted))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
								>
									<Plus size={15} />
								</button>
								{addMenuOpen && (
									<AddMenuPopover
										anchor={addBtnRef.current}
										ignoreRef={addBtnRef}
										onClose={() => setAddMenuOpen(false)}
										onAddImages={() => void pickImages()}
										onSketch={() => setSketchOpen(true)}
									/>
								)}
								<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 select-none">
									{/* Model Picker */}
									<div className="relative max-w-full shrink-0" ref={modelMenuRef}>
										<button
											type="button"
											onClick={() => setModelOpen((v) => !v)}
											title={t("sidechat.modelTooltip", { model: displayModelName, source: effective.source === "picker" ? "" : effective.source === "setting" ? t("sidechat.sourceDedicated") : t("sidechat.sourceFollowParent") })}
											className="flex min-w-0 max-w-full items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors select-none"
										>
											<span className="min-w-0 break-all text-left">{displayModelName}</span>
											<ChevronDown size={10} className="shrink-0 text-[var(--text-30,var(--text-dim))]" />
										</button>

										{modelOpen && (
											<FloatingLayer
												anchor={modelMenuRef.current}
												placement="top-start"
												offset={6}
												layer="popover"
												ignoreRefs={[modelMenuRef]}
												onDismiss={() => setModelOpen(false)}
												className="w-[320px] rounded-xl border border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] py-1 shadow-lg"
											>
												<ModelMenuContent
													models={catalog}
													currentValue={effective.selector}
													extras={[
														{
															value: "",
															label: dedicatedUsable
																? t("sidechat.defaultDedicated", { label: dedicatedLabel })
																: parentModel.label
																	? t("sidechat.defaultFollowParent", { label: parentModel.label })
																	: t("sidechat.defaultFollowParentGeneric"),
														},
													]}
													onSelect={(key) => {
														setSelectedModel(key);
														setThinking("");
														setModelOpen(false);
													}}
												/>
											</FloatingLayer>
										)}
									</div>

									{/* Thinking Level Picker (shared with the main composer) */}
									<ThinkingLevelPicker
										levels={thinkingLevels}
										reasoning={effectiveOption?.reasoning}
										value={effectiveThinking}
										open={thinkingOpen}
										onOpenChange={setThinkingOpen}
										onSelect={setThinking}
									/>
								</div>

								{/* Send Button */}
								<button
									type="button"
									disabled={!canSend}
									onClick={() => void send()}
									title={busy ? t("sidechat.sending") : t("sidechat.sendEnter")}
									className={clsx(
										"flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150 shrink-0",
										busy || attachingImages > 0
												? "bg-[var(--bg-hover)] text-[var(--text-40)] cursor-not-allowed"
												: canSend
													? "bg-[var(--text)] text-[var(--bg-panel)] hover:opacity-90 active:scale-95 shadow-xs"
													: "bg-[var(--bg-hover)] text-[var(--text-30,var(--text-dim))] cursor-not-allowed",
									)}
								>
									{busy ? (
										<Loader2 size={13} className="animate-spin text-[var(--text-40)]" />
									) : (
										<ArrowUp size={14} className="stroke-[2.5]" />
									)}
								</button>
							</div>
						</div>
						{sketchOpen && (
							<Suspense fallback={null}>
								<SketchPad
									composerTop={attachmentRef.current?.getBoundingClientRect().top ?? null}
									onCancel={() => setSketchOpen(false)}
									onInsert={(d) => void insertSketch(d)}
								/>
							</Suspense>
						)}
					</>
				)}
			</div>
		</div>
	);
}

