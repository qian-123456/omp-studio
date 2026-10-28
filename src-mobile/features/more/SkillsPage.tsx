import { CircleAlert, Puzzle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, errorMessage } from "../../core/api";
import { BottomSheet, Chip, EmptyState, ListGroup, ListRow, Markdown, PageHeader, PullToRefresh, Spinner, Switch, toast } from "../../ui";
import { LoadState, useLoad } from "./controls";
import { filterSkills, ISSUE_LABEL, reasonText, stripFrontmatter } from "./skills";
import type { Skill, SkillsData } from "./skills";

/** List row with a tappable body and a trailing switch (a switch cannot live inside a row button). */
function ToggleRow({
	title,
	subtitle,
	checked,
	label,
	onToggle,
	onOpen,
	testId,
}: {
	title: ReactNode;
	subtitle?: ReactNode;
	checked: boolean;
	label: string;
	onToggle: () => void;
	onOpen?: () => void;
	testId?: string;
}) {
	const body = (
		<>
			<span className="block text-m-md break-words text-m-text">{title}</span>
			{subtitle != null && <span className="mt-0.5 block text-m-xs break-words text-m-text-3">{subtitle}</span>}
		</>
	);
	return (
		<div className="m-list-row flex w-full items-stretch pl-5" data-testid={testId}>
			<div className="m-list-sep flex min-h-14 min-w-0 flex-1 items-center gap-2 pr-3">
				{onOpen ? (
					<button type="button" onClick={onOpen} className="min-w-0 flex-1 py-3 text-left active:opacity-60">
						{body}
					</button>
				) : (
					<div className="min-w-0 flex-1 py-3">{body}</div>
				)}
				<Switch checked={checked} label={label} onChange={onToggle} />
			</div>
		</div>
	);
}

