/**
 * Shared single-file editor for settings pages (规则文件, 记忆文件): edit/preview,
 * 放弃修改, 保存 (⌘S), 在访达中显示, 重新读取, and a stamp-based save conflict
 * check. Mount with `key={fileKey}`: switching files remounts; an unsaved draft
 * is stashed on unmount and restored when the same file is opened again and
 * still matches what the draft was based on.
 */

import { useT } from "../../stores/language";
import { markdown } from "@codemirror/lang-markdown";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import clsx from "clsx";
import { FilePlus2, FolderOpen, RefreshCw, RotateCcw, Save } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { Segmented } from "../../components/Segmented";
import { confirmDialog } from "../../lib/dialogs";
import { useShortPath } from "../../lib/hooks";
import type { StampedText } from "../../lib/ipc";
import { themeById, useResolvedThemeId } from "../../lib/theme";
import { toast } from "../../lib/toast";
import { Button, SettingsCard } from "./ui";
import { describeFileCommandError as errMsg, isConflictError, isTooLargeToEdit } from "./fileEditorLogic";

/** Unsaved drafts survive switching files / leaving the section. */
const draftCache = new Map<string, { loaded: string; draft: string }>();

type Tab = "edit" | "preview";

export interface FileEditorProps {
	/** Identity of the file; also the draft-cache key. */
	fileKey: string;
	/** Absolute path shown to the user and revealed in Finder. */
	path: string;
	load: () => Promise<StampedText>;
	/** Persist `content`; `stamp` is what `load` returned. Returns the new stamp. Must reject with a CONFLICT error when disk changed. */
	save: (content: string, stamp: string | null) => Promise<string | null>;
	/** View-only (omp regenerates the file). */
	readOnly?: boolean;
	/** When set and the file is missing, a 「创建文件」 button writes this content. */
	createContent?: string;
	/** Status line under the path; default derives from existence. */
	statusText?: (loaded: string | null) => string;
	/** Extra toolbar buttons (e.g. delete). */
	extraActions?: ReactNode;
	/** Called after a successful save / create / reload so lists can refresh. */
	onChanged?: () => void;
	savedToast?: string;
	/** Skip the outer SettingsCard chrome (inline expansion inside another card). */
	bare?: boolean;
}

