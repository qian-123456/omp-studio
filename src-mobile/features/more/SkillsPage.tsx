import { Puzzle, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { BottomSheet, Chip, EmptyState, Markdown, PageHeader, PullToRefresh, toast } from "../../ui";
import { LoadState, Switch, useLoad } from "./controls";
import { filterSkills, ISSUE_LABEL, reasonText, stripFrontmatter } from "./skills";
import type { Skill, SkillsData } from "./skills";

function SectionTitle({ title, count }: { title: string; count: number }) {
	return (
		<div className="flex items-center gap-2 px-4 pb-1 pt-4 text-m-sm font-medium text-m-text-2">
			<span>{title}</span>
			<span className="rounded-m-pill bg-m-surface px-2 text-m-xs text-m-text-3">{count}</span>
		</div>
	);
}

function SkillDetail({ skill, onClose, onToggle }: { skill: Skill | null; onClose: () => void; onToggle: (s: Skill) => void }) {
	const [content, setContent] = useState<{ path: string; text: string | null; error?: string } | null>(null);
	const path = skill?.path;
	useEffect(() => {
		if (!path) return;
		let alive = true;
		api<{ text: string }>("GET", `/left/skills/content?path=${encodeURIComponent(path)}`)
			.then((r) => alive && setContent({ path, text: r.text }))
			.catch((e) => alive && setContent({ path, text: null, error: errorMessage(e, "无法读取 SKILL.md") }));
		return () => {
			alive = false;
		};
	}, [path]);
	const loaded = content && content.path === path ? content : null;
	return (
		<BottomSheet open={!!skill} onClose={onClose} title={skill?.name} fullHeight>
			{skill && (
				<div className="flex flex-col gap-4 p-4" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 16px)" }}>
					<div className="flex items-center justify-between gap-3 rounded-m-lg border border-m-border bg-m-surface px-4">
						<span className="text-m-md">启用</span>
						<Switch checked={skill.enabled} label={`启用 ${skill.name}`} onChange={() => onToggle(skill)} />
					</div>
					<div className="flex flex-wrap gap-1.5">
						<Chip tone="accent">{skill.provider}</Chip>
						<Chip>{skill.source}</Chip>
						{skill.copies > 1 && <Chip tone="warn">{skill.copies} 份同名</Chip>}
						<Chip>{skill.promptChars} 字符常驻</Chip>
					</div>
					{!skill.enabled && skill.disabledReason && (
						<div className="text-m-sm text-m-warn">已停用：{reasonText(skill.disabledReason)}</div>
					)}
					{skill.issues.length > 0 && (
						<div className="text-m-sm text-m-danger">问题：{skill.issues.map((i) => ISSUE_LABEL[i] ?? i).join("、")}</div>
					)}
					<div className="break-all text-m-xs text-m-text-3">{skill.root} · {skill.path}</div>
					{skill.description && <Markdown text={skill.description} />}
					{loaded?.text != null ? (
						<div className="border-t border-m-border pt-4">
							<Markdown text={stripFrontmatter(loaded.text)} />
						</div>
					) : loaded?.error ? (
						<div className="text-m-xs text-m-text-3">{loaded.error}</div>
					) : (
						<div className="text-m-xs text-m-text-3">正在读取 SKILL.md</div>
					)}
				</div>
			)}
		</BottomSheet>
	);
}

