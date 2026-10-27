import { ArrowUp, CornerDownLeft, ExternalLink, MessageSquarePlus, Sparkles } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { relTime, sessionName } from "../../core/lib/format";
import { appendUnique, normalizeTranscript } from "../../core/normalize";
import { nav, paths } from "../../core/nav";
import type { PageProps } from "../../core/nav";
import { events } from "../../core/sse";
import { useSessions } from "../../core/stores/sessions";
import { STATUS_LABEL } from "../../core/types";
import type { Item, MobileSession, TranscriptPage } from "../../core/types";
import { BottomSheet, Chip, EmptyState, HeaderButton, Markdown, PageHeader, PullToRefresh, Spinner, toast } from "../../ui";
import { ActionButton, LoadGate, Loading } from "./PanelState";
import { useLayer, useLoad, useResync } from "./hooks";

import { loadUnsent, saveUnsent } from "../chat/lib/unsent";

export const HANDBACK_MARKER = "【回传整理】";
export const HANDBACK_PROMPT = `${HANDBACK_MARKER}请把我们在这个辅助对话里讨论并确定下来的内容，整理成一份可以交给主会话的结论。

要求：
1. 提取所有已达成的共识、最终方案与关键决定；
2. 保持简短精炼，分点说明，方便主会话快速了解上下文；
3. 直接输出结论内容，不要添加额外的寒暄或多余包装。`;
function findLastItemIndex<T>(arr: readonly T[], pred: (item: T) => boolean): number {
	for (let i = arr.length - 1; i >= 0; i--) {
		if (pred(arr[i])) return i;
	}
	return -1;
}


const q = encodeURIComponent;
const FETCH_DEBOUNCE_MS = 400;
const MAX_ROWS = 80;

export function SidechatPage({ route }: PageProps) {
	const id = route.params.id;
	const [thread, setThread] = useState<string | null>(null);
	const closeThread = useCallback(() => setThread(null), []);
	useLayer(thread !== null, closeThread);
	return thread ? (
		<ThreadView parentId={id} threadId={thread} onClose={closeThread} />
	) : (
		<ListView sessionId={id} onOpen={setThread} />
	);
}

/* ------------------------------------------------------------------ list */

