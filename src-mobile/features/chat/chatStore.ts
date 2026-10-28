/**
 * Per-page chat controller: owns transcript sync, live stream, pending UI, composer state and send logic.
 * State lives in a vanilla zustand store so React rows subscribe to exactly the slice they render
 * (streaming only changes `live`; the persisted rows keep identity).
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { api, errorMessage, LONG_TIMEOUT_MS, upload } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { buildPendingResponse, doneOption, nextMultiChoice, type PendingAnswer } from "../../core/pendingUi";
import { events } from "../../core/sse";
import { useSessions } from "../../core/stores/sessions";
import type { Item, PendingEntry, RpcFrame, TranscriptPage } from "../../core/types";
import { isDraftId } from "../../core/types";
import { confirm, toast } from "../../ui";
import { attention } from "./lib/attention";
import { isFinalReply, matchRequest, resolveRequest, type AskAnswer, type AskDriverState, type AskSpec } from "./lib/askDriver";
import { isBatchApprovable, showApproveAll } from "./lib/approvals";
import { createDebounce, DRAFT_ACTIVITY_DEBOUNCE_MS, draftActivityBody, draftBook } from "./lib/drafts";
import { attachmentBlocker, buildPrompt, buildPromptBody, sendIntent, type StreamBehavior } from "./lib/prompt";
import { loadSlashCommands, parseSlashInput, type SlashCmd } from "./lib/slash";
import { livePersisted, pruneLive, reduceFrame, type StreamState } from "./lib/stream";
import { EMPTY_TRANSCRIPT, mergePage, reconcileOptimistic, transcriptQuery, type OptimisticMsg, type TranscriptState } from "./lib/transcript";
import { buildBlocks, reuseBlocks, type Block } from "./lib/turns";
import { clearUnsent, loadUnsent } from "./lib/unsent";
import type { Goal } from "./components/GoalSheet";

export interface Attachment {
	id: number;
	name: string;
	isImage: boolean;
	url: string;
	status: "up" | "ok" | "err";
	path?: string;
	err?: string;
}

export interface LocalOut {
	id: number;
	name: string;
	text: string;
}

export interface ComposerState {
	live?: boolean;
	streaming?: boolean;
	model?: string | null;
	thinkingLevel?: string | null;
	planMode?: boolean;
	goal?: Goal | null;
	contextTokens?: number | null;
	contextWindow?: number | null;
	contextPercent?: number | null;
}

export interface ForkFrom {
	entryId: string;
	preview: string;
}

interface PromptDeliveryState {
	text: string;
	prompt: string;
	atts: Attachment[];
	phase: "sending" | "unknown";
}

const deliveryKey = (id: string) => `omp.mobile.delivery.${id}`;
function loadDelivery(id: string): PromptDeliveryState | null {
	try {
		const v = JSON.parse(localStorage.getItem(deliveryKey(id)) ?? "null");
		return v && typeof v.text === "string" && typeof v.prompt === "string" && Array.isArray(v.atts)
			? { ...v, phase: "unknown" } : null;
	} catch { return null; }
}

// Process restarts may reuse request IDs; a new arrival must not inherit an old tombstone.
const pendingIdentity = (entry: PendingEntry): string => JSON.stringify([entry.request?.id ?? "", entry.receivedAt ?? ""]);

export interface ChatState {
	loaded: boolean;
	transcript: TranscriptState;
	blocks: Block[];
	live: Item | null;
	working: boolean;
	optimistic: OptimisticMsg[];
	localOut: LocalOut[];
	pendings: PendingEntry[];
	cstate: ComposerState | null;
	atts: Attachment[];
	forkFrom: ForkFrom | null;
	compacting: boolean;
	delivery: PromptDeliveryState | null;
}

// Promise.withResolvers is missing on older iOS Safari, which this bundle targets.
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_BYTES = 20 * 1024 * 1024;
const DEAD = ["interrupted", "suspended", "error"];
export const isDeadStatus = (status: string | undefined, working: boolean): boolean => !working && !!status && DEAD.includes(status);

/** Markdown quote of a selected passage: every line prefixed with 「> 」 (blank lines kept as 「>」). */
export function quoteMarkdown(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.trim()
		.split("\n")
		.map((l) => (l.trim() ? `> ${l}` : ">"))
		.join("\n");
}

