/**
 * [D] 批量替换模型 ▸ 历史记录: the newest 10 replacements with their edits. Undo
 * restores the previous values of one record and reports every item's outcome
 * (items whose value changed again are skipped by the backend).
 */
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import type {
	ModelReplaceItemResult,
	ModelReplaceRecord,
} from "../../../lib/contracts";
import { timeWithTitle } from "../../../lib/format";
import { invertEdit, type EditSummary, summarizeEdit } from "./logic";
import { BTN_PRIMARY, Chip } from "./parts";

export interface UndoOutcome {
	recordId: string;
	results: ModelReplaceItemResult[];
}

function EditList({ record, projectNames }: { record: ModelReplaceRecord; projectNames: Record<string, string> }) {
	return (
		<div className="border-t border-[var(--border-divider)] px-3 py-1.5">
			{record.edits.map((edit, index) => {
				const summary: EditSummary = summarizeEdit(edit, projectNames);
				const restored = summarizeEdit(invertEdit(edit), projectNames);
				return (
					<div key={`${summary.title}:${index}`} className="py-1 text-[10px]">
						<div className="flex flex-wrap items-center gap-1.5">
							<span className="min-w-0 break-all text-neutral-300">{summary.title}</span>
							<Chip tone="neutral">{summary.context}</Chip>
						</div>
						<div className="whitespace-pre-wrap break-all font-mono text-neutral-500">
							{summary.before} → {summary.after}
						</div>
						{summary.details.map((line) => (
							<div key={line} className="whitespace-pre-wrap break-all font-mono text-neutral-600">
								{line}
							</div>
						))}
						{record.undoneAt === null && (
							<div className="whitespace-pre-wrap break-all font-mono text-neutral-600">撤销后恢复为 {restored.after}</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

/** The undo response carries the STORED edits, so each row is named like the record's own rows. */
function UndoResults({
	results,
	projectNames,
}: {
	results: ModelReplaceItemResult[];
	projectNames: Record<string, string>;
}) {
	return (
		<div className="border-t border-[var(--border-divider)] bg-[var(--well-bg)] px-3 py-1.5">
			<div className="text-[10px] text-neutral-500">撤销结果</div>
			{results.map((result, index) => {
				const summary = summarizeEdit(result.edit, projectNames);
				return (
					<div key={index} className="flex items-start gap-1.5 py-0.5 text-[10px]">
						{result.ok ? (
							<CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
						) : (
							<XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
						)}
						<span className="min-w-0 flex-1">
							<span className="break-all text-neutral-300">{summary.title}</span>
							<span className="ml-1 break-all text-neutral-500">{summary.context}</span>
							<span className="ml-1 whitespace-pre-wrap break-all text-neutral-400">
								{result.ok ? "已恢复" : (result.error ?? "撤销失败")}
							</span>
						</span>
					</div>
				);
			})}
		</div>
	);
}

export function ModelReplaceHistory({
	records,
	loading,
	error,
	projectNames,
	undoingId,
	undoOutcome,
	onReload,
	onUndo,
}: {
	records: ModelReplaceRecord[];
	loading: boolean;
	error: string | null;
	projectNames: Record<string, string>;
	undoingId: string | null;
	undoOutcome: UndoOutcome | null;
	onReload: () => void;
	onUndo: (recordId: string) => void;
}) {
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	if (loading && records.length === 0) {
		return (
			<div className="flex items-center gap-2 px-3 py-6 text-xs text-neutral-400">
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
				正在读取历史记录…
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center justify-between gap-2 px-3 pb-2 text-[11px] text-neutral-400">
				<span>最近 10 次批量替换；撤销只会恢复本次替换写过的值。</span>
				<button
					type="button"
					onClick={onReload}
					disabled={loading}
					className="inline-flex shrink-0 items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-1 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50"
				>
					<RotateCcw className="h-3 w-3" />
					刷新
				</button>
			</div>

			{error !== null && (
				<div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] leading-5 text-rose-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="min-w-0 flex-1 break-all">{error}</span>
				</div>
			)}

			{records.length === 0 && !loading && (
				<div className="px-3 py-6 text-xs text-neutral-500">还没有批量替换记录。</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
				{records.map((record) => {
					const time = timeWithTitle(record.createdAt);
					const isOpen = expanded[record.id] ?? false;
					return (
						<div key={record.id} className="mb-2 rounded-xl hairline">
							<div className="flex items-center gap-2 px-3 py-2 text-[11px]">
								<button
									type="button"
									onClick={() => setExpanded((prev) => ({ ...prev, [record.id]: !isOpen }))}
									className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
									title="展开本次替换的每一处改动"
								>
									<span className="min-w-0 break-all font-mono text-neutral-300">
										{record.fromModel} → {record.toModel}
									</span>
									<Chip tone="neutral">{record.edits.length} 项</Chip>
									{record.undoneAt !== null && <Chip tone="info">已撤销</Chip>}
								</button>
								<span className="shrink-0 text-[10px] text-neutral-500" title={time.title}>
									{time.text}
								</span>
								<button
									type="button"
									onClick={() => onUndo(record.id)}
									disabled={record.undoneAt !== null || undoingId !== null}
									title={record.undoneAt !== null ? "这条记录已经撤销过" : "恢复本次替换前的值"}
									className={BTN_PRIMARY}
								>
									{undoingId === record.id ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
									撤销
								</button>
							</div>
							{isOpen && <EditList record={record} projectNames={projectNames} />}
							{undoOutcome?.recordId === record.id && (
								<UndoResults results={undoOutcome.results} projectNames={projectNames} />
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
