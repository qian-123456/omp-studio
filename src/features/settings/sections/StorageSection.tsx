/** Settings ▸ 存储空间 (`storage`): app disk usage, safe cleanups, and omp session cleanup (to the Trash). */
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronRight, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { StorageOverview, StorageProjectRow, StorageSessionsOverview } from "../../../lib/contracts";
import { confirmDialog } from "../../../lib/dialogs";
import { formatBytes, relativeTime } from "../../../lib/format";
import {
	storageCleanStatusRecords,
	storageClearWebCache,
	storageCompactDb,
	storageImagesClean,
	storageImagesPreview,
	storageOverview,
	storageSessionsOverview,
	storageStaleSessionsPreview,
	storageTrashSessions,
} from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { useComposer } from "../../../stores/composer";
import {
	collectDraftTexts,
	DEFAULT_STALE_DAYS,
	describeStorageError,
	parseStaleDays,
	selectableSessions,
	selectedBytes,
} from "../storageLogic";
import { Button, Chip, Notice, SectionHeader, SettingRow, SettingsCard } from "../ui";

function drafts(): string[] {
	return collectDraftTexts(useComposer.getState(), window.localStorage);
}

export function StorageSection() {
	const [overview, setOverview] = useState<StorageOverview | null>(null);
	const [sessions, setSessions] = useState<StorageSessionsOverview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [days, setDays] = useState(String(DEFAULT_STALE_DAYS));
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

	const refresh = useCallback(async () => {
		try {
			const [o, s] = await Promise.all([storageOverview(), storageSessionsOverview()]);
			setOverview(o);
			setSessions(s);
			setError(null);
			// Drop selections that no longer exist.
			const ids = new Set(s.projects.flatMap((p) => p.sessions.map((x) => x.id)));
			setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
		} catch (e) {
			setError(describeStorageError(e));
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	/** Run one action with a busy flag and a unified error toast. */
	const run = async (key: string, fn: () => Promise<void>) => {
		setBusy(key);
		try {
			await fn();
		} catch (e) {
			toast.error(describeStorageError(e));
		} finally {
			setBusy(null);
		}
	};

	const cleanImages = () =>
		run("images", async () => {
			const preview = await storageImagesPreview(drafts());
			if (preview.count === 0) {
				toast.info("没有可清理的图片（只清理超过 30 天且没被任何地方引用的图片）");
				return;
			}
			const ok = await confirmDialog(
				`将删除 ${preview.count} 张图片，释放 ${formatBytes(preview.bytes)}。\n只包含超过 30 天、且没被想法、定时任务、草稿或任何会话引用的图片，删除后无法恢复。`,
				{ danger: true, okLabel: "清理", title: "清理没用到的图片" },
			);
			if (!ok) return;
			const done = await storageImagesClean(drafts());
			toast.success(`已清理 ${done.count} 张图片，释放 ${formatBytes(done.bytes)}`);
			await refresh();
		});

	const clearWebCache = () =>
		run("web", async () => {
			const freed = await storageClearWebCache();
			toast.success(`已清空缓存，释放 ${formatBytes(freed)}`);
			await refresh();
		});

	const cleanStatus = () =>
		run("status", async () => {
			const done = await storageCleanStatusRecords();
			toast.success(`已清理 ${done.count} 条过期记录，释放 ${formatBytes(done.bytes)}`);
			await refresh();
		});

	const compactDb = () =>
		run("db", async () => {
			const r = await storageCompactDb();
			toast.success(`数据库已压缩：${formatBytes(r.beforeBytes)} → ${formatBytes(r.afterBytes)}`);
			await refresh();
		});

	const trash = async (ids: string[], bytes: number, what: string) => {
		const ok = await confirmDialog(
			`将 ${what}（${ids.length} 个会话，约 ${formatBytes(bytes)}）移到废纸篓。\n正在运行、已置顶或被终端占用的会话会自动跳过；可在废纸篓中恢复文件，但会话不会再出现在列表里。`,
			{ danger: true, okLabel: "移到废纸篓", title: "删除会话" },
		);
		if (!ok) return;
		const report = await storageTrashSessions(ids);
		const skipped = report.skipped.length > 0 ? `，跳过 ${report.skipped.length} 个` : "";
		toast.success(`已移到废纸篓 ${report.trashed} 个会话，释放 ${formatBytes(report.freedBytes)}${skipped}`);
		setSelected(new Set());
		await refresh();
	};

	const deleteSelected = () =>
		run("sessions", async () => {
			if (!sessions) return;
			const ids = [...selected];
			const bytes = sessions.projects.reduce((n, p) => n + selectedBytes(p, selected), 0);
			await trash(ids, bytes, "选中的会话");
		});

	const deleteStale = () =>
		run("stale", async () => {
			const n = parseStaleDays(days);
			const preview = await storageStaleSessionsPreview(n);
			if (preview.count === 0) {
				toast.info(`没有超过 ${n} 天没更新的可删除会话`);
				return;
			}
			await trash(preview.ids, preview.bytes, `超过 ${n} 天没更新的会话`);
		});

	const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
		const next = new Set(set);
		if (!next.delete(id)) next.add(id);
		return next;
	};

	const reveal = (path: string) =>
		void revealItemInDir(path).catch((e) => toast.error(`无法在访达中显示：${describeStorageError(e)}`));

	const selectedTotal = sessions ? sessions.projects.reduce((n, p) => n + selectedBytes(p, selected), 0) : 0;

	return (
		<div className="space-y-6">
			<SectionHeader
				title="存储空间"
				description="本应用和 omp 占用了多少磁盘，以及哪些内容可以安全清理"
				actions={
					<Button icon={RefreshCw} onClick={() => void refresh()} disabled={busy !== null}>
						刷新
					</Button>
				}
			/>
			{error && (
				<Notice tone="danger" title="无法读取存储用量">
					{error}
				</Notice>
			)}

			<SettingsCard title="图片" description="粘贴、拖入的图片与旧版剪贴板缓存">
				<SettingRow
					label="没用到的图片"
					description="只清理超过 30 天、且没被想法、定时任务、未发送草稿或任何会话引用的图片。每天启动后会在后台自动清理一次。"
					hint={overview ? `当前共 ${overview.images.count} 张，占用 ${formatBytes(overview.images.bytes)}` : "读取中"}
					control={
						<Button
							icon={Trash2}
							loading={busy === "images"}
							disabled={busy !== null || !overview}
							onClick={() => void cleanImages()}
						>
							清理没用到的图片
						</Button>
					}
				/>
			</SettingsCard>

			<SettingsCard title="缓存与记录">
				<SettingRow
					label="网页缓存"
					description="界面加载产生的临时网络缓存，清空后会自动重新生成。不会影响设置、草稿和登录状态。"
					hint={overview ? `占用 ${formatBytes(overview.webCacheBytes)}` : "读取中"}
					control={
						<Button
							loading={busy === "web"}
							disabled={busy !== null || !overview || overview.webCacheBytes === 0}
							onClick={() => void clearWebCache()}
						>
							清空缓存
						</Button>
					}
				/>
				<SettingRow
					label="过期的运行记录"
					description="已经结束的 omp 进程留下的状态文件（超过一天且进程已退出）。"
					hint={
						overview
							? `共 ${overview.status.count} 条，其中 ${overview.status.expiredCount} 条已过期（${formatBytes(overview.status.expiredBytes)}）`
							: "读取中"
					}
					control={
						<Button
							loading={busy === "status"}
							disabled={busy !== null || !overview || overview.status.expiredCount === 0}
							onClick={() => void cleanStatus()}
						>
							清理过期记录
						</Button>
					}
				/>
				<SettingRow
					label="应用数据库"
					description="整理数据库文件、回收已删除内容留下的空位，数据不会丢失。"
					hint={overview ? `占用 ${formatBytes(overview.dbBytes)}` : "读取中"}
					control={
						<Button loading={busy === "db"} disabled={busy !== null || !overview} onClick={() => void compactDb()}>
							压缩数据库
						</Button>
					}
				/>
			</SettingsCard>

			<SettingsCard
				title="omp 会话"
				description="会话记录和工具输出。从这里删除会移到废纸篓，可以恢复文件。"
				aside={sessions ? `共 ${formatBytes(sessions.totalBytes)} · ${sessions.sessionCount} 个会话` : undefined}
			>
				<SettingRow
					label="删除久未更新的会话"
					description="正在运行、已置顶、被终端里的 omp 占用的会话不会被删除。"
					control={
						<div className="flex items-center gap-2">
							<span className="text-xs text-[var(--text-muted)]">超过</span>
							<input
								aria-label="天数"
								inputMode="numeric"
								className="w-16 rounded-md hairline bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text)]"
								value={days}
								onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
							/>
							<span className="text-xs text-[var(--text-muted)]">天没更新</span>
							<Button
								icon={Trash2}
								variant="danger"
								loading={busy === "stale"}
								disabled={busy !== null || !sessions}
								onClick={() => void deleteStale()}
							>
								删除这些会话
							</Button>
						</div>
					}
				/>
				<SettingRow
					label="会话文件夹"
					description={sessions?.root}
					control={
						<Button icon={FolderOpen} disabled={!sessions} onClick={() => sessions && reveal(sessions.root)}>
							在访达中显示
						</Button>
					}
				/>
			</SettingsCard>

			{sessions && (
				<SettingsCard
					title="按项目查看"
					description="展开项目，勾选会话后移到废纸篓。"
					footer={
						selected.size > 0 ? (
							<span className="flex items-center gap-3">
								<span>
									已选 {selected.size} 个，约 {formatBytes(selectedTotal)}
								</span>
								<Button
									size="sm"
									variant="danger"
									icon={Trash2}
									loading={busy === "sessions"}
									disabled={busy !== null}
									onClick={() => void deleteSelected()}
								>
									移到废纸篓
								</Button>
							</span>
						) : undefined
					}
				>
					{sessions.projects.length === 0 && <div className="px-4 py-3 text-xs text-[var(--text-muted)]">没有会话</div>}
					{sessions.projects.map((p) => (
						<ProjectBlock
							key={p.dir}
							project={p}
							expanded={open.has(p.dir)}
							selected={selected}
							onToggleOpen={() => setOpen((s) => toggle(s, p.dir))}
							onToggleSession={(id) => setSelected((s) => toggle(s, id))}
							onSelectAll={(all) =>
								setSelected((s) => {
									const next = new Set(s);
									for (const row of selectableSessions(p)) {
										if (all) next.add(row.id);
										else next.delete(row.id);
									}
									return next;
								})
							}
							onReveal={() => reveal(p.dir)}
						/>
					))}
				</SettingsCard>
			)}
		</div>
	);
}

function ProjectBlock({
	project,
	expanded,
	selected,
	onToggleOpen,
	onToggleSession,
	onSelectAll,
	onReveal,
}: {
	project: StorageProjectRow;
	expanded: boolean;
	selected: ReadonlySet<string>;
	onToggleOpen: () => void;
	onToggleSession: (id: string) => void;
	onSelectAll: (all: boolean) => void;
	onReveal: () => void;
}) {
	const selectable = selectableSessions(project);
	const allSelected = selectable.length > 0 && selectable.every((s) => selected.has(s.id));
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const label = project.cwd ?? project.name;
	return (
		<div>
			<div className="flex items-center gap-2 px-4 py-2.5">
				<button
					type="button"
					onClick={onToggleOpen}
					aria-expanded={expanded}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					<Chevron className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
					<span className="min-w-0 break-all text-[13px] text-[var(--text)]" title={project.dir}>
						{label}
					</span>
				</button>
				<Chip>{project.sessions.length} 个会话</Chip>
				<span className="w-20 shrink-0 text-right text-xs tabular-nums text-[var(--text-muted)]">
					{formatBytes(project.bytes)}
				</span>
				<Button size="sm" icon={FolderOpen} onClick={onReveal}>
					在访达中显示
				</Button>
			</div>
			{expanded && (
				<div className="border-t border-[var(--border-divider)] bg-[var(--bg-hover)]/30">
					{selectable.length > 0 && (
						<label className="flex items-center gap-2 px-4 py-1.5 text-xs text-[var(--text-muted)]">
							<input type="checkbox" checked={allSelected} onChange={(e) => onSelectAll(e.target.checked)} />
							全选可删除的会话
						</label>
					)}
					{project.sessions.map((s) => (
						<label key={s.id} className="flex items-center gap-2 px-4 py-1.5">
							<input
								type="checkbox"
								disabled={s.skipReason !== null}
								checked={selected.has(s.id)}
								onChange={() => onToggleSession(s.id)}
							/>
							<span className="min-w-0 flex-1 break-all text-xs text-[var(--text)]" title={s.title}>
								{s.title}
							</span>
							{s.skipReason && <Chip tone="warning">{s.skipReason}</Chip>}
							<span className="w-24 shrink-0 text-right text-[11px] text-[var(--text-dim)]">
								{s.updatedAt ? relativeTime(s.updatedAt) : ""}
							</span>
							<span className="w-20 shrink-0 text-right text-xs tabular-nums text-[var(--text-muted)]">
								{formatBytes(s.bytes)}
							</span>
						</label>
					))}
				</div>
			)}
		</div>
	);
}