/** Hook the composer registers so the controller can read/restore the uncontrolled textarea. */
export interface ComposerHandle {
	get(): string;
	set(text: string, focus?: boolean): void;
	focus?: () => void;
	clear?: () => void;
}

interface AskReplayProgress {
	states: (AskDriverState | undefined)[];
	current: PendingEntry;
	/** A successful reply consumed this request; only fetching its successor is safe. */
	awaitingNext?: PendingEntry;
	/** Retained until POST is acknowledged or a newer pending id proves it was consumed. */
	attempt?: { requestId: string; qIndex: number; toggled: string[] };
}

export class ChatController {
	readonly store: StoreApi<ChatState>;
	composer: ComposerHandle | null = null;
	/** Last composer text, saved by the composer on unmount (it may unmount before the controller disposes). */
	lastText = "";
	/** Text the composer starts with (stash / unsent / handoff does not use it). */
	readonly initialText: string;
	private stream: StreamState = { live: null, working: false };
	private rafId = 0;
	private fetching = false;
	private fetchAgain = false;
	private fetchTimer: ReturnType<typeof setTimeout> | undefined;
	private stateTimer: ReturnType<typeof setInterval> | undefined;
	private lastSend = 0;
	private attSeq = 0;
	private optSeq = 0;
	private outSeq = 0;
	private clearLiveAfterFetch = false;
	private disposed = false;
	/** First prompt carried over from a draft; re-registered if this page is torn down before it persisted (StrictMode, fast back). */
	private handoffText: string | null = null;
	private offs: Array<() => void> = [];
	private touchDraft: ReturnType<typeof createDebounce>;
	private askProgress = new Map<string, AskReplayProgress>();
	private pendingSequence = 0;
	private answered = new Set<string>();

	constructor(readonly id: string) {
		const handoff = draftBook.takeHandoff(id);
		const stash = draftBook.restore(id);
		const status = useSessions.getState().byId[id]?.status;
		const opt: OptimisticMsg[] = handoff ? [{ id: `o${++this.optSeq}`, text: handoff.text, imageUrls: [] }] : [];
		const working = status === "working" || !!handoff;
		this.stream = { live: null, working };
		this.initialText = stash ? stash.text : loadUnsent(id);
		if (handoff) {
			this.lastSend = Date.now();
			this.handoffText = handoff.text;
		}
		this.store = createStore<ChatState>(() => ({
			loaded: false,
			transcript: EMPTY_TRANSCRIPT,
			blocks: [],
			live: null,
			working,
			optimistic: opt,
			localOut: [],
			pendings: [],
			cstate: null,
			atts: (stash?.atts as Attachment[] | undefined) ?? [],
			forkFrom: null,
			compacting: false,
			delivery: loadDelivery(id),
		}));
		this.touchDraft = createDebounce(() => this.draftActivity(true), DRAFT_ACTIVITY_DEBOUNCE_MS);
	}

	get state(): ChatState {
		return this.store.getState();
	}
	private set(p: Partial<ChatState>): void {
		this.store.setState(p);
	}

	/* ------------------------------------------------------------ lifecycle */

	start(): void {
		const draft = isDraftId(this.id);
		this.offs.push(
			events.on("rpc", (d) => {
				if (d && d.sessionId === this.id) this.onRpc(d.frame as RpcFrame);
			}),
			events.on("touch", (d) => {
				if (!d || !d.sessionId || d.sessionId === this.id) {
					this.scheduleFetch(150);
					void this.loadPendings();
				}
			}),
			events.on("resync", () => this.resync()),
			events.on("hello", () => this.resync()),
			useSessions.subscribe((s, prev) => {
				if (s.byId[this.id] !== prev.byId[this.id]) this.onSessionChanged();
			}),
		);
		if (!draft) void this.fetchTranscript();
		else this.set({ loaded: true });
		void this.loadPendings();
		void this.loadState();
		void loadSlashCommands(this.id).catch(() => {});
		this.stateTimer = setInterval(() => {
			if (!document.hidden) void this.loadState();
		}, 5000);
		if (draft && this.draftMeaningful()) this.draftActivity(true);
	}