export function FileEditor({
	fileKey,
	path,
	load: loadFile,
	save: saveFile,
	readOnly: forcedReadOnly = false,
	createContent,
	statusText,
	extraActions,
	onChanged,
	savedToast,
	bare = false,
}: FileEditorProps) {
	const { t } = useT();
	const effectiveSavedToast = savedToast ?? t("settingsCore.fileEditor.savedToast");
	const short = useShortPath();
	const dark = themeById(useResolvedThemeId())?.dark ?? true;

	const [tab, setTab] = useState<Tab>("edit");
	const [ready, setReady] = useState(false);
	const [loaded, setLoaded] = useState<string | null>(null);
	const [stamp, setStamp] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [restored, setRestored] = useState(false);
	const revision = useRef(0);
	const operation = useRef(0);
	const pending = useRef(false);

	const tooLarge = loaded !== null && isTooLargeToEdit(loaded);
	const readOnly = forcedReadOnly || tooLarge;
	const dirty = ready && loaded !== null && !readOnly && draft !== loaded;

	const bufRef = useRef({ loaded, draft, dirty });
	bufRef.current = { loaded, draft, dirty };
	useEffect(
		() => () => {
			const b = bufRef.current;
			if (b.dirty && b.loaded !== null) draftCache.set(fileKey, { loaded: b.loaded, draft: b.draft });
		},
		[fileKey],
	);

	const apply = useCallback((res: StampedText, startedRevision: number) => {
		// Text typed against the old snapshot must keep its old conflict stamp too.
		if (revision.current !== startedRevision) return;
		setLoaded(res.content);
		setStamp(res.stamp);
		setDraft(res.content ?? "");
		setRestored(false);
	}, []);

	const load = useCallback(
		async (useCache: boolean) => {
			const id = ++operation.current;
			const startedRevision = revision.current;
			pending.current = true;
			setLoading(true);
			try {
				const res = await loadFile();
				if (operation.current !== id) return;
				const cached = draftCache.get(fileKey);
				draftCache.delete(fileKey);
				if (useCache && cached && res.content !== null && cached.loaded === res.content) {
					setLoaded(res.content);
					setStamp(res.stamp);
					setDraft(cached.draft);
					setRestored(true);
				} else {
					if (useCache && cached) toast.info(t("settingsCore.fileEditor.draftDiscarded"));
					apply(res, startedRevision);
				}
				setLoadError(null);
			} catch (e) {
				if (operation.current !== id) return;
				if (bufRef.current.loaded === null) setLoadError(errMsg(e));
				else toast.error(errMsg(e));
			} finally {
				if (operation.current === id) {
					pending.current = false;
					setReady(true);
					setLoading(false);
				}
			}
		},
		[loadFile, fileKey, apply],
	);

	// Load once per mount; the parent remounts via `key` when the file changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional single load per mount
	useEffect(() => {
		void load(true);
		return () => { operation.current++; };
	}, []);

	const save = useCallback(async () => {
		if (!dirty || pending.current) return;
		pending.current = true;
		const id = ++operation.current;
		setSaving(true);
		const text = draft;
		try {
			let useStamp = stamp;
			for (;;) {
				try {
					const next = await saveFile(text, useStamp);
					if (operation.current !== id) return;
					setLoaded(text);
					setStamp(next);
					// The persisted snapshot advances, but any newer typing stays dirty.
					setRestored(false);
					toast.success(effectiveSavedToast);
					onChanged?.();
					return;
				} catch (e) {
					if (!isConflictError(e)) throw e;
					if (operation.current !== id) return;
					const overwrite = await confirmDialog(
						t("settingsCore.fileEditor.conflictConfirm"),
						{ title: t("settingsCore.fileEditor.conflictTitle"), danger: true, okLabel: t("settingsCore.fileEditor.overwrite"), cancelLabel: t("settingsCore.fileEditor.reload") },
					);
					if (operation.current !== id) return;
					if (!overwrite) {
						const startedRevision = revision.current;
						const fresh = await loadFile();
						if (operation.current !== id) return;
						apply(fresh, startedRevision);
						onChanged?.();
						return;
					}
					// Overwrite: adopt the current on-disk stamp and retry once more.
					useStamp = (await loadFile()).stamp;
					if (operation.current !== id) return;
				}
			}
		} catch (e) {
			if (operation.current === id) toast.error(t("settingsCore.fileEditor.saveError", { error: errMsg(e) }));
		} finally {
			if (operation.current === id) {
				pending.current = false;
				setSaving(false);
			}
		}
	}, [dirty, saving, draft, stamp, saveFile, loadFile, apply, onChanged, savedToast]);

	const create = async () => {
		if (createContent === undefined || pending.current) return;
		pending.current = true;
		const id = ++operation.current;
		setSaving(true);
		try {
			const next = await saveFile(createContent, null);
			if (operation.current !== id) return;
			setLoaded(createContent);
			setStamp(next);
			setDraft(createContent);
			setTab("edit");
			onChanged?.();
		} catch (e) {
			if (operation.current !== id) return;
			if (isConflictError(e)) {
				toast.info(t("settingsCore.fileEditor.fileAlreadyExists"));
				try {
					const startedRevision = revision.current;
					const fresh = await loadFile();
					if (operation.current !== id) return;
					apply(fresh, startedRevision);
					onChanged?.();
				} catch (readError) {
					if (operation.current === id) toast.error(t("settingsCore.fileEditor.createError", { error: errMsg(readError) }));
				}
			} else {
				toast.error(t("settingsCore.fileEditor.createError", { error: errMsg(e) }));
			}
		} finally {
			if (operation.current === id) {
				pending.current = false;
				setSaving(false);
			}
		}
	};

	const discard = async () => {
		if (!dirty) return;
		const ok = await confirmDialog(t("settingsCore.fileEditor.discardConfirm"), {
			title: t("settingsCore.fileEditor.discardTitle"),
			danger: true,
			okLabel: t("settingsCore.fileEditor.discardLabel"),
		});
		if (ok && loaded !== null) {
			setDraft(loaded);
			setRestored(false);
		}
	};

	const reload = async () => {
		if (pending.current) return;
		if (dirty) {
			const ok = await confirmDialog(t("settingsCore.fileEditor.reloadConfirm"), {
				title: t("settingsCore.fileEditor.reloadConfirmTitle"),
				danger: true,
				okLabel: t("settingsCore.fileEditor.discardLabel"),
			});
			if (!ok) return;
			if (pending.current) return;
		}
		draftCache.delete(fileKey);
		await load(false);
		onChanged?.();
	};

	const reveal = () => {
		const where = loaded !== null ? path : path.replace(/\/[^/]+$/, "");
		void revealItemInDir(where).catch((e) => toast.error(t("settingsCore.fileEditor.revealError", { error: errMsg(e) })));
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
				e.preventDefault();
				void save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [save]);

	const extensions = useMemo(() => [markdown(), EditorView.lineWrapping], []);

	const exists = ready && !loadError && loaded !== null;
	const status = !ready
		? t("settingsCore.fileEditor.statusReading")
		: loadError
			? t("settingsCore.fileEditor.statusFailed")
			: statusText
				? statusText(loaded)
				: loaded === null
					? t("settingsCore.fileEditor.statusNotExists")
					: t("settingsCore.fileEditor.statusExists");
	const body = (
		<>
			<div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						{dirty && (
							<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" title={t("settingsCore.fileEditor.unsavedIndicator")} />
						)}
						<code className="break-all font-mono text-xs text-[var(--text)]" title={path}>
							{short(path)}
						</code>
					</div>
					<div className="text-[11px] text-neutral-500">{status}</div>
				</div>
				{extraActions}
				<Button icon={FolderOpen} onClick={reveal}>
					{t("settingsCore.fileEditor.showInFinder")}
				</Button>
				<Button
					icon={RefreshCw}
					onClick={() => void reload()}
					disabled={loading || saving}
					title={t("settingsCore.fileEditor.reloadFromDisk")}
					aria-label={t("settingsCore.fileEditor.reloadFromDisk")}
				>
					<span className={clsx(loading && "animate-pulse")}>{t("settingsCore.fileEditor.reloading")}</span>
				</Button>
			</div>

			{ready && loadError && <div className="px-4 py-3 text-xs text-[var(--status-error)]">{loadError}</div>}

			{ready && !loadError && loaded === null && (
				<div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
					<p className="text-xs text-neutral-400">{t("settingsCore.fileEditor.notCreated")}</p>
					{createContent !== undefined && (
						<Button icon={FilePlus2} onClick={() => void create()} disabled={loading || saving} loading={saving}>
							{t("settingsCore.fileEditor.createFile")}
						</Button>
					)}
				</div>
			)}

			{exists && (
				<div>
					{restored && (
						<div className="px-4 py-2 text-[11px] text-[var(--status-warning)]">{t("settingsCore.fileEditor.restoredNotice")}</div>
					)}
					{tooLarge && (
						<div className="px-4 py-2 text-[11px] text-[var(--status-warning)]">
							{t("settingsCore.fileEditor.tooLargeNotice")}
						</div>
					)}
					{forcedReadOnly && (
						<div className="px-4 py-2 text-[11px] text-[var(--text-muted)]">
							{t("settingsCore.fileEditor.forcedReadOnlyNotice")}
						</div>
					)}
					<div className="flex items-center justify-between gap-2 px-4 py-2">
						<Segmented<Tab>
							aria-label={t("settingsCore.fileEditor.editOrPreview")}
							size="sm"
							value={tab}
							onChange={setTab}
							options={[
								{ value: "edit", label: forcedReadOnly ? t("settingsCore.fileEditor.rawTab") : t("settingsCore.fileEditor.editTab") },
								{ value: "preview", label: t("settingsCore.fileEditor.previewTab") },
							]}
						/>
						{!forcedReadOnly && (
							<div className="flex items-center gap-2">
								<Button icon={RotateCcw} onClick={() => void discard()} disabled={!dirty || saving || loading}>
									{t("settingsCore.fileEditor.discardLabel")}
								</Button>
								<Button
									variant="primary"
									icon={Save}
									onClick={() => void save()}
									disabled={!dirty || saving || loading}
									loading={saving}
									title={`${t("settingsCore.fileEditor.saveButton")} (⌘S)`}
								>
									{saving ? t("settingsCore.fileEditor.savingButton") : t("settingsCore.fileEditor.saveButton")}
								</Button>
							</div>
						)}
					</div>
					{tab === "edit" ? (
						<div className="max-h-[60vh] min-h-[240px] overflow-auto font-mono text-xs">
							<CodeMirror
								value={draft}
								onChange={(text) => { revision.current++; setDraft(text); }}
								extensions={extensions}
								theme={dark ? "dark" : "light"}
								editable={!readOnly}
								readOnly={readOnly}
								minHeight="240px"
								basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
							/>
						</div>
					) : (
						<div className="max-h-[60vh] min-h-[240px] overflow-auto px-5 py-3 text-xs leading-6 text-[var(--text-muted)] [&_a]:text-[var(--accent)] [&_code]:rounded [&_code]:bg-[var(--well-bg)] [&_code]:px-1 [&_code]:font-mono [&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-[var(--text)] [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-[var(--text)] [&_h3]:mt-2 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-[var(--well-bg)] [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
							{draft.trim() ? (
								<Markdown text={draft} />
							) : (
								<p className="text-[var(--text-dim)]">{t("settingsCore.fileEditor.emptyFile")}</p>
							)}
						</div>
					)}
				</div>
			)}
		</>
	);

	return bare ? body : <SettingsCard>{body}</SettingsCard>;
}