export function SkillsPage() {
	const { data, setData, error, loading, reload } = useLoad(() => api<SkillsData>("GET", "/left/skills"));
	const [query, setQuery] = useState("");
	const [openName, setOpenName] = useState<string | null>(null);
	const shown = useMemo(() => (data ? filterSkills(data.skills, query) : []), [data, query]);
	const opened = data?.skills.find((s) => s.name === openName) ?? null;

	const toggle = async (url: string, body: Record<string, unknown>, apply: (d: SkillsData) => SkillsData) => {
		setData((d) => (d ? apply(d) : d));
		try {
			await api("POST", url, body);
			toast("已更新（对新会话生效）", { kind: "success" });
		} catch (e) {
			toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
		}
		await reload();
	};
	const toggleSkill = (s: Skill) =>
		toggle("/left/skills/toggle", { name: s.name, enabled: !s.enabled }, (d) => ({
			...d,
			skills: d.skills.map((x) => (x.name === s.name ? { ...x, enabled: !s.enabled } : x)),
		}));

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg text-m-text">
			<PageHeader title="Skills" subtitle={data ? `${data.skills.length} 个 Skill · ${data.extensions.length} 个扩展` : undefined} />
			<PullToRefresh onRefresh={reload}>
				{data === null ? (
					<LoadState loading={loading} error={error} onRetry={reload} />
				) : (
					<div style={{ paddingBottom: "calc(var(--m-safe-bottom) + 16px)" }}>
						<div className="px-4 pt-3">
							<label className="flex min-h-11 items-center gap-2 rounded-m-md border border-m-border bg-m-surface px-3">
								<Search size={16} className="shrink-0 text-m-text-3" aria-hidden />
								<input
									type="search"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="搜索 Skill"
									aria-label="搜索 Skill"
									className="min-w-0 flex-1 bg-transparent text-m-md text-m-text outline-none"
								/>
							</label>
						</div>
						{data.configError && <div className="px-4 pt-3 text-m-sm text-m-danger">配置读取异常：{data.configError}</div>}
						{data.skillsEnabled === false && <div className="px-4 pt-3 text-m-sm text-m-warn">Skills 总开关已关闭</div>}
						<SectionTitle title="Skills" count={shown.length} />
						{shown.length === 0 ? (
							<EmptyState icon={<Puzzle size={36} />} title={query ? "没有匹配的 Skill" : "没有 Skill"} />
						) : (
							<ul>
								{shown.map((s) => (
									<li key={`${s.name}:${s.path}`} className="flex items-center gap-2 border-b border-m-border pl-4 pr-1" data-testid="skill-row">
										<button type="button" onClick={() => setOpenName(s.name)} className="min-h-14 min-w-0 flex-1 py-2 text-left">
											<div className="flex flex-wrap items-center gap-x-2">
												<span className="break-all text-m-md font-medium">{s.name}</span>
												<span className="whitespace-nowrap text-m-xs text-m-text-3">{s.provider}</span>
											</div>
											{s.description && <div className="line-clamp-2 text-m-sm text-m-text-2">{s.description}</div>}
											{!s.enabled && s.disabledReason && (
												<div className="text-m-xs text-m-warn">已停用：{reasonText(s.disabledReason)}</div>
											)}
											{s.issues.length > 0 && (
												<div className="text-m-xs text-m-danger">问题：{s.issues.map((i) => ISSUE_LABEL[i] ?? i).join("、")}</div>
											)}
										</button>
										<Switch checked={s.enabled} label={`启用 ${s.name}`} onChange={() => void toggleSkill(s)} />
									</li>
								))}
							</ul>
						)}
						{!query && (
							<>
								<SectionTitle title="扩展" count={data.extensions.length} />
								{data.extensions.length === 0 ? (
									<div className="px-4 py-3 text-m-sm text-m-text-3">没有扩展</div>
								) : (
									<ul>
										{data.extensions.map((x) => (
											<li key={x.path} className="flex items-center gap-2 border-b border-m-border pl-4 pr-1">
												<div className="min-h-14 min-w-0 flex-1 py-2">
													<div className="break-all text-m-md">{x.name}</div>
													<div className="break-all text-m-xs text-m-text-3">{x.source}</div>
												</div>
												<Switch
													checked={x.enabled}
													label={`启用 ${x.name}`}
													onChange={() =>
														void toggle("/left/extensions/toggle", { path: x.path, enabled: !x.enabled }, (d) => ({
															...d,
															extensions: d.extensions.map((e) => (e.path === x.path ? { ...e, enabled: !x.enabled } : e)),
														}))
													}
												/>
											</li>
										))}
									</ul>
								)}
							</>
						)}
					</div>
				)}
			</PullToRefresh>
			<SkillDetail skill={opened} onClose={() => setOpenName(null)} onToggle={(s) => void toggleSkill(s)} />
		</div>
	);
}