	dispose(): void {
		this.disposed = true;
		for (const off of this.offs) off();
		this.offs = [];
		clearInterval(this.stateTimer);
		clearTimeout(this.fetchTimer);
		if (this.rafId) cancelAnimationFrame(this.rafId);
		this.touchDraft.cancel();
		const pendingHandoff = this.handoffText;
		if (pendingHandoff !== null && this.state.optimistic.some((o) => o.text === pendingHandoff)) {
			draftBook.handoff(this.id, this.id, pendingHandoff);
		}
		const { atts } = this.state;
		if (isDraftId(this.id)) {
			const text = this.composer?.get() ?? this.lastText;
			const meaningful = draftBook.stash(this.id, text, atts);
			this.draftActivity(false, meaningful);
		} else {
			for (const a of atts) if (a.url) URL.revokeObjectURL(a.url);
		}
	}

	/* ------------------------------------------------------------ drafts */

	private draftMeaningful(): boolean {
		return (this.composer?.get() ?? this.lastText ?? this.initialText).trim() !== "" || this.state.atts.length > 0;
	}
	private draftActivity(active: boolean, meaningful?: boolean): void {
		if (!isDraftId(this.id)) return;
		const m = meaningful ?? this.draftMeaningful();
		api("POST", `/sessions/${this.id}/draft-activity`, draftActivityBody(active, m)).catch(() => {});
	}
	/** Called on every edit; debounced so the first meaningful edit prewarms omp. */
	noteEdit(): void {
		if (isDraftId(this.id)) this.touchDraft.call();
	}

	/* ------------------------------------------------------------ transcript */

	private rebuild(t: TranscriptState): Block[] {
		return reuseBlocks(this.state.blocks, buildBlocks(t.items, t.stats));
	}

	async fetchTranscript(): Promise<void> {
		if (isDraftId(this.id) || this.disposed) return;
		if (this.fetching) {
			this.fetchAgain = true;
			return;
		}
		this.fetching = true;
		try {
			const page = await api<TranscriptPage>("GET", `/sessions/${this.id}/transcript?${transcriptQuery(this.state.transcript)}`);
			if (this.disposed) return;
			this.applyPage(page);
		} catch (e) {
			console.warn("[chat] transcript", e);
			if (!this.state.loaded) this.set({ loaded: true });
		} finally {
			this.fetching = false;
			if (this.fetchAgain) {
				this.fetchAgain = false;
				this.scheduleFetch(50);
			}
		}
	}

	private applyPage(page: TranscriptPage): void {
		const prev = this.state;
		const r = mergePage(prev.transcript, page);
		const optimistic = reconcileOptimistic(prev.optimistic, r.newUserTexts);
		let live = this.stream.live;
		if (this.clearLiveAfterFetch) {
			this.clearLiveAfterFetch = false;
			live = null;
		} else {
			live = pruneLive(r.state.items, live);
		}
		this.stream = { ...this.stream, live };
		if (!r.changed && optimistic === prev.optimistic && live === prev.live && prev.loaded) return;
		this.set({
			loaded: true,
			transcript: r.state,
			blocks: r.changed ? this.rebuild(r.state) : prev.blocks,
			optimistic,
			live,
		});
	}

	private scheduleFetch(ms: number): void {
		clearTimeout(this.fetchTimer);
		this.fetchTimer = setTimeout(() => void this.fetchTranscript(), ms);
	}

	/** Pull-to-refresh / resync: re-read everything from byte 0 and reconcile live state. */
	async refresh(): Promise<void> {
		this.stream = { ...this.stream, live: null };
		this.set({ live: null, transcript: { ...this.state.transcript, offset: 0, tailId: null } });
		await Promise.all([this.fetchTranscript(), this.loadState(), this.loadPendings(), useSessions.getState().refresh().catch(() => [])]);
	}

	/** SSE frames can be lost (suspended tab, server lag): rebuild live state from transcript + composer state. */
	private resync(): void {
		this.stream = { ...this.stream, live: null };
		this.set({ live: null });
		this.scheduleFetch(0);
		void this.loadState();
		void this.loadPendings();
	}

