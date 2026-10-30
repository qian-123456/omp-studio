/** Settings → 记忆 → 记忆文件: browse and edit what omp stored in ~/.omp/agent/memories/<project>/. */

import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tNow, useT } from "../../../stores/language";
import { NativeSelect } from "../../../components/NativeSelect";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { useHomeDir } from "../../../lib/hooks";
import {
	type MemoryFileInfo,
	ompMemoryDeleteSkill,
	ompMemoryFiles,
	ompMemoryProjects,
	ompMemoryRead,
	ompMemoryWrite,
} from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { formatTokenEstimate } from "../../../lib/tokenEstimate";
import { FileEditor } from "../FileEditor";
import { describeFileCommandError } from "../fileEditorLogic";
import { Notice } from "../../../components/Notice";
import { Button, Chip, SettingRow, SettingsCard } from "../ui";
import { useSettingsProjectCwd } from "../useAppSettings";
import {
	defaultMemorySlug,
	describeMemoryFile,
	formatTextSize,
	memoryProjectLabel,
	parseSkillDescription,
	previewText,
	skillNameOf,
	splitMemoryFiles,
} from "./memoryFiles";

/** Open a folder in Finder; fall back to revealing it when the opener scope refuses dot-folders. */
async function openFolder(path: string) {
	try {
		await openPath(path);
	} catch {
		try {
			await revealItemInDir(path);
		} catch (e) {
			toast.error(tNow("memoryRules.openFolderFailed", { error: errMsg(e) }));
		}
	}
}

async function openWithDefaultEditor(path: string) {
	try {
		await openPath(path);
	} catch {
		try {
			await revealItemInDir(path);
		} catch (e) {
			toast.error(tNow("memoryRules.openFileFailed", { error: errMsg(e) }));
		}
	}
}

/** Nearest ancestor that actually scrolls (the settings page body). */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
	for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
		const oy = getComputedStyle(p).overflowY;
		if (oy === "auto" || oy === "scroll") return p;
	}
	return null;
}

/** Loads a memory file's text; `null` while loading or when the file is missing. */
function useMemoryText(slug: string, rel: string, reloadToken: number): string | null {
	const [text, setText] = useState<string | null>(null);
	useEffect(() => {
		let alive = true;
		void reloadToken;
		ompMemoryRead(slug, rel).then(
			(r) => alive && setText(r.content),
			() => alive && setText(null),
		);
		return () => {
			alive = false;
		};
	}, [slug, rel, reloadToken]);
	return text;
}

interface CardProps {
	slug: string;
	file: MemoryFileInfo;
	path: string | null;
	reloadToken: number;
	onEdit: () => void;
}

