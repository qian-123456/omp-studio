import { Camera, CornerDownLeft, ExternalLink, FileText, ImagePlus, MessagesSquare, Paperclip, RefreshCw, Sparkles, Wrench, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, upload } from "../../core/api";
import { imageFromBlob } from "../../core/lib/images";
import { relTime, sessionName } from "../../core/lib/format";
import { appendUnique, normalizeTranscript } from "../../core/normalize";
import { nav, paths } from "../../core/nav";
import type { PageProps } from "../../core/nav";
import { events } from "../../core/sse";
import { useSessions } from "../../core/stores/sessions";
import { STATUS_LABEL } from "../../core/types";
import type { Item, MobileSession, TranscriptPage } from "../../core/types";
import {
	BottomSheet,
	Button,
	EmptyState,
	IconButton,
	inputCls,
	ListGroup,
	ListRow,
	Markdown,
	PageHeader,
	PullToRefresh,
	toast,
} from "../../ui";
import { loadUnsent, saveUnsent } from "../chat/lib/unsent";
import { LoadGate, Loading } from "./PanelState";
import { useLayer, useLoad, useResync } from "./hooks";
import type { Attachment } from "../chat/chatStore";
import { ComposerCapsule } from "../chat/components/ComposerCapsule";
import type { ComposerApi } from "../chat/components/ComposerCapsule";
import { ActionTile } from "../chat/components/Composer";
import { attachmentBlocker, buildPrompt } from "../chat/lib/prompt";
import { WorkspacePanelBar } from "./WorkspacePanelBar";

type SidechatImage = { mime: string; data: string };
type SidechatMessage = { text: string; imagePaths: string[]; images: SidechatImage[] };
type SidechatAttachment = Attachment & { file: File; image?: SidechatImage };

export const HANDBACK_MARKER = "【回传整理】";
export const HANDBACK_PROMPT = `${HANDBACK_MARKER}请把我们在这个辅助对话里讨论并确定下来的内容，整理成一份可以交给主会话的结论。

要求：
1. 提取所有已达成的共识、最终方案与关键决定；
2. 保持简短精炼，分点说明，方便主会话快速了解上下文；
3. 直接输出结论内容，不要添加额外的寒暄或多余包装。`;

/** sessionStorage key prefix (+ parent session id) of a quote handed over by a thread annotation. */
export const SIDECHAT_DRAFT_PREFIX = "omp:sidechat-draft:";

/** Text of the first assistant reply after the latest handback request, if any. */
function handbackReply(items: readonly Item[]): string | null {
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i];
		if (it.role === "user" && it.text?.includes(HANDBACK_MARKER)) {
			return items.slice(i + 1).find((x) => x.role === "assistant" && x.text)?.text ?? null;
		}
	}
	return null;
}

