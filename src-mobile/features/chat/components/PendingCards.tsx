import { Check, RotateCcw } from "lucide-react";
import { memo, useState } from "react";
import { pendingForm } from "../../../core/pendingUi";
import type { PendingEntry } from "../../../core/types";
import { Spinner } from "../../../ui";
import { useChat, useChatUi } from "../ChatContext";
import { isBatchApprovable, showApproveAll } from "../lib/approvals";

const btn =
	"min-h-11 whitespace-nowrap rounded-m-pill border border-m-border px-4 text-m-sm font-medium active:bg-m-surface-hover disabled:opacity-50";
const primary =
	"min-h-11 whitespace-nowrap rounded-m-pill bg-m-accent px-4 text-m-sm font-medium text-m-accent-text active:opacity-80 disabled:opacity-50";

const PendingCard = memo(function PendingCard({ entry }: { entry: PendingEntry }) {
	const { controller } = useChatUi();
	const form = pendingForm(entry);
	const [busy, setBusy] = useState(false);
	const [text, setText] = useState(form.defaultValue);
	const [customText, setCustomText] = useState("");
	const [selectedRadio, setSelectedRadio] = useState<string>(() => {
		const rec = form.options.find((o) => o.recommended && !o.isDone && !o.isOther);
		return rec?.raw ?? form.options.find((o) => !o.isDone && !o.isOther)?.raw ?? "";
	});
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
	const isQuestion = !confirmLike && !approval;
	const regularOptions = form.options.filter((o) => !o.isDone && !o.isOther);

	return (
		<div className="rounded-m-md border border-m-border bg-m-surface p-3" data-testid="pending-card">
			<div className="mb-2 flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span className="whitespace-nowrap rounded-m-pill bg-m-surface-2 px-2 py-0.5 text-m-xs text-m-warn">
						{approval ? "待批准" : "待回复"}
					</span>
					{/* Multi-step pagination (Question X of Y) */}
					{form.index != null && form.total != null && (
						<div className="flex items-center gap-1.5" aria-label={`问题 ${form.index} / ${form.total}`}>
							<span className="whitespace-nowrap text-m-xs font-medium text-m-accent">
								问题 {form.index} / {form.total}
							</span>
							<span className="flex items-center gap-1">
								{Array.from({ length: form.total }).map((_, i) => (
									<span
										key={i}
										className={`h-1.5 rounded-full transition-all ${
											i + 1 === form.index ? "w-3 bg-m-accent" : i + 1 < (form.index ?? 0) ? "w-1.5 bg-m-accent/50" : "w-1.5 bg-m-border"
										}`}
									/>
								))}
							</span>
						</div>
					)}
				</div>
				{isQuestion && (
					<button
						type="button"
						aria-label="重试"
						disabled={busy}
						onClick={() =>
							run(async () => {
								await controller.loadPendings();
								controller.retry();
							})
						}
						className="flex items-center gap-1 text-m-xs text-m-text-3 active:text-m-text"
					>
						<RotateCcw size={12} />
						重试
					</button>
				)}
			</div>

			<div className="m-selectable whitespace-pre-wrap break-words text-m-md font-medium">
				{form.title || "请求"}
			</div>
			{form.message && (
				<div className="m-selectable mt-1 whitespace-pre-wrap break-words text-m-sm text-m-text-2">
					{form.message}
				</div>
			)}

			{form.text ? (
				/* Freeform text input */
				<>
					<textarea
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder={form.placeholder || "输入回复"}
						rows={3}
						className="mt-2 w-full resize-none rounded-m-sm border border-m-border bg-m-bg p-2 text-m-md outline-none focus:border-m-accent"
					/>
					<div className="mt-2 flex gap-2">
						<button
							type="button"
							className={primary}
							disabled={busy || (form.required && !text.trim())}
							onClick={() => run(() => controller.respond(entry, { value: text }))}
						>
							{busy ? <Spinner size={14} /> : "提交"}
						</button>
						<button
							type="button"
							className={btn}
							disabled={busy}
							onClick={() => run(() => controller.respond(entry, { cancelled: true }))}
						>
							跳过
						</button>
						<button
							type="button"
							className={btn}
							disabled={busy}
							onClick={() =>
								run(async () => {
									await controller.loadPendings();
									controller.retry();
								})
							}
						>
							重试
						</button>
					</div>
				</>
			) : confirmLike ? (
				/* Confirm / Allow / Deny */
				<div className="mt-2 flex gap-2">
					<button
						type="button"
						className={primary}
						disabled={busy}
						onClick={() => run(() => controller.respond(entry, { confirmed: true }))}
					>
						允许
					</button>
					<button
						type="button"
						className={btn}
						disabled={busy}
						onClick={() => run(() => controller.respond(entry, { confirmed: false }))}
					>
						拒绝
					</button>
				</div>
			) : form.multiple ? (
				/* Multi-select checkboxes */
				<>
					<div className="mt-2 flex flex-col gap-2" role="group" aria-label="多选项列表">
						{regularOptions.map((o) => {
							const on = picked.includes(o.label);
							return (
								<button
									type="button"
									key={o.raw}
									role="checkbox"
									aria-checked={on}
									onClick={() =>
										setPicked(on ? picked.filter((x) => x !== o.label) : [...picked, o.label])
									}
									className={`flex min-h-11 items-center gap-2.5 rounded-m-md border px-3 py-2 text-left text-m-sm ${
										on ? "border-m-accent bg-m-surface-2" : "border-m-border"
									}`}
								>
									<span
										className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-m-sm border ${
											on ? "border-m-accent bg-m-accent text-m-accent-text" : "border-m-border"
										}`}
									>
										{on && <Check size={14} />}
									</span>
									<span className="min-w-0 flex-1 break-words">
										<span className="font-medium text-m-text">{o.label}</span>
										{o.recommended && <span className="ml-1.5 text-m-xs text-m-accent">（推荐）</span>}
										{o.description && (
											<span className="block text-m-xs text-m-text-3">{o.description}</span>
										)}
									</span>
								</button>
							);
						})}
					</div>

					{/* Freeform input */}
					<div className="mt-2">
						<input
							type="text"
							value={customText}
							onChange={(e) => setCustomText(e.target.value)}
							placeholder="备注 / 自定义补充（可选）"
							className="min-h-10 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text outline-none placeholder:text-m-text-3 focus:border-m-accent"
						/>
					</div>

					<div className="mt-3 flex items-center gap-2">
						<button
							type="button"
							className={primary}
							disabled={busy}
							onClick={() => run(() => controller.respondMulti(entry, picked))}
						>
							{busy ? <Spinner size={14} /> : "完成选择"}
						</button>
						<button
							type="button"
							className={btn}
							disabled={busy}
							onClick={() => run(() => controller.respond(entry, { cancelled: true }))}
						>
							跳过
						</button>
						<button
							type="button"
							className={btn}
							disabled={busy}
							onClick={() =>
								run(async () => {
									await controller.loadPendings();
									controller.retry();
								})
							}
						>
							重试
						</button>
						<span className="ml-auto whitespace-nowrap text-m-xs text-m-text-3">
							已选 {picked.length} 项
						</span>
					</div>
				</>
			) : (
				/* Single-select radio */
				<>
					<div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="单选项列表">
						{regularOptions.map((o) => {
							const on = selectedRadio === o.raw;
							return (
								<button
									type="button"
									key={o.raw}
									role="radio"
									aria-checked={on}
									onClick={() => {
										setSelectedRadio(o.raw);
										setCustomText("");
									}}
									className={`flex min-h-11 items-center gap-2.5 rounded-m-md border px-3 py-2 text-left text-m-sm ${
										on ? "border-m-accent bg-m-surface-2" : "border-m-border"
									}`}
								>
									<span
										className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
											on ? "border-m-accent" : "border-m-border"
										}`}
									>
										{on && <span className="h-2.5 w-2.5 rounded-full bg-m-accent" />}
									</span>
									<span className="min-w-0 flex-1 break-words">
										<span className="font-medium text-m-text">{o.label}</span>
										{o.recommended && <span className="ml-1.5 text-m-xs text-m-accent">（推荐）</span>}
										{o.description && (
											<span className="block text-m-xs text-m-text-3">{o.description}</span>
										)}
									</span>
								</button>
							);
						})}
					</div>

					{/* Freeform input for custom answer */}
					<div className="mt-2">
						<input
							type="text"
							value={customText}
							onChange={(e) => {
								setCustomText(e.target.value);
								if (e.target.value) setSelectedRadio("");
							}}
							placeholder="其他（输入自定义回答）"
							className="min-h-10 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text outline-none placeholder:text-m-text-3 focus:border-m-accent"
						/>
					</div>

					<div className="mt-3 flex items-center gap-2">
						<button
							type="button"
							className={primary}
							disabled={busy || (!selectedRadio && !customText.trim())}
							onClick={() =>
								run(() =>
									controller.respond(entry, {
										value: customText.trim() ? customText.trim() : selectedRadio,
									}),
								)
							}
						>
							{busy ? <Spinner size={14} /> : "确认"}
						</button>
						<button
							type="button"
							className={btn}
							disabled={busy}
							onClick={() => run(() => controller.respond(entry, { cancelled: true }))}
						>
							跳过
						</button>
						<button
							type="button"
							className={btn}
							disabled={busy}
							onClick={() =>
								run(async () => {
									await controller.loadPendings();
									controller.retry();
								})
							}
						>
							重试
						</button>
					</div>
				</>
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
