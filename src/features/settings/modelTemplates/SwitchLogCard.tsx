/**
 * [D] Settings ▸ 模板与自动切换: recent switch history.
 *
 * Newest first. Each row shows the outcome chip, when, the template and the
 * reason; expanding it reveals the full reason, every role edit and the
 * per-session result. An applied/partial entry that has not been undone keeps
 * an 「撤销」 button that restores the previous role values.
 */
import { ChevronDown, History, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../../../components/Modal";
import type {
	ModelSwitchLogEntry,
	SessionSwitchResult,
	TemplateRoleEdit,
	TemplateStoreSnapshot,
} from "../../../lib/contracts";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { absoluteTime, timeAgo } from "../../../lib/format";
import { modelSwitchUndo } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { Notice } from "../../../components/Notice";
import { Button, Chip, IconButton, SettingsCard, type ChipTone } from "../ui";
import { inScope, statusLabel, statusTone } from "./logic";
import { useModelTemplatesStore } from "./store";
import { useT } from "../../../stores/language";

const TONE_CHIP: Record<"ok" | "warn" | "error" | "muted", ChipTone> = {
	ok: "success",
	warn: "warning",
	error: "danger",
	muted: "neutral",
};

/** Statuses whose edits are still in effect and can therefore be undone. */
const UNDOABLE: Record<string, true> = { applied: true, partial: true };

function EditList({ edits }: { edits: TemplateRoleEdit[] }) {
	const { t } = useT();
	if (edits.length === 0) return <div className="text-[11px] text-[var(--text-dim)]">{t("modelTemplates.noRoleEdits")}</div>;
	return (
		<ul className="space-y-1">
			{edits.map((edit) => (
				<li key={edit.role} className="text-[11px] leading-[18px]">
					<span className="break-all font-mono font-semibold text-[var(--text)]">{edit.role}</span>
					<span className="text-[var(--text-dim)]">{t("modelTemplates.colon")}</span>
					<span className="break-all text-[var(--text-muted)]">{edit.before ?? t("modelTemplates.unconfigured")}</span>
					<span className="text-[var(--text-dim)]"> → </span>
					<span className="break-all text-[var(--text)]">{edit.after ?? t("modelTemplates.unconfigured")}</span>
				</li>
			))}
		</ul>
	);
}

function SessionList({ results }: { results: SessionSwitchResult[] }) {
	const { t } = useT();
	if (results.length === 0) return <div className="text-[11px] text-[var(--text-dim)]">{t("modelTemplates.noRunningSessions")}</div>;
	return (
		<ul className="space-y-1">
			{results.map((result) => (
				<li key={result.sessionId} className="text-[11px] leading-[18px]">
					<Chip tone={result.ok ? "success" : "warning"}>{result.ok ? t("modelTemplates.switched") : t("modelTemplates.notSwitched")}</Chip>{" "}
					<span className="break-all font-medium text-[var(--text)]">{result.title || result.sessionId}</span>
					{result.reason && <span className="break-words text-[var(--text-muted)]"> · {result.reason}</span>}
				</li>
			))}
		</ul>
	);
}

function LogRow({
	entry,
	busy,
	onUndo,
}: {
	entry: ModelSwitchLogEntry;
	busy: boolean;
	onUndo: () => void;
}) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const undoable = UNDOABLE[entry.status] === true && entry.undoneAt === null;
	const createdAgo = timeAgo(entry.createdAt);
	const undoneAgo = entry.undoneAt ? timeAgo(entry.undoneAt) : "";

	return (
		<div>
			<div className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-1.5">
						<Chip tone={TONE_CHIP[statusTone(entry.status)]}>{statusLabel(entry.status)}</Chip>
						<span className="break-words text-[13px] font-medium text-[var(--text)]">{entry.templateName}</span>
						{entry.ruleName && <Chip tone="neutral">{t("modelTemplates.ruleBadge", { rule: entry.ruleName })}</Chip>}
						<span className="text-[11px] text-[var(--text-dim)]" title={absoluteTime(entry.createdAt)}>
							{createdAgo}
						</span>
					</div>
					{entry.reason && (
						<div className="mt-0.5 break-words text-[11px] leading-4 text-[var(--text-muted)]">
							{entry.reason}
						</div>
					)}
					{entry.undoneAt && (
						<div className="mt-0.5 text-[11px] leading-4 text-[var(--text-dim)]">
							{t("modelTemplates.undoneAgo", { time: undoneAgo })}
						</div>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{undoable && (
						<Button size="sm" icon={RotateCcw} loading={busy} onClick={onUndo}>
							{t("modelTemplates.undo")}
						</Button>
					)}
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen((v) => !v)}
						className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
					>
						{open ? t("modelTemplates.collapseDetails") : t("modelTemplates.expandDetails")}
						<ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
					</button>
				</div>
			</div>
			{open && (
				<div className="space-y-2 border-t border-[var(--border-divider)] bg-[var(--well-bg)] px-4 py-2.5">
					<div>
						<div className="text-[11px] font-semibold text-[var(--text)]">{t("modelTemplates.reasonLabel")}</div>
						<div className="select-text whitespace-pre-wrap break-words text-[11px] leading-[18px] text-[var(--text-muted)]">
							{entry.reason || t("common.none")}
						</div>
					</div>
					<div>
						<div className="text-[11px] font-semibold text-[var(--text)]">
							{t("modelTemplates.roleEditsCount", { count: String(entry.edits.length) })}
						</div>
						<EditList edits={entry.edits} />
					</div>
					<div>
						<div className="text-[11px] font-semibold text-[var(--text)]">{t("modelTemplates.sessionSwitch")}</div>
						<SessionList results={entry.sessionResults} />
					</div>
				</div>
			)}
		</div>
	);
}

const INLINE_LIMIT = 3;

function CompactRow({
	entry,
	busy,
	onUndo,
}: {
	entry: ModelSwitchLogEntry;
	busy: boolean;
	onUndo: () => void;
}) {
	const { t } = useT();
	const undoable = UNDOABLE[entry.status] === true && entry.undoneAt === null;
	const createdAgo = timeAgo(entry.createdAt);
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
				<span className="text-[11px] text-[var(--text-dim)]" title={absoluteTime(entry.createdAt)}>
					{createdAgo}
				</span>
				<span className="break-words text-[13px] font-medium text-[var(--text)]">{entry.templateName}</span>
				<Chip tone="neutral">{entry.ruleName ? t("modelTemplates.ruleBadge", { rule: entry.ruleName }) : t("modelTemplates.manualBadge")}</Chip>
				<Chip tone={TONE_CHIP[statusTone(entry.status)]}>{statusLabel(entry.status)}</Chip>
				{entry.undoneAt && <span className="text-[11px] text-[var(--text-dim)]">{t("modelTemplates.undoneBadge")}</span>}
			</div>
			{undoable && (
				<Button size="sm" icon={RotateCcw} loading={busy} onClick={onUndo}>
					{t("modelTemplates.undo")}
				</Button>
			)}
		</div>
	);
}

