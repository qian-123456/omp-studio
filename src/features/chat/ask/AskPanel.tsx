/** [B] Codex-style panel for the agent's `ask` tool, docked in place of the
 * composer. omp drives ask over plain select/editor UI requests; the routing
 * hook matches those to the ask tool-call arguments and replays the user's
 * answer as the RPC response sequence (see askDriver.ts). */

import { Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PendingUiRequest } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { isComposing } from "../../../lib/hooks";
import { rpcUiRespond } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { tNow, useT } from "../../../stores/language";
import { useLive } from "../../../stores/live";
import {
	type AskAnswer,
	type AskDriverState,
	type AskMatch,
	type AskQuestion,
	type AskResolution,
	type AskSpec,
	findOpenAsks,
	isAnswerSubmittable,
	matchRequest,
	OTHER_OPTION,
	resolveRequest,
	unansweredQuestions,
} from "./askDriver";
import { claimEscape } from "../../../lib/escapeClaim";

/** Driver progress keyed `${sessionId}:${toolCallId}:${qIndex}`; module-level
 * so it survives SessionView remounts (session switch). */
const driverStates = new Map<string, AskDriverState>();
/** Request ids already answered by the driver, keyed `sessionId:id` (ids may be
 * reused across sessions; guards double responses). */
const respondedIds = new Set<string>();
export const respondedKey = (sessionId: string, id: string): string => `${sessionId}:${id}`;

/** Forget driver progress and answered ids of removed sessions (keys are `sessionId:...`). */
export function pruneAskState(sessionIds: readonly string[]): void {
	const prefixes = sessionIds.map((sid) => `${sid}:`);
	const hit = (k: string) => prefixes.some((p) => k.startsWith(p));
	for (const k of [...driverStates.keys()]) if (hit(k)) driverStates.delete(k);
	for (const k of [...respondedIds]) if (hit(k)) respondedIds.delete(k);
}

export interface AskRoute {
	req: PendingUiRequest;
	spec: AskSpec;
	match: AskMatch;
	resolution: AskResolution;
}

export function useAskRouting(sessionId: string, pendingUi: PendingUiRequest[]) {
	const tools = useLive((s) => s.sessions[sessionId]?.tools);
	const items = useLive((s) => s.sessions[sessionId]?.items);
	const dismissUi = useLive((s) => s.dismissUi);
	const [version, bump] = useReducer((x: number) => x + 1, 0);
	const [awaiting, setAwaiting] = useState(false);

	const route = useMemo<AskRoute | null>(() => {
		void version;
		if (!pendingUi.length) return null;
		const specs = findOpenAsks(Object.values(tools ?? {}), items ?? []);
		for (const req of pendingUi) {
			for (const spec of specs) {
				const match = matchRequest(spec, req.request);
				if (!match) continue;
				const key = `${sessionId}:${spec.toolCallId}:${match.qIndex}`;
				const resolution = resolveRequest(
					spec.questions[match.qIndex],
					match,
					driverStates.get(key),
				);
				if (resolution.kind !== "fallback")
					return { req, spec, match, resolution };
			}
		}
		return null;
	}, [pendingUi, tools, items, sessionId, version]);

	// Replay the stored answer one response at a time; omp re-sends the next
	// request, which re-runs this effect.
	useEffect(() => {
		if (!route || route.resolution.kind !== "auto") return;
		const { match, spec, resolution } = route;
		const id = match.requestId;
		const rkey = respondedKey(sessionId, id);
		if (respondedIds.has(rkey)) return;
		respondedIds.add(rkey);
		const key = `${sessionId}:${spec.toolCallId}:${match.qIndex}`;
		const state = driverStates.get(key);
		const final =
			match.method === "editor" ||
			(resolution.value !== OTHER_OPTION &&
				(!spec.questions[match.qIndex].multi || resolution.value === match.doneOption));
		setAwaiting(true);
		rpcUiRespond(sessionId, { id, value: resolution.value })
			.then(() => {
				if (final) {
					driverStates.delete(key);
					// No further question follows: release the composer now.
					setAwaiting(false);
				}
				else if (state) driverStates.set(key, { ...state, toggled: resolution.toggled });
				dismissUi(sessionId, id);
			})
			.catch((err) => {
				driverStates.delete(key);
				respondedIds.delete(rkey);
				toast.error(tNow("ask.submitFailed", { error: errMsg(err) }));
				setAwaiting(false);
				bump();
			});
	}, [route, sessionId, dismissUi]);

	// Bridge the gap between our response and omp's next request.
	useEffect(() => {
		if (!awaiting) return;
		if (route?.resolution.kind === "present") {
			setAwaiting(false);
			return;
		}
		const timer = setTimeout(() => setAwaiting(false), 4000);
		return () => clearTimeout(timer);
	}, [awaiting, route]);

	/** Store every drafted answer; replay starts on the pending request and
	 * continues as omp sends each following question. */
	const submit = useCallback(
		(answers: readonly (AskAnswer | undefined)[]) => {
			if (!route) return;
			answers.forEach((answer, i) => {
				if (answer)
					driverStates.set(`${sessionId}:${route.spec.toolCallId}:${i}`, {
						answer,
						toggled: [],
					});
			});
			bump();
		},
		[route, sessionId],
	);

	const cancel = useCallback(async () => {
		if (!route) return;
		const id = route.match.requestId;
		respondedIds.add(respondedKey(sessionId, id));
		try {
			await rpcUiRespond(sessionId, { id, cancelled: true });
			dismissUi(sessionId, id);
		} catch (err) {
			respondedIds.delete(respondedKey(sessionId, id));
			toast.error(tNow("ask.cancelFailed", { error: errMsg(err) }));
		}
	}, [route, sessionId, dismissUi]);

	return { route, awaiting, submit, cancel };
}



