/**
 * [D] Settings ▸ 模板与自动切换: recent switch history.
 *
 * Newest first. Each row shows the outcome chip, when, the template and the
 * reason; expanding it reveals the full reason, every role edit and the
 * per-session result. An applied/partial entry that has not been undone keeps
 * an 「撤销」 button that restores the previous role values.
 */
import { ChevronDown, History, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import type {
	ModelSwitchLogEntry,
	SessionSwitchResult,
	TemplateRoleEdit,
	TemplateStoreSnapshot,
} from "../../../lib/contracts";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { absoluteTime, relativeTime } from "../../../lib/format";
import { modelSwitchUndo } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { Button, Chip, EmptyState, Notice, SettingsCard, type ChipTone } from "../ui";
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
	// `relativeTime` already returns 「刚刚」, so only real intervals take a 前 suffix.
	const createdAgo = relativeTime(entry.createdAt);
	const undoneAgo = entry.undoneAt ? relativeTime(entry.undoneAt) : "";

	return (
		<div>
			<div className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-1.5">
						<Chip tone={TONE_CHIP[statusTone(entry.status)]}>{statusLabel(entry.status)}</Chip>
						<span className="break-words text-[13px] font-medium text-[var(--text)]">{entry.templateName}</span>
						{entry.ruleName && <Chip tone="neutral">规则：{entry.ruleName}</Chip>}
						<span className="text-[11px] text-[var(--text-dim)]" title={absoluteTime(entry.createdAt)}>
							{createdAgo === "刚刚" ? createdAgo : `${createdAgo}前`}
						</span>
					</div>
					{entry.reason && (
						<div className="mt-0.5 break-words text-[11px] leading-4 text-[var(--text-muted)]">
							{entry.reason}
						</div>
					)}
					{entry.undoneAt && (
						<div className="mt-0.5 text-[11px] leading-4 text-[var(--text-dim)]">
							已于 {undoneAgo === "刚刚" ? "刚刚" : `${undoneAgo}前`}撤销
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

	return (
		<SettingsCard
			title="切换记录"
			description="最近 200 次应用、自动切换和撤销。未撤销的切换可以一键恢复。"
			aside={entries.length > 0 ? `${entries.length} 条` : undefined}
			clip
		>
			{error && (
				<div className="px-4 py-3">
					<Notice tone="danger" title="撤销失败">
						<span className="select-text break-all">{error}</span>
					</Notice>
				</div>
			)}
			{entries.length === 0 ? (
				<EmptyState icon={History} title="还没有切换记录" description="应用模板或规则命中后，这里会留下记录。" />
			) : (
				entries.map((entry) => (
					<LogRow key={entry.id} entry={entry} busy={busyId === entry.id} onUndo={() => void undo(entry)} />
				))
			)}
		</SettingsCard>
	);
}
