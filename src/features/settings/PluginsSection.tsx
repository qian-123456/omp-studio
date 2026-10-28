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

import { useT } from "../../stores/language";
import {
	ExternalLink,
	FolderOpen,
	Loader2,
	Puzzle,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
	ExtensionItem,
	PluginCatalog,
	PluginItem,
} from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import {
	extensionDelete,
	pluginsList,
	pluginSetEnabled,
	skillsList,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { updateOmpListSetting } from "../skills/ompListSetting";
import { Switch } from "./Switch";
import { projectName } from "./mcpDraft";
import { OmpSections } from "./OmpSettingsList";
import { SectionJumpBar } from "./SectionJumpBar";
import { EmptyState } from "../../components/EmptyState";
import { Notice } from "../../components/Notice";
import { Button, Chip, IconButton, SectionHeader, SettingsCard } from "./ui";

function pluginSourceLabel(p: PluginItem, t: (k: string) => string): string {
	if (p.kind === "npm") return "npm";
	if (p.kind === "link") return t("settingsCore.plugins.sourceLocal");
	if (p.kind === "marketplace") return t("settingsCore.plugins.sourceMarketplace");
	if (p.kind === "unknown") return t("settingsCore.plugins.sourceUnknown");
	return p.kind;
}




export function PluginsSection({
	cwd,
	query = "",
}: {
	cwd: string | null;
	query?: string;
}) {
	const { t } = useT();
	const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
	const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const loadGeneration = useRef(0);
	const currentCwd = useRef(cwd);
	currentCwd.current = cwd;

	const reload = useCallback(async () => {
		if (currentCwd.current !== cwd) return;
		const generation = ++loadGeneration.current;
		setLoading(true);
		try {
			const [cat, skills] = await Promise.all([
				pluginsList(cwd),
				skillsList(cwd).catch(() => null),
			]);
			if (generation !== loadGeneration.current || currentCwd.current !== cwd) return;
			setCatalog(cat);
			setExtensions(skills?.extensions ?? []);
			setLoadError(null);
		} catch (e) {
			if (generation === loadGeneration.current && currentCwd.current === cwd) setLoadError(errMsg(e));
		} finally {
			if (generation === loadGeneration.current && currentCwd.current === cwd) setLoading(false);
		}
	}, [cwd]);

	useEffect(() => {
		setCatalog(null);
		setExtensions([]);
		setLoadError(null);
		void reload();
		return () => { loadGeneration.current++; };
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
					? t("settingsCore.plugins.pluginDisabledToast", { name: p.name })
					: t("settingsCore.plugins.pluginEnabledToast", { name: p.name }),
			);
			await reload();
		} catch (e) {
			toast.error(t("settingsCore.plugins.pluginUpdateError", { error: errMsg(e) }));
		} finally {
			setBusy(null);
		}
	};

	const toggleExtension = async (ext: ExtensionItem) => {
		if (busy) return;
		setBusy(`ext:${ext.path}`);
		try {
			await updateOmpListSetting("disabledExtensions", (cur) =>
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
					? t("settingsCore.plugins.extensionDisabledToast", { name: ext.name })
					: t("settingsCore.plugins.extensionEnabledToast", { name: ext.name }),
			);
			await reload();
		} catch (e) {
			toast.error(t("settingsCore.plugins.extensionUpdateError", { error: errMsg(e) }));
		} finally {
			setBusy(null);
		}
	};

	const deleteExtension = async (ext: ExtensionItem) => {
		if (busy) return;
		const ok = await confirmDialog(
			t("settingsCore.plugins.deleteExtensionConfirm", { name: ext.name, path: ext.path }),
			{ title: t("settingsCore.plugins.deleteExtensionTitle"), danger: true, okLabel: t("settingsCore.plugins.delete") },
		);
		if (!ok) return;
		setBusy(`ext:${ext.path}`);
		try {
			await extensionDelete(ext.path, cwd);
			toast.success(t("settingsCore.plugins.extensionDeletedToast", { name: ext.name }));
			await reload();
		} catch (e) {
			toast.error(t("settingsCore.plugins.extensionDeleteError", { error: errMsg(e) }));
		} finally {
			setBusy(null);
		}
	};

	const reveal = (dir: string) => {
		void revealItemInDir(dir).catch((e) =>
			toast.error(t("settingsCore.plugins.openDirError", { error: errMsg(e) })),
		);
	};

	const busyIcon = (
		<Loader2 className="h-3 w-3 animate-spin text-[var(--text-dim)]" aria-label={t("settingsCore.plugins.saving")} />
	);

	return (
		<div className="space-y-6">
			<SectionHeader
				title={t("settingsCore.plugins.title")}
				description={t("settingsCore.plugins.description")}
				actions={
					<IconButton
						icon={RefreshCw}
						label={t("settingsCore.plugins.rescan")}
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
						{t("settingsCore.plugins.currentProject")}<span className="font-medium text-[var(--text)]">{projectName(cwd)}</span>
					</span>
				) : (
					<span className="text-[var(--text-dim)]">{t("settingsCore.plugins.noProjectSelected")}</span>
				)}
			</div>

			{loadError && (
				<Notice
					tone="danger"
					action={
						<Button size="sm" icon={RefreshCw} onClick={() => void reload()}>
							{t("settingsCore.plugins.retry")}
						</Button>
					}
				>
					<span className="break-all">{t("settingsCore.plugins.loadError", { error: loadError })}</span>
				</Notice>
			)}

			{/* Installed plugins */}
			<SettingsCard
				title={t("settingsCore.plugins.installedPlugins")}
				jump={t("settingsCore.plugins.installedPlugins")}
				aside={t("settingsCore.plugins.countUnit", { count: catalog?.plugins.length ?? 0 })}
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
									{r.scope === "project" ? t("settingsCore.plugins.projectPluginsDir") : t("settingsCore.plugins.globalPluginsDir")}
								</Button>
							))}
						</span>
					) : undefined
				}
			>
				{!catalog && !loadError ? (
					<div className="flex justify-center py-6 text-[var(--text-dim)]">
						<Loader2 aria-label={t("settingsCore.plugins.loadingPlugins")} className="h-4 w-4 animate-spin" />
					</div>
				) : plugins.length === 0 ? (
					<EmptyState
						icon={Puzzle}
						title={q ? t("settingsCore.plugins.noPluginsMatched", { query: q }) : t("settingsCore.plugins.noPluginsInstalled")}
						description={
							q ? undefined : t("settingsCore.plugins.installHint")
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
									<Chip title={t("settingsCore.plugins.installSource")}>{pluginSourceLabel(p, t)}</Chip>
									<Chip
										tone={p.scope === "project" ? "accent" : "neutral"}
										title={p.scope === "project" ? t("settingsCore.plugins.projectScopeTooltip") : t("settingsCore.plugins.globalScopeTooltip")}
									>
										{p.scope === "project" ? t("settingsCore.plugins.projectScope") : t("settingsCore.plugins.globalScope")}
									</Chip>
									{!p.hasManifest && (
										<Chip tone="warning" title={t("settingsCore.plugins.noManifestTooltip")}>
											{t("settingsCore.plugins.noManifest")}
										</Chip>
									)}
									{p.projectDisabled && (
										<Chip tone="warning" title={t("settingsCore.plugins.projectDisabledTooltip")}>
											{t("settingsCore.plugins.projectDisabled")}
										</Chip>
									)}
								</div>
								{p.description && (
									<div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">{p.description}</div>
								)}
								{p.enabledFeatures != null && p.enabledFeatures.length > 0 && (
									<div className="mt-0.5 truncate font-mono text-xs text-[var(--text-dim)]">
										{t("settingsCore.plugins.enabledFeatures", { features: p.enabledFeatures.join(", ") })}
									</div>
								)}
							</div>
							<div className="flex shrink-0 items-center gap-0.5">
								{p.dir && (
									<IconButton
										icon={ExternalLink}
										label={t("settingsCore.plugins.showInFinder", { name: p.name })}
										title={t("settingsCore.plugins.showInFinderPath", { path: p.dir! })}
										onClick={() => reveal(p.dir!)}
									/>
								)}
								{busy === `plugin:${p.name}` && busyIcon}
								<span
									className="ml-2"
									title={
										p.projectDisabled
											? t("settingsCore.plugins.disabledByOverride")
											: p.enabled
												? t("settingsCore.plugins.clickToDisable")
												: t("settingsCore.plugins.clickToEnable")
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
				title={t("settingsCore.plugins.extensions")}
				jump={t("settingsCore.plugins.extensions")}
				aside={t("settingsCore.plugins.countUnit", { count: extensions.length })}
				description={t("settingsCore.plugins.extensionsDesc")}
				fieldId="extensionList"
				clip
			>
				{exts.length === 0 ? (
					<EmptyState title={q ? t("settingsCore.plugins.noExtensionsMatched", { query: q }) : t("settingsCore.plugins.noExtensionsFound")} />
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
										{ext.source === "project" ? t("settingsCore.plugins.projectScope") : t("settingsCore.plugins.globalScope")}
									</Chip>
								</div>
								<div className="mt-0.5 truncate font-mono text-xs text-[var(--text-dim)]" title={ext.path}>
									{ext.path}
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-0.5">
								<IconButton
									icon={ExternalLink}
									label={t("settingsCore.plugins.showInFinder", { name: ext.name })}
									title={t("settingsCore.plugins.showInFinderGeneric")}
									onClick={() => reveal(ext.path)}
								/>
								<IconButton
									icon={Trash2}
									variant="danger"
									label={t("settingsCore.plugins.deleteExtensionLabel", { name: ext.name })}
									title={t("settingsCore.plugins.deleteExtensionTooltip")}
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
