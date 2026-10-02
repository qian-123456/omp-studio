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
 * - The `extensions` / `disabledExtensions` config keys render as regular
 *   OMP config rows underneath.
 */

import {
	AlertTriangle,
	ExternalLink,
	FolderOpen,
	Loader2,
	Puzzle,
	RefreshCw,
	Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
	ExtensionItem,
	PluginCatalog,
	PluginItem,
} from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import {
	ompConfigList,
	ompConfigSet,
	pluginsList,
	pluginSetEnabled,
	skillsList,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { Switch } from "./Switch";
import { OmpConfigSection } from "./OmpConfigSection";
import { projectName } from "./mcpDraft";
import { SectionHeader } from "./ui";

const KIND_LABELS: Record<string, string> = {
	npm: "npm",
	link: "本地链接",
	marketplace: "市场",
	unknown: "未知来源",
};

const EXTENSION_KEYS = ["extensions", "disabledExtensions"] as const;

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
	onNavigateSection,
}: {
	cwd: string | null;
	query?: string;
	onNavigateSection: (id: string) => void;
}) {
	const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
	const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [filter, setFilter] = useState("");

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

	const q = (filter.trim() || query.trim()).toLowerCase();

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

	const reveal = (dir: string) => {
		void revealItemInDir(dir).catch((e) =>
			toast.error(`打开目录失败: ${errMsg(e)}`),
		);
	};

	const busyIcon = <Loader2 className="h-3 w-3 animate-spin text-neutral-500" aria-label="正在保存" />;

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<SectionHeader
					title="插件"
					description="插件和扩展模块能给 AI 增加新命令、工具或行为。开关改动只对之后新开的会话生效。"
				/>
				<div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
					<FolderOpen className="h-3 w-3 shrink-0" />
					{cwd ? (
						<span className="truncate" title={cwd}>
							当前项目：<span className="text-neutral-200">{projectName(cwd)}</span>
							<span className="ml-1 text-neutral-500">（同时显示该项目自己安装的插件）</span>
						</span>
					) : (
						<span className="text-neutral-500">
							未选择项目：只显示全局插件。在侧栏选中一个会话后，可查看该项目的插件。
						</span>
					)}
				</div>
			</div>

			{loadError && (
				<div
					role="alert"
					className="flex items-start gap-1.5 rounded-xl hairline bg-rose-950/20 px-3 py-2 text-[11px] text-rose-300"
				>
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="min-w-0 flex-1 break-all">读取插件失败：{loadError}</span>
					<button
						type="button"
						onClick={() => void reload()}
						className="inline-flex shrink-0 items-center gap-1 text-rose-200 hover:underline"
					>
						<RefreshCw className="h-3 w-3" />
						重试
					</button>
				</div>
			)}

			{/* Installed plugins */}
			<div className="space-y-2" data-field-id="pluginList">
				<div className="flex items-center justify-between">
					<div className="text-xs font-medium text-neutral-200">
						已安装插件
						<span className="ml-1.5 text-[10px] font-normal text-neutral-500">
							{catalog?.plugins.length ?? 0} 个
						</span>
					</div>
					<div className="flex items-center gap-1.5">
						<div className="relative">
							<Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-500" />
							<input
								type="text"
								value={filter}
								onChange={(e) => setFilter(e.target.value)}
								placeholder="搜索插件…"
								aria-label="搜索插件和扩展"
								className="w-32 rounded-lg hairline bg-[var(--well-bg)] py-1 pl-7 pr-2 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
							/>
						</div>
						<button
							type="button"
							onClick={() => void reload()}
							disabled={busy !== null || loading}
							title="重新扫描插件目录"
							aria-label="重新扫描插件目录"
							className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-50"
						>
							<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
						</button>
						{catalog?.roots.map((r) => (
							<button
								key={r.dir}
								type="button"
								onClick={() => reveal(r.dir)}
								title={r.dir}
								className="inline-flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-1 text-[11px] text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95 transition-all"
							>
								<ExternalLink className="h-3 w-3" />
								{r.scope === "project" ? "项目插件目录" : "全局插件目录"}
							</button>
						))}
					</div>
				</div>

				<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card divide-y divide-[var(--border-divider)] overflow-hidden">
					{!catalog && !loadError ? (
						<div className="flex justify-center py-5 text-neutral-500">
							<Loader2 aria-label="加载插件" className="h-4 w-4 animate-spin" />
						</div>
					) : plugins.length === 0 ? (
						<div className="flex items-center gap-2 px-3.5 py-4 text-xs text-neutral-500">
							<Puzzle className="h-3.5 w-3.5" />
							{q
								? `没有匹配「${q}」的插件`
								: "还没有安装插件。可在终端运行 omp plugin install <包名> 安装，装好后点上方刷新按钮。"}
						</div>
					) : (
						plugins.map((p) => (
							<div
								key={`${p.scope}:${p.name}`}
								className="flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
							>
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-center gap-2">
										<span className="truncate text-xs font-semibold text-neutral-100">
											{p.name}
										</span>
										{p.version && (
											<span className="shrink-0 font-mono text-[10px] text-neutral-500">
												v{p.version}
											</span>
										)}
										<span
											title="安装来源"
											className="shrink-0 rounded bg-[var(--well-bg)] px-1 py-0.5 text-[9px] text-neutral-400"
										>
											{pluginSourceLabel(p)}
										</span>
										<span
											title={p.scope === "project" ? "只在当前项目的会话中加载" : "所有项目的会话都会加载"}
											className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${
												p.scope === "project" ? "bg-sky-500/15 text-sky-300" : "bg-[var(--well-bg)] text-neutral-400"
											}`}
										>
											{p.scope === "project" ? "项目" : "全局"}
										</span>
										{!p.hasManifest && (
											<span
												title="插件缺少 omp 清单 (package.json 中的 omp/pi 字段)，运行时不会加载"
												className="shrink-0 rounded bg-amber-500/15 px-1 py-0.2 text-[9px] text-amber-300"
											>
												无清单
											</span>
										)}
										{p.projectDisabled && (
											<span
												title="当前项目的 plugin-overrides.json 禁用了它，需在该文件中解除"
												className="shrink-0 rounded bg-amber-500/15 px-1 py-0.2 text-[9px] text-amber-300"
											>
												项目已禁用
											</span>
										)}
									</div>
									{p.description && (
										<div className="mt-0.5 truncate text-[10px] text-neutral-500">
											{p.description}
										</div>
									)}
									{p.enabledFeatures != null &&
										p.enabledFeatures.length > 0 && (
											<div className="mt-0.5 truncate font-mono text-[10px] text-neutral-600">
												已启用功能：{" "}
												{p.enabledFeatures.join(", ")}
											</div>
										)}
								</div>
								<div className="flex shrink-0 items-center gap-1">
									{p.dir && (
										<button
											type="button"
											onClick={() => reveal(p.dir!)}
											title={`在访达中显示：${p.dir}`}
											aria-label={`在访达中显示 ${p.name}`}
											className="rounded-lg p-1 text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-300 active:scale-95 transition-all"
										>
											<ExternalLink className="h-3 w-3" />
										</button>
									)}
									{busy === `plugin:${p.name}` && busyIcon}
									<span
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
				</div>
			</div>

			{/* Extension modules */}
			<div className="space-y-2" data-field-id="extensionList">
				<div className="px-1 text-xs font-medium text-neutral-200">
					扩展模块
					<span className="ml-1.5 text-[10px] font-normal text-neutral-500">
						{extensions.length} 个 · 放在 extensions 目录中的脚本模块
					</span>
				</div>
				<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card divide-y divide-[var(--border-divider)] overflow-hidden">
					{exts.length === 0 ? (
						<div className="px-3.5 py-4 text-xs text-neutral-500">
							{q ? `没有匹配「${q}」的扩展` : "未发现扩展模块"}
						</div>
					) : (
						exts.map((ext) => (
							<div
								key={ext.path}
								className="flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
							>
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-center gap-2">
										<span className="truncate text-xs font-semibold text-neutral-100">
											{ext.name}
										</span>
										<span
											className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${
												ext.source === "project" ? "bg-sky-500/15 text-sky-300" : "bg-[var(--well-bg)] text-neutral-400"
											}`}
										>
											{ext.source === "project" ? "项目" : "全局"}
										</span>
									</div>
									<div
										className="mt-0.5 truncate font-mono text-[10px] text-neutral-500"
										title={ext.path}
									>
										{ext.path}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<button
										type="button"
										onClick={() => reveal(ext.path)}
										title="在访达中显示"
										className="rounded-lg p-1 text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-300 active:scale-95 transition-all"
									>
										<ExternalLink className="h-3 w-3" />
									</button>
									{busy === `ext:${ext.path}` && busyIcon}
									<Switch
										checked={ext.enabled}
										disabled={busy !== null}
										onChange={() => void toggleExtension(ext)}
									/>
								</div>
							</div>
						))
					)}
				</div>
			</div>

			{/* extensions / disabledExtensions config rows */}
			<div data-field-id="extensionsConfig" className="space-y-2">
				<OmpConfigSection
					activeTab="providers"
					onTabChange={onNavigateSection}
					keysOnly={EXTENSION_KEYS}
					title="扩展配置"
					hint="显式加载的扩展路径与停用列表（omp config）"
					query={query}
				/>
			</div>
		</div>
	);
}