function ListView({ sessionId, onOpen }: { sessionId: string; onOpen: (id: string) => void }) {
	const state = useLoad(
		async (signal) => {
			const rows = await api<MobileSession[]>("GET", `/sessions/${q(sessionId)}/sidechats`, undefined, { signal });
			return [...rows].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
		},
		[sessionId],
	);
	const taRef = useRef<HTMLTextAreaElement>(null);
	const [creating, setCreating] = useState(false);
	useResync(() => void state.reload(true));

	const create = async () => {
		const question = taRef.current?.value.trim() ?? "";
		if (!question) {
			toast("请输入问题", { kind: "error" });
			return;
		}
		setCreating(true);
		try {
			const info = await api<{ sessionId: string }>("POST", `/sessions/${q(sessionId)}/sidechats`, { question });
			void useSessions.getState().refresh();
			if (taRef.current) taRef.current.value = "";
			onOpen(info.sessionId);
		} catch (e) {
			toast(`发起失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="辅助对话" subtitle="不打断主会话的追问" />
			<PullToRefresh onRefresh={() => state.reload(true)}>
				<div className="border-b border-m-border p-3">
					<textarea
						ref={taRef}
						rows={3}
						placeholder="向这个会话发起一个辅助对话问题"
						className="w-full resize-none rounded-m-md border border-m-border bg-m-surface p-3 text-m-md text-m-text outline-none focus:border-m-accent"
					/>
					<div className="mt-2 flex justify-end">
						<ActionButton tone="primary" disabled={creating} onClick={() => void create()}>
							<MessageSquarePlus size={16} />
							发起辅助对话
						</ActionButton>
					</div>
				</div>
				<LoadGate state={state}>
					{(rows) =>
						rows.length === 0 ? (
							<EmptyState title="还没有辅助对话" />
						) : (
							<ul className="m-0 list-none p-0">
								{rows.map((s) => (
									<li key={s.id}>
										<button
											type="button"
											onClick={() => onOpen(s.id)}
											className="block min-h-14 w-full border-b border-m-border px-4 py-3 text-left active:bg-m-surface-hover"
										>
											<span className="flex items-center gap-2">
												<span className="min-w-0 flex-1 break-words text-m-md text-m-text">{sessionName(s)}</span>
												<span className="shrink-0 whitespace-nowrap text-m-xs text-m-text-3">{relTime(s.updatedAt)}</span>
											</span>
											<span className="mt-1 block">
												<Chip tone={s.status === "working" ? "accent" : "neutral"}>{STATUS_LABEL[s.status] ?? s.status}</Chip>
											</span>
										</button>
									</li>
								))}
							</ul>
						)
					}
				</LoadGate>
			</PullToRefresh>
		</div>
	);
}

/* ---------------------------------------------------------------- thread */

function ThreadView({ parentId, threadId, onClose }: { parentId: string; threadId: string; onClose: () => void }) {
	const session = useSessions((s) => s.byId[threadId]);
	const [items, setItems] = useState<Item[]>([]);
	const [pending, setPending] = useState<string[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cursor = useRef({ offset: 0, tail: null as string | null });
	const inflight = useRef(false);
	const again = useRef(false);
	const alive = useRef(true);
	const scroller = useRef<HTMLDivElement>(null);
	const stick = useRef(true);

	const [handbackOpen, setHandbackOpen] = useState(false);
	const [handbackDraft, setHandbackDraft] = useState("");
	const [handbackPhase, setHandbackPhase] = useState<"idle" | "summarizing" | "ready" | "error">("idle");
	const [handbackSending, setHandbackSending] = useState(false);

	const fetchThread = useCallback(async () => {
		if (inflight.current) {
			again.current = true;
			return;
		}
		inflight.current = true;
		try {
			const c = cursor.current;
			const page = await api<TranscriptPage>(
				"GET",
				`/sessions/${q(threadId)}/transcript?from=${c.offset}${c.tail ? `&tail=${q(c.tail)}` : ""}`,
			);
			if (!alive.current) return;
			const added = normalizeTranscript(page.items);
			setItems((prev) => appendUnique(page.reset ? [] : prev, added));
			cursor.current = { offset: page.nextOffset ?? c.offset, tail: page.tailId ?? null };
			const users = new Set(added.filter((i) => i.role === "user").map((i) => i.text.trim()));
			if (users.size) setPending((p) => p.filter((t) => !users.has(t.trim())));
			setError(null);
		} catch (e) {
			if (alive.current) setError(errorMessage(e, "加载失败"));
		} finally {
			inflight.current = false;
			if (alive.current) setLoaded(true);
			if (again.current && alive.current) {
				again.current = false;
				void fetchThread();
			}
		}
	}, [threadId]);
	const triggerSummarize = async () => {
		setHandbackPhase("summarizing");
		try {
			await api("POST", `/sessions/${q(threadId)}/prompt`, { text: HANDBACK_PROMPT });
			window.setTimeout(() => void fetchThread(), FETCH_DEBOUNCE_MS);
		} catch (e) {
			setHandbackPhase("error");
			toast(`整理失败：${errorMessage(e)}`, { kind: "error" });
		}
	};

	useEffect(() => {
		if (handbackPhase !== "summarizing") return;
		const markerIdx = findLastItemIndex(items, (it) => it.role === "user" && (it.text?.includes(HANDBACK_MARKER) ?? false));
		if (markerIdx >= 0) {
			const assistantAfter = items.slice(markerIdx + 1).find((it) => it.role === "assistant" && it.text);
			if (assistantAfter?.text) {
				setHandbackDraft(assistantAfter.text);
				if (session?.status !== "working") {
					setHandbackPhase("ready");
				}
			}
		}
	}, [items, handbackPhase, session?.status]);

	const openHandback = () => {
		if (items.length === 0) {
			toast("辅助对话暂无内容，请先提问", { kind: "error" });
			return;
		}
		setHandbackOpen(true);
		// If we haven't drafted yet, look for an existing marker response or prefill with the latest assistant message
		const markerIdx = findLastItemIndex(items, (it) => it.role === "user" && (it.text?.includes(HANDBACK_MARKER) ?? false));
		if (markerIdx >= 0) {
			const assistantAfter = items.slice(markerIdx + 1).find((it) => it.role === "assistant" && it.text);
			if (assistantAfter?.text) {
				setHandbackDraft(assistantAfter.text);
				setHandbackPhase("ready");
				return;
			}
		}
		const lastAssistant = [...items].reverse().find((it) => it.role === "assistant" && it.text)?.text ?? "";
		if (lastAssistant && !handbackDraft) {
			setHandbackDraft(lastAssistant);
			setHandbackPhase("ready");
		}
	};

	const insertIntoParent = () => {
		const title = session ? sessionName(session) : "辅助对话";
		const note = `[来自辅助对话：${title}]\n> ${handbackDraft.trim()}`;
		const prev = loadUnsent(parentId);
		const combined = prev ? `${prev}\n\n${note}` : note;
		saveUnsent(parentId, combined);
		setHandbackOpen(false);
		toast("已放进主会话输入框", { kind: "success" });
		nav.push(paths.chat(parentId));
	};

	const sendDirectToParent = async () => {
		setHandbackSending(true);
		try {
			const title = session ? sessionName(session) : "辅助对话";
			const note = `[来自辅助对话：${title}]\n\n${handbackDraft.trim()}`;
			await api("POST", `/sessions/${q(parentId)}/prompt`, { text: note });
			setHandbackOpen(false);
			toast("已成功回传给父会话", { kind: "success" });
			nav.push(paths.chat(parentId));
		} catch (e) {
			toast(`回传失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setHandbackSending(false);
		}
	};


	useEffect(() => {
		alive.current = true;
		void fetchThread();
		let timer = 0;
		const off = events.on("rpc", (d) => {
			if (d.sessionId !== threadId) return;
			window.clearTimeout(timer);
			timer = window.setTimeout(() => void fetchThread(), FETCH_DEBOUNCE_MS);
		});
		return () => {
			alive.current = false;
			off();
			window.clearTimeout(timer);
		};
	}, [threadId, fetchThread]);
	useResync(() => void fetchThread());

	// Keep pinned to the bottom unless the user scrolled up.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on content change
	useEffect(() => {
		const el = scroller.current;
		if (el && stick.current) el.scrollTop = el.scrollHeight;
	}, [items, pending]);

	const send = async (text: string): Promise<boolean> => {
		try {
			await api("POST", `/sessions/${q(threadId)}/prompt`, { text });
			setPending((p) => [...p, text]);
			stick.current = true;
			window.setTimeout(() => void fetchThread(), FETCH_DEBOUNCE_MS);
			return true;
		} catch (e) {
			toast(`发送失败：${errorMessage(e)}`, { kind: "error" });
			return false;
		}
	};

	const working = session?.status === "working";
	const visible = items.length > MAX_ROWS ? items.slice(-MAX_ROWS) : items;
	return (
		<>
			<div className="flex h-full flex-col bg-m-bg">
			<PageHeader
				title={session ? sessionName(session) : "辅助对话"}
				subtitle={working ? "运行中" : undefined}
				onBack={onClose}
				right={
					<>
						<button
							type="button"
							onClick={openHandback}
							className="mr-1 flex min-h-9 items-center gap-1 whitespace-nowrap rounded-m-pill border border-m-border px-2.5 text-m-xs font-medium text-m-accent active:bg-m-surface-hover"
						>
							<CornerDownLeft size={14} />
							回传
						</button>
						<HeaderButton
							icon={<ExternalLink size={20} />}
							label="打开完整会话"
							onClick={() => nav.push(paths.chat(threadId))}
						/>
					</>
				}
			/>
			<div
				ref={scroller}
				onScroll={(e) => {
					const el = e.currentTarget;
					stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
				}}
				className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
			>
				{!loaded && <Loading />}
				{loaded && error !== null && items.length === 0 && (
					<EmptyState title="加载失败" hint={error} action={<ActionButton onClick={() => void fetchThread()}>重试</ActionButton>} />
				)}
				{items.length > MAX_ROWS && (
					<div className="text-center text-m-xs text-m-text-3">仅显示最近 {MAX_ROWS} 条，完整记录请打开完整会话</div>
				)}
				{visible.map((it) => (
					<ThreadRow key={it.id} item={it} />
				))}
				{pending.map((t, i) => (
					<UserBubble key={`p${i}`} text={t} dim />
				))}
				{working && (
					<div className="flex items-center gap-2 text-m-sm text-m-text-3">
						<Spinner size={14} />
						<span className="whitespace-nowrap">思考中</span>
					</div>
				)}
			</div>
				<ThreadComposer onSend={send} />
			</div>
			<BottomSheet
				open={handbackOpen}
				onClose={() => setHandbackOpen(false)}
				title="回传给父会话"
				footer={
					<div className="flex gap-2 p-3">
						<ActionButton
							className="flex-1"
							disabled={!handbackDraft.trim() || handbackSending}
							onClick={insertIntoParent}
						>
							放入输入框
						</ActionButton>
						<ActionButton
							tone="primary"
							className="flex-1"
							disabled={!handbackDraft.trim() || handbackSending}
							onClick={() => void sendDirectToParent()}
						>
							{handbackSending ? <Spinner size={14} /> : "直接发送"}
						</ActionButton>
					</div>
				}
			>
				<div className="p-4">
					<div className="mb-2 flex items-center justify-between">
						<span className="text-m-sm text-m-text-2">结论摘要</span>
						<button
							type="button"
							disabled={handbackPhase === "summarizing" || working}
							onClick={() => void triggerSummarize()}
							className="flex min-h-8 items-center gap-1.5 rounded-m-pill border border-m-border px-3 text-m-xs font-medium text-m-accent active:bg-m-surface-hover disabled:opacity-50"
						>
							{handbackPhase === "summarizing" ? <Spinner size={12} /> : <Sparkles size={14} />}
							让 AI 整理结论
						</button>
					</div>
					{handbackPhase === "summarizing" && (
						<div className="mb-3 flex items-center gap-2 rounded-m-md bg-m-surface p-3 text-m-sm text-m-text-3">
							<Spinner size={16} />
							<span>辅助对话正在整理结论…</span>
						</div>
					)}
					<textarea
						value={handbackDraft}
						onChange={(e) => setHandbackDraft(e.target.value)}
						rows={6}
						placeholder="编辑要回传给父会话的结论内容..."
						className="w-full resize-none rounded-m-md border border-m-border bg-m-surface p-3 text-m-md text-m-text outline-none focus:border-m-accent"
					/>
					<p className="mt-2 text-m-xs text-m-text-3">
						点击「放入输入框」将作为引用草稿放入主会话输入框；点击「直接发送」将作为新消息直接发送给主会话。
					</p>
				</div>
			</BottomSheet>
		</>
	);
}

function UserBubble({ text, dim = false }: { text: string; dim?: boolean }) {
	return (
		<div className="flex justify-end">
			<div
				className={`max-w-[85%] whitespace-pre-wrap break-words rounded-m-lg bg-m-bubble-user-bg px-3 py-2 text-m-md text-m-bubble-user-text ${dim ? "opacity-60" : ""}`}
			>
				{text}
			</div>
		</div>
	);
}

const ThreadRow = memo(function ThreadRow({ item }: { item: Item }) {
	if (item.role === "user") return item.text ? <UserBubble text={item.text} /> : null;
	if (item.role !== "assistant") return null;
	return (
		<div className="space-y-2">
			{item.text && <Markdown text={item.text} />}
			{item.tools.map((t) => (
				<div
					key={t.id}
					className="flex items-center gap-2 rounded-m-md border border-m-border bg-m-surface px-3 py-2 text-m-xs text-m-text-2"
				>
					<span className="whitespace-nowrap font-medium text-m-text">{t.name}</span>
					<span className="min-w-0 break-all">{t.intent || argSummary(t.args)}</span>
				</div>
			))}
		</div>
	);
});

function argSummary(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const rec = args as Record<string, unknown>;
	for (const k of ["command", "path", "file_path", "pattern", "query", "url"]) {
		if (typeof rec[k] === "string") return rec[k] as string;
	}
	return "";
}

/** Uncontrolled composer: no React state per keystroke except the empty↔non-empty flag; IME-safe autosize. */
function ThreadComposer({ onSend }: { onSend: (text: string) => Promise<boolean> }) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);
	const raf = useRef(0);
	const [hasText, setHasText] = useState(false);
	const hasRef = useRef(false);
	const [sending, setSending] = useState(false);

	useEffect(() => () => cancelAnimationFrame(raf.current), []);

	const resize = () => {
		raf.current = 0;
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
	};
	const onInput = () => {
		const el = ref.current;
		if (!el) return;
		const has = el.value.trim().length > 0;
		if (has !== hasRef.current) {
			hasRef.current = has;
			setHasText(has);
		}
		if (!composing.current && !raf.current) raf.current = requestAnimationFrame(resize);
	};
	const submit = async () => {
		const el = ref.current;
		const text = el?.value.trim() ?? "";
		if (!el || !text || sending) return;
		setSending(true);
		const ok = await onSend(text);
		setSending(false);
		if (ok) {
			el.value = "";
			hasRef.current = false;
			setHasText(false);
			el.style.height = "auto";
		}
	};
	return (
		<div
			className="flex shrink-0 items-end gap-2 border-t border-m-border bg-m-composer-bg px-3 pt-2"
			style={{ paddingBottom: "calc(var(--m-safe-bottom) + 8px)" }}
		>
			<textarea
				ref={ref}
				rows={1}
				placeholder="继续追问"
				enterKeyHint="send"
				onInput={onInput}
				onCompositionStart={() => {
					composing.current = true;
				}}
				onCompositionEnd={() => {
					composing.current = false;
					onInput();
				}}
				className="max-h-40 min-h-11 flex-1 resize-none rounded-m-lg border border-m-border bg-m-surface px-3 py-2.5 text-m-md text-m-text outline-none focus:border-m-accent"
			/>
			<button
				type="button"
				aria-label="发送"
				disabled={!hasText || sending}
				onClick={() => void submit()}
				className="flex size-11 shrink-0 items-center justify-center rounded-m-pill bg-m-accent text-m-accent-text disabled:opacity-40"
			>
				{sending ? <Spinner size={18} /> : <ArrowUp size={20} />}
			</button>
		</div>
	);
}
