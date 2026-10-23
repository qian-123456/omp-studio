/**
 * [D] "插件" settings section.
 *
 * - Installed plugins: `plugins_list` reads omp's plugin roots
 *   (`~/.omp/plugins` + project `.omp/plugins`): package.json deps (npm),
 *   lockfile-only entries (`plugin link`), and `installed_plugins.json`
 *   (marketplace). The toggle writes `plugins.<name>.enabled` in that scope's
 *   `omp-plugins.lock.json` — the same file `omp plugin enable/disable` edits.
 * - Extension modules: reused `skills_list` catalog (`.omp/agent/extensions`
 *   + project `.omp/extensions`); toggled through `disabledExtensions` via the
 *   standard `omp config set` bridge.
 * - The `extensions` / `disabledExtensions` / `marketplace.autoUpdate` config
 *   keys render as the omp section 扩展 (`<OmpSections page="plugins" />`).
 */

import {
	ExternalLink,
	FolderOpen,
	Loader2,
	Puzzle,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
	ExtensionItem,
	PluginCatalog,
	PluginItem,
} from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import {
	extensionDelete,
	ompConfigList,
	ompConfigSet,
	pluginsList,
	pluginSetEnabled,
	skillsList,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { Switch } from "./Switch";
import { projectName } from "./mcpDraft";
import { OmpSections } from "./OmpSettingsList";
import { SectionJumpBar } from "./SectionJumpBar";
import { EmptyState } from "../../components/EmptyState";
import { Notice } from "../../components/Notice";
import { Button, Chip, IconButton, SectionHeader, SettingsCard } from "./ui";

const KIND_LABELS: Record<string, string> = {
	npm: "npm",
	link: "本地链接",
	marketplace: "市场",
	unknown: "未知来源",
};

/** Write an OMP string-array setting via `omp config set` (same shape the
 * skills page uses for disabledExtensions). */
async function updateOmpList(
	key: string,
	mutate: (current: string[]) => string[],
): Promise<void> {
	const list = await ompConfigList();
	const entry = list.entries.find((e) => e.key === key);
	const current =
		entry && Array.isArray(entry.value)
			? entry.value.filter((v): v is string => typeof v === "string")
			: [];
	const next = mutate(current);
	if (next === current) return;
	await ompConfigSet(key, JSON.stringify(next));
}

function pluginSourceLabel(p: PluginItem): string {
	return KIND_LABELS[p.kind] ?? p.kind;
}

export function PluginsSection({
	cwd,
	query = "",
}: {
	cwd: string | null;
	query?: string;
}) {
	const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
	const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const [cat, skills] = await Promise.all([
				pluginsList(cwd),
				skillsList(cwd).catch(() => null),
			]);
			setCatalog(cat);
			setExtensions(skills?.extensions ?? []);
			setLoadError(null);
		} catch (e) {
			setLoadError(errMsg(e));
		} finally {
			setLoading(false);
		}
	}, [cwd]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const q = query.trim().toLowerCase();

	const plugins = useMemo(
		() =>
			(catalog?.plugins ?? []).filter(
				(p) =>
					!q ||
					p.name.toLowerCase().includes(q) ||
					(p.description ?? "").toLowerCase().includes(q),
			),
		[catalog, q],
	);
	const exts = useMemo(
		() =>
			extensions.filter(
				(e) =>
					!q ||
					e.name.toLowerCase().includes(q) ||
					e.path.toLowerCase().includes(q),
			),
		[extensions, q],
	);

	const togglePlugin = async (p: PluginItem) => {
		if (busy) return;
		setBusy(`plugin:${p.name}`);
		try {
			await pluginSetEnabled(p.name, !p.enabled, cwd);
			toast.success(
				p.enabled
					? `已停用插件 ${p.name}，新会话生效`
					: `已启用插件 ${p.name}，新会话生效`,
			);
			await reload();
		} catch (e) {
			toast.error(`更新插件状态失败: ${errMsg(e)}`);
		} finally {
			setBusy(null);
		}
	};

	const toggleExtension = async (ext: ExtensionItem) => {
		if (busy) return;
		setBusy(`ext:${ext.path}`);
		try {
			await updateOmpList("disabledExtensions", (cur) =>
				ext.enabled
					? [...new Set([...cur, ext.name])]
					: cur.filter(
							(id) =>
								id !== ext.name &&
								id !== `extension-module:${ext.name}` &&
								id !== ext.path,
						),
			);
			toast.success(
				ext.enabled
					? `已停用扩展 ${ext.name}，新会话生效`
					: `已启用扩展 ${ext.name}，新会话生效`,
			);
			await reload();
		} catch (e) {
			toast.error(`更新扩展状态失败: ${errMsg(e)}`);
		} finally {
			setBusy(null);
		}
	};

	const deleteExtension = async (ext: ExtensionItem) => {
		if (busy) return;
		const ok = await confirmDialog(
			`永久删除扩展模块「${ext.name}」？\n${ext.path}\n文件会直接从磁盘删除，无法恢复。`,
			{ title: "删除扩展模块", danger: true, okLabel: "删除" },
		);
		if (!ok) return;
		setBusy(`ext:${ext.path}`);
		try {
			await extensionDelete(ext.path, cwd);
			toast.success(`已删除扩展 ${ext.name}，新会话生效`);
			await reload();
		} catch (e) {
			toast.error(`删除扩展失败: ${errMsg(e)}`);
		} finally {
			setBusy(null);
		}
	};

	const reveal = (dir: string) => {
		void revealItemInDir(dir).catch((e) =>
			toast.error(`打开目录失败: ${errMsg(e)}`),
		);
	};

	const busyIcon = (
		<Loader2 className="h-3 w-3 animate-spin text-[var(--text-dim)]" aria-label="正在保存" />
	);

	return (
		<div className="space-y-6">
			<SectionHeader
				title="插件"
				description="已安装的插件与扩展。开关改动只对之后新开的会话生效。"
				actions={
					<IconButton
						icon={RefreshCw}
						label="重新扫描插件目录"
						onClick={() => void reload()}
						disabled={busy !== null || loading}
						className={loading ? "[&_svg]:animate-spin" : undefined}
					/>
				}
			/>
			<SectionJumpBar />

			<div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
				<FolderOpen className="h-3.5 w-3.5 shrink-0" />
				{cwd ? (
					<span className="min-w-0 truncate" title={cwd}>
						当前项目：<span className="font-medium text-[var(--text)]">{projectName(cwd)}</span>
					</span>
				) : (
					<span className="text-[var(--text-dim)]">未选择项目，仅显示全局插件</span>
				)}
			</div>

			{loadError && (
				<Notice
					tone="danger"
					action={
						<Button size="sm" icon={RefreshCw} onClick={() => void reload()}>
							重试
						</Button>
					}
				>
					<span className="break-all">读取插件失败：{loadError}</span>
				</Notice>
			)}

			{/* Installed plugins */}
			<SettingsCard
				title="已安装插件"
				jump="已安装插件"
				aside={`${catalog?.plugins.length ?? 0} 个`}
				fieldId="pluginList"
				clip
				footer={
					catalog && catalog.roots.length > 0 ? (
						<span className="flex flex-wrap items-center gap-1.5">
							{catalog.roots.map((r) => (
								<Button
									key={r.dir}
									size="sm"
									variant="ghost"
									icon={ExternalLink}
									title={r.dir}
									onClick={() => reveal(r.dir)}
								>
									{r.scope === "project" ? "项目插件目录" : "全局插件目录"}
								</Button>
							))}
						</span>
					) : undefined
				}
			>
				{!catalog && !loadError ? (
					<div className="flex justify-center py-6 text-[var(--text-dim)]">
						<Loader2 aria-label="加载插件" className="h-4 w-4 animate-spin" />
					</div>
				) : plugins.length === 0 ? (
					<EmptyState
						icon={Puzzle}
						title={q ? `没有匹配「${q}」的插件` : "还没有安装插件"}
						description={
							q ? undefined : "可在终端运行 omp plugin install <包名> 安装，装好后点右上角的刷新按钮。"
						}
					/>
				) : (
					plugins.map((p) => (
						<div
							key={`${p.scope}:${p.name}`}
							className="flex items-center justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-[var(--bg-hover)]"
						>
							<div className="min-w-0 flex-1">
								<div className="flex min-w-0 flex-wrap items-center gap-1.5">
									<span className="truncate text-[13px] font-medium text-[var(--text)]">{p.name}</span>
									{p.version && (
										<span className="shrink-0 font-mono text-xs text-[var(--text-dim)]">v{p.version}</span>
									)}
									<Chip title="安装来源">{pluginSourceLabel(p)}</Chip>
									<Chip
										tone={p.scope === "project" ? "accent" : "neutral"}
										title={p.scope === "project" ? "只在当前项目的会话中加载" : "所有项目的会话都会加载"}
									>
										{p.scope === "project" ? "项目" : "全局"}
									</Chip>
									{!p.hasManifest && (
										<Chip tone="warning" title="插件缺少 omp 清单（package.json 中的 omp 或 pi 字段），运行时不会加载">
											无清单
										</Chip>
									)}
									{p.projectDisabled && (
										<Chip tone="warning" title="当前项目的 plugin-overrides.json 禁用了它，需在该文件中解除">
											项目已禁用
										</Chip>
									)}
								</div>
								{p.description && (
									<div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{p.description}</div>
								)}
								{p.enabledFeatures != null && p.enabledFeatures.length > 0 && (
									<div className="mt-0.5 truncate font-mono text-xs text-[var(--text-dim)]">
										已启用功能：{p.enabledFeatures.join(", ")}
									</div>
								)}
							</div>
							<div className="flex shrink-0 items-center gap-0.5">
								{p.dir && (
									<IconButton
										icon={ExternalLink}
										label={`在访达中显示 ${p.name}`}
										title={`在访达中显示：${p.dir}`}
										onClick={() => reveal(p.dir!)}
									/>
								)}
								{busy === `plugin:${p.name}` && busyIcon}
								<span
									className="ml-2"
									title={
										p.projectDisabled
											? "已被项目覆盖配置禁用，无法在此开启"
											: p.enabled
												? "已启用，点击停用"
												: "已停用，点击启用"
									}
								>
									<Switch
										checked={p.enabled}
										disabled={busy !== null || p.projectDisabled}
										onChange={() => void togglePlugin(p)}
									/>
								</span>
							</div>
						</div>
					))
				)}
			</SettingsCard>

			{/* Extension modules */}
			<SettingsCard
				title="扩展模块"
				jump="扩展模块"
				aside={`${extensions.length} 个`}
				description="放在扩展目录中的脚本模块。"
				fieldId="extensionList"
				clip
			>
				{exts.length === 0 ? (
					<EmptyState title={q ? `没有匹配「${q}」的扩展` : "未发现扩展模块"} />
				) : (
					exts.map((ext) => (
						<div
							key={ext.path}
							className="flex items-center justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-[var(--bg-hover)]"
						>
							<div className="min-w-0 flex-1">
								<div className="flex min-w-0 items-center gap-1.5">
									<span className="truncate text-[13px] font-medium text-[var(--text)]">{ext.name}</span>
									<Chip tone={ext.source === "project" ? "accent" : "neutral"}>
										{ext.source === "project" ? "项目" : "全局"}
									</Chip>
								</div>
								<div className="mt-0.5 truncate font-mono text-xs text-[var(--text-dim)]" title={ext.path}>
									{ext.path}
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-0.5">
								<IconButton
									icon={ExternalLink}
									label={`在访达中显示 ${ext.name}`}
									title="在访达中显示"
									onClick={() => reveal(ext.path)}
								/>
								<IconButton
									icon={Trash2}
									variant="danger"
									label={`删除扩展 ${ext.name}`}
									title="永久删除这个扩展模块"
									disabled={busy !== null}
									onClick={() => void deleteExtension(ext)}
								/>
								{busy === `ext:${ext.path}` && busyIcon}
								<span className="ml-2">
									<Switch
										checked={ext.enabled}
										disabled={busy !== null}
										onChange={() => void toggleExtension(ext)}
									/>
								</span>
							</div>
						</div>
					))
				)}
			</SettingsCard>

			{/* extensions / disabledExtensions / marketplace.autoUpdate */}
			<OmpSections page="plugins" />
		</div>
	);
}