function SkillSubtitle({ s }: { s: Skill }) {
	return (
		<>
			<span className="block text-m-text-3">{s.provider}</span>
			{s.description && <span className="mt-0.5 line-clamp-2 text-m-sm text-m-text-2">{s.description}</span>}
			{!s.enabled && s.disabledReason && <span className="mt-1 block text-m-warn">已停用：{reasonText(s.disabledReason)}</span>}
			{s.issues.length > 0 && <span className="mt-1 block text-m-danger">问题：{s.issues.map((i) => ISSUE_LABEL[i] ?? i).join("、")}</span>}
		</>
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
		<BottomSheet open={!!skill} onClose={onClose} title={skill?.name} subtitle={skill?.provider} fullHeight>
			{skill && (
				<div className="flex flex-col gap-5 pb-8">
					<ListGroup>
						<ToggleRow title="启用" subtitle="对新会话生效" checked={skill.enabled} label={`启用 ${skill.name}`} onToggle={() => onToggle(skill)} />
					</ListGroup>
					<div className="flex flex-wrap gap-1.5 px-5">
						<Chip tone="accent">{skill.provider}</Chip>
						<Chip>{skill.source}</Chip>
						{skill.copies > 1 && <Chip tone="warn">{skill.copies} 份同名</Chip>}
						<Chip>{skill.promptChars} 字符常驻</Chip>
					</div>
					{(!skill.enabled && skill.disabledReason) || skill.issues.length > 0 ? (
						<div className="flex flex-col gap-1 px-5 text-m-sm">
							{!skill.enabled && skill.disabledReason && <p className="text-m-warn">已停用：{reasonText(skill.disabledReason)}</p>}
							{skill.issues.length > 0 && <p className="text-m-danger">问题：{skill.issues.map((i) => ISSUE_LABEL[i] ?? i).join("、")}</p>}
						</div>
					) : null}
					<p className="m-selectable px-5 text-m-xs break-all text-m-text-3">{skill.path}</p>
					{skill.description && (
						<div className="m-selectable px-5">
							<Markdown text={skill.description} />
						</div>
					)}
					<div className="mx-4 rounded-m-lg bg-m-card px-4 py-4 shadow-m-card">
						{loaded?.text != null ? (
							<div className="m-selectable">
								<Markdown text={stripFrontmatter(loaded.text)} />
							</div>
						) : loaded?.error ? (
							<p className="m-selectable text-m-sm break-words text-m-text-3">{loaded.error}</p>
						) : (
							<div className="flex items-center gap-2 text-m-sm text-m-text-3">
								<Spinner size={16} /> 正在读取 SKILL.md
							</div>
						)}
					</div>
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
			toast("已更新，对新会话生效", { kind: "success" });
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
		<div className="flex h-full min-h-0 flex-col bg-m-bg-elev text-m-text">
			<PageHeader
				title="Skills"
				subtitle={data ? `${data.skills.length} 个 Skill · ${data.extensions.length} 个扩展` : undefined}
				className="bg-m-bg-elev!"
			/>
			<PullToRefresh onRefresh={reload}>
				{data === null ? (
					<LoadState loading={loading} error={error} onRetry={reload} />
				) : (
					<div className="pt-1" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 24px)" }}>
						<div className="px-4">
							<label className="flex min-h-12 items-center gap-3 rounded-m-pill bg-m-card pr-1 pl-4 shadow-m-card focus-within:ring-2 focus-within:ring-m-accent">
								<Search size={20} strokeWidth={1.75} className="shrink-0 text-m-text-3" aria-hidden />
								<input
									type="search"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="搜索 Skill"
									aria-label="搜索 Skill"
									className="min-w-0 flex-1 bg-transparent text-m-md text-m-text outline-none placeholder:text-m-text-3 [&::-webkit-search-cancel-button]:hidden"
								/>
								{query && (
									<button
										type="button"
										aria-label="清除搜索"
										onClick={() => setQuery("")}
										className="flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill text-m-text-3 active:bg-m-surface-hover"
									>
										<X size={18} />
									</button>
								)}
							</label>
						</div>
						{(data.configError || data.skillsEnabled === false) && (
							<ListGroup className="mt-4">
								{data.configError && (
									<ListRow
										icon={<CircleAlert size={22} strokeWidth={1.75} />}
										danger
										title="配置读取异常"
										subtitle={<span className="m-selectable">{data.configError}</span>}
									/>
								)}
								{data.skillsEnabled === false && <ListRow title="Skills 总开关已关闭" subtitle="在电脑端设置中打开后才会加载" />}
							</ListGroup>
						)}
						{shown.length === 0 ? (
							<EmptyState icon={<Puzzle size={26} strokeWidth={1.75} />} title={query ? "没有匹配的 Skill" : "没有 Skill"} />
						) : (
							<ListGroup title={`Skills · ${shown.length}`}>
								{shown.map((s) => (
									<ToggleRow
										key={`${s.name}:${s.path}`}
										testId="skill-row"
										title={s.name}
										subtitle={<SkillSubtitle s={s} />}
										checked={s.enabled}
										label={`启用 ${s.name}`}
										onToggle={() => void toggleSkill(s)}
										onOpen={() => setOpenName(s.name)}
									/>
								))}
							</ListGroup>
						)}
						{!query &&
							(data.extensions.length === 0 ? (
								<ListGroup title="扩展 · 0">
									<ListRow title="没有扩展" />
								</ListGroup>
							) : (
								<ListGroup title={`扩展 · ${data.extensions.length}`}>
									{data.extensions.map((x) => (
										<ToggleRow
											key={x.path}
											title={x.name}
											subtitle={<span className="break-all">{x.source}</span>}
											checked={x.enabled}
											label={`启用 ${x.name}`}
											onToggle={() =>
												void toggle("/left/extensions/toggle", { path: x.path, enabled: !x.enabled }, (d) => ({
													...d,
													extensions: d.extensions.map((e) => (e.path === x.path ? { ...e, enabled: !x.enabled } : e)),
												}))
											}
										/>
									))}
								</ListGroup>
							))}
					</div>
				)}
			</PullToRefresh>
			<SkillDetail skill={opened} onClose={() => setOpenName(null)} onToggle={(s) => void toggleSkill(s)} />
		</div>
	);
}
