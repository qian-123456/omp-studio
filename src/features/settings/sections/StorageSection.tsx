/** Settings ▸ 存储空间 (`storage`): app disk usage, safe cleanups, and omp session cleanup (to the Trash). */
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronRight, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../../stores/language";
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
import { Notice } from "../../../components/Notice";
import { SectionJumpBar } from "../SectionJumpBar";
import { Button, Chip, SectionHeader, SettingRow, SettingsCard } from "../ui";

function drafts(): string[] {
	return collectDraftTexts(useComposer.getState(), window.localStorage);
}
function formatSkipReason(reason: string, t: (k: string) => string): string {
	if (reason === "正在运行") return t("settingsSectionsStorage.storage.skipRunning");
	if (reason === "已置顶") return t("settingsSectionsStorage.storage.skipPinned");
	if (reason === "终端运行中" || reason.includes("终端")) return t("settingsSectionsStorage.storage.skipTerminal");
	return reason;
}

export function StorageSection() {
	const { t } = useT();
	const [overview, setOverview] = useState<StorageOverview | null>(null);
	const [sessions, setSessions] = useState<StorageSessionsOverview | null>(null);
	const [cleanable, setCleanable] = useState<{ count: number; bytes: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [days, setDays] = useState(String(DEFAULT_STALE_DAYS));
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

	const refresh = useCallback(async () => {
		try {
			const [o, s, c] = await Promise.all([storageOverview(), storageSessionsOverview(), storageImagesPreview(drafts())]);
			setOverview(o);
			setSessions(s);
			setCleanable(c);
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
				toast.info(t("settingsSectionsStorage.storage.cleanImagesNoOp"));
				return;
			}
			const ok = await confirmDialog(
				t("settingsSectionsStorage.storage.cleanImagesConfirm", { count: preview.count, bytes: formatBytes(preview.bytes) }),
				{ danger: true, okLabel: t("settingsSectionsStorage.storage.cleanImagesOk"), title: t("settingsSectionsStorage.storage.cleanImagesTitle") },
			);
			if (!ok) return;
			const done = await storageImagesClean(drafts());
			toast.success(t("settingsSectionsStorage.storage.cleanImagesDone", { count: done.count, bytes: formatBytes(done.bytes) }));
			await refresh();
		});

	const clearWebCache = () =>
		run("web", async () => {
			const freed = await storageClearWebCache();
			toast.success(t("settingsSectionsStorage.storage.clearWebCacheDone", { bytes: formatBytes(freed) }));
			await refresh();
		});

	const cleanStatus = () =>
		run("status", async () => {
			const done = await storageCleanStatusRecords();
			toast.success(t("settingsSectionsStorage.storage.cleanStatusDone", { count: done.count, bytes: formatBytes(done.bytes) }));
			await refresh();
		});

	const compactDb = () =>
		run("db", async () => {
			const r = await storageCompactDb();
			toast.success(t("settingsSectionsStorage.storage.compactDbDone", { before: formatBytes(r.beforeBytes), after: formatBytes(r.afterBytes) }));
			await refresh();
		});

	const trash = async (ids: string[], bytes: number, what: string) => {
		const ok = await confirmDialog(
			t("settingsSectionsStorage.storage.trashSessionsConfirm", { what, count: ids.length, bytes: formatBytes(bytes) }),
			{ danger: true, okLabel: t("settingsSectionsStorage.storage.trashOk"), title: t("settingsSectionsStorage.storage.deleteSessionsTitle") },
		);
		if (!ok) return;
		const report = await storageTrashSessions(ids);
		const skipped = report.skipped.length > 0 ? t("settingsSectionsStorage.storage.skippedCount", { count: report.skipped.length }) : "";
		toast.success(t("settingsSectionsStorage.storage.trashSessionsDone", { count: report.trashed, bytes: formatBytes(report.freedBytes), skipped }));
		setSelected(new Set());
		await refresh();
	};

	const deleteSelected = () =>
		run("sessions", async () => {
			if (!sessions) return;
			const ids = [...selected];
			const bytes = sessions.projects.reduce((n, p) => n + selectedBytes(p, selected), 0);
			await trash(ids, bytes, t("settingsSectionsStorage.storage.selectedSessions"));
		});

	const deleteStale = () =>
		run("stale", async () => {
			const n = parseStaleDays(days);
			const preview = await storageStaleSessionsPreview(n);
			if (preview.count === 0) {
				toast.info(t("settingsSectionsStorage.storage.staleDaysNoOp", { days: n }));
				return;
			}
			await trash(preview.ids, preview.bytes, t("settingsSectionsStorage.storage.staleSessionsWhat", { days: n }));
		});

	const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
		const next = new Set(set);
		if (!next.delete(id)) next.add(id);
		return next;
	};

	const reveal = (path: string) =>
		void revealItemInDir(path).catch((e) => toast.error(t("settingsSectionsStorage.storage.revealError", { error: describeStorageError(e) })));

	const selectedTotal = sessions ? sessions.projects.reduce((n, p) => n + selectedBytes(p, selected), 0) : 0;

	return (
		<div className="space-y-6">
			<SectionHeader
				title={t("settingsSectionsStorage.storage.title")}
				description={t("settingsSectionsStorage.storage.description")}
				actions={
					<Button icon={RefreshCw} onClick={() => void refresh()} disabled={busy !== null}>
						{t("settingsSectionsStorage.storage.refresh")}
					</Button>
				}
			/>
			{error && (
				<Notice tone="danger" title={t("settingsSectionsStorage.storage.readUsageError")}>
					{error}
				</Notice>
			)}

			<SectionJumpBar />
			<SettingsCard jump={t("settingsSectionsStorage.storage.jumpImages")} title={t("settingsSectionsStorage.storage.titleImages")} description={t("settingsSectionsStorage.storage.descImages")}>
				<SettingRow
					label={t("settingsSectionsStorage.storage.unusedImagesLabel")}
					description={t("settingsSectionsStorage.storage.unusedImagesDesc")}
					hint={
						overview && cleanable
							? t(cleanable.count > 0 ? "settingsSectionsStorage.storage.imagesHintCleanable" : "settingsSectionsStorage.storage.imagesHintNone", {
									count: overview.images.count,
									bytes: formatBytes(overview.images.bytes),
									cleanCount: cleanable.count,
									cleanBytes: formatBytes(cleanable.bytes),
								})
							: t("settingsSectionsStorage.storage.loading")
					}
					control={
						<Button
							icon={Trash2}
							loading={busy === "images"}
							disabled={busy !== null || !overview || !cleanable || cleanable.count === 0}
							onClick={() => void cleanImages()}
						>
							{t("settingsSectionsStorage.storage.cleanImagesBtn")}
						</Button>
					}
				/>
			</SettingsCard>

			<SettingsCard jump={t("settingsSectionsStorage.storage.jumpCacheAndLogs")} title={t("settingsSectionsStorage.storage.titleCacheAndLogs")}>
				<SettingRow
					label={t("settingsSectionsStorage.storage.webCacheLabel")}
					description={t("settingsSectionsStorage.storage.webCacheDesc")}
					hint={overview ? t("settingsSectionsStorage.storage.usedBytesHint", { bytes: formatBytes(overview.webCacheBytes) }) : t("settingsSectionsStorage.storage.loading")}
					control={
						<Button
							loading={busy === "web"}
							disabled={busy !== null || !overview || overview.webCacheBytes === 0}
							onClick={() => void clearWebCache()}
						>
							{t("settingsSectionsStorage.storage.clearCacheBtn")}
						</Button>
					}
				/>
				<SettingRow
					label={t("settingsSectionsStorage.storage.expiredStatusLabel")}
					description={t("settingsSectionsStorage.storage.expiredStatusDesc")}
					hint={
						overview
							? t("settingsSectionsStorage.storage.expiredStatusHint", { count: overview.status.count, expiredCount: overview.status.expiredCount, bytes: formatBytes(overview.status.expiredBytes) })
							: t("settingsSectionsStorage.storage.loading")
					}
					control={
						<Button
							loading={busy === "status"}
							disabled={busy !== null || !overview || overview.status.expiredCount === 0}
							onClick={() => void cleanStatus()}
						>
							{t("settingsSectionsStorage.storage.cleanStatusBtn")}
						</Button>
					}
				/>
				<SettingRow
					label={t("settingsSectionsStorage.storage.appDbLabel")}
					description={t("settingsSectionsStorage.storage.appDbDesc")}
					hint={overview ? t("settingsSectionsStorage.storage.usedBytesHint", { bytes: formatBytes(overview.dbBytes) }) : t("settingsSectionsStorage.storage.loading")}
					control={
						<Button loading={busy === "db"} disabled={busy !== null || !overview} onClick={() => void compactDb()}>
							{t("settingsSectionsStorage.storage.compactDbBtn")}
						</Button>
					}
				/>
			</SettingsCard>

			<SettingsCard
				jump={t("settingsSectionsStorage.storage.jumpOmpSessions")}
				title={t("settingsSectionsStorage.storage.titleOmpSessions")}
				description={t("settingsSectionsStorage.storage.descOmpSessions")}
				aside={sessions ? t("settingsSectionsStorage.storage.totalSessionsAside", { bytes: formatBytes(sessions.totalBytes), count: sessions.sessionCount }) : undefined}
			>
				<SettingRow
					label={t("settingsSectionsStorage.storage.deleteStaleLabel")}
					description={t("settingsSectionsStorage.storage.deleteStaleDesc")}
					control={
						<div className="flex items-center gap-2">
							<span className="text-xs text-[var(--text-muted)]">{t("settingsSectionsStorage.storage.daysOver")}</span>
							<input
								aria-label={t("settingsSectionsStorage.storage.daysAria")}
								inputMode="numeric"
								className="w-16 rounded-md hairline bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text)]"
								value={days}
								onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
							/>
							<span className="text-xs text-[var(--text-muted)]">{t("settingsSectionsStorage.storage.daysUnupdated")}</span>
							<Button
								icon={Trash2}
								variant="danger"
								loading={busy === "stale"}
								disabled={busy !== null || !sessions}
								onClick={() => void deleteStale()}
							>
								{t("settingsSectionsStorage.storage.deleteStaleBtn")}
							</Button>
						</div>
					}
				/>
				<SettingRow
					label={t("settingsSectionsStorage.storage.sessionFolderLabel")}
					description={sessions?.root}
					control={
						<Button icon={FolderOpen} disabled={!sessions} onClick={() => sessions && reveal(sessions.root)}>
							{t("settingsSectionsStorage.storage.revealInFinder")}
						</Button>
					}
				/>
			</SettingsCard>

			{sessions && (
				<SettingsCard
					jump={t("settingsSectionsStorage.storage.jumpByProject")}
					title={t("settingsSectionsStorage.storage.titleByProject")}
					description={t("settingsSectionsStorage.storage.descByProject")}
					footer={
						selected.size > 0 ? (
							<span className="flex items-center gap-3">
								<span>
									{t("settingsSectionsStorage.storage.selectedCount", { count: selected.size, bytes: formatBytes(selectedTotal) })}
								</span>
								<Button
									size="sm"
									variant="danger"
									icon={Trash2}
									loading={busy === "sessions"}
									disabled={busy !== null}
									onClick={() => void deleteSelected()}
								>
									{t("settingsSectionsStorage.storage.moveToTrashBtn")}
								</Button>
							</span>
						) : undefined
					}
				>
					{sessions.projects.length === 0 && <div className="px-4 py-3 text-xs text-[var(--text-muted)]">{t("settingsSectionsStorage.storage.noSessions")}</div>}
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
	const { t } = useT();
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
				<Chip>{t("settingsSectionsStorage.storage.projectSessionsCount", { count: project.sessions.length })}</Chip>
				<span className="w-20 shrink-0 text-right text-xs tabular-nums text-[var(--text-muted)]">
					{formatBytes(project.bytes)}
				</span>
				<Button size="sm" icon={FolderOpen} onClick={onReveal}>
					{t("settingsSectionsStorage.storage.revealInFinder")}
				</Button>
			</div>
			{expanded && (
				<div className="border-t border-[var(--border-divider)] bg-[var(--bg-hover)]/30">
					{selectable.length > 0 && (
						<label className="flex items-center gap-2 px-4 py-1.5 text-xs text-[var(--text-muted)]">
							<input type="checkbox" checked={allSelected} onChange={(e) => onSelectAll(e.target.checked)} />
							{t("settingsSectionsStorage.storage.selectAllDeletable")}
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
							{s.skipReason && <Chip tone="warning">{formatSkipReason(s.skipReason, t)}</Chip>}
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