function LogModal({
	entries,
	busyId,
	error,
	onUndo,
	onClose,
}: {
	entries: ModelSwitchLogEntry[];
	busyId: string | null;
	error: string | null;
	onUndo: (entry: ModelSwitchLogEntry) => void;
	onClose: () => void;
}) {
	const { t } = useT();
	return (
		<Modal
			onClose={onClose}
			size="none"
			ariaLabel={t("modelTemplates.allSwitchLogsAria")}
			className="h-[min(80vh,680px)] w-[720px] max-w-[calc(100vw-2rem)] overflow-hidden p-4 text-[var(--text)]"
		>
			<div
				className="flex min-h-0 flex-1 flex-col"
				onKeyDown={(e) => {
					// Escape must reach Modal's window listener; other keys stay inside the dialog.
					if (e.key !== "Escape") e.stopPropagation();
				}}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-divider)] pb-3">
					<div className="min-w-0">
						<h2 id="switch-log-modal-title" className="text-sm font-semibold text-[var(--text)]">
							{t("modelTemplates.allSwitchLogsTitle")}
						</h2>
						<p className="mt-0.5 text-[11px] leading-5 text-[var(--text-muted)]">
							{t("modelTemplates.allSwitchLogsDesc", { count: String(entries.length) })}
						</p>
					</div>
					<IconButton icon={X} label={t("common.close")} onClick={onClose} />
				</div>
				{error && (
					<div className="shrink-0 pt-3">
						<Notice tone="danger" title={t("modelTemplates.undoFailed")}>
							<span className="select-text break-all">{error}</span>
						</Notice>
					</div>
				)}
				<div className="mt-3 min-h-0 flex-1 divide-y divide-[var(--border-divider)] overflow-y-auto rounded-xl hairline">
					{entries.map((entry) => (
						<LogRow key={entry.id} entry={entry} busy={busyId === entry.id} onUndo={() => onUndo(entry)} />
					))}
				</div>
			</div>
		</Modal>
	);
}

export function SwitchLogCard({
	snapshot,
	scope,
}: {
	snapshot: TemplateStoreSnapshot | null;
	/** Page scope: `"global"` or a project path. */
	scope: string;
}) {
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showAll, setShowAll] = useState(false);
	const entries = useMemo(() => inScope(snapshot?.log ?? [], scope), [snapshot, scope]);
	const { t } = useT();

	const undo = async (entry: ModelSwitchLogEntry) => {
		const ok = await confirmDialog(
			t("modelTemplates.undoConfirm", { template: entry.templateName }),
			{ title: t("modelTemplates.undoTitle"), okLabel: t("modelTemplates.undo") },
		);
		if (!ok) return;
		setBusyId(entry.id);
		setError(null);
		try {
			const result = await modelSwitchUndo(entry.id);
			toast.success(result.reason || t("modelTemplates.undoneSuccess"));
			await useModelTemplatesStore.getState().refresh();
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setBusyId(null);
		}
	};

	if (entries.length === 0) return null;

	return (
		<>
			<SettingsCard
				title={t("modelTemplates.recentSwitchesTitle")}
				jump={t("modelTemplates.recentSwitchesTitle")}
				description={t("modelTemplates.recentSwitchesDesc")}
				aside={t("modelTemplates.rulesCount", { count: String(entries.length) })}
				clip
			>
				{error && !showAll && (
					<div className="px-4 py-3">
						<Notice tone="danger" title={t("modelTemplates.undoFailed")}>
							<span className="select-text break-all">{error}</span>
						</Notice>
					</div>
				)}
				{entries.slice(0, INLINE_LIMIT).map((entry) => (
					<CompactRow
						key={entry.id}
						entry={entry}
						busy={busyId === entry.id}
						onUndo={() => void undo(entry)}
					/>
				))}
				<div className="flex justify-end px-4 py-2">
					<Button size="sm" icon={History} onClick={() => setShowAll(true)}>
						{entries.length > INLINE_LIMIT ? t("modelTemplates.viewAllCount", { count: String(entries.length) }) : t("modelTemplates.details")}
					</Button>
				</div>
			</SettingsCard>
			{showAll && (
				<LogModal
					entries={entries}
					busyId={busyId}
					error={error}
					onUndo={(entry) => void undo(entry)}
					onClose={() => setShowAll(false)}
				/>
			)}
		</>
	);
}