	/* ------------------------------------------------------------ live stream */

	private onRpc(frame: RpcFrame): void {
		if (!frame || typeof frame.type !== "string") return;
		if (frame.type.startsWith("extension_ui")) void this.loadPendings();
		const step = reduceFrame(this.stream, frame);
		if (!step.handled) return;
		let live = step.state.live;
		if (step.dropped) {
			// Terminal end: keep the streamed answer visible until the persisted row arrives.
			live = step.dropped;
			this.clearLiveAfterFetch = true;
		}
		this.stream = { live, working: step.state.working };
		if (step.refetch) this.scheduleFetch(250);
		if (step.reloadState) setTimeout(() => void this.loadState(), 300);
		if (step.turnEnded) attention("done");
		this.scheduleFlush();
	}

	/** Coalesce stream renders to at most one per animation frame (immediate when the page is hidden: rAF stalls). */
	private scheduleFlush(): void {
		if (this.rafId) return;
		const run = () => {
			this.rafId = 0;
			if (this.disposed) return;
			const { live, working } = this.stream;
			const s = this.state;
			if (s.live !== live || s.working !== working) this.set({ live, working });
		};
		if (typeof document !== "undefined" && document.hidden) run();
		else this.rafId = requestAnimationFrame(run);
	}

	private setWorking(working: boolean): void {
		this.stream = { ...this.stream, working };
		if (this.state.working !== working) this.set({ working });
	}

	private onSessionChanged(): void {
		const s = useSessions.getState().byId[this.id];
		if (s && s.status !== "working" && !this.stream.live && Date.now() - this.lastSend > 4000) this.setWorking(false);
		else if (s && s.status === "working") this.setWorking(true);
		void this.loadPendings();
	}

	/* ------------------------------------------------------------ composer state / pending */

	async loadState(): Promise<void> {
		try {
			const st = await api<ComposerState>("GET", `/sessions/${this.id}/composer-state`);
			if (this.disposed) return;
			const prev = this.state.cstate;
			if (st.thinkingLevel == null && prev?.thinkingLevel) st.thinkingLevel = prev.thinkingLevel;
			this.set({ cstate: st });
			if (st.streaming && !this.stream.working) this.setWorking(true);
			else if (!st.streaming && this.stream.working && !this.stream.live && Date.now() - this.lastSend > 4000) {
				const s = useSessions.getState().byId[this.id];
				if (!s || s.status !== "working") this.setWorking(false);
			}
		} catch (e) {
			console.warn("[chat] composer-state", e);
		}
	}

	patchState(p: Partial<ComposerState>): void {
		this.set({ cstate: { ...(this.state.cstate ?? {}), ...p } });
	}

	async loadPendings(): Promise<void> {
		if (isDraftId(this.id)) return;
		const sequence = ++this.pendingSequence;
		const s = useSessions.getState().byId[this.id];
		if (!s || !s.pending) {
			if (this.state.pendings.length) this.set({ pendings: [] });
			return;
		}
		try {
			const list = await api<PendingEntry[]>("GET", `/sessions/${this.id}/pending-ui`);
			if (this.disposed || sequence !== this.pendingSequence) return;
			const arr = (Array.isArray(list) ? list : []).filter((p) => !this.answered.has(pendingIdentity(p)));
			const before = this.state.pendings.length;
			this.set({ pendings: arr });
			if (arr.length > before) attention("approval");
		} catch (e) {
			console.warn("[chat] pending-ui", e);
		}
	}

	async respond(entry: PendingEntry, answer: PendingAnswer): Promise<void> {
		try {
			const body = buildPendingResponse(entry, answer);
			await api("POST", `/sessions/${this.id}/ui-respond`, { response: { ...body, type: "extension_ui_response" } });
			this.consumePending([entry]);
			await useSessions.getState().refresh().catch(() => []);
			await this.loadPendings();
		} catch (e) {
			toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
			throw e;
		}
	}

