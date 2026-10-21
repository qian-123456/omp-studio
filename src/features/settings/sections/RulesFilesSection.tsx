/** Settings → 规则文件: every omp rule file (AGENTS.md, RULES.md, rules/*.md, APPEND_SYSTEM.md), global or per project. */

import clsx from "clsx";
import { FilePlus2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Segmented } from "../../../components/Segmented";
import { useHomeDir, useShortPath } from "../../../lib/hooks";
import { fsReadDir, ompRuleRead, ompRuleWrite } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { FileEditor } from "../FileEditor";
import { describeFileCommandError } from "../fileEditorLogic";
import { OmpSections } from "../OmpSettingsList";
import { Button, Chip, Notice, SectionHeader, SettingRow, SettingsCard } from "../ui";
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

export function RulesFilesSection() {
	const cwd = useSettingsProjectCwd();
	const home = useHomeDir();
	const short = useShortPath();

	const [scope, setScope] = useState<RuleScope>("global");
	const effectiveScope: RuleScope = cwd ? scope : "global";
	const [contents, setContents] = useState<RuleContents>({});
	const [ruleNames, setRuleNames] = useState<string[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const fixed = useMemo(() => buildRuleEntries(effectiveScope, home, cwd), [effectiveScope, home, cwd]);
	const dir = rulesDirPath(effectiveScope, home, cwd);
	const ruleFiles = useMemo(() => (dir ? buildRuleFileEntries(dir, ruleNames) : []), [dir, ruleNames]);
	const entries = useMemo(() => [...fixed, ...ruleFiles], [fixed, ruleFiles]);
	const selected = entries.find((e) => e.id === selectedId) ?? null;

	const refresh = useCallback(async () => {
		try {
			const reads = await Promise.all(fixed.map(async (e) => [e.path, (await ompRuleRead(e.path)).content] as const));
			setContents(Object.fromEntries(reads));
			setError(null);
		} catch (e) {
			setError(describeFileCommandError(e));
		}
		if (dir) {
			// A missing rules/ folder just means no rule files yet.
			setRuleNames(await fsReadDir(dir).then((list) => list.filter((d) => !d.isDir).map((d) => d.name), () => []));
		} else {
			setRuleNames([]);
		}
	}, [fixed, dir]);

	useEffect(() => {
		setContents({});
		setSelectedId(null);
		void refresh();
	}, [refresh]);

	const create = async (entry: RuleEntry) => {
		try {
			await ompRuleWrite(entry.path, entry.starter, null);
			await refresh();
			setSelectedId(entry.id);
		} catch (e) {
			toast.error(`创建失败：${describeFileCommandError(e)}`);
		}
	};

	const load = useCallback(() => ompRuleRead(selected?.path ?? ""), [selected?.path]);
	const save = useCallback(
		(content: string, stamp: string | null) => ompRuleWrite(selected?.path ?? "", content, stamp),
		[selected?.path],
	);

	const renderRow = (e: RuleEntry) => {
		const st = ruleStatus(e, contents);
		const isRuleFile = e.kind === "rule-file";
		const loading = st.label === "读取中";
		return (
			<div
				key={e.id}
				className={clsx(
					"flex items-start gap-3 px-4 py-2.5",
					e.id === selectedId && "bg-[var(--bg-active-fill)]",
				)}
			>
				<button
					type="button"
					onClick={() => setSelectedId(e.id)}
					className="min-w-0 flex-1 text-left"
					title={e.path}
				>
					<div className="flex flex-wrap items-center gap-2">
						<code className="font-mono text-xs text-[var(--text)]">{e.label}</code>
						{!loading && (
							<Chip tone={st.exists || isRuleFile ? "success" : "neutral"}>
								{isRuleFile ? "已存在" : st.label}
							</Chip>
						)}
						{st.note && <span className="text-[11px] text-[var(--status-warning)]">{st.note}</span>}
					</div>
					<div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{e.description}</div>
				</button>
				{!isRuleFile && !loading && !st.exists && (
					<Button icon={FilePlus2} onClick={() => void create(e)}>
						创建
					</Button>
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

			<SettingsCard fieldId="agentsMdProjectFile">
				<div className="divide-y divide-[var(--border-subtle)]">
					{fixed.map(renderRow)}
					{ruleFiles.map(renderRow)}
				</div>
				{ruleFiles.length === 0 && (
					<p className="px-4 py-2.5 text-[11px] text-[var(--text-muted)]">
						{dir ? short(dir) : "rules/"} 下还没有规则文件（rules/*.md）。可在访达里把规则文件放进去，这里会列出来。
					</p>
				)}
			</SettingsCard>

			<div data-field-id="agentsMdEditor">
				{selected ? (
					<FileEditor
						key={`rule:${selected.path}`}
						fileKey={`rule:${selected.path}`}
						path={selected.path}
						load={load}
						save={save}
						createContent={selected.kind === "rule-file" ? undefined : selected.starter}
						statusText={(loaded) => {
							const st = ruleStatus(selected, { [selected.path]: loaded });
							return st.note ? `${st.label}；${st.note}` : st.label;
						}}
						onChanged={() => void refresh()}
					/>
				) : (
					<p className="px-1 text-xs text-[var(--text-muted)]">选择上面的一个文件来查看或编辑。</p>
				)}
			</div>

			<OmpSections page="agents-md" />
		</div>
	);
}
