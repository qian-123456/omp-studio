/** Settings → 规则文件: every omp rule file (AGENTS.md, RULES.md, rules/*.md, APPEND_SYSTEM.md), global or per project. */

import clsx from "clsx";
import { ArrowUpRight, ChevronDown, ChevronRight, FilePlus2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../../../components/Segmented";
import { useHomeDir, useShortPath } from "../../../lib/hooks";
import { fsReadDir, ompRuleRead, ompRuleWrite } from "../../../lib/ipc";
import { formatTokenEstimate } from "../../../lib/tokenEstimate";
import { toast } from "../../../lib/toast";
import { FileEditor } from "../FileEditor";
import { describeFileCommandError } from "../fileEditorLogic";
import { OmpSections } from "../OmpSettingsList";
import { useSettingsNav } from "../settingsNav";
import { Notice } from "../../../components/Notice";
import { Button, Chip, SectionHeader, SettingRow, SettingsCard } from "../ui";
import { useSettingsProjectCwd } from "../useAppSettings";
import {
	type RuleContents,
	type RuleEntry,
	type RuleScope,
	buildRuleEntries,
	buildRuleFileEntries,
	ruleStatus,
	rulesDirPath,
} from "./rulesFiles";

const RELATED_PAGES = [
	{ id: "memory", label: "记忆", description: "memory_summary.md、MEMORY.md 和沉淀的技能，omp 从历史会话里自己整理，同样会带进新会话" },
	{ id: "skills", label: "技能与命令", description: "从哪些目录加载技能和自定义命令" },
	{ id: "prompt-composition", label: "系统提示词构成", description: "规则文件和记忆最终各占系统提示词多少" },
] as const;

export function RulesFilesSection() {
	const cwd = useSettingsProjectCwd();
	const { navigate } = useSettingsNav();
	const home = useHomeDir();
	const short = useShortPath();

	const [scope, setScope] = useState<RuleScope>("global");
	const effectiveScope: RuleScope = cwd ? scope : "global";
	const [contents, setContents] = useState<RuleContents>({});
	const [ruleNames, setRuleNames] = useState<string[]>([]);
	/** Row whose editor is expanded below it (only one at a time). */
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const editorRef = useRef<HTMLDivElement | null>(null);

	const fixed = useMemo(() => buildRuleEntries(effectiveScope, home, cwd), [effectiveScope, home, cwd]);
	const dir = rulesDirPath(effectiveScope, home, cwd);
	const ruleFiles = useMemo(() => (dir ? buildRuleFileEntries(dir, ruleNames) : []), [dir, ruleNames]);
	const entries = useMemo(() => [...fixed, ...ruleFiles], [fixed, ruleFiles]);
	const expanded = entries.find((e) => e.id === expandedId) ?? null;

	const refresh = useCallback(async () => {
		try {
			const reads = await Promise.all(fixed.map(async (e) => [e.path, (await ompRuleRead(e.path)).content] as const));
			setContents(Object.fromEntries(reads));
			setError(null);
		} catch (e) {
			setError(describeFileCommandError(e));
		}
		if (!dir) {
			setRuleNames([]);
			return;
		}
		// A missing rules/ folder just means no rule files yet.
		const names = await fsReadDir(dir).then((list) => list.filter((d) => !d.isDir).map((d) => d.name), () => []);
		setRuleNames(names);
		const extra = await Promise.all(
			buildRuleFileEntries(dir, names).map(
				async (e) => [e.path, await ompRuleRead(e.path).then((r) => r.content, () => null)] as const,
			),
		);
		setContents((prev) => ({ ...prev, ...Object.fromEntries(extra) }));
	}, [fixed, dir]);

	useEffect(() => {
		setContents({});
		setExpandedId(null);
		void refresh();
	}, [refresh]);

	// Expanding a row mounts the editor under it; bring that editor into view.
	useEffect(() => {
		if (!expandedId) return;
		const frame = requestAnimationFrame(() => {
			editorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
		return () => cancelAnimationFrame(frame);
	}, [expandedId]);

	const create = async (entry: RuleEntry) => {
		try {
			await ompRuleWrite(entry.path, entry.starter, null);
			await refresh();
			setExpandedId(entry.id);
		} catch (e) {
			toast.error(`创建失败：${describeFileCommandError(e)}`);
		}
	};

	const load = useCallback(() => ompRuleRead(expanded?.path ?? ""), [expanded?.path]);
	const save = useCallback(
		(content: string, stamp: string | null) => ompRuleWrite(expanded?.path ?? "", content, stamp),
		[expanded?.path],
	);

	const renderRow = (e: RuleEntry) => {
		const st = ruleStatus(e, contents);
		const isRuleFile = e.kind === "rule-file";
		const loading = st.label === "读取中";
		const open = e.id === expandedId;
		const text = contents[e.path];
		// A file that is not on disk yet has nothing to open: its action is 「创建」.
		// While the status is unknown (读取中) the row stays plain too.
		const expandable = isRuleFile || st.exists || open;
		const canCreate = !isRuleFile && !loading && !st.exists;
		const summary = (
			<span className="min-w-0 flex-1">
				<span className="flex flex-wrap items-center gap-2">
					<code className="font-mono text-xs text-[var(--text)]">{e.label}</code>
					{!loading && (
						<Chip tone={st.exists || isRuleFile ? "success" : "neutral"}>{isRuleFile ? "已存在" : st.label}</Chip>
					)}
					{typeof text === "string" && text.trim() !== "" && <Chip>{formatTokenEstimate(text)}</Chip>}
					{st.note && <span className="text-[11px] text-[var(--status-warning)]">{st.note}</span>}
				</span>
				<span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">{e.description}</span>
			</span>
		);
		return (
			<div key={e.id} data-rule-row={e.id}>
				<div className="flex items-start">
					{expandable ? (
						<button
							type="button"
							onClick={() => setExpandedId(open ? null : e.id)}
							aria-expanded={open}
							aria-controls={open ? `rule-editor-${e.id}` : undefined}
							aria-label={open ? `收起 ${e.label}` : `查看并编辑 ${e.label}`}
							title={open ? `收起 ${e.label}` : `查看并编辑 ${e.label}（${e.path}）`}
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
							<Button icon={FilePlus2} onClick={() => void create(e)}>
								创建
							</Button>
						</div>
					)}
				</div>
				{open && (
					<div
						id={`rule-editor-${e.id}`}
						ref={editorRef}
						data-field-id="agentsMdEditor"
						className="border-t border-[var(--border-divider)] bg-[var(--bg-panel)] pb-3 pt-3"
					>
						<FileEditor
							key={`rule:${e.path}`}
							fileKey={`rule:${e.path}`}
							path={e.path}
							load={load}
							save={save}
							bare
							createContent={isRuleFile ? undefined : e.starter}
							statusText={(loaded) => {
								const s = ruleStatus(e, { [e.path]: loaded });
								return s.note ? `${s.label}；${s.note}` : s.label;
							}}
							onChanged={() => void refresh()}
						/>
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="space-y-5">
			<SectionHeader
				title="规则文件"
				description="omp 每次对话都会带上的长期规则，以及输出时实时检查的规则"
			/>

			<Notice tone="info">
				修改只对之后新开的会话生效；内容按原样保存，AGENTS.md 里的 <code>@路径</code> 引用行会在 omp 读取时展开。
			</Notice>

			{error && <Notice tone="danger">{error}</Notice>}

			<SettingsCard
				fieldId="agentsMdScope"
				footer={
					effectiveScope === "global"
						? "全局文件对所有项目的会话都生效。"
						: "项目文件只对在该目录（及子目录）启动的会话生效，和全局文件同时生效。"
				}
			>
				<SettingRow
					label="查看哪一层"
					description={cwd ? `当前项目：${short(cwd)}` : "先在左侧选中一个会话，才能编辑它所在项目的规则文件"}
					control={
						<Segmented<RuleScope>
							aria-label="规则文件范围"
							size="sm"
							value={effectiveScope}
							onChange={setScope}
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
			</SettingsCard>

			<SettingsCard fieldId="agentsMdProjectFile" clip>
				<div className="divide-y divide-[var(--border-divider)]">
					{fixed.map(renderRow)}
					{ruleFiles.map(renderRow)}
				</div>
				{ruleFiles.length === 0 && (
					<p className="px-4 py-2.5 text-[11px] text-[var(--text-muted)]">
						{dir ? short(dir) : "rules/"} 下还没有规则文件（rules/*.md）。可在访达里把规则文件放进去，这里会列出来。
					</p>
				)}
			</SettingsCard>

			<SettingsCard fieldId="agentsMdRelated">
				<div className="divide-y divide-[var(--border-divider)]">
					{RELATED_PAGES.map((p) => (
						<SettingRow
							key={p.id}
							label={p.label}
							description={p.description}
							control={
								<Button icon={ArrowUpRight} onClick={() => navigate(p.id)}>
									前往{p.label}
								</Button>
							}
						/>
					))}
				</div>
			</SettingsCard>

			{!expanded && (
				<p data-field-id="agentsMdEditor" className="px-1 text-xs text-[var(--text-muted)]">
					点开带「查看并编辑」的一行，就能在那一行下面查看和修改文件内容。
				</p>
			)}

			<OmpSections page="agents-md" />
		</div>
	);
}