	/** Multi-select loop: flip each chosen label with one reply (the server re-asks after each), then press 「Done」. */
	async respondMulti(entry: PendingEntry, selected: readonly string[]): Promise<void> {
		let cur = entry;
		let toggled: string[] = [];
		try {
			for (let guard = 0; guard < 60; guard++) {
				const n = nextMultiChoice(cur, selected, toggled);
				if (!n) break;
				await api("POST", `/sessions/${this.id}/ui-respond`, {
					response: { ...buildPendingResponse(cur, { value: n.value }), type: "extension_ui_response" },
				});
				this.consumePending([cur]);
				toggled = n.toggled;
				const nextEntry = await this.waitNextPending(cur);
				if (!nextEntry) throw new Error("等待下一步超时");
				cur = nextEntry;
			}
			const done = doneOption(cur);
			if (!done) throw new Error("找不到「完成」选项");
			await api("POST", `/sessions/${this.id}/ui-respond`, {
				response: { ...buildPendingResponse(cur, { value: done }), type: "extension_ui_response" },
			});
			this.consumePending([cur]);
			await useSessions.getState().refresh().catch(() => []);
			await this.loadPendings();
		} catch (e) {
			toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
			throw e;
		}
	}

	/**
	 * Replay locally drafted answers of an `ask` call: omp asks one question per request, so every reply waits
	 * for the next request and answers it from `answers` until the last question is done. Throws (after a toast)
	 * when a request cannot be answered automatically; the card then offers 重试 from the current request.
	 */
	async answerAsk(spec: AskSpec, answers: readonly (AskAnswer | undefined)[], first: PendingEntry): Promise<void> {
		const kept = this.askProgress.get(spec.toolCallId);
		const progress: AskReplayProgress = kept ?? {
			states: answers.map((answer) => (answer ? { answer, toggled: [] } : undefined)),
			current: first,
		};
		this.askProgress.set(spec.toolCallId, progress);
		try {
			if (kept) {
				if (progress.awaitingNext) {
					const next = await this.waitNextPending(progress.awaitingNext);
					if (!next) throw new Error("等待下一题超时");
					progress.current = next;
					progress.awaitingNext = undefined;
				} else {
					// Refresh after a failed POST: it may have reached omp even if its response was lost.
					const list = await api<PendingEntry[]>("GET", `/sessions/${this.id}/pending-ui`);
					const current = (Array.isArray(list) ? list : []).find((p) => matchRequest(spec, p.request));
					if (!current) throw new Error("找不到当前待回答的问题");
					progress.current = current;
					const attempted = progress.attempt;
					if (attempted && current.request?.id !== attempted.requestId) {
						const state = progress.states[attempted.qIndex];
						if (state) progress.states[attempted.qIndex] = { ...state, toggled: attempted.toggled };
					}
					progress.attempt = undefined;
				}
				const current = matchRequest(spec, progress.current.request);
				if (!current) throw new Error("问题已变化，请刷新后重试");
				answers.forEach((answer, i) => {
					if (answer && i >= current.qIndex) progress.states[i] = { answer, toggled: progress.states[i]?.toggled ?? [] };
				});
			}
			for (let guard = 0; guard < 200; guard++) {
				const cur = progress.current;
				const m = matchRequest(spec, cur.request);
				if (!m) throw new Error("问题已变化，请刷新后重试");
				const q = spec.questions[m.qIndex];
				const st = progress.states[m.qIndex];
				const res = resolveRequest(q, m, st);
				if (res.kind !== "auto") throw new Error(`第 ${m.qIndex + 1} 题无法自动提交`);
				progress.attempt = { requestId: m.requestId, qIndex: m.qIndex, toggled: res.toggled };
				await api("POST", `/sessions/${this.id}/ui-respond`, {
					response: { ...buildPendingResponse(cur, { value: res.value }), type: "extension_ui_response" },
				});
				// Keep the ask card mounted until replay settles so busy/error state survives each reply.
				this.consumePending([cur], true);
				progress.attempt = undefined;
				if (st) progress.states[m.qIndex] = { ...st, toggled: res.toggled };
				if (isFinalReply(q, m, res.value) && m.qIndex === spec.questions.length - 1) break;
				progress.awaitingNext = cur;
				const next = await this.waitNextPending(cur);
				if (!next) throw new Error("等待下一题超时");
				progress.current = next;
				progress.awaitingNext = undefined;
			}
			this.askProgress.delete(spec.toolCallId);
			await useSessions.getState().refresh().catch(() => []);
			await this.loadPendings();
		} catch (e) {
			toast(`提交失败：${errorMessage(e)}`, { kind: "error" });
			await this.loadPendings();
			throw e;
		}
	}

