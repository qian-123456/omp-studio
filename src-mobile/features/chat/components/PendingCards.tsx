import { Check, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";
import { pendingForm } from "../../../core/pendingUi";
import type { PendingEntry, PendingOption, ToolItem } from "../../../core/types";
import { Button, inputCls, toast } from "../../../ui";
import { useChat, useChatUi } from "../ChatContext";
import { isBatchApprovable, showApproveAll } from "../lib/approvals";
import { findOpenAsks, isAnswerSubmittable, matchRequest, type AskAnswer, type AskMatch, type AskQuestion, type AskSpec } from "../lib/askDriver";

/** Answer recorded for a skipped question (the agent sees the user chose not to answer). */
const SKIPPED = "跳过这一题";

interface AskDraft extends AskAnswer {
	skipped?: boolean;
}

/** Drafts of an ask by tool-call id: survive the card remounting between omp's per-question requests. */
const askDrafts = new Map<string, (AskDraft | undefined)[]>();

function Card({ icon, label, children }: { icon: ReactNode; label: ReactNode; children: ReactNode }) {
	return (
		<div className="rounded-m-lg bg-m-surface p-4" data-testid="pending-card">
			<div className="mb-2 flex min-h-6 items-center gap-2 text-m-xs text-m-text-3">
				<span className="flex shrink-0 text-m-text-2">{icon}</span>
				{label}
			</div>
			{children}
		</div>
	);
}

function ErrorLine({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
	return (
		<div className="mt-3 flex items-center gap-2 rounded-m-md bg-m-danger-bg py-1 pr-1 pl-4 text-m-sm text-m-danger">
			<span className="min-w-0 flex-1">提交失败</span>
			<Button size="sm" variant="ghost" className="text-m-danger" busy={busy} onClick={onRetry}>
				重试
			</Button>
		</div>
	);
}

/** Runs one submission; remembers failure so the card can offer 重试 (the controller already toasted). */
function useSubmit() {
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState<(() => Promise<void>) | null>(null);
	const run = async (fn: () => Promise<void>) => {
		setBusy(true);
		setFailed(null);
		try {
			await fn();
		} catch {
			setFailed(() => fn);
		} finally {
			setBusy(false);
		}
	};
	return { busy, failed, run };
}

/** Radio / checkbox row, ≥ 52px, whole row tappable. */
function ChoiceRow({
	multi,
	on,
	label,
	description,
	recommended,
	onClick,
}: {
	multi: boolean;
	on: boolean;
	label: string;
	description?: string;
	recommended?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role={multi ? "checkbox" : "radio"}
			aria-checked={on}
			onClick={onClick}
			className={`flex min-h-13 w-full items-center gap-3 rounded-m-md px-3 py-2.5 text-left transition-colors duration-(--m-dur-fast) ${
				on ? "bg-m-surface-2" : "active:bg-m-surface-hover"
			}`}
		>
			<span
				aria-hidden
				className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center border-2 ${multi ? "rounded-[7px]" : "rounded-m-pill"} ${
					on ? "border-m-accent bg-m-accent text-m-accent-text" : "border-m-border-strong"
				}`}
			>
				{on && (multi ? <Check size={14} strokeWidth={3} /> : <span className="h-2 w-2 rounded-m-pill bg-m-accent-text" />)}
			</span>
			<span className="min-w-0 flex-1 break-words">
				<span className="text-m-md text-m-text">{label}</span>
				{recommended && <span className="ml-2 whitespace-nowrap text-m-xs text-m-accent">推荐</span>}
				{description && <span className="mt-0.5 block text-m-sm text-m-text-3">{description}</span>}
			</span>
		</button>
	);
}

function Progress({ index, total }: { index: number; total: number }) {
	return (
		<span className="flex items-center gap-2" aria-label={`问题 ${index} / ${total}`}>
			<span className="whitespace-nowrap">
				问题 {index}/{total}
			</span>
			<span aria-hidden className="flex items-center gap-1">
				{Array.from({ length: total }, (_, i) => (
					<span key={i} className={`h-1.5 rounded-m-pill ${i + 1 === index ? "w-3 bg-m-accent" : i + 1 < index ? "w-1.5 bg-m-accent" : "w-1.5 bg-m-surface-2"}`} />
				))}
			</span>
		</span>
	);
}

/* ------------------------------------------------------------------ approvals */

/** Keep omp's exact option values; remembered grants are session-only unless explicitly Always. */
function approvalButtons(options: readonly PendingOption[]) {
	const raws = options.map((o) => o.raw);
	const hasOnce = raws.includes("Approve Once");
	const once = hasOnce ? "Approve Once" : raws.find((r) => r === "Approve");
	const deny = raws.find((r) => r === "Deny");
	const other = raws.filter((r) => r !== once && r !== deny).map((raw) => {
		let label = raw;
		if (raw === "Approve File") label = "本会话允许文件";
		else if (raw.startsWith("Approve Directory: ")) label = `本会话允许目录：${raw.slice(19)}`;
		else if (raw === "Approve") label = "本会话记住";
		else if (/^Approve .+ for this session$/.test(raw)) label = `本会话允许：${raw.slice(8, -17)}`;
		else if (raw === "Always Approve File") label = "始终允许文件";
		else if (raw.startsWith("Always Approve Directory: ")) label = `始终允许目录：${raw.slice(26)}`;
		else if (raw === "Always Approve") label = "始终允许";
		return { raw, label };
	});
	return { once, deny, other };
}

const ApprovalCard = memo(function ApprovalCard({ entry }: { entry: PendingEntry }) {
	const { controller } = useChatUi();
	const form = pendingForm(entry);
	const { busy, failed, run } = useSubmit();
	const [head, ...rest] = (form.title || "工具请求").split("\n");
	const detail = [rest.join("\n").trim(), form.message.trim()].filter(Boolean).join("\n\n");
	const confirmLike = form.method === "confirm";
	const b = approvalButtons(form.options);
	const send = (value: string) => run(() => controller.respond(entry, { value }));
	return (
		<Card icon={<ShieldCheck size={18} strokeWidth={1.75} />} label="需要你的批准">
			<div className="m-selectable break-words text-m-md font-medium">{head}</div>
			{detail && (
				<pre className="m-selectable mt-3 mb-0 whitespace-pre-wrap break-words rounded-m-md bg-m-code-bg p-3 font-m-mono text-m-xs leading-5 text-m-text-2">
					{detail}
				</pre>
			)}
			{failed && <ErrorLine busy={busy} onRetry={() => void run(failed)} />}
			<div className="mt-4 flex flex-wrap justify-end gap-2">
				{confirmLike ? (
					<>
						<Button disabled={busy} onClick={() => void run(() => controller.respond(entry, { confirmed: false }))}>
							拒绝
						</Button>
						<Button variant="primary" busy={busy} onClick={() => void run(() => controller.respond(entry, { confirmed: true }))}>
							允许
						</Button>
					</>
				) : (
					<>
						{b.deny && (
							<Button disabled={busy} onClick={() => void send(b.deny as string)}>
								拒绝
							</Button>
						)}
						{b.other.map(({ raw, label }) => (
							<Button key={raw} disabled={busy} onClick={() => void send(raw)}>
								{label}
							</Button>
						))}
						{b.once && (
							<Button variant="primary" busy={busy} onClick={() => void send(b.once as string)}>
								单次允许
							</Button>
						)}
					</>
				)}
			</div>
		</Card>
	);
});

/* ------------------------------------------------------------------ ask (all questions, local paging) */

function initialAnswer(q: AskQuestion): AskAnswer {
	const rec = q.recommended !== undefined && q.recommended >= 0 && q.recommended < q.options.length ? q.recommended : undefined;
	return { selected: !q.multi && rec !== undefined ? [q.options[rec].label] : [], custom: "" };
}

const AskCard = memo(function AskCard({ spec, match, entry }: { spec: AskSpec; match: AskMatch; entry: PendingEntry }) {
	const { controller } = useChatUi();
	const start = match.qIndex;
	const [answers, setAnswers] = useState<(AskDraft | undefined)[]>(() => {
		const kept = askDrafts.get(spec.toolCallId);
		return kept ?? spec.questions.map((q, i) => (i >= start ? initialAnswer(q) : undefined));
	});
	const [idx, setIdx] = useState(start);
	const { busy, failed, run } = useSubmit();
	const q = spec.questions[idx];
	const a = answers[idx] ?? initialAnswer(q);
	const last = idx === spec.questions.length - 1;

	const update = (next: AskDraft, at = idx) => {
		setAnswers((prev) => {
			const copy = prev.slice();
			copy[at] = next;
			askDrafts.set(spec.toolCallId, copy);
			return copy;
		});
	};

	const submit = (all: (AskDraft | undefined)[]) => {
		const missing = spec.questions.findIndex((qq, i) => i >= start && !all[i]?.skipped && !isAnswerSubmittable(qq, all[i] ?? initialAnswer(qq)));
		if (missing >= 0) {
			setIdx(missing);
			toast(`第 ${missing + 1} 题还没有回答`, { kind: "error" });
			return;
		}
		const filled = all.map((x, i) => (x?.skipped ? { selected: [], custom: SKIPPED } : i >= start ? (x ?? initialAnswer(spec.questions[i])) : x));
		void run(async () => {
			await controller.answerAsk(spec, filled, entry);
			askDrafts.delete(spec.toolCallId);
		});
	};

	const next = () => (last ? submit(answers) : setIdx(idx + 1));
	const skip = () => {
		const skipped: AskDraft = { ...a, skipped: true };
		const all = answers.slice();
		all[idx] = skipped;
		update(skipped);
		if (last) submit(all);
		else setIdx(idx + 1);
	};

	const toggle = (label: string) => {
		if (q.multi) {
			const on = a.selected.includes(label);
			update({ ...a, skipped: false, selected: on ? a.selected.filter((l) => l !== label) : [...a.selected, label] });
		} else {
			update({ selected: [label], custom: "" });
		}
	};

	return (
		<Card
			icon={<MessageCircleQuestion size={18} strokeWidth={1.75} />}
			label={
				<>
					{spec.questions.length > 1 ? <Progress index={idx + 1} total={spec.questions.length} /> : <span>需要你回答</span>}
					{q.header && <span className="ml-auto whitespace-nowrap rounded-m-pill bg-m-surface-2 px-2.5 py-0.5 text-m-text-2">{q.header}</span>}
				</>
			}
		>
			<div className="m-selectable mb-2 break-words text-m-md font-medium">{q.question}</div>
			<div role={q.multi ? "group" : "radiogroup"} aria-label={q.multi ? "多选项" : "单选项"} className="-mx-1 flex flex-col gap-0.5">
				{q.options.map((o, i) => (
					<ChoiceRow
						key={o.label}
						multi={q.multi}
						on={a.selected.includes(o.label) && (q.multi || !a.custom.trim())}
						label={o.label}
						description={o.description}
						recommended={q.recommended === i}
						onClick={() => toggle(o.label)}
					/>
				))}
			</div>
			<input
				type="text"
				value={a.custom}
				onChange={(e) => update({ ...a, skipped: false, custom: e.target.value })}
				placeholder={q.multi ? "补充说明（可选）" : "其他回答（可选）"}
				aria-label={q.multi ? "补充说明" : "其他回答"}
				className={`${inputCls} mt-2 bg-m-bg!`}
			/>
			{failed && <ErrorLine busy={busy} onRetry={() => submit(answers)} />}
			<div className="mt-4 flex items-center gap-2">
				<Button variant="ghost" disabled={busy} onClick={skip}>
					跳过
				</Button>
				<span className="flex-1" />
				<Button disabled={busy || idx <= start} onClick={() => setIdx(idx - 1)}>
					上一题
				</Button>
				<Button variant="primary" busy={busy} onClick={next}>
					{last ? "提交" : "下一题"}
				</Button>
			</div>
		</Card>
	);
});

/* ------------------------------------------------------------------ generic select / text requests */

const QuestionCard = memo(function QuestionCard({ entry }: { entry: PendingEntry }) {
	const { controller } = useChatUi();
	const form = pendingForm(entry);
	const { busy, failed, run } = useSubmit();
	const options = form.options.filter((o) => !o.isDone && !o.isOther);
	const [text, setText] = useState(form.defaultValue);
	const [custom, setCustom] = useState("");
	const [radio, setRadio] = useState<string>(() => (options.find((o) => o.recommended) ?? options[0])?.raw ?? "");
	const [picked, setPicked] = useState<string[]>([]);

	const label =
		form.index != null && form.total != null ? <Progress index={form.index} total={form.total} /> : <span>需要你回答</span>;

	let body: ReactNode;
	let submit: () => Promise<void>;
	let canSubmit = true;
	if (form.text) {
		body = (
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder={form.placeholder || "输入回复"}
				rows={3}
				className={`${inputCls} h-auto resize-none bg-m-bg!`}
			/>
		);
		submit = () => controller.respond(entry, { value: text });
		canSubmit = !(form.required && !text.trim());
	} else if (form.multiple) {
		body = (
			<div role="group" aria-label="多选项" className="-mx-1 flex flex-col gap-0.5">
				{options.map((o) => {
					const on = picked.includes(o.label);
					return (
						<ChoiceRow
							key={o.raw}
							multi
							on={on}
							label={o.label}
							description={o.description}
							recommended={o.recommended}
							onClick={() => setPicked(on ? picked.filter((x) => x !== o.label) : [...picked, o.label])}
						/>
					);
				})}
			</div>
		);
		submit = () => controller.respondMulti(entry, picked);
	} else {
		body = (
			<>
				<div role="radiogroup" aria-label="单选项" className="-mx-1 flex flex-col gap-0.5">
					{options.map((o) => (
						<ChoiceRow
							key={o.raw}
							multi={false}
							on={radio === o.raw && !custom.trim()}
							label={o.label}
							description={o.description}
							recommended={o.recommended}
							onClick={() => {
								setRadio(o.raw);
								setCustom("");
							}}
						/>
					))}
				</div>
				<input
					type="text"
					value={custom}
					onChange={(e) => setCustom(e.target.value)}
					placeholder="其他回答（可选）"
					aria-label="其他回答"
					className={`${inputCls} mt-2 bg-m-bg!`}
				/>
			</>
		);
		submit = () => controller.respond(entry, { value: custom.trim() || radio });
		canSubmit = !!(custom.trim() || radio);
	}

	return (
		<Card icon={<MessageCircleQuestion size={18} strokeWidth={1.75} />} label={label}>
			<div className="m-selectable mb-2 break-words text-m-md font-medium">{form.title || "请求"}</div>
			{form.message && <div className="m-selectable mb-2 whitespace-pre-wrap break-words text-m-sm text-m-text-2">{form.message}</div>}
			{body}
			{failed && <ErrorLine busy={busy} onRetry={() => void run(failed)} />}
			<div className="mt-4 flex items-center justify-end gap-2">
				<Button disabled={busy} onClick={() => void run(() => controller.respond(entry, { cancelled: true }))}>
					跳过
				</Button>
				<Button variant="primary" busy={busy} disabled={!canSubmit} onClick={() => void run(submit)}>
					提交
				</Button>
			</div>
		</Card>
	);
});

/** Tool calls of the newest turn (persisted + live): where an open `ask` call lives. */
function useOpenAsks(): AskSpec[] {
	const blocks = useChat((s) => s.blocks);
	const live = useChat((s) => s.live);
	return useMemo(() => {
		const tools: ToolItem[] = [];
		for (let i = blocks.length - 1; i >= 0; i--) {
			const b = blocks[i];
			if (b.type !== "turn") continue;
			for (const s of b.steps) if (s.kind === "tool") tools.push(s.tool);
			break;
		}
		if (live) tools.push(...live.tools);
		return findOpenAsks(tools);
	}, [blocks, live]);
}

export function PendingCards() {
	const { controller } = useChatUi();
	const pendings = useChat((s) => s.pendings);
	const asks = useOpenAsks();
	if (!pendings.length) return null;
	const approvals = pendings.filter(isBatchApprovable).length;
	return (
		<div className="max-h-[50%] shrink-0 space-y-3 overflow-y-auto overscroll-contain px-4 pt-1 pb-2">
			{showApproveAll(pendings) && (
				<div className="flex flex-wrap items-center gap-2 rounded-m-lg bg-m-surface py-2 pr-2 pl-4">
					<span className="min-w-0 flex-1 text-m-sm text-m-text-2">{approvals} 个工具请求等待批准</span>
					<Button size="sm" onClick={() => void controller.approveAll("deny", pendings)}>
						全部拒绝
					</Button>
					<Button size="sm" variant="primary" onClick={() => void controller.approveAll("approve", pendings)}>
						全部允许
					</Button>
				</div>
			)}
			{pendings.map((p, i) => {
				if (isBatchApprovable(p)) return <ApprovalCard key={p.request?.id ?? i} entry={p} />;
				for (const spec of asks) {
					const m = matchRequest(spec, p.request);
					if (m) return <AskCard key={`ask-${spec.toolCallId}`} spec={spec} match={m} entry={p} />;
				}
				return <QuestionCard key={p.request?.id ?? i} entry={p} />;
			})}
		</div>
	);
}
