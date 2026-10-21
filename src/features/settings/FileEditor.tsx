/**
 * Shared single-file editor for settings pages (规则文件, 记忆文件): edit/preview,
 * 放弃修改, 保存 (⌘S), 在访达中显示, 重新读取, and a stamp-based save conflict
 * check. Mount with `key={fileKey}`: switching files remounts; an unsaved draft
 * is stashed on unmount and restored when the same file is opened again and
 * still matches what the draft was based on.
 */

import { markdown } from "@codemirror/lang-markdown";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import clsx from "clsx";
import { FilePlus2, FolderOpen, RefreshCw, RotateCcw, Save } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
	savedToast = "已保存，新开的会话会使用新内容",
}: FileEditorProps) {
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

	const apply = useCallback((res: StampedText) => {
		setLoaded(res.content);
		setStamp(res.stamp);
		setDraft(res.content ?? "");
		setRestored(false);
	}, []);

	const load = useCallback(
		async (useCache: boolean) => {
			setLoading(true);
			try {
				const res = await loadFile();
				const cached = draftCache.get(fileKey);
				draftCache.delete(fileKey);
				if (useCache && cached && res.content !== null && cached.loaded === res.content) {
					setLoaded(res.content);
					setStamp(res.stamp);
					setDraft(cached.draft);
					setRestored(true);
				} else {
					if (useCache && cached) toast.info("文件已被修改，之前未保存的草稿已丢弃");
					apply(res);
				}
				setLoadError(null);
			} catch (e) {
				setLoaded(null);
				setStamp(null);
				setDraft("");
				setLoadError(errMsg(e));
			} finally {
				setReady(true);
				setLoading(false);
			}
		},
		[loadFile, fileKey, apply],
	);

	// Load once per mount; the parent remounts via `key` when the file changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional single load per mount
	useEffect(() => {
		void load(true);
	}, []);

	const save = useCallback(async () => {
		if (!dirty || saving) return;
		setSaving(true);
		const text = draft;
		try {
			let useStamp = stamp;
			for (;;) {
				try {
					const next = await saveFile(text, useStamp);
					setLoaded(text);
					setStamp(next);
					setDraft(text);
					setRestored(false);
					toast.success(savedToast);
					onChanged?.();
					return;
				} catch (e) {
					if (!isConflictError(e)) throw e;
					const overwrite = await confirmDialog(
						"这个文件在你打开之后被 omp 或其他程序更新过。覆盖会丢掉磁盘上的新内容；重新载入会丢掉你当前的修改。",
						{ title: "文件已被 omp 更新", danger: true, okLabel: "覆盖", cancelLabel: "重新载入" },
					);
					if (!overwrite) {
						const fresh = await loadFile();
						apply(fresh);
						onChanged?.();
						return;
					}
					// Overwrite: adopt the current on-disk stamp and retry once more.
					useStamp = (await loadFile()).stamp;
				}
			}
		} catch (e) {
			toast.error(`保存失败：${errMsg(e)}`);
		} finally {
			setSaving(false);
		}
	}, [dirty, saving, draft, stamp, saveFile, loadFile, apply, onChanged, savedToast]);

	const create = async () => {
		if (createContent === undefined) return;
		try {
			const next = await saveFile(createContent, null);
			setLoaded(createContent);
			setStamp(next);
			setDraft(createContent);
			setTab("edit");
			onChanged?.();
		} catch (e) {
			if (isConflictError(e)) {
				toast.info("文件已经存在，已载入");
				await load(false);
				onChanged?.();
			} else {
				toast.error(`创建失败：${errMsg(e)}`);
			}
		}
	};

	const discard = async () => {
		if (!dirty) return;
		const ok = await confirmDialog("撤销所有未保存的修改，恢复到上次保存的内容？", {
			title: "放弃修改",
			danger: true,
			okLabel: "放弃修改",
		});
		if (ok && loaded !== null) {
			setDraft(loaded);
			setRestored(false);
		}
	};

	const reload = async () => {
		if (dirty) {
			const ok = await confirmDialog("重新读取会丢掉未保存的修改。确定继续？", {
				title: "放弃未保存的修改？",
				danger: true,
				okLabel: "放弃修改",
			});
			if (!ok) return;
		}
		draftCache.delete(fileKey);
		await load(false);
		onChanged?.();
	};

	const reveal = () => {
		const where = loaded !== null ? path : path.replace(/\/[^/]+$/, "");
		void revealItemInDir(where).catch((e) => toast.error(`无法在访达中显示：${errMsg(e)}`));
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
		? "读取中"
		: loadError
			? "读取失败"
			: statusText
				? statusText(loaded)
				: loaded === null
					? "文件不存在"
					: "已存在";

	return (
		<SettingsCard>
			<div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						{dirty && (
							<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" title="有未保存的修改" />
						)}
						<code className="truncate font-mono text-xs text-[var(--text)]" title={path}>
							{short(path)}
						</code>
					</div>
					<div className="text-[11px] text-neutral-500">{status}</div>
				</div>
				{extraActions}
				<Button icon={FolderOpen} onClick={reveal}>
					在访达中显示
				</Button>
				<Button
					icon={RefreshCw}
					onClick={() => void reload()}
					disabled={loading}
					title="从磁盘重新读取"
					aria-label="从磁盘重新读取"
				>
					<span className={clsx(loading && "animate-pulse")}>重新读取</span>
				</Button>
			</div>

			{ready && loadError && <div className="px-4 py-3 text-xs text-[var(--status-error)]">{loadError}</div>}

			{ready && !loadError && loaded === null && (
				<div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
					<p className="text-xs text-neutral-400">这个文件还没有创建。</p>
					{createContent !== undefined && (
						<Button icon={FilePlus2} onClick={() => void create()}>
							创建文件
						</Button>
					)}
				</div>
			)}

			{exists && (
				<div>
					{restored && (
						<div className="px-4 py-2 text-[11px] text-[var(--status-warning)]">已恢复你上次离开时未保存的修改。</div>
					)}
					{tooLarge && (
						<div className="px-4 py-2 text-[11px] text-[var(--status-warning)]">
							文件超过 1 MB，为避免卡顿只能查看。请用外部编辑器修改。
						</div>
					)}
					{forcedReadOnly && (
						<div className="px-4 py-2 text-[11px] text-[var(--text-muted)]">
							这个文件由 omp 自动生成，只能查看，修改会在下次整理记忆时被覆盖。
						</div>
					)}
					<div className="flex items-center justify-between gap-2 px-4 py-2">
						<Segmented<Tab>
							aria-label="编辑或预览"
							size="sm"
							value={tab}
							onChange={setTab}
							options={[
								{ value: "edit", label: forcedReadOnly ? "原文" : "编辑" },
								{ value: "preview", label: "预览" },
							]}
						/>
						{!forcedReadOnly && (
							<div className="flex items-center gap-2">
								<Button icon={RotateCcw} onClick={() => void discard()} disabled={!dirty || saving}>
									放弃修改
								</Button>
								<Button
									variant="primary"
									icon={Save}
									onClick={() => void save()}
									disabled={!dirty || saving}
									loading={saving}
									title="保存 (⌘S)"
								>
									{saving ? "保存中" : "保存"}
								</Button>
							</div>
						)}
					</div>
					{tab === "edit" ? (
						<div className="max-h-[60vh] min-h-[240px] overflow-auto font-mono text-xs">
							<CodeMirror
								value={draft}
								onChange={setDraft}
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
								<ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
							) : (
								<p className="text-[var(--text-dim)]">空文件</p>
							)}
						</div>
					)}
				</div>
			)}
		</SettingsCard>
	);
}