	private async waitNextPending(prev: PendingEntry): Promise<PendingEntry | null> {
		const prevId = prev.request?.id;
		for (let i = 0; i < 20; i++) {
			await sleep(250);
			try {
				const list = await api<PendingEntry[]>("GET", `/sessions/${this.id}/pending-ui`);
				const next = (Array.isArray(list) ? list : []).find((e) => e.request?.id && e.request.id !== prevId);
				if (next) return next;
			} catch {
				/* retry */
			}
		}
		return null;
	}

	private consumePending(entries: readonly PendingEntry[], keepVisible = false): void {
		++this.pendingSequence;
		for (const entry of entries) if (entry.request?.id) this.answered.add(pendingIdentity(entry));
		if (!keepVisible) this.set({ pendings: this.state.pendings.filter((p) => !this.answered.has(pendingIdentity(p))) });
	}

	async approveAll(action: "approve" | "deny", seen = this.state.pendings): Promise<void> {
		if (!showApproveAll(seen)) return;
		const ids = seen.filter(isBatchApprovable).flatMap((p) => p.request?.id ? [p.request.id] : []);
		try {
			const r = await api<{ handled?: number; skipped?: number; handledIds?: string[] }>("POST", `/sessions/${this.id}/ui-respond-all`, { action, ids });
			this.consumePending(seen.filter((p) => r.handledIds?.includes(p.request?.id ?? "")));
			toast(`${action === "approve" ? "已允许" : "已拒绝"} ${r.handled ?? 0} 项${r.skipped ? `，${r.skipped} 项需手动处理` : ""}`, { kind: "success" });
			await useSessions.getState().refresh().catch(() => []);
			await this.loadPendings();
		} catch (e) {
			toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
		}
	}

	/* ------------------------------------------------------------ send / stop / slash */

	async stop(): Promise<void> {
		try {
			await api("POST", `/sessions/${this.id}/abort`);
			toast("已发送停止请求");
		} catch (e) {
			toast(`停止失败：${errorMessage(e)}`, { kind: "error" });
		}
		setTimeout(() => void this.loadState(), 600);
	}

	/** Returns true when the text was consumed (composer should already have been cleared by the caller on true). */
	async send(text: string, behavior: StreamBehavior): Promise<boolean> {
		if (this.state.delivery) {
			toast("上一条消息送达状态待确认，请先核对记录或恢复输入，勿直接重发", { kind: "error" });
			return false;
		}
		const s = this.state;
		const intent = sendIntent(text, s.atts.length, s.working);
		if (intent === "none") return false;
		if (intent === "stop") {
			// A double-tap on ↑ must not land on the ■ it just turned into.
			if (Date.now() - this.lastSend < 1200) return false;
			void this.stop();
			return false;
		}
		const blocker = attachmentBlocker(s.atts);
		if (blocker) {
			toast(blocker);
			return false;
		}
		const trimmed = text.trim();
		if (s.forkFrom && trimmed) {
			this.composer?.set("");
			await this.runCommand("fork", trimmed, text);
			return true;
		}
		if (intent === "slash") {
			const p = parseSlashInput(trimmed);
			if (p) {
				this.composer?.set("");
				await this.runCommand(p.name, p.args, text);
				return true;
			}
		}
		return this.sendPrompt(trimmed, behavior);
	}