const q = encodeURIComponent;
const FETCH_DEBOUNCE_MS = 400;
const MAX_ROWS = 80;
const ICON = { size: 22, strokeWidth: 1.75 } as const;

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
	useResync(() => void state.reload(true));
	// A thread annotation (「批注到辅助对话」) hands its quote over through sessionStorage.
	const draftKey = `${SIDECHAT_DRAFT_PREFIX}${sessionId}`;
	const [draft] = useState(() => sessionStorage.getItem(draftKey) ?? "");
	useEffect(() => {
		sessionStorage.removeItem(draftKey);
	}, [draftKey]);

	const create = async ({ text: question, imagePaths }: SidechatMessage): Promise<boolean> => {
		try {
			const info = await api<{ sessionId: string }>("POST", `/sessions/${q(sessionId)}/sidechats`, { question, imagePaths });
			void useSessions.getState().refresh();
			onOpen(info.sessionId);
			return true;
		} catch (e) {
			toast(`发起失败：${errorMessage(e)}`, { kind: "error" });
			return false;
		}
	};

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="辅助对话" subtitle="不打断主对话的追问" />
			<WorkspacePanelBar sessionId={sessionId} current="sidechat" />
			<PullToRefresh onRefresh={() => state.reload(true)}>
				<LoadGate state={state}>
					{(rows) =>
						rows.length === 0 ? (
							<EmptyState
								icon={<MessagesSquare {...ICON} />}
								title="还没有辅助对话"
								hint="在下面问一个问题，主对话会继续它自己的工作"
							/>
						) : (
							<div className="pt-2 pb-4">
								<ListGroup>
									{rows.map((s) => (
										<ListRow
											key={s.id}
											icon={<MessagesSquare {...ICON} />}
											title={sessionName(s)}
											subtitle={
												<span className="inline-flex items-center gap-1.5">
													{s.status === "working" && <span aria-hidden className="m-pulse h-2 w-2 rounded-m-pill bg-m-accent" />}
													<span className="whitespace-nowrap">{STATUS_LABEL[s.status] ?? s.status}</span>
													<span aria-hidden>·</span>
													<span className="whitespace-nowrap">{relTime(s.updatedAt)}</span>
												</span>
											}
											onClick={() => onOpen(s.id)}
										/>
									))}
								</ListGroup>
							</div>
						)
					}
				</LoadGate>
			</PullToRefresh>
			<Composer sessionId={sessionId} placeholder="问一个问题，开始辅助对话" onSend={create} initialText={draft} />
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
	const fetchTimer = useRef(0);
	const scroller = useRef<HTMLDivElement>(null);
	const stick = useRef(true);

	const [handbackOpen, setHandbackOpen] = useState(false);
	const [handbackDraft, setHandbackDraft] = useState("");
	const [summarizing, setSummarizing] = useState(false);
	const [summarySettled, setSummarySettled] = useState(false);
	const summaryRun = useRef<"idle" | "running" | "terminal" | "settling">("idle");
	const [handbackSending, setHandbackSending] = useState(false);

	const fetchThread = useCallback(async () => {
		if (inflight.current) {
			again.current = true;
			return;
		}
		inflight.current = true;
		if (summaryRun.current === "terminal") summaryRun.current = "settling";
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
			} else if (alive.current && summaryRun.current === "settling") {
				// Read the final transcript before releasing the editable handback draft.
				setSummarySettled(true);
			}
		}
	}, [threadId]);
	const scheduleFetch = useCallback(() => {
		window.clearTimeout(fetchTimer.current);
		if (!alive.current || document.visibilityState === "hidden") return;
		fetchTimer.current = window.setTimeout(() => void fetchThread(), FETCH_DEBOUNCE_MS);
	}, [fetchThread]);

	const working = session?.status === "working";

	const triggerSummarize = async () => {
		summaryRun.current = "running";
		setSummarySettled(false);
		setSummarizing(true);
		try {
			await api("POST", `/sessions/${q(threadId)}/prompt`, { text: HANDBACK_PROMPT });
			scheduleFetch();
		} catch (e) {
			summaryRun.current = "idle";
			setSummarizing(false);
			toast(`整理失败：${errorMessage(e)}`, { kind: "error" });
		}
	};

	// A terminal run can finish without text; idle/background continuations cannot finish the summary.
	useEffect(() => {
		if (!summarizing) return;
		const reply = handbackReply(items);
		if (reply) setHandbackDraft(reply);
		if (summarySettled) {
			summaryRun.current = "idle";
			setSummarizing(false);
		}
	}, [items, summarizing, summarySettled]);

	const openHandback = () => {
		setHandbackOpen(true);
		if (handbackDraft) return;
		const reply = handbackReply(items);
		if (reply) {
			setHandbackDraft(reply);
			return;
		}
		// No conclusion yet: ask the side chat to write one.
		if (!working) void triggerSummarize();
	};

	const handbackTitle = session ? sessionName(session) : "辅助对话";
	const insertIntoParent = () => {
		const note = `[来自辅助对话：${handbackTitle}]\n> ${handbackDraft.trim()}`;
		const prev = loadUnsent(parentId);
		saveUnsent(parentId, prev ? `${prev}\n\n${note}` : note);
		setHandbackOpen(false);
		toast("已放进主对话输入框", { kind: "success" });
		nav.push(paths.chat(parentId));
	};

	const sendDirectToParent = async () => {
		setHandbackSending(true);
		try {
			const note = `[来自辅助对话：${handbackTitle}]\n\n${handbackDraft.trim()}`;
			await api("POST", `/sessions/${q(parentId)}/prompt`, { text: note });
			setHandbackOpen(false);
			toast("已发回主对话", { kind: "success" });
			nav.push(paths.chat(parentId));
		} catch (e) {
			toast(`发送失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setHandbackSending(false);
		}
	};

	useEffect(() => {
		alive.current = true;
		void fetchThread();
		const off = events.on("rpc", (d) => {
			if (d.sessionId !== threadId) return;
			if (summaryRun.current === "running" && d.frame.type === "agent_end" && d.frame.isTerminal !== false) {
				summaryRun.current = "terminal";
			}
			scheduleFetch();
		});
		const onVisibility = () => {
			window.clearTimeout(fetchTimer.current);
			if (document.visibilityState === "visible") void fetchThread();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			alive.current = false;
			off();
			window.clearTimeout(fetchTimer.current);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [threadId, fetchThread, scheduleFetch]);
	useResync(() => void fetchThread());

	// Keep pinned to the bottom unless the user scrolled up.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on content change
	useEffect(() => {
		const el = scroller.current;
		if (el && stick.current) el.scrollTop = el.scrollHeight;
	}, [items, pending]);

	const send = async ({ text, images }: SidechatMessage): Promise<boolean> => {
		try {
			await api("POST", `/sessions/${q(threadId)}/prompt-ex`, { text, images, ...(working ? { streamingBehavior: "followUp" } : {}) });
			setPending((p) => [...p, text]);
			stick.current = true;
			scheduleFetch();
			return true;
		} catch (e) {
			toast(`发送失败：${errorMessage(e)}`, { kind: "error" });
			return false;
		}
	};

	const visible = items.length > MAX_ROWS ? items.slice(-MAX_ROWS) : items;
	return (
		<>
			<div className="flex h-full flex-col bg-m-bg">
				<PageHeader
					title="辅助对话"
					subtitle={working ? <span className="m-shimmer whitespace-nowrap">正在回复</span> : "独立旁聊"}
					onBack={onClose}
					right={
						<div className="flex items-center gap-1">
							{items.length > 0 && <IconButton variant="tinted" icon={<CornerDownLeft size={20} strokeWidth={1.75} />} label="整理结论发回主对话" onClick={openHandback} />}
							<IconButton variant="filled" icon={<ExternalLink size={20} strokeWidth={1.75} />} label="打开完整会话" onClick={() => nav.push(paths.chat(threadId))} />
						</div>
					}
				/>
				<WorkspacePanelBar sessionId={parentId} current="sidechat" />
				<div
					ref={scroller}
					onScroll={(e) => {
						const el = e.currentTarget;
						stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
					}}
					className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pt-2 pb-4"
				>
					<h1 className="m-selectable text-m-lg font-medium break-words text-m-text">{handbackTitle}</h1>
					{!loaded && <Loading />}
					{loaded && error !== null && items.length === 0 && (
						<EmptyState title="加载失败" hint={error} action={<Button onClick={() => void fetchThread()}>重试</Button>} />
					)}
					{items.length > MAX_ROWS && (
						<div className="text-center text-m-xs text-m-text-3">只显示最近 {MAX_ROWS} 条，完整记录请打开完整会话</div>
					)}
					{visible.map((it) => (
						<ThreadRow key={it.id} item={it} />
					))}
					{pending.map((t, i) => (
						<UserBubble key={`p${i}`} text={t} dim />
					))}
					{working && <div className="m-shimmer text-m-sm text-m-text-3">思考中</div>}
				</div>
				<Composer sessionId={threadId} placeholder="继续追问" onSend={send} working={working} onStop={async () => {
					try { await api("POST", `/sessions/${q(threadId)}/abort`); }
					catch (e) { toast(`停止失败：${errorMessage(e)}`, { kind: "error" }); }
				}} />
			</div>
			<BottomSheet
				open={handbackOpen}
				onClose={() => setHandbackOpen(false)}
				title="发回主对话"
				footer={
					<div className="flex gap-2 px-4 pt-2 pb-3">
						<Button
							variant="tonal"
							className="flex-1"
							disabled={!handbackDraft.trim() || handbackSending || summarizing}
							onClick={insertIntoParent}
						>
							放进输入框
						</Button>
						<Button
							variant="primary"
							className="flex-1"
							busy={handbackSending}
							disabled={!handbackDraft.trim() || summarizing}
							onClick={() => void sendDirectToParent()}
						>
							直接发送
						</Button>
					</div>
				}
			>
				<div className="px-4 pb-2">
					<div className="mb-3 flex items-center justify-between gap-3 px-1">
						<span className="text-m-xs font-medium whitespace-nowrap text-m-text-3">结论</span>
						<Button
							variant="tonal"
							icon={<Sparkles size={16} strokeWidth={1.75} />}
							busy={summarizing}
							disabled={working && !summarizing}
							onClick={() => void triggerSummarize()}
						>
							{handbackDraft ? "重新整理" : "让 AI 整理"}
						</Button>
					</div>
					{summarizing && !handbackDraft && <div className="m-shimmer mb-3 px-1 text-m-sm text-m-text-3">正在整理结论</div>}
					<textarea
						value={handbackDraft}
						onChange={(e) => setHandbackDraft(e.target.value)}
						rows={7}
						aria-label="结论"
						placeholder="要发回主对话的结论"
						className={`${inputCls} block resize-none rounded-m-lg`}
					/>
					<p className="px-1 pt-2 text-m-xs text-m-text-3">「放进输入框」只放进主对话的草稿，不会发送；「直接发送」会立刻发给主对话。</p>
				</div>
			</BottomSheet>
		</>
	);
}

function UserBubble({ text, dim = false }: { text: string; dim?: boolean }) {
	return (
		<div className="flex justify-end">
			<div
				className={`m-selectable max-w-[85%] rounded-m-lg bg-m-bubble-user-bg px-[18px] py-3 text-m-md break-words whitespace-pre-wrap text-m-bubble-user-text ${dim ? "opacity-60" : ""}`}
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
			{item.tools.map((t) => (
				<div key={t.id} className="flex items-start gap-2 text-m-sm text-m-text-3">
					<Wrench size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
					<span className="min-w-0 break-all">
						<span className="text-m-text-2">{t.name}</span> {t.intent || argSummary(t.args)}
					</span>
				</div>
			))}
			{item.text && (
				<div className="m-selectable text-m-body">
					<Markdown text={item.text} />
				</div>
			)}
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

/** Child-session adapter: shared IME/voice capsule, real uploads, and no main-chat store mutations. */
function Composer({ sessionId, placeholder, onSend, initialText = "", working = false, onStop }: {
	sessionId: string;
	placeholder: string;
	onSend: (message: SidechatMessage) => Promise<boolean>;
	initialText?: string;
	working?: boolean;
	onStop?: () => Promise<void>;
}) {
	const apiRef = useRef<ComposerApi | null>(null);
	const [sending, setSending] = useState(false);
	const sendingRef = useRef(false);
	const [plusOpen, setPlusOpen] = useState(false);
	const [atts, setAtts] = useState<SidechatAttachment[]>([]);
	const attsRef = useRef(atts);
	attsRef.current = atts;
	const nextId = useRef(0);
	const alive = useRef(true);
	const uploads = useRef(new Map<number, AbortController>());
	const fileAny = useRef<HTMLInputElement>(null);
	const fileCamera = useRef<HTMLInputElement>(null);
	const fileGallery = useRef<HTMLInputElement>(null);
	useEffect(() => {
		alive.current = true;
		if (initialText) apiRef.current?.focus();
		return () => {
			alive.current = false;
			for (const ctl of uploads.current.values()) ctl.abort();
			uploads.current.clear();
			for (const att of attsRef.current) if (att.url) URL.revokeObjectURL(att.url);
		};
	}, [initialText]);
	const patchAtt = (id: number, patch: Partial<SidechatAttachment>) => {
		if (alive.current) setAtts((prev) => prev.map((att) => att.id === id ? { ...att, ...patch } : att));
	};
	const uploadAtt = async (att: SidechatAttachment) => {
		const ctl = new AbortController();
		uploads.current.set(att.id, ctl);
		patchAtt(att.id, { status: "up", err: undefined });
		try {
			let image: SidechatImage | undefined;
			if (att.isImage) image = await imageFromBlob(att.file);
			if (ctl.signal.aborted) return;
			const result = await upload<{ path: string }>(`/sessions/${q(sessionId)}/upload`, att.file, { name: att.name, signal: ctl.signal });
			patchAtt(att.id, { status: "ok", path: result.path, image });
		} catch (e) {
			if (!ctl.signal.aborted) { patchAtt(att.id, { status: "err", err: errorMessage(e) }); toast(`上传失败：${errorMessage(e)}`, { kind: "error" }); }
		} finally { if (uploads.current.get(att.id) === ctl) uploads.current.delete(att.id); }
	};
	const addFiles = (files: readonly File[]) => {
		for (const file of files) {
			if (file.size > 20 * 1024 * 1024) { toast(`「${file.name}」超过 20MB 上限，无法上传`, { kind: "error" }); continue; }
			const isImage = file.type.startsWith("image/");
			const att: SidechatAttachment = { id: ++nextId.current, name: file.name || "附件", isImage, url: isImage ? URL.createObjectURL(file) : "", status: "up", file };
			setAtts((prev) => [...prev, att]);
			void uploadAtt(att);
		}
	};
	const pickFiles = (input: HTMLInputElement) => {
		const files = Array.from(input.files ?? []);
		input.value = "";
		addFiles(files);
	};
	const removeAtt = (att: SidechatAttachment) => {
		uploads.current.get(att.id)?.abort();
		uploads.current.delete(att.id);
		if (att.url) URL.revokeObjectURL(att.url);
		setAtts((prev) => prev.filter((item) => item.id !== att.id));
	};
	const submit = async (text: string) => {
		if (sendingRef.current) return;
		const blocker = attachmentBlocker(atts);
		if (blocker) { toast(blocker, { kind: "error" }); return; }
		const prompt = buildPrompt(text.trim(), atts);
		if (!prompt) return;
		sendingRef.current = true;
		setSending(true);
		try {
			const ok = await onSend({ text: prompt, imagePaths: atts.flatMap((att) => att.isImage && att.path ? [att.path] : []), images: atts.flatMap((att) => att.image ? [att.image] : []) });
			if (ok && alive.current) {
				if (apiRef.current?.get() === text) apiRef.current.clear();
				for (const att of atts) if (att.url) URL.revokeObjectURL(att.url);
				setAtts((prev) => prev.filter((att) => !atts.some((sent) => sent.id === att.id)));
			}
		} finally { sendingRef.current = false; if (alive.current) setSending(false); }
	};
	const attachments = atts.length > 0 ? (
		<div className="m-noscrollbar flex gap-2 overflow-x-auto pb-2">
			{atts.map((att) => <div key={att.id} className="flex w-52 shrink-0 items-center gap-2 rounded-m-md bg-m-surface p-2">
				{att.isImage ? <img src={att.url} alt={att.name} className="h-12 w-12 rounded-m-sm object-cover" /> : <FileText size={24} className="shrink-0 text-m-text-2" />}
				<div className="min-w-0 flex-1"><span className="block break-all text-m-xs text-m-text">{att.name}</span><span role="status" className={`block text-m-xs ${att.status === "err" ? "text-m-danger" : "text-m-text-3"}`}>{att.status === "up" ? "上传中" : att.status === "err" ? att.err : "已上传"}</span></div>
				{att.status === "err" && <IconButton label={`重试上传 ${att.name}`} icon={<RefreshCw size={18} />} disabled={sending} onClick={() => void uploadAtt(att)} />}
				<IconButton label={`移除 ${att.name}`} icon={<X size={18} />} disabled={sending} onClick={() => removeAtt(att)} />
			</div>)}
		</div>
	) : undefined;
	return (
		<div className="shrink-0 px-4 pt-1" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 8px)" }}>
			<ComposerCapsule apiRef={apiRef} placeholder={placeholder} initialText={initialText} busy={sending} working={working} hasExtra={atts.length > 0} top={attachments} onPlus={() => setPlusOpen(true)} onSend={(text) => void submit(text)} onStop={onStop ? () => void onStop() : undefined} />
			<input ref={fileAny} type="file" multiple hidden onChange={(e) => pickFiles(e.currentTarget)} />
			<input ref={fileCamera} type="file" accept="image/png,image/jpeg,image/gif,image/webp" capture="environment" hidden onChange={(e) => pickFiles(e.currentTarget)} />
			<input ref={fileGallery} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => pickFiles(e.currentTarget)} />
			<BottomSheet open={plusOpen} onClose={() => setPlusOpen(false)} title="添加附件">
				<div className="grid grid-cols-3 gap-3 px-4 pb-4">
					<ActionTile icon={<Paperclip size={24} />} label="文件" disabled={sending} onClick={() => { setPlusOpen(false); fileAny.current?.click(); }} />
					<ActionTile icon={<Camera size={24} />} label="拍照" disabled={sending} onClick={() => { setPlusOpen(false); fileCamera.current?.click(); }} />
					<ActionTile icon={<ImagePlus size={24} />} label="相册" disabled={sending} onClick={() => { setPlusOpen(false); fileGallery.current?.click(); }} />
				</div>
			</BottomSheet>
		</div>
	);
}
