/** [C] Center "文档" view: md preview/annotate/edit (docs/ARCHITECTURE.md §11 C). */

import CodeMirror, { type ViewUpdate } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import clsx from "clsx";
import { FileText, MessageSquarePlus, RefreshCw, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { confirmDialog } from "../../lib/dialogs";
import { isComposing, useEscapeKey, useShortPath } from "../../lib/hooks";
import { basename } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { NativeSelect } from "../../components/NativeSelect";
import { claimEscape } from "../../lib/escapeClaim";
import { useFileBuffer } from "./useFileBuffer";
import { tNow, useT } from "../../stores/language";

type Tab = "preview" | "split" | "edit";

interface Selection {
	text: string;
}

export function DocView({ path }: { path: string }) {
	const { t } = useT();
	const buffer = useFileBuffer(path);
	const { saved, draft, setDraft, error, external, saving, dirty } = buffer;
	const [tab, setTab] = useState<Tab>("preview");
	const [note, setNote] = useState<string | null>(null);
	const [sel, setSel] = useState<Selection | null>(null);
	const [comment, setComment] = useState("");
	const [pickSession, setPickSession] = useState("");
	const [lastAnnotatedSessionId, setLastAnnotatedSessionId] = useState<string | null>(null);
	const previewRef = useRef<HTMLDivElement>(null);

	const sessions = useSessions((s) => s.sessions);
	const sessionId = useUi((s) => s.selectedSessionId);
	const setCenter = useUi((s) => s.setCenter);
	const selectSession = useUi((s) => s.selectSession);
	const addAnnotation = useComposer((s) => s.addAnnotation);
	const short = useShortPath();

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload on path change
	useEffect(() => {
		setSel(null);
		setNote(null);
	}, [path]);

	const save = useCallback(async () => {
		if (!(await buffer.save())) return;
		const saved = tNow("editor.saved");
		setNote(saved);
		setTimeout(() => setNote((n) => (n === saved ? null : n)), 1500);
	}, [buffer]);

	// Cmd+S / Ctrl+S saves while editing.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [save]);
	const handleClose = async () => {
		if (
			dirty &&
			!(await confirmDialog(
				t("editor.discardConfirm"),
				{
					danger: true,
					title: t("editor.discardTitle"),
					okLabel: t("editor.discardAndExit"),
				},
			))
		) {
			return;
		}
		setCenter(sessionId ? "session" : "home");
	};

	useEscapeKey(handleClose);


	const reload = async () => {
		if (dirty && !(await confirmDialog(t("editor.discardAndReloadConfirm"), { danger: true }))) return;
		await buffer.reload();
	};

	const captureSelection = () => {
		const s = window.getSelection();
		if (!s || s.isCollapsed || !previewRef.current?.contains(s.anchorNode)) {
			if (!comment.trim()) {
				setSel(null);
			}
			return;
		}
		const text = s.toString().trim();
		if (text) {
			setSel({ text });
		} else if (!comment.trim()) {
			setSel(null);
		}
	};

	const handleCmUpdate = (viewUpdate: ViewUpdate) => {
		// IME composition marks the composing text as a selection; it is not a user selection.
		if (viewUpdate.view.composing || viewUpdate.view.compositionStarted) return;
		if (viewUpdate.selectionSet) {
			const mainSel = viewUpdate.state.selection.main;
			if (!mainSel.empty) {
				const text = viewUpdate.state.sliceDoc(mainSel.from, mainSel.to).trim();
				if (text) {
					setSel({ text });
				}
			} else if (!comment.trim()) {
				setSel(null);
			}
		}
	};

	const annotate = () => {
		const target = sessionId ?? (pickSession || null);
		if (!sel || !target) return;
		addAnnotation(target, {
			source: "doc",
			file: path,
			text: sel.text,
			comment: comment.trim() || undefined,
		});
		const sLabel = sessions[target]?.label || target.slice(0, 6);
		setLastAnnotatedSessionId(target);
		const added = t("editor.addedAnnotationToSession", { session: sLabel });
		setNote(added);
		toast.success(added);
		setTimeout(() => {
			setNote((n) => (n === added ? null : n));
		}, 2500);
		setSel(null);
		setComment("");
		window.getSelection()?.removeAllRanges();
	};
	const sessionList = Object.values(sessions).filter((s) => !s.archived);
	const annTarget = sessionId ?? (pickSession || null);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-b border-[var(--border-divider)]">
				<div className="flex items-center gap-2 px-3 pt-2 pb-1">
					<FileText size={14} className="shrink-0 text-neutral-400" />
					<span className="min-w-0 flex-1 truncate text-xs text-[var(--text)]" title={path}>
						<span className="font-medium">{basename(path)}</span>
						<span className="ml-1.5 text-[10px] text-neutral-500">{short(path)}</span>
					</span>
					{dirty && (
						<span className="shrink-0 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
							{t("editor.unsaved")}
						</span>
					)}
					{note && (
						<div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] text-emerald-400">
							<span>{note}</span>
							{lastAnnotatedSessionId && (
								<button
									type="button"
									onClick={() => selectSession(lastAnnotatedSessionId)}
									className="font-medium text-amber-400 hover:underline"
								>
									{t("editor.goToSession")}
								</button>
							)}
						</div>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 text-[11px] [&_button]:whitespace-nowrap">
					<div className="flex shrink-0 rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] p-0.5">
						{(
							[
								{ id: "preview", label: t("editor.tabPreview") },
								{ id: "split", label: t("editor.tabSplit") },
								{ id: "edit", label: t("editor.tabEdit") },
							] as const
						).map((t) => (
							<button
								key={t.id}
								type="button"
								onClick={() => setTab(t.id)}
								className={clsx(
									"px-2.5 py-0.5 rounded-md transition-colors",
									tab === t.id
										? "bg-[var(--bg-active-fill)] text-[var(--text)] shadow-xs"
										: "text-neutral-400 hover:text-[var(--text)]",
								)}
							>
								{t.label}
							</button>
						))}
					</div>
					<span className="flex-1" />
					<button
						type="button"
						title={t("editor.saveShortcut")}
						disabled={!dirty || saving}
						onClick={save}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40 transition-colors"
					>
						<Save size={13} />
						{t("common.save")}
					</button>
					<button
						type="button"
						title={t("editor.reloadFromDisk")}
						onClick={reload}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
					>
						<RefreshCw size={13} />
						{t("editor.reload")}
					</button>
					<button
						type="button"
						title={t("editor.closeEsc")}
						onClick={handleClose}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
					>
						<X size={13} />
						{t("common.close")}
					</button>
				</div>
			</div>

			{error && <div className="shrink-0 border-b border-[var(--border-divider)] px-3 py-1.5 text-xs text-rose-400">{error}</div>}
			{external && (
				<div className="flex shrink-0 items-center gap-2 border-b border-amber-800/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
					<span className="flex-1">{t("editor.fileModifiedOnDisk")}</span>
					<button type="button" onClick={reload} className="rounded bg-amber-800/60 px-2 py-0.5 hover:bg-amber-700/60">
						{t("editor.reload")}
					</button>
					<button type="button" onClick={buffer.dismissExternal} className="px-1.5 text-amber-300/80">
						{t("editor.keepMyChanges")}
					</button>
				</div>
			)}

			{tab === "split" ? (
				<div className="flex min-h-0 flex-1 overflow-hidden">
					<div className="flex-1 min-w-0 border-r border-neutral-800 overflow-hidden [&_.cm-editor]:h-full [&_.cm-editor]:bg-neutral-950 [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs">
						<CodeMirror
							value={draft}
							onChange={setDraft}
							onUpdate={handleCmUpdate}
							extensions={[markdown()]}
							theme="dark"
							height="100%"
							style={{ height: "100%" }}
							basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
						/>
					</div>
					<div
						ref={previewRef}
						onMouseUp={captureSelection}
						className="flex-1 min-w-0 overflow-y-auto px-5 py-3 text-sm"
					>
						{saved === null && !error && (
							<div className="py-6 text-center text-xs text-neutral-500">{t("editor.loading")}</div>
						)}
						{saved !== null && (
							<Markdown text={draft} />
						)}
					</div>
				</div>
			) : tab === "preview" ? (
				<div
					ref={previewRef}
					onMouseUp={captureSelection}
					className="min-h-0 flex-1 overflow-y-auto px-5 py-3 text-sm"
				>
					{saved === null && !error && <div className="py-6 text-center text-xs text-neutral-500">{t("editor.loading")}</div>}
					{saved !== null && (
						<Markdown text={draft} />
					)}
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-editor]:bg-neutral-950 [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs">
					<CodeMirror
						value={draft}
						onChange={setDraft}
						onUpdate={handleCmUpdate}
						extensions={[markdown()]}
						theme="dark"
						height="100%"
						style={{ height: "100%" }}
						basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
					/>
				</div>
			)}

			{sel && (
				<div className="flex shrink-0 items-end gap-2 border-t border-[var(--border-divider)] bg-[var(--bg-panel)] p-2.5 shadow-lg">
					<div className="min-w-0 flex-1">
						<div className="mb-1 truncate text-[10px] text-neutral-400 font-mono" title={sel.text}>
							{t("editor.selectedSnippet", { text: sel.text.length > 80 ? `${sel.text.slice(0, 80)}…` : sel.text })}
						</div>
						<textarea
							autoFocus
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							placeholder={t("editor.annotationInputPlaceholder")}
							rows={2}
							className="w-full resize-none rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] p-2 text-xs text-[var(--text)] outline-none focus:border-amber-500"
							onKeyDown={(e) => {
								if (isComposing(e)) return;
								if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
									e.preventDefault();
									if (annTarget) annotate();
								}
								if (e.key === "Escape") {
									claimEscape(e);
									if (!comment.trim()) {
										setSel(null);
										window.getSelection()?.removeAllRanges();
									}
								}
							}}
						/>
					</div>
					{!sessionId && (
						<NativeSelect
							value={pickSession}
							onChange={(e) => setPickSession(e.target.value)}
							containerClassName="max-w-36 shrink-0"
						>
							<option value="">{t("editor.selectTargetSession")}</option>
							{sessionList.map((s) => (
								<option key={s.id} value={s.id}>
									{s.label} {s.title}
								</option>
							))}
						</NativeSelect>
					)}
					<button
						type="button"
						disabled={!annTarget}
						onClick={annotate}
						title={annTarget ? t("editor.addAnnotationTip") : t("editor.firstSelectSession")}
						className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
					>
						<MessageSquarePlus size={14} />
						<span>{t("editor.annotateShortcut")}</span>
					</button>
					<button
						type="button"
						onClick={() => {
							setSel(null);
							setComment("");
							window.getSelection()?.removeAllRanges();
						}}
						className="rounded-lg px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
					>
						{t("common.cancel")}
					</button>
				</div>
			)}

		</div>
	);
}