	/** Explicit recovery is not proof of non-delivery; never resends automatically. */
	async resolveDelivery(restore: boolean): Promise<void> {
		const pending = this.state.delivery;
		if (!pending || pending.phase !== "unknown") return;
		if (!await confirm({ title: restore ? "恢复消息到输入框" : "已核对送达状态", message: "电脑可能已经收到此消息。请先核对会话记录；恢复后再次发送可能重复执行。", confirmText: restore ? "知晓风险，恢复输入" : "已核对，继续" })) return;
		if (this.disposed || this.state.delivery !== pending) return;
		// Keep the durable payload after restore until a new dispatch succeeds or the user acknowledges it.
		// Otherwise reloading immediately after recovery could lose attached file paths.
		if (!restore) {
			try { localStorage.removeItem(deliveryKey(this.id)); }
			catch { toast("无法保存恢复状态，请检查浏览器存储", { kind: "error" }); return; }
		}
		if (restore) {
			if (!this.composer) { toast("请等待输入框准备完成后重试", { kind: "error" }); return; }
			const cur = this.composer?.get() ?? this.lastText;
			this.composer?.set(cur ? `${pending.text}\n${cur}` : pending.text);
			this.set({ atts: [...pending.atts.map((a) => ({ ...a, id: ++this.attSeq })), ...this.state.atts] });
		} else {
			for (const a of pending.atts) if (a.url) URL.revokeObjectURL(a.url);
		}
		this.set({ delivery: null });
	}

	private async sendPrompt(text: string, behavior: StreamBehavior): Promise<boolean> {
		const id = this.id;
		const wasWorking = this.state.working;
		const prompt = buildPrompt(text, this.state.atts);
		const savedAtts = this.state.atts;
		const delivery: PromptDeliveryState = { text, prompt, atts: savedAtts, phase: "sending" };
		// Persist before dispatch: a reload while awaiting HTTP is ambiguous too.
		try { localStorage.setItem(deliveryKey(id), JSON.stringify({ ...delivery, atts: savedAtts.map((a) => ({ ...a, url: "" })) })); }
		catch { toast("无法保存发送状态，消息尚未发送，请检查浏览器存储", { kind: "error" }); return false; }
		this.set({ delivery });
		const opt: OptimisticMsg = { id: `o${++this.optSeq}`, text: prompt, imageUrls: savedAtts.filter((a) => a.isImage && a.url).map((a) => a.url) };
		this.composer?.set("");
		clearUnsent(id);
		this.lastSend = Date.now();
		this.stream = { ...this.stream, working: true };
		this.set({ atts: [], optimistic: [...this.state.optimistic, opt], working: true });
		let r: { sessionId?: string };
		try {
			r = await api<{ sessionId?: string }>("POST", `/sessions/${id}/prompt-ex`, buildPromptBody(prompt, wasWorking, behavior));
		} catch (e) {
			// HTTP failure is ambiguous even when the server reports a validation-like error.
			this.stream = { ...this.stream, working: wasWorking };
			this.set({ delivery: { ...delivery, phase: "unknown" }, optimistic: this.state.optimistic.filter((o) => o.id !== opt.id), working: wasWorking });
			toast(`送达状态未知：${errorMessage(e)}。请核对记录后再决定是否重发`, { kind: "error" });
			return true;
		}
		try { localStorage.removeItem(deliveryKey(id)); }
		catch { toast("消息已送达，但无法清理本地发送记录。刷新后请先核对，勿盲目重发", { kind: "error" }); }
		this.set({ delivery: null });
		if (r && r.sessionId && r.sessionId !== id) {
			draftBook.handoff(id, r.sessionId, prompt);
			useSessions.getState().refresh().catch(() => {});
			if (!this.disposed) nav.replace(paths.chat(r.sessionId));
			return true;
		}
		for (const a of savedAtts) if (a.url) URL.revokeObjectURL(a.url);
		this.scheduleFetch(300);
		return true;
	}

	/** Execute `/name args` through the server: shows `output` locally, follows `sessionId` for /new and /fork. */
	async runCommand(name: string, args: string, restore?: string): Promise<void> {
		const id = this.id;
		this.lastSend = Date.now();
		const fork = name === "fork" ? this.state.forkFrom : null;
		const body: Record<string, unknown> = { name, args: args || undefined };
		if (fork) body.entryId = fork.entryId;
		try {
			const r = await api<{ output?: string; sessionId?: string; forwarded?: boolean }>("POST", `/sessions/${id}/slash`, body);
			if (r.output && !this.disposed) this.set({ localOut: [...this.state.localOut, { id: ++this.outSeq, name, text: r.output }] });
			if (r.forwarded) {
				this.setWorking(true);
				this.scheduleFetch(300);
			}
			if (fork) this.set({ forkFrom: null });
			if (r.sessionId && r.sessionId !== id) {
				if (isDraftId(id)) nav.replace(paths.chat(r.sessionId));
				else nav.push(paths.chat(r.sessionId));
			}
			else if (!r.output && !r.forwarded) toast(`/${name} 已执行`);
			if (!this.disposed) void this.loadState();
			useSessions.getState().refresh().catch(() => {});
		} catch (e) {
			if (!this.disposed && restore !== undefined) this.composer?.set(restore);
			toast(`/${name}：${errorMessage(e)}`, { kind: "error" });
		}
	}

