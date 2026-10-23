/**
 * Settings ▸ 子代理 ▸ 子代理提示词与定义:
 * Browse, configure and edit prompt definitions for built-in and custom subagents (scout, task, reviewer, etc.)
 * in ~/.omp/agent/agents/<name>.md or <project>/.omp/agents/<name>.md.
 *
 * The header states how OMP picks a definition (project → global → built-in, whole-file, first wins)
 * and every row says which version is actually in use, so users never have to work that out themselves.
 */

import clsx from "clsx";
import { ChevronDown, ChevronRight, FilePlus2, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHomeDir } from "../../../lib/hooks";
import { fsReadDir, ompAgentRead, ompAgentWrite } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { formatTokenEstimate } from "../../../lib/tokenEstimate";
import { FileEditor } from "../FileEditor";
import { describeFileCommandError } from "../fileEditorLogic";
import { RoleScopeBar, useRoleScope } from "../modelRoleScope";
import { scopeDisplayName } from "../modelTemplates/logic";
import { Notice } from "../../../components/Notice";
import { Button, Chip, SectionHeader, SettingsCard } from "../ui";
import {
	AGENT_LAYER_LABEL,
	type AgentContents,
	type AgentEntry,
	type AgentScope,
	agentsDirPath,
	buildAgentEntries,
	extractFrontmatterSummary,
	isAgentFileName,
	resolveAgentLayer,
} from "./agentDefs";
import { NewAgentForm } from "./NewAgentForm";

async function listAgentFiles(dir: string | null): Promise<string[]> {
	if (!dir) return [];
	return fsReadDir(dir).then(
		(list) => list.filter((d) => !d.isDir && isAgentFileName(d.name)).map((d) => d.name),
		() => [],
	);
}

