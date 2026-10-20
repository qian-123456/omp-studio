/** Settings → 规则文件 AGENTS.md: view/edit the global or project context file omp injects. */

import { markdown } from "@codemirror/lang-markdown";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import clsx from "clsx";
import { FilePlus2, FolderOpen, RefreshCw, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Segmented } from "../../../components/Segmented";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { useHomeDir, useShortPath } from "../../../lib/hooks";
import { readTextFile, validatePath, writeTextFile } from "../../../lib/ipc";
import { themeById, useResolvedThemeId } from "../../../lib/theme";
import { toast } from "../../../lib/toast";
import { Button, Notice, SectionHeader, SettingRow, SettingsCard } from "../ui";
import { OmpSections } from "../OmpSettingsList";
import { useSettingsProjectCwd } from "../useAppSettings";
import {
	type AgentsMdScope,
	type CandidateState,
	type ProjectTarget,
	STARTER_TEMPLATE,
	checkBeforeSave,
	defaultProjectTarget,
	effectiveProjectTarget,
	isTooLargeToEdit,
	projectAgentsMdPath,
	projectOmpDir,
} from "./agentsMd";

/** Unsaved drafts survive leaving the section (settings nav cannot be blocked). */
const draftCache = new Map<string, { loaded: string; draft: string }>();

/** null content = file missing. */
async function readIfExists(path: string): Promise<string | null> {
	const check = await validatePath(path);
	if (!check.exists) return null;
	if (check.isDir) throw new Error(`这是一个目录：${path}`);
	return readTextFile(path);
}

interface ProjectProbe {
	cwd: string;
	root: CandidateState;
	native: CandidateState;
	ompDirExists: boolean;
}

type Tab = "edit" | "preview";