	async compact(): Promise<void> {
		if (this.state.compacting) return;
		this.set({ compacting: true });
		try {
			await api("POST", `/sessions/${this.id}/slash`, { name: "compact" }, { timeoutMs: LONG_TIMEOUT_MS });
			toast("上下文压缩完成", { kind: "success" });
			this.scheduleFetch(200);
			void this.loadState();
		} catch (e) {
			toast(`压缩失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			if (!this.disposed) this.set({ compacting: false });
		}
	}

	async resume(): Promise<void> {
		try {
			await api("POST", `/sessions/${this.id}/resume`);
			await useSessions.getState().refresh();
		} catch (e) {
			toast(`恢复失败：${errorMessage(e)}`, { kind: "error" });
		}
	}

	/** Insert a selected passage as a markdown quote (every line prefixed) at the end of the composer. */
	stageAnnotation(quote: string, comment?: string): void {
		const block = quoteMarkdown(quote);
		const formatted = comment?.trim() ? `${block}\n\n${comment.trim()}` : `${block}\n\n`;
		const cur = this.composer?.get() ?? "";
		const next = cur ? `${cur.replace(/\s+$/, "")}\n\n${formatted}` : formatted;
		this.composer?.set(next, true);
		this.composer?.focus?.();
	}

	focusComposer(): void {
		this.composer?.focus?.();
	}

	/* ------------------------------------------------------------ message actions */

	retry(): void {
		void this.runCommand("retry", "");
	}
	editResend(text: string): void {
		this.set({ forkFrom: null });
		this.composer?.set(text, true);
	}
	forkFrom(entryId: string, preview: string): void {
		this.set({ forkFrom: { entryId, preview } });
		this.composer?.set("", true);
	}
	cancelFork(): void {
		this.set({ forkFrom: null });
	}

	/* ------------------------------------------------------------ attachments */

	addFiles(files: readonly File[], forceImage = false): void {
		for (const f of files) {
			if (f.size > MAX_BYTES) {
				toast(`「${f.name}」超过 20MB 上限，无法上传`);
				continue;
			}
			const isImage = forceImage || f.type.startsWith("image/");
			const att: Attachment = {
				id: ++this.attSeq,
				name: f.name || (isImage ? "image.jpg" : "file"),
				isImage,
				url: isImage ? URL.createObjectURL(f) : "",
				status: "up",
			};
			this.set({ atts: [...this.state.atts, att] });
			this.noteEdit();
			upload<{ path: string }>(`/sessions/${this.id}/upload`, f, { name: att.name })
				.then((r) => this.patchAtt(att.id, { status: "ok", path: r.path }))
				.catch((e: unknown) => {
					this.patchAtt(att.id, { status: "err", err: errorMessage(e) });
					toast(`上传失败：${errorMessage(e)}`, { kind: "error" });
				});
		}
	}
	private patchAtt(id: number, p: Partial<Attachment>): void {
		if (this.disposed && !isDraftId(this.id)) return;
		this.set({ atts: this.state.atts.map((a) => (a.id === id ? { ...a, ...p } : a)) });
	}
	removeAtt(id: number): void {
		const a = this.state.atts.find((x) => x.id === id);
		if (a?.url) URL.revokeObjectURL(a.url);
		this.set({ atts: this.state.atts.filter((x) => x.id !== id) });
		this.noteEdit();
	}

	slashCommands(): Promise<SlashCmd[]> {
		return loadSlashCommands(this.id);
	}

	/** True when the live row's text is already persisted (used by tests/bench). */
	livePersisted(): boolean {
		return livePersisted(this.state.transcript.items, this.state.live);
	}
}