export function AgentDefsPanel() {
	const roleScope = useRoleScope();
	/**
	 * Project whose `.omp/agents` is listed or checked for shadowing: the picked project on the 项目 tab,
	 * otherwise the session's project (the picker is hidden on 全局, so nothing else would be visible).
	 */
	const cwd = roleScope.scope === "project" ? roleScope.pick : roleScope.sessionCwd;
	const projectName = cwd === null ? "" : scopeDisplayName(cwd, roleScope.projects);
	const home = useHomeDir();

	const effectiveScope: AgentScope = roleScope.scope === "project" && cwd ? "project" : "global";
	const [contents, setContents] = useState<AgentContents>({});
	/** File names per layer; null while loading. */
	const [globalNames, setGlobalNames] = useState<string[] | null>(null);
	const [projectNames, setProjectNames] = useState<string[] | null>(null);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [creatingCustom, setCreatingCustom] = useState(false);
	const editorRef = useRef<HTMLDivElement | null>(null);

	const globalDir = agentsDirPath("global", home, cwd);
	const projectDir = agentsDirPath("project", home, cwd);
	const dir = effectiveScope === "global" ? globalDir : projectDir;
	const hereNames = effectiveScope === "global" ? globalNames : projectNames;
	const entries = useMemo(() => (dir ? buildAgentEntries(dir, hereNames ?? []) : []), [dir, hereNames]);
	const expanded = entries.find((e) => e.id === expandedId) ?? null;

	const refresh = useCallback(async () => {
		try {
			const [g, p] = await Promise.all([listAgentFiles(globalDir), listAgentFiles(projectDir)]);
			setGlobalNames(g);
			setProjectNames(p);
			const currentDir = effectiveScope === "global" ? globalDir : projectDir;
			if (!currentDir) {
				setContents({});
				return;
			}
			const currentEntries = buildAgentEntries(currentDir, effectiveScope === "global" ? g : p);
			const reads = await Promise.all(
				currentEntries.map(
					async (e) =>
						[
							e.path,
							await ompAgentRead(e.path).then(
								(r) => r.content,
								() => null,
							),
						] as const,
				),
			);
			setContents(Object.fromEntries(reads));
			setError(null);
		} catch (e) {
			setError(describeFileCommandError(e));
		}
	}, [globalDir, projectDir, effectiveScope]);

	useEffect(() => {
		setContents({});
		setExpandedId(null);
		setCreatingCustom(false);
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!expandedId) return;
		const frame = requestAnimationFrame(() => {
			editorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
		return () => cancelAnimationFrame(frame);
	}, [expandedId]);

	const layerWord = AGENT_LAYER_LABEL[effectiveScope];

	const handleCreate = async (entry: AgentEntry) => {
		try {
			await ompAgentWrite(entry.path, entry.starter, null);
			await refresh();
			setExpandedId(entry.id);
			toast.success(`已为 ${entry.name} 新建${layerWord}，记得把提示词写完整`);
		} catch (e) {
			toast.error(`创建失败：${describeFileCommandError(e)}`);
		}
	};

	const handleCreatedCustom = async (name: string) => {
		setCreatingCustom(false);
		await refresh();
		setExpandedId(name);
		toast.success(`已新建子代理 ${name}，主 AI 现在可以派它了`);
	};
	const takenNames = useMemo(() => new Set(entries.map((e) => e.name)), [entries]);
	/** 「让 AI 帮我写」 runs where the file goes: the project, else the session's project, else home. */
	const aiCwd = effectiveScope === "project" ? cwd : (roleScope.sessionCwd ?? home);

	const load = useCallback(() => ompAgentRead(expanded?.path ?? ""), [expanded?.path]);
	const save = useCallback(
		(content: string, stamp: string | null) => ompAgentWrite(expanded?.path ?? "", content, stamp),
		[expanded?.path],
	);

	const renderRow = (e: AgentEntry) => {
		const loading = globalNames === null || projectNames === null || contents[e.path] === undefined;
		const filename = `${e.name}.md`;
		const layer = resolveAgentLayer({
			isBuiltin: e.isBuiltin,
			scope: effectiveScope,
			inGlobal: globalNames?.includes(filename) ?? false,
			inProject: projectNames?.includes(filename) ?? false,
			hasProject: cwd !== null,
		});
		const open = e.id === expandedId;
		const text = contents[e.path];
		const meta = typeof text === "string" ? extractFrontmatterSummary(text) : {};

		const expandable = layer.hereExists || open;
		const canCreate = !loading && !layer.hereExists;

		const summary = (
			<span className="min-w-0 flex-1">
				<span className="flex flex-wrap items-center gap-2">
					<code className="font-mono text-xs font-semibold text-[var(--text)]">{e.name}</code>
					{!e.isBuiltin && <Chip tone="neutral">自己新建的</Chip>}
					{!loading && layer.active && (
						<Chip
							tone={layer.active === effectiveScope ? "success" : "neutral"}
							title="OMP 实际使用的是哪一份"
						>
							正在用：{AGENT_LAYER_LABEL[layer.active]}
						</Chip>
					)}
					{meta.model && (
						<Chip tone="neutral" title="文件里写的模型">
							{meta.model}
						</Chip>
					)}
					{meta.thinkingLevel && (
						<Chip tone="neutral" title="思考等级">
							思考: {meta.thinkingLevel}
						</Chip>
					)}
					{typeof text === "string" && text.trim() !== "" && <Chip>{formatTokenEstimate(text)}</Chip>}
				</span>
				<span className="mt-1 block text-[11px] text-[var(--text-muted)]">{meta.description || e.description}</span>
				{layer.shadowedBy && (
					<span className="mt-1 block text-[11px] text-[var(--status-warning)]">
						「{projectName}」另有自己的{AGENT_LAYER_LABEL[layer.shadowedBy]}，这里的修改在那个项目里不会生效。
					</span>
				)}
			</span>
		);

		return (
			<div key={e.id} data-agent-row={e.id} data-testid={`agent-row-${e.id}`}>
				<div className="flex items-start">
					{expandable ? (
						<button
							type="button"
							onClick={() => setExpandedId(open ? null : e.id)}
							aria-expanded={open}
							aria-controls={open ? `agent-editor-${e.id}` : undefined}
							aria-label={open ? `收起 ${e.name}` : `查看并编辑 ${e.name}`}
							title={open ? `收起 ${e.name}` : `查看并编辑 ${e.name}（${e.path}）`}
							className={clsx(
								"flex min-w-0 flex-1 items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]",
								open && "bg-[var(--bg-active-fill)] hover:bg-[var(--bg-active-fill)]",
							)}
						>
							{open ? (
								<ChevronDown size={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
							) : (
								<ChevronRight size={13} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
							)}
							{summary}
							<span className="hairline shrink-0 whitespace-nowrap rounded-lg bg-[var(--bg-active-fill)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)]">
								{open ? "收起" : "查看并编辑"}
							</span>
						</button>
					) : (
						<div className="flex min-w-0 flex-1 items-start gap-2 px-4 py-2.5">{summary}</div>
					)}
					{canCreate && (
						<div className="py-2.5 pr-4">
							<Button
								icon={FilePlus2}
								aria-label={`为 ${e.name} 新建${layerWord}`}
								title={`在 ${e.path} 新建一份，之后${effectiveScope === "global" ? "所有项目" : `「${projectName}」`}都用它`}
								onClick={() => void handleCreate(e)}
							>
								新建{layerWord}
							</Button>
						</div>
					)}
				</div>
				{open && (
					<div
						id={`agent-editor-${e.id}`}
						ref={editorRef}
						className="border-t border-[var(--border-divider)] bg-[var(--bg-panel)] pb-3 pt-3"
					>
						<FileEditor
							key={`agent:${e.path}`}
							fileKey={`agent:${e.path}`}
							path={e.path}
							load={load}
							save={save}
							bare
							createContent={e.starter}
							savedToast="子代理定义已保存"
							statusText={(loaded) => (loaded === null ? "还没有这份文件" : `这是${layerWord}`)}
							onChanged={() => void refresh()}
						/>
					</div>
				)}
			</div>
		);
	};

	return (
		<div data-jump="子代理定义" className="scroll-mt-4 space-y-4">
			<SectionHeader
				title="子代理提示词与定义"
				description="自定义各子代理的提示词、可用工具和模型。项目配置优先于全局配置；自定义后会完整替换内置提示词。"
			/>

			<RoleScopeBar
				roleScope={roleScope}
				label="配置范围"
				projectTitle="只在所选项目用的版本"
				description={null}
			/>

			{error && <Notice tone="danger">{error}</Notice>}

			<SettingsCard fieldId="subagentsList" clip>
				<div className="flex items-center justify-between gap-3 border-b border-[var(--border-divider)] px-4 py-2.5 bg-[var(--bg-card-subtle)]">
					<div className="flex min-w-0 items-center gap-2">
						<Sparkles size={14} className="shrink-0 text-[var(--text-muted)]" />
						<span className="text-xs font-medium text-[var(--text)]">子代理列表（{layerWord}）</span>
					</div>
					{!creatingCustom && (
						<Button size="sm" variant="primary" icon={Plus} disabled={!dir} title={!dir ? "工作区目录尚未确定" : undefined} onClick={() => setCreatingCustom(true)}>
							新建子代理
						</Button>
					)}
				</div>
				{creatingCustom && dir && (
					<NewAgentForm
						dir={dir}
						scopeLabel={effectiveScope === "global" ? "全局版本（所有项目都能用）" : `「${projectName}」的项目版本`}
						taken={takenNames}
						aiCwd={aiCwd}
						onCreated={(name) => void handleCreatedCustom(name)}
						onCancel={() => setCreatingCustom(false)}
					/>
				)}

				<div className="divide-y divide-[var(--border-divider)]">{entries.map(renderRow)}</div>
			</SettingsCard>
		</div>
	);
}
