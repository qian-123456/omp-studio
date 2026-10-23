/** Settings → 记忆 → 记忆文件: browse and edit what omp stored in ~/.omp/agent/memories/<project>/. */

import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
			toast.error(`在访达中打开失败：${errMsg(e)}`);
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
			toast.error(`打开文件失败：${errMsg(e)}`);
		}
	}
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
						编辑
					</Button>
					<Button size="sm" icon={ExternalLink} disabled={!path} onClick={() => path && void openWithDefaultEditor(path)}>
						用默认编辑器打开
					</Button>
				</div>
			</div>
			{preview === null ? (
				<p className="text-xs text-[var(--text-muted)]">文件内容为空或已不存在。</p>
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
							{expanded ? "收起" : `展开全文（还有 ${preview.hiddenLines} 行）`}
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
	const text = useMemoryText(slug, file.rel, reloadToken);
	const name = skillNameOf(file.rel) ?? file.rel;
	const description = text === null ? null : parseSkillDescription(text);
	return (
		<div className="space-y-1.5 px-4 py-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-[13px] font-semibold text-[var(--text)]">{name}</span>
				<div className="flex flex-wrap items-center gap-1.5">
					<Button size="sm" icon={Pencil} onClick={onEdit}>
						编辑
					</Button>
					<Button size="sm" icon={FolderOpen} disabled={!folderPath} onClick={() => folderPath && void openFolder(folderPath)}>
						打开文件夹
					</Button>
					<Button size="sm" icon={ExternalLink} disabled={!path} onClick={() => path && void openWithDefaultEditor(path)}>
						用默认编辑器打开
					</Button>
					<Button size="sm" variant="danger" icon={Trash2} onClick={onDelete}>
						删除
					</Button>
				</div>
			</div>
			<p className="text-xs leading-4 text-[var(--text-muted)]">
				{text === null ? "文件已不存在" : (description ?? "SKILL.md 没有写 description")}
			</p>
		</div>
	);
}

export function MemoryFilesPanel() {
	const cwd = useSettingsProjectCwd();
	const home = useHomeDir();
	const [projects, setProjects] = useState<string[] | null>(null);
	const [slug, setSlug] = useState<string | null>(null);
	const [files, setFiles] = useState<MemoryFileInfo[]>([]);
	const [rel, setRel] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [rawOpen, setRawOpen] = useState(false);
	const [reloadToken, setReloadToken] = useState(0);

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
		if (!slug) {
			setFiles([]);
			return;
		}
		try {
			setFiles(await ompMemoryFiles(slug));
			setError(null);
		} catch (e) {
			setFiles([]);
			setError(describeFileCommandError(e));
		}
	}, [slug]);

	useEffect(() => {
		setRel(null);
		setRawOpen(false);
		void refreshFiles();
	}, [refreshFiles]);

	const split = useMemo(() => splitMemoryFiles(files), [files]);
	const selected = files.find((f) => f.rel === rel) ?? null;

	const load = useCallback(() => ompMemoryRead(slug ?? "", rel ?? ""), [slug, rel]);
	const save = useCallback(
		(content: string, stamp: string | null) => ompMemoryWrite(slug ?? "", rel ?? "", content, stamp),
		[slug, rel],
	);

	const deleteSkill = async (name: string) => {
		if (!slug) return;
		const ok = await confirmDialog(`删除技能「${name}」？整个技能文件夹会被移除，无法恢复。`, {
			title: "删除技能",
			danger: true,
			okLabel: "删除",
		});
		if (!ok) return;
		try {
			await ompMemoryDeleteSkill(slug, name);
			toast.success("技能已删除");
			setRel(null);
			await refreshFiles();
		} catch (e) {
			toast.error(`删除失败：${describeFileCommandError(e)}`);
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
			<div className="space-y-3">
				<div className="flex items-center gap-2 px-1">
					<Button icon={ArrowLeft} onClick={closeEditor}>
						返回列表
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
							loaded === null ? "文件已不存在" : selected.editable ? "omp 会读取这个文件" : "由 omp 生成"
						}
						extraActions={
							skillName ? (
								<Button icon={Trash2} variant="danger" onClick={() => void deleteSkill(skillName)}>
									删除技能
								</Button>
							) : undefined
						}
						onChanged={() => void refreshFiles()}
						savedToast="已保存，新开的会话会使用新内容"
					/>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-start justify-between gap-2 px-1">
				<div>
					<h3 className="text-sm font-semibold text-[var(--text)]">记忆文件</h3>
					<p className="mt-0.5 text-xs text-[var(--text-muted)]">
						omp 为每个项目单独存放的记忆。摘要和技能可以直接改，改完新开的会话生效；这里不会新建文件。
					</p>
				</div>
				<Button icon={FolderOpen} disabled={!projectDir} onClick={() => projectDir && void openFolder(projectDir)}>
					在访达中打开记忆目录
				</Button>
			</div>

			{error && <Notice tone="danger">{error}</Notice>}

			<SettingsCard>
				<SettingRow
					label="项目"
					description={
						projects && projects.length === 0 && !error
							? "还没有任何项目的记忆"
							: projectLabel
								? `${projectLabel.label}${projectLabel.exact ? "" : "（路径里的 - 可能是目录分隔符）"}`
								: "默认是当前会话所在的项目"
					}
					control={
						<NativeSelect
							aria-label="记忆所属项目"
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
				<p className="px-1 text-xs text-[var(--text-muted)]">这个项目下还没有记忆文件。</p>
			)}

			{slug && split.notes.length > 0 && (
				<SettingsCard title="记忆" description="摘要在每次新会话开头注入；完整记忆由 agent 需要时查阅。">
					{split.notes.map((f) => (
						<NoteCard
							key={f.rel}
							slug={slug}
							file={f}
							path={pathOf(f.rel)}
							reloadToken={reloadToken}
							onEdit={() => setRel(f.rel)}
						/>
					))}
				</SettingsCard>
			)}

			{slug && (
				<SettingsCard title="沉淀的技能" description="每个技能一个文件夹，可编辑或删除。">
					{split.skills.length === 0 ? (
						<p className="px-4 py-3 text-xs text-[var(--text-muted)]">还没有沉淀的技能</p>
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
									onEdit={() => setRel(f.rel)}
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
							omp 自动生成的原始记录（{split.generatedCount} 个）
						</button>
						{rawOpen && (
							<div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-5">
								<p className="text-xs text-[var(--text-muted)]">
									原始记忆和各次会话摘要由 omp 反复重新生成，手改没有意义，需要时在访达里查看。
								</p>
								<Button
									size="sm"
									icon={FolderOpen}
									disabled={!projectDir}
									onClick={() => projectDir && void openFolder(projectDir)}
								>
									在访达中显示
								</Button>
							</div>
						)}
					</div>
				</SettingsCard>
			)}
		</div>
	);
}