function NoteCard({ slug, file, path, reloadToken, onEdit }: CardProps) {
	const { t } = useT();
	const text = useMemoryText(slug, file.rel, reloadToken);
	const [expanded, setExpanded] = useState(false);
	const d = describeMemoryFile(file.rel);
	const preview = text === null ? null : previewText(text);
	return (
		<div className="space-y-2 px-4 py-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<span className="text-[13px] font-semibold text-[var(--text)]">{d.title}</span>
					<span className="font-mono text-[11px] text-[var(--text-dim)]">{file.rel}</span>
					<Chip tone="accent">{d.role}</Chip>
					{text !== null && (
						<>
							<Chip>{formatTokenEstimate(text)}</Chip>
							<Chip>{formatTextSize(text)}</Chip>
						</>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					<Button size="sm" icon={Pencil} onClick={onEdit}>
						{t("memoryRules.edit")}
					</Button>
					<Button size="sm" icon={ExternalLink} disabled={!path} onClick={() => path && void openWithDefaultEditor(path)}>
						{t("memoryRules.openInDefaultEditor")}
					</Button>
				</div>
			</div>
			{preview === null ? (
				<p className="text-xs text-[var(--text-muted)]">{t("memoryRules.emptyOrMissing")}</p>
			) : (
				<>
					<pre className="whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-active-fill)] px-3 py-2 font-mono text-[11px] leading-4 text-[var(--text-muted)]">
						{expanded ? text : preview.text}
					</pre>
					{preview.hiddenLines > 0 && (
						<Button
							size="sm"
							variant="ghost"
							icon={expanded ? ChevronDown : ChevronRight}
							onClick={() => setExpanded((v) => !v)}
						>
							{expanded ? t("memoryRules.collapse") : t("memoryRules.expandAll", { lines: preview.hiddenLines })}
						</Button>
					)}
				</>
			)}
		</div>
	);
}

function SkillCard({
	slug,
	file,
	path,
	folderPath,
	reloadToken,
	onEdit,
	onDelete,
}: CardProps & { folderPath: string | null; onDelete: () => void }) {
	const { t } = useT();
	const text = useMemoryText(slug, file.rel, reloadToken);
	const name = skillNameOf(file.rel) ?? file.rel;
	const description = text === null ? null : parseSkillDescription(text);
	return (
		<div className="space-y-1.5 px-4 py-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-[13px] font-semibold text-[var(--text)]">{name}</span>
				<div className="flex flex-wrap items-center gap-1.5">
					<Button size="sm" icon={Pencil} onClick={onEdit}>
						{t("memoryRules.edit")}
					</Button>
					<Button size="sm" icon={FolderOpen} disabled={!folderPath} onClick={() => folderPath && void openFolder(folderPath)}>
						{t("memoryRules.openFolder")}
					</Button>
					<Button size="sm" icon={ExternalLink} disabled={!path} onClick={() => path && void openWithDefaultEditor(path)}>
						{t("memoryRules.openInDefaultEditor")}
					</Button>
					<Button size="sm" variant="danger" icon={Trash2} onClick={onDelete}>
						{t("memoryRules.delete")}
					</Button>
				</div>
			</div>
			<p className="text-xs leading-4 text-[var(--text-muted)]">
				{text === null ? t("memoryRules.fileNotFound") : (description ?? t("memoryRules.noDescription"))}
			</p>
		</div>
	);
}

export function MemoryFilesPanel() {
	const { t } = useT();
	const cwd = useSettingsProjectCwd();
	const home = useHomeDir();
	const [projects, setProjects] = useState<string[] | null>(null);
	const [slug, setSlug] = useState<string | null>(null);
	const [files, setFiles] = useState<MemoryFileInfo[]>([]);
	const [rel, setRel] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [rawOpen, setRawOpen] = useState(false);
	const [reloadToken, setReloadToken] = useState(0);
	const filesGeneration = useRef(0);
	const currentSlug = useRef(slug);
	currentSlug.current = slug;

	useEffect(() => {
		let alive = true;
		(async () => {
			try {
				const all = await ompMemoryProjects();
				// Hide projects that have no memory files at all.
				const counts = await Promise.all(all.map((p) => ompMemoryFiles(p).then((f) => f.length, () => 0)));
				if (!alive) return;
				const list = all.filter((_, i) => counts[i] > 0);
				setProjects(list);
				setSlug((cur) => (cur && list.includes(cur) ? cur : defaultMemorySlug(list, cwd)));
				setError(null);
			} catch (e) {
				if (!alive) return;
				setProjects([]);
				setError(describeFileCommandError(e));
			}
		})();
		return () => {
			alive = false;
		};
	}, [cwd]);

	const refreshFiles = useCallback(async () => {
		if (currentSlug.current !== slug) return;
		const generation = ++filesGeneration.current;
		if (!slug) {
			setFiles([]);
			return;
		}
		try {
			const next = await ompMemoryFiles(slug);
			if (generation !== filesGeneration.current || currentSlug.current !== slug) return;
			setFiles(next);
			setError(null);
		} catch (e) {
			if (generation !== filesGeneration.current || currentSlug.current !== slug) return;
			setFiles([]);
			setError(describeFileCommandError(e));
		}
	}, [slug]);

	useEffect(() => {
		setRel(null);
		setRawOpen(false);
		setFiles([]);
		setError(null);
		void refreshFiles();
		return () => { filesGeneration.current++; };
	}, [refreshFiles]);

	const split = useMemo(() => splitMemoryFiles(files), [files]);
	const selected = files.find((f) => f.rel === rel) ?? null;
	const editing = Boolean(selected && slug);

	// The list and the editor swap in place inside one long settings page. Without this, opening the editor
	// keeps the list's scroll offset and lands mid-page (or in blank space); bring the editor to the top and
	// put the list back where the user left it on return. The editor is shorter than the page, so the browser
	// clamps the scroll offset the moment the views swap: the list offset is therefore captured before the swap,
	// and the panel gets a temporary min-height that keeps the target offset reachable (held for the whole
	// editing session; on return only until the list's text has loaded).
	const rootRef = useRef<HTMLDivElement>(null);
	const listScrollTop = useRef<number | null>(null);
	const wasEditing = useRef(false);
	const openEditor = (target: string) => {
		listScrollTop.current = scrollParentOf(rootRef.current)?.scrollTop ?? null;
		setRel(target);
	};
	useLayoutEffect(() => {
		if (editing === wasEditing.current) return;
		wasEditing.current = editing;
		const root = rootRef.current;
		const scroller = scrollParentOf(root);
		if (!root || !scroller) return;
		const rootTop = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
		let target: number;
		if (editing) {
			target = rootTop;
		} else if (listScrollTop.current !== null) {
			target = listScrollTop.current;
			listScrollTop.current = null;
		} else {
			return;
		}
		root.style.minHeight = `${Math.max(0, target + scroller.clientHeight - rootTop)}px`;
		scroller.scrollTop = target;
		const release = editing
			? undefined
			: window.setTimeout(() => {
					root.style.minHeight = "";
				}, 1500);
		return () => {
			window.clearTimeout(release);
			root.style.minHeight = "";
		};
	}, [editing]);

	const load = useCallback(() => ompMemoryRead(slug ?? "", rel ?? ""), [slug, rel]);
	const save = useCallback(
		(content: string, stamp: string | null) => ompMemoryWrite(slug ?? "", rel ?? "", content, stamp),
		[slug, rel],
	);

	const deleteSkill = async (name: string) => {
		if (!slug) return;
		const ok = await confirmDialog(t("memoryRules.deleteSkillConfirm", { name }), {
			title: t("memoryRules.deleteSkillTitle"),
			danger: true,
			okLabel: t("memoryRules.delete"),
		});
		if (!ok || currentSlug.current !== slug) return;
		try {
			await ompMemoryDeleteSkill(slug, name);
			toast.success(t("memoryRules.skillDeleted"));
			if (currentSlug.current !== slug) return;
			setRel(null);
			await refreshFiles();
		} catch (e) {
			toast.error(t("memoryRules.deleteFailed", { error: describeFileCommandError(e) }));
		}
	};

	const closeEditor = () => {
		setRel(null);
		setReloadToken((n) => n + 1);
		void refreshFiles();
	};

	const memoriesDir = home ? `${home.replace(/\/+$/, "")}/.omp/agent/memories` : null;
	const projectDir = memoriesDir ? (slug ? `${memoriesDir}/${slug}` : memoriesDir) : null;
	const pathOf = (r: string) => (projectDir && slug ? `${projectDir}/${r}` : null);
	const knownPaths = cwd ? [cwd] : [];
	const projectLabel = slug ? memoryProjectLabel(slug, home, knownPaths) : null;

	if (selected && slug) {
		const filePath = pathOf(selected.rel);
		const skillName = skillNameOf(selected.rel);
		return (
			<div ref={rootRef} className="scroll-mt-4 space-y-3" data-jump={t("memoryRules.title")}>
				<div className="flex items-center gap-2 px-1">
					<Button icon={ArrowLeft} onClick={closeEditor}>
						{t("memoryRules.backToList")}
					</Button>
					<span className="text-xs text-[var(--text-muted)]">{describeMemoryFile(selected.rel).title}</span>
				</div>
				{error && <Notice tone="danger">{error}</Notice>}
				{filePath && (
					<FileEditor
						key={`mem:${slug}/${selected.rel}`}
						fileKey={`mem:${slug}/${selected.rel}`}
						path={filePath}
						load={load}
						save={save}
						readOnly={!selected.editable}
						statusText={(loaded) =>
							loaded === null
								? t("memoryRules.fileNotFound")
								: selected.editable
									? t("memoryRules.ompWillRead")
									: t("memoryRules.generatedByOmp")
						}
						extraActions={
							skillName ? (
								<Button icon={Trash2} variant="danger" onClick={() => void deleteSkill(skillName)}>
									{t("memoryRules.deleteSkill")}
								</Button>
							) : undefined
						}
						onChanged={() => void refreshFiles()}
						savedToast={t("memoryRules.savedToast")}
					/>
				)}
			</div>
		);
	}

	return (
		<div ref={rootRef} className="scroll-mt-4 space-y-3" data-jump={t("memoryRules.title")}>
			<div className="flex flex-wrap items-start justify-between gap-2 px-1">
				<div>
					<h3 className="text-sm font-semibold text-[var(--text)]">{t("memoryRules.title")}</h3>
					<p className="mt-0.5 text-xs text-[var(--text-muted)]">{t("memoryRules.desc")}</p>
				</div>
				<Button icon={FolderOpen} disabled={!projectDir} onClick={() => projectDir && void openFolder(projectDir)}>
					{t("memoryRules.openInFinder")}
				</Button>
			</div>

			{error && <Notice tone="danger">{error}</Notice>}

			<SettingsCard>
				<SettingRow
					label={t("memoryRules.project")}
					description={
						projects && projects.length === 0 && !error
							? t("memoryRules.noProjectMemory")
							: projectLabel
								? `${projectLabel.label}${projectLabel.exact ? "" : t("memoryRules.hyphenNote")}`
								: t("memoryRules.defaultCurrentProject")
					}
					control={
						<NativeSelect
							aria-label={t("memoryRules.projectSelectAria")}
							containerClassName="w-72"
							value={slug ?? ""}
							disabled={!projects || projects.length === 0}
							onChange={(e) => setSlug(e.target.value)}
						>
							{(projects ?? []).map((p) => (
								<option key={p} value={p}>
									{memoryProjectLabel(p, home, knownPaths).label}
								</option>
							))}
						</NativeSelect>
					}
				/>
			</SettingsCard>

			{slug && files.length === 0 && !error && (
				<p className="px-1 text-xs text-[var(--text-muted)]">{t("memoryRules.noFilesUnderProject")}</p>
			)}

			{slug && split.notes.length > 0 && (
				<SettingsCard title={t("memoryRules.memoryCardTitle")} description={t("memoryRules.memoryCardDesc")}>
					{split.notes.map((f) => (
						<NoteCard
							key={f.rel}
							slug={slug}
							file={f}
							path={pathOf(f.rel)}
							reloadToken={reloadToken}
							onEdit={() => openEditor(f.rel)}
						/>
					))}
				</SettingsCard>
			)}

			{slug && (
				<SettingsCard title={t("memoryRules.skillsCardTitle")} description={t("memoryRules.skillsCardDesc")}>
					{split.skills.length === 0 ? (
						<p className="px-4 py-3 text-xs text-[var(--text-muted)]">{t("memoryRules.noSkillsYet")}</p>
					) : (
						split.skills.map((f) => {
							const name = skillNameOf(f.rel) ?? f.rel;
							return (
								<SkillCard
									key={f.rel}
									slug={slug}
									file={f}
									path={pathOf(f.rel)}
									folderPath={pathOf(`skills/${name}`)}
									reloadToken={reloadToken}
									onEdit={() => openEditor(f.rel)}
									onDelete={() => void deleteSkill(name)}
								/>
							);
						})
					)}
				</SettingsCard>
			)}

			{slug && split.generatedCount > 0 && (
				<SettingsCard>
					<div className="px-4 py-3">
						<button
							type="button"
							aria-expanded={rawOpen}
							onClick={() => setRawOpen((v) => !v)}
							className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-[var(--text)]"
						>
							{rawOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
							{t("memoryRules.generatedRecordsTitle", { count: split.generatedCount })}
						</button>
						{rawOpen && (
							<div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-5">
								<p className="text-xs text-[var(--text-muted)]">
									{t("memoryRules.generatedRecordsDesc")}
								</p>
								<Button
									size="sm"
									icon={FolderOpen}
									disabled={!projectDir}
									onClick={() => projectDir && void openFolder(projectDir)}
								>
									{t("memoryRules.showInFinder")}
								</Button>
							</div>
						)}
					</div>
				</SettingsCard>
			)}
		</div>
	);
}
