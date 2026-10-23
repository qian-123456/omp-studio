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

const TONE_CHIP: Record<"ok" | "warn" | "error" | "muted", ChipTone> = {
	ok: "success",
	warn: "warning",
	error: "danger",
	muted: "neutral",
};

/** Statuses whose edits are still in effect and can therefore be undone. */
const UNDOABLE: Record<string, true> = { applied: true, partial: true };

function EditList({ edits }: { edits: TemplateRoleEdit[] }) {
	if (edits.length === 0) return <div className="text-[11px] text-[var(--text-dim)]">没有角色改动</div>;
	return (
		<ul className="space-y-1">
			{edits.map((edit) => (
				<li key={edit.role} className="text-[11px] leading-[18px]">
					<span className="break-all font-mono font-semibold text-[var(--text)]">{edit.role}</span>
					<span className="text-[var(--text-dim)]">：</span>
					<span className="break-all text-[var(--text-muted)]">{edit.before ?? "未配置"}</span>
					<span className="text-[var(--text-dim)]"> → </span>
					<span className="break-all text-[var(--text)]">{edit.after ?? "未配置"}</span>
				</li>
			))}
		</ul>
	);
}

function SessionList({ results }: { results: SessionSwitchResult[] }) {
	if (results.length === 0) return <div className="text-[11px] text-[var(--text-dim)]">没有运行中的会话需要切换</div>;
	return (
		<ul className="space-y-1">
			{results.map((result) => (
				<li key={result.sessionId} className="text-[11px] leading-[18px]">
					<Chip tone={result.ok ? "success" : "warning"}>{result.ok ? "已切换" : "未切换"}</Chip>{" "}
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
						{entry.ruleName && <Chip tone="neutral">规则：{entry.ruleName}</Chip>}
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
							已于 {undoneAgo}撤销
						</div>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{undoable && (
						<Button size="sm" icon={RotateCcw} loading={busy} onClick={onUndo}>
							撤销
						</Button>
					)}
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen((v) => !v)}
						className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
					>
						{open ? "收起详情" : "展开详情"}
						<ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
					</button>
				</div>
			</div>
			{open && (
				<div className="space-y-2 border-t border-[var(--border-divider)] bg-[var(--well-bg)] px-4 py-2.5">
					<div>
						<div className="text-[11px] font-semibold text-[var(--text)]">原因</div>
						<div className="select-text whitespace-pre-wrap break-words text-[11px] leading-[18px] text-[var(--text-muted)]">
							{entry.reason || "（无）"}
						</div>
					</div>
					<div>
						<div className="text-[11px] font-semibold text-[var(--text)]">
							角色改动（{entry.edits.length} 处）
						</div>
						<EditList edits={entry.edits} />
					</div>
					<div>
						<div className="text-[11px] font-semibold text-[var(--text)]">会话切换</div>
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
	const undoable = UNDOABLE[entry.status] === true && entry.undoneAt === null;
	const createdAgo = timeAgo(entry.createdAt);
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
				<span className="text-[11px] text-[var(--text-dim)]" title={absoluteTime(entry.createdAt)}>
					{createdAgo}
				</span>
				<span className="break-words text-[13px] font-medium text-[var(--text)]">{entry.templateName}</span>
				<Chip tone="neutral">{entry.ruleName ? `规则：${entry.ruleName}` : "手动"}</Chip>
				<Chip tone={TONE_CHIP[statusTone(entry.status)]}>{statusLabel(entry.status)}</Chip>
				{entry.undoneAt && <span className="text-[11px] text-[var(--text-dim)]">已撤销</span>}
			</div>
			{undoable && (
				<Button size="sm" icon={RotateCcw} loading={busy} onClick={onUndo}>
					撤销
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
	return (
		<Modal
			onClose={onClose}
			size="none"
			ariaLabel="全部切换记录"
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
							全部切换记录
						</h2>
						<p className="mt-0.5 text-[11px] leading-5 text-[var(--text-muted)]">
							最近 200 次应用、自动切换和撤销，共 {entries.length} 条。
						</p>
					</div>
					<IconButton icon={X} label="关闭" onClick={onClose} />
				</div>
				{error && (
					<div className="shrink-0 pt-3">
						<Notice tone="danger" title="撤销失败">
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

	const undo = async (entry: ModelSwitchLogEntry) => {
		const ok = await confirmDialog(
			`确定撤销这次切换，把角色恢复成应用前的模型吗？\n模板「${entry.templateName}」`,
			{ title: "撤销切换", okLabel: "撤销" },
		);
		if (!ok) return;
		setBusyId(entry.id);
		setError(null);
		try {
			const result = await modelSwitchUndo(entry.id);
			toast.success(result.reason || "已撤销并恢复原配置");
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
				title="最近切换"
				description="最近的应用、自动切换和撤销记录。"
				aside={`${entries.length} 条`}
				clip
			>
				{error && !showAll && (
					<div className="px-4 py-3">
						<Notice tone="danger" title="撤销失败">
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
						{entries.length > INLINE_LIMIT ? `查看全部 ${entries.length} 条` : "详情"}
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