export function AgentsMdSection() {
	const cwd = useSettingsProjectCwd();
	const home = useHomeDir();
	const short = useShortPath();
	const dark = themeById(useResolvedThemeId())?.dark ?? true;

	const [scope, setScope] = useState<AgentsMdScope>("global");
	const [target, setTarget] = useState<ProjectTarget>("root");
	const [probe, setProbe] = useState<ProjectProbe | null>(null);
	const [tab, setTab] = useState<Tab>("edit");

	// Loaded file state for `path`. `loaded` null = missing on disk.
	const [loadedPath, setLoadedPath] = useState<string | null>(null);
	const [loaded, setLoaded] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [restored, setRestored] = useState(false);

	const effectiveScope: AgentsMdScope = cwd ? scope : "global";
	const path =
		effectiveScope === "global"
			? home
				? `${home.replace(/\/+$/, "")}/.omp/agent/AGENTS.md`
				: null
			: cwd
				? projectAgentsMdPath(cwd, target)
				: null;

	const ready = loadedPath !== null && loadedPath === path;
	const readOnly = loaded !== null && isTooLargeToEdit(loaded);
	const dirty = ready && loaded !== null && !readOnly && draft !== loaded;

	// Keep the latest buffer reachable from the unmount cleanup.
	const bufRef = useRef({ path: loadedPath, loaded, draft, dirty });
	bufRef.current = { path: loadedPath, loaded, draft, dirty };
	useEffect(
		() => () => {
			const b = bufRef.current;
			if (b.dirty && b.path && b.loaded !== null) draftCache.set(b.path, { loaded: b.loaded, draft: b.draft });
		},
		[],
	);

	// Probe both project candidates whenever the project changes.
	const refreshProbe = useCallback(async (dir: string) => {
		try {
			const [root, native, ompDir] = await Promise.all([
				readIfExists(projectAgentsMdPath(dir, "root")),
				readIfExists(projectAgentsMdPath(dir, "native")),
				validatePath(projectOmpDir(dir)),
			]);
			const next: ProjectProbe = {
				cwd: dir,
				root: { content: root },
				native: { content: native },
				ompDirExists: ompDir.exists && ompDir.isDir,
			};
			setProbe(next);
			return next;
		} catch (e) {
			setProbe(null);
			toast.error(`读取项目规则文件失败：${errMsg(e)}`);
			return null;
		}
	}, []);

	useEffect(() => {
		if (!cwd) {
			setProbe(null);
			return;
		}
		let alive = true;
		void refreshProbe(cwd).then((p) => {
			if (alive && p) setTarget(defaultProjectTarget(p.root, p.native));
		});
		return () => {
			alive = false;
		};
	}, [cwd, refreshProbe]);

	const load = useCallback(async (p: string) => {
		setLoading(true);
		try {
			const text = await readIfExists(p);
			const cached = draftCache.get(p);
			draftCache.delete(p);
			setLoaded(text);
			if (cached && text !== null && cached.loaded === text) {
				setDraft(cached.draft);
				setRestored(true);
			} else {
				if (cached) toast.info("文件已在外部被修改，之前未保存的草稿已丢弃");
				setDraft(text ?? "");
				setRestored(false);
			}
			setLoadError(null);
		} catch (e) {
			setLoaded(null);
			setDraft("");
			setLoadError(errMsg(e));
		} finally {
			setLoadedPath(p);
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (path) void load(path);
	}, [path, load]);

	/** Ask before throwing away unsaved edits; true = OK to proceed. */
	const confirmDiscard = useCallback(async () => {
		if (!dirty) return true;
		return confirmDialog("当前文件有未保存的修改，切换后这些修改会丢失。确定继续？", {
			title: "放弃未保存的修改？",
			danger: true,
			okLabel: "放弃修改",
		});
	}, [dirty]);

	const switchScope = async (next: AgentsMdScope) => {
		if (next === effectiveScope || !(await confirmDiscard())) return;
		setScope(next);
	};

	const switchTarget = async (next: ProjectTarget) => {
		if (next === target || !(await confirmDiscard())) return;
		setTarget(next);
	};

	const afterWrite = useCallback(
		(text: string) => {
			setLoaded(text);
			setDraft(text);
			setRestored(false);
			if (cwd && effectiveScope === "project") void refreshProbe(cwd);
		},
		[cwd, effectiveScope, refreshProbe],
	);

	const save = useCallback(async () => {
		if (!path || !dirty || saving) return;
		setSaving(true);
		try {
			const onDisk = await readIfExists(path);
			const check = checkBeforeSave(loaded, onDisk);
			if (check.kind === "conflict") {
				const overwrite = await confirmDialog(
					"这个文件在你打开之后被其他程序修改过。用你现在的内容覆盖磁盘上的版本？",
					{ title: "文件已在外部被修改", danger: true, okLabel: "覆盖" },
				);
				if (!overwrite) {
					const reload = await confirmDialog("要改为载入磁盘上的最新版本吗？你当前的修改会丢失。", {
						title: "重新载入？",
						danger: true,
						okLabel: "重新载入",
					});
					if (reload) {
						setLoaded(check.onDisk);
						setDraft(check.onDisk ?? "");
						setRestored(false);
					}
					return;
				}
			}
			const text = draft;
			await writeTextFile(path, text);
			afterWrite(text);
			toast.success("已保存，新开的会话会使用新内容");
		} catch (e) {
			toast.error(`保存失败：${errMsg(e)}`);
		} finally {
			setSaving(false);
		}
	}, [path, dirty, saving, loaded, draft, afterWrite]);

	const create = async () => {
		if (!path) return;
		try {
			const onDisk = await readIfExists(path);
			if (onDisk !== null) {
				toast.info("文件已经存在，已载入");
				setLoaded(onDisk);
				setDraft(onDisk);
				return;
			}
			await writeTextFile(path, STARTER_TEMPLATE);
			afterWrite(STARTER_TEMPLATE);
			setTab("edit");
		} catch (e) {
			toast.error(`创建失败：${errMsg(e)}`);
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
		if (!path || !(await confirmDiscard())) return;
		draftCache.delete(path);
		await load(path);
		if (cwd && effectiveScope === "project") void refreshProbe(cwd);
	};

	const reveal = () => {
		if (!path) return;
		const where = loaded !== null ? path : path.replace(/\/[^/]+$/, "");
		void revealItemInDir(where).catch((e) => toast.error(`无法在访达中显示：${errMsg(e)}`));
	};

	// ⌘S / Ctrl+S saves while this section is mounted.
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

	const projectProbe = probe && probe.cwd === cwd ? probe : null;
	const effective = projectProbe ? effectiveProjectTarget(projectProbe.root, projectProbe.native) : null;

	const exists = ready && loaded !== null;
	const statusText = !ready
		? "读取中"
		: loadError
			? "读取失败"
			: loaded === null
				? "文件不存在"
				: effectiveScope === "project" && effective !== null && effective !== target
					? "存在，但被另一个文件覆盖，omp 不会读取它"
					: loaded.trim() === ""
						? "存在，但内容为空（omp 会忽略空文件）"
						: "omp 会读取这个文件";

	return (
		<div className="space-y-5">
			<SectionHeader
				title="规则文件 AGENTS.md"
				description="omp 每次对话都会带上的长期规则，以及输出时实时检查的规则"
			/>

			<Notice tone="info">
				AGENTS.md 写给 AI 的长期说明（项目约定、常用命令、注意事项）。修改只对之后新开的会话生效；内容按原样保存，
				<code>@路径</code> 引用行会在 omp 读取时展开。
			</Notice>

			<SettingsCard
				fieldId="agentsMdScope"
				footer={
					effectiveScope === "global"
						? "全局文件对所有项目的会话都生效。"
						: "项目文件只对在该目录（及子目录）启动的会话生效，和全局文件同时生效。"
				}
			>
				<SettingRow
					label="编辑哪个文件"
					description={
						cwd ? `当前项目：${short(cwd)}` : "先在左侧选中一个会话，才能编辑它所在项目的 AGENTS.md"
					}
					control={
						<Segmented<AgentsMdScope>
							aria-label="AGENTS.md 范围"
							size="sm"
							value={effectiveScope}
							onChange={(v) => void switchScope(v)}
							options={[
								{ value: "global", label: "全局" },
								{
									value: "project",
									label: "当前项目",
									disabled: !cwd,
									title: cwd ? undefined : "先在左侧选中一个会话",
								},
							]}
						/>
					}
				/>
				{effectiveScope === "project" && cwd && (
					<SettingRow
						fieldId="agentsMdProjectFile"
						label="项目文件位置"
						description={
							projectProbe?.ompDirExists
								? "项目里有两个可选位置。两个都有内容时，omp 只读 .omp/AGENTS.md。"
								: "项目根目录的 AGENTS.md。若想用 .omp/AGENTS.md，需先在项目里建好 .omp 文件夹。"
						}
						control={
							<Segmented<ProjectTarget>
								aria-label="项目 AGENTS.md 位置"
								size="sm"
								value={target}
								onChange={(v) => void switchTarget(v)}
								options={[
									{ value: "root", label: "AGENTS.md" },
									{
										value: "native",
										label: ".omp/AGENTS.md",
										disabled: !projectProbe?.ompDirExists,
										title: projectProbe?.ompDirExists ? undefined : "项目里还没有 .omp 文件夹",
									},
								]}
							/>
						}
					>
						{effective !== null && (
							<p className="px-4 pb-3 text-[11px] text-[var(--text-muted)]">
								omp 实际读取：
								<code className="font-mono text-neutral-300">
									{short(projectAgentsMdPath(cwd, effective))}
								</code>
							</p>
						)}
					</SettingRow>
				)}
			</SettingsCard>

			<SettingsCard fieldId="agentsMdEditor">
				<div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							{dirty && (
								<span
									className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
									title="有未保存的修改"
								/>
							)}
							<code className="truncate font-mono text-xs text-[var(--text)]" title={path ?? undefined}>
								{path ? short(path) : "未选择"}
							</code>
						</div>
						<div className="text-[11px] text-neutral-500">{statusText}</div>
					</div>
					<Button icon={FolderOpen} onClick={reveal} disabled={!path}>
						在访达中显示
					</Button>
					<Button
						icon={RefreshCw}
						onClick={() => void reload()}
						disabled={!path || loading}
						title="从磁盘重新读取"
						aria-label="从磁盘重新读取"
					>
						<span className={clsx(loading && "animate-pulse")}>重新读取</span>
					</Button>
				</div>

				{ready && loadError && <div className="px-4 py-3 text-xs text-[var(--status-error)]">{loadError}</div>}

				{ready && !loadError && loaded === null && (
					<div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
						<p className="text-xs text-neutral-400">这个位置还没有 AGENTS.md。</p>
						<Button icon={FilePlus2} onClick={() => void create()}>
							创建文件
						</Button>
					</div>
				)}

				{exists && (
					<div>
						{restored && (
							<div className="px-4 py-2 text-[11px] text-[var(--status-warning)]">已恢复你上次离开时未保存的修改。</div>
						)}
						{readOnly && (
							<div className="px-4 py-2 text-[11px] text-[var(--status-warning)]">
								文件超过 1 MB，为避免卡顿只能查看。请用外部编辑器修改。
							</div>
						)}
						<div className="flex items-center justify-between gap-2 px-4 py-2">
							<Segmented<Tab>
								aria-label="编辑或预览"
								size="sm"
								value={tab}
								onChange={setTab}
								options={[
									{ value: "edit", label: "编辑" },
									{ value: "preview", label: "预览" },
								]}
							/>
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

			<OmpSections page="agents-md" />
		</div>
	);
}