interface Draft extends AskAnswer {
	cursor: number;
}

const validRecommended = (q: AskQuestion): number | undefined =>
	q.recommended !== undefined && q.recommended >= 0 && q.recommended < q.options.length
		? q.recommended
		: undefined;

function initialDraft(q: AskQuestion): Draft {
	const rec = validRecommended(q);
	return {
		cursor: rec ?? 0,
		selected: !q.multi && rec !== undefined ? [q.options[rec].label] : [],
		custom: "",
	};
}

/** Single-select: typed text replaces the option pick (omp's Other path). */
const answerOf = (q: AskQuestion, d: Draft): AskAnswer =>
	q.multi
		? { selected: d.selected, custom: d.custom }
		: { selected: d.custom.trim() ? [] : d.selected, custom: d.custom };

/** All questions of one ask; navigation is local, only 提交 talks to omp. */
export function AskPanel({
	spec,
	startIndex,
	busy,
	onSubmit,
	onCancel,
}: {
	spec: AskSpec;
	/** First question omp still waits for (earlier ones are already answered). */
	startIndex: number;
	busy: boolean;
	onSubmit: (answers: readonly (AskAnswer | undefined)[]) => void;
	onCancel: () => void;
}) {
	const { t, locale } = useT();
	const total = spec.questions.length;
	const [current, setCurrent] = useState(startIndex);
	// Drafts exist once a question is visited, so an unvisited multi-select
	// still counts as unanswered.
	const [drafts, setDrafts] = useState<(Draft | undefined)[]>(() => {
		const d: (Draft | undefined)[] = [];
		d[startIndex] = initialDraft(spec.questions[startIndex]);
		return d;
	});
	const panelRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const question = spec.questions[current];
	const { options, multi } = question;
	const draft = drafts[current] ?? initialDraft(question);
	const otherIdx = options.length;
	const rec = validRecommended(question);
	const answers = spec.questions.map((q, i) => {
		const d = drafts[i];
		return d ? answerOf(q, d) : undefined;
	});
	const missing = unansweredQuestions(spec, answers, startIndex);
	const isLast = current === total - 1;

	useEffect(() => {
		panelRef.current?.focus();
	}, []);

	const update = (patch: Partial<Draft>) =>
		setDrafts((ds) => {
			const next = [...ds];
			next[current] = { ...(ds[current] ?? initialDraft(question)), ...patch };
			return next;
		});

	const goTo = (i: number) => {
		if (i < startIndex || i >= total) return;
		setDrafts((ds) => {
			if (ds[i]) return ds;
			const next = [...ds];
			next[i] = initialDraft(spec.questions[i]);
			return next;
		});
		setCurrent(i);
		panelRef.current?.focus();
	};

	const submitAll = () => {
		if (busy) return;
		if (missing.length) goTo(missing[0]);
		else onSubmit(answers);
	};

	const activate = (i: number) => {
		if (i === otherIdx) {
			update({ cursor: i });
			inputRef.current?.focus();
			return;
		}
		const label = options[i].label;
		if (multi) {
			const s = draft.selected;
			update({
				cursor: i,
				selected: s.includes(label) ? s.filter((l) => l !== label) : [...s, label],
			});
			return;
		}
		update({ cursor: i, selected: [label], custom: "" });
		// Codex: picking an option advances; the last question waits for 提交.
		if (!isLast) goTo(current + 1);
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (isComposing(e) || busy) return;
		const inInput = e.target === inputRef.current;
		const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
		if (e.key === "Escape") {
			claimEscape(e);
			if (inInput) panelRef.current?.focus();
			else onCancel();
			return;
		}
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const next =
				(draft.cursor + (e.key === "ArrowDown" ? 1 : -1) + otherIdx + 1) % (otherIdx + 1);
			update({ cursor: next });
			if (next === otherIdx) inputRef.current?.focus();
			else panelRef.current?.focus();
			return;
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (!inInput && !multi && draft.cursor < otherIdx) activate(draft.cursor);
			else if (isLast) submitAll();
			else goTo(current + 1);
			return;
		}
		if (inInput) return;
		if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && plain) {
			e.preventDefault();
			goTo(current + (e.key === "ArrowRight" ? 1 : -1));
			return;
		}
		if (e.key === " " && multi && draft.cursor < otherIdx) {
			e.preventDefault();
			activate(draft.cursor);
			return;
		}
		if (/^[1-9]$/.test(e.key) && plain) {
			const i = Number(e.key) - 1;
			if (i <= otherIdx) {
				e.preventDefault();
				activate(i);
			}
			return;
		}
		// Typing while on the options jumps into the free-text row (Codex).
		if (e.key.length === 1 && plain) {
			update({ cursor: otherIdx });
			inputRef.current?.focus();
		}
	};

	const row =
		"group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors";
	const ghostBtn =
		"inline-flex items-center gap-1 rounded border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] disabled:opacity-50";
	const primaryBtn =
		"inline-flex items-center gap-1 rounded bg-[var(--text)] px-2.5 py-1 text-xs font-medium text-[var(--bg)] transition-colors hover:opacity-90 disabled:opacity-50";
	return (
		<div
			ref={panelRef}
			tabIndex={-1}
			onKeyDown={onKeyDown}
			className="my-2 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-3 text-[var(--text)] outline-none"
		>
			<div className="flex items-center gap-2 text-[11px] text-[var(--text-40)]">
				{question.header && (
					<span className="rounded border border-[var(--line)] px-1.5 py-px text-[var(--text-60)]">
						{question.header}
					</span>
				)}
				{total > 1 && (
					<span>
						{t("ask.questionProgress", { current: current + 1, total })}
					</span>
				)}
				{multi && <span>{t("ask.multiSelect")}</span>}
				{total > 1 && (
					<span className="ml-auto flex items-center gap-1">
						{spec.questions.map((q, i) => {
							const a = answers[i];
							const done = i < startIndex || (a !== undefined && isAnswerSubmittable(q, a));
							return (
								<button
									key={q.id}
									type="button"
									disabled={busy || i < startIndex}
									aria-label={t("ask.questionAria", { index: i + 1 })}
									title={t("ask.questionAria", { index: i + 1 })}
									onClick={() => goTo(i)}
									className={`h-1.5 rounded-full transition-all ${i === current ? "w-4 bg-[var(--text)]" : `w-1.5 ${done ? "bg-[var(--text-60)]" : "bg-[var(--line)]"}`}`}
								/>
							);
						})}
					</span>
				)}
			</div>
			<div className="mt-1.5 whitespace-pre-wrap text-[13px] font-medium">
				{question.question}
			</div>
			<div className="mt-2 flex flex-col">
				{options.map((o, i) => {
					const on = draft.selected.includes(o.label) && (multi || !draft.custom.trim());
					return (
						<button
							key={o.label}
							type="button"
							disabled={busy}
							onMouseEnter={() => update({ cursor: i })}
							onClick={() => activate(i)}
							className={`${row} ${draft.cursor === i ? "bg-[var(--ghost-hover)]" : ""}`}
						>
							<span className="w-4 shrink-0 pt-px text-right text-[12px] tabular-nums text-[var(--text-40)]">
								{i + 1}.
							</span>
							{multi && (
								<span
									className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${on ? "border-[var(--text)] bg-[var(--text)] text-[var(--bg)]" : "border-[var(--text-40)]"}`}
								>
									{on && <Check size={10} strokeWidth={3} />}
								</span>
							)}
							<span className="min-w-0 flex-1">
								<span className={`text-[13px] ${on && !multi ? "font-medium" : ""}`}>
									{o.label}
								</span>
								{i === rec && (
									<span className="ml-1.5 text-[11px] text-[var(--text-40)]">{t("ask.recommended")}</span>
								)}
								{o.description && (
									<span className="block whitespace-pre-wrap text-[12px] text-[var(--text-40)]">
										{o.description}
									</span>
								)}
							</span>
							{!multi && on && (
								<Check size={13} className="mt-0.5 shrink-0 text-[var(--text-60)]" />
							)}
						</button>
					);
				})}
				<div
					className={`${row} ${draft.cursor === otherIdx ? "bg-[var(--ghost-hover)]" : ""}`}
					onMouseEnter={() => update({ cursor: otherIdx })}
				>
					<span className="w-4 shrink-0 pt-px text-right text-[12px] tabular-nums text-[var(--text-40)]">
						{otherIdx + 1}.
					</span>
					<input
						ref={inputRef}
						value={draft.custom}
						disabled={busy}
						onFocus={() => update({ cursor: otherIdx })}
						onChange={(e) => update({ custom: e.target.value })}
						placeholder={multi ? t("ask.notesOptional") : t("ask.otherLabel")}
						className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-40)]"
					/>
				</div>
			</div>
			<div className="mt-2 flex items-center gap-2">
				<span
					className="min-w-0 flex-1 text-[11px] text-[var(--text-40)]"
				>
					{isLast && missing.length > 0
						? t("ask.unanswered", {
								questions: missing
									.map((i) => t("ask.questionAria", { index: i + 1 }))
									.join(locale === "zh-CN" ? "、" : ", "),
							})
						: `${multi ? t("ask.hintMulti") : t("ask.hintSingle")}${total > 1 ? t("ask.hintSwitch") : ""}${t("ask.hintEnter", { action: isLast ? t("ask.hintSubmit") : t("ask.hintNext") })}${t("ask.hintEsc")}`}
				</span>
				<button type="button" disabled={busy} onClick={onCancel} className={ghostBtn}>
					{t("ask.skip")}
				</button>
				{total > 1 && (
					<button
						type="button"
						disabled={busy || current <= startIndex}
						onClick={() => goTo(current - 1)}
						className={ghostBtn}
					>
						{t("ask.prevQuestion")}
					</button>
				)}
				{isLast ? (
					<button
						type="button"
						disabled={busy || missing.length > 0}
						onClick={submitAll}
						className={primaryBtn}
					>
						{busy && <Loader2 size={12} className="animate-spin" />}
						{t("ask.submit")}
					</button>
				) : (
					<button type="button" disabled={busy} onClick={() => goTo(current + 1)} className={primaryBtn}>
						{t("ask.nextQuestion")}
					</button>
				)}
			</div>
		</div>
	);
}
