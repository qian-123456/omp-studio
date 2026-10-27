import { Check } from "lucide-react";
import { memo, useState } from "react";
import { pendingForm } from "../../../core/pendingUi";
import type { PendingEntry } from "../../../core/types";
import { Spinner } from "../../../ui";
import { useChat, useChatUi } from "../ChatContext";
import { isBatchApprovable, showApproveAll } from "../lib/approvals";

const btn = "min-h-11 whitespace-nowrap rounded-m-pill border border-m-border px-4 text-m-sm font-medium active:bg-m-surface-hover disabled:opacity-50";
const primary = "min-h-11 whitespace-nowrap rounded-m-pill bg-m-accent px-4 text-m-sm font-medium text-m-accent-text active:opacity-80 disabled:opacity-50";

const PendingCard = memo(function PendingCard({ entry }: { entry: PendingEntry }) {
	const { controller } = useChatUi();
	const form = pendingForm(entry);
	const [busy, setBusy] = useState(false);
	const [text, setText] = useState(form.defaultValue);
	const [picked, setPicked] = useState<string[]>([]);
	const run = async (fn: () => Promise<void>) => {
		setBusy(true);
		try {
			await fn();
		} catch {
			/* toast already shown by the controller */
		} finally {
			setBusy(false);
		}
	};
	const confirmLike = form.method === "confirm";
	const approval = isBatchApprovable(entry);
	return (
		<div className="rounded-m-md border border-m-border bg-m-surface p-3">
			<div className="mb-1 flex items-center gap-2">
				<span className="whitespace-nowrap rounded-m-pill bg-m-surface-2 px-2 py-0.5 text-m-xs text-m-warn">{approval ? "待批准" : "待回复"}</span>
				{form.index != null && form.total != null && (
					<span className="whitespace-nowrap text-m-xs text-m-text-3">
						{form.index}/{form.total}
					</span>
				)}
			</div>
			<div className="m-selectable whitespace-pre-wrap break-words text-m-md font-medium">{form.title || "请求"}</div>
			{form.message && <div className="m-selectable mt-1 whitespace-pre-wrap break-words text-m-sm text-m-text-2">{form.message}</div>}
			{form.text ? (
				<>
					<textarea
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder={form.placeholder || "输入回复"}
						rows={3}
						className="mt-2 w-full resize-none rounded-m-sm border border-m-border bg-m-bg p-2 text-m-md outline-none"
					/>
					<div className="mt-2 flex gap-2">
						<button type="button" className={primary} disabled={busy} onClick={() => run(() => controller.respond(entry, { value: text }))}>
							提交
						</button>
						{!form.required && (
							<button type="button" className={btn} disabled={busy} onClick={() => run(() => controller.respond(entry, { cancelled: true }))}>
								跳过
							</button>
						)}
					</div>
				</>
			) : confirmLike ? (
				<div className="mt-2 flex gap-2">
					<button type="button" className={primary} disabled={busy} onClick={() => run(() => controller.respond(entry, { confirmed: true }))}>
						允许
					</button>
					<button type="button" className={btn} disabled={busy} onClick={() => run(() => controller.respond(entry, { confirmed: false }))}>
						拒绝
					</button>
				</div>
			) : form.multiple ? (
				<>
					<div className="mt-2 flex flex-col gap-2">
						{form.options
							.filter((o) => !o.isDone && !o.isOther)
							.map((o) => {
								const on = picked.includes(o.label);
								return (
									<button
										type="button"
										key={o.raw}
										aria-pressed={on}
										onClick={() => setPicked(on ? picked.filter((x) => x !== o.label) : [...picked, o.label])}
										className={`flex min-h-11 items-center gap-2 rounded-m-md border px-3 text-left text-m-sm ${on ? "border-m-accent bg-m-surface-2" : "border-m-border"}`}
									>
										<span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-m-sm border ${on ? "border-m-accent bg-m-accent text-m-accent-text" : "border-m-border"}`}>
											{on && <Check size={14} />}
										</span>
										<span className="min-w-0 flex-1 break-words">{o.label}</span>
									</button>
								);
							})}
					</div>
					<div className="mt-2 flex items-center gap-2">
						<button type="button" className={primary} disabled={busy} onClick={() => run(() => controller.respondMulti(entry, picked))}>
							{busy ? <Spinner size={14} /> : "完成选择"}
						</button>
						<span className="whitespace-nowrap text-m-xs text-m-text-3">已选 {picked.length} 项</span>
					</div>
				</>
			) : (
				<div className="mt-2 flex flex-wrap gap-2">
					{form.options.map((o) => (
						<button
							type="button"
							key={o.raw}
							disabled={busy}
							onClick={() => run(() => controller.respond(entry, { value: o.raw }))}
							className={`${/^approve|允许|批准/i.test(o.raw) ? primary : btn} text-left`}
							title={o.description || undefined}
						>
							{o.label}
							{o.recommended ? "（推荐）" : ""}
						</button>
					))}
				</div>
			)}
		</div>
	);
});

export function PendingCards() {
	const { controller } = useChatUi();
	const pendings = useChat((s) => s.pendings);
	if (!pendings.length) return null;
	const all = showApproveAll(pendings);
	return (
		<div className="max-h-[45%] shrink-0 space-y-2 overflow-y-auto overscroll-contain border-t border-m-border bg-m-bg px-3 py-2">
			{all && (
				<div className="flex items-center gap-2 rounded-m-md bg-m-surface-2 p-2">
					<span className="min-w-0 flex-1 text-m-sm text-m-text-2">有多项待批准的工具请求</span>
					<button type="button" className={primary} onClick={() => void controller.approveAll("approve")}>
						全部允许
					</button>
					<button type="button" className={btn} onClick={() => void controller.approveAll("deny")}>
						全部拒绝
					</button>
				</div>
			)}
			{pendings.map((p, i) => (
				<PendingCard key={p.request?.id ?? i} entry={p} />
			))}
		</div>
	);
}
