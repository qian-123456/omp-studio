/** Settings → 记忆 → 记忆文件: browse and edit what omp stored in ~/.omp/agent/memories/<project>/. */

import clsx from "clsx";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NativeSelect } from "../../../components/NativeSelect";
import { confirmDialog } from "../../../lib/dialogs";
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
import { FileEditor } from "../FileEditor";
import { describeFileCommandError } from "../fileEditorLogic";
import { Button, Notice, SettingRow, SettingsCard } from "../ui";
import { useSettingsProjectCwd } from "../useAppSettings";
import { defaultMemorySlug, describeMemoryFile, groupMemoryFiles, memorySlugLabel, skillNameOf } from "./memoryFiles";

export function MemoryFilesPanel() {
	const cwd = useSettingsProjectCwd();
	const home = useHomeDir();
	const [projects, setProjects] = useState<string[] | null>(null);
	const [slug, setSlug] = useState<string | null>(null);
	const [files, setFiles] = useState<MemoryFileInfo[]>([]);
	const [rel, setRel] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		ompMemoryProjects().then(
			(list) => {
				if (!alive) return;
				setProjects(list);
				setSlug((cur) => cur ?? defaultMemorySlug(list, cwd));
				setError(null);
			},
			(e) => {
				if (!alive) return;
				setProjects([]);
				setError(describeFileCommandError(e));
			},
		);
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
		void refreshFiles();
	}, [refreshFiles]);

	const groups = useMemo(() => groupMemoryFiles(files), [files]);
	const selected = files.find((f) => f.rel === rel) ?? null;

	const load = useCallback(() => ompMemoryRead(slug ?? "", rel ?? ""), [slug, rel]);
	const save = useCallback(
		(content: string, stamp: string | null) => ompMemoryWrite(slug ?? "", rel ?? "", content, stamp),
		[slug, rel],
	);

	const deleteSkill = async () => {
		const name = rel ? skillNameOf(rel) : null;
		if (!slug || !name) return;
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

	const memoriesDir = home ? `${home.replace(/\/+$/, "")}/.omp/agent/memories` : null;
	const filePath = memoriesDir && slug && rel ? `${memoriesDir}/${slug}/${rel}` : null;

	return (
		<div className="space-y-3">
			<div className="px-1">
				<h3 className="text-sm font-semibold text-[var(--text)]">记忆文件</h3>
				<p className="mt-0.5 text-xs text-[var(--text-muted)]">
					omp 为每个项目单独存放的记忆。摘要和技能可以直接改；其余由 omp 生成，只能查看。这里不会新建文件。
				</p>
			</div>

			{error && <Notice tone="danger">{error}</Notice>}

			<SettingsCard>
				<SettingRow
					label="项目"
					description={
						projects && projects.length === 0 && !error ? "还没有任何项目的记忆" : "默认是当前会话所在的项目"
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
									{memorySlugLabel(p)}
								</option>
							))}
						</NativeSelect>
					}
				/>
				{slug && groups.length === 0 && !error && (
					<p className="px-4 pb-3 text-xs text-[var(--text-muted)]">这个项目下还没有记忆文件。</p>
				)}
				{groups.map((g) => (
					<div key={g.id} className="px-4 pb-3">
						<div className="text-xs font-medium text-[var(--text)]">{g.title}</div>
						<div className="mb-1.5 text-[11px] text-[var(--text-muted)]">{g.hint}</div>
						<div className="flex flex-wrap gap-1.5">
							{g.files.map((f) => {
								const d = describeMemoryFile(f.rel);
								return (
									<button
										type="button"
										key={f.rel}
										title={d.hint ? `${d.hint}（${f.rel}）` : f.rel}
										onClick={() => setRel(f.rel)}
										className={clsx(
											"press-scale rounded-lg px-2.5 py-1 font-mono text-[11px] transition-colors hairline",
											f.rel === rel
												? "bg-[var(--bg-active-fill)] text-[var(--text)]"
												: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
										)}
									>
										{d.title}
									</button>
								);
							})}
						</div>
					</div>
				))}
			</SettingsCard>

			{selected && slug && filePath && (
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
						skillNameOf(selected.rel) ? (
							<Button icon={Trash2} variant="danger" onClick={() => void deleteSkill()}>
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
