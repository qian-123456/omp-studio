import { Check, CheckCheck, CheckCircle2, Loader2, RefreshCw, Settings as SettingsIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Todo } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";
import { markSessionSeen, useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useTodos } from "../todos/store";
import { INBOX_ORDER, type InboxEntry, type InboxKind, type InboxSessionKind } from "./attention";
import { useInboxGroups } from "./useInboxBadge";

type Tab = "all" | Exclude<InboxKind, "running">;

const TABS: { id: Tab; label: string }[] = [
	{ id: "all", label: "全部" },
	{ id: "approval", label: "待审批" },
	{ id: "question", label: "提问" },
	{ id: "error", label: "报错" },
	{ id: "interrupted", label: "中断" },
	{ id: "unread", label: "未读" },
	{ id: "schedule", label: "定时任务" },
];

const SECTION_LABEL: Record<InboxKind, string> = {
	approval: "待审批",
	question: "提问",
	error: "报错",
	interrupted: "中断",
	unread: "未读（已完成，未查看）",
	schedule: "定时任务",
	running: "运行中",
};

const EMPTY_TEXT: Record<Tab, string> = {
	all: "暂时没有需要你处理的事项",
	approval: "没有待审批的会话",
	question: "没有等你回答的提问",
	error: "没有报错的会话",
	interrupted: "没有中断的会话",
	unread: "没有未查看的已完成会话",
	schedule: "没有待处理的定时任务",
};

export function InboxPage() {
	const groups = useInboxGroups();
	const selectSession = useUi((s) => s.selectSession);
	const setCenter = useUi((s) => s.setCenter);
	const openSettings = useUi((s) => s.openSettings);
	const loadSessions = useSessions((s) => s.load);
	const actTodo = useTodos((s) => s.act);
	const [tab, setTab] = useState<Tab>("all");
	const [focusedIndex, setFocusedIndex] = useState(0);

	const rows = tab === "all" ? groups.all : groups.entries[tab];

	// Keep focus valid when rows disappear (viewed / answered / expired).
	useEffect(() => {
		setFocusedIndex((i) => Math.max(0, Math.min(i, rows.length - 1)));
	}, [rows.length]);

	const openEntry = (e: InboxEntry) => {
		if (e.type === "session") {
			selectSession(e.session.id);
		} else if (e.todo.sessionId) {
			selectSession(e.todo.sessionId);
		} else {
			setCenter("schedules");
		}
	};

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			const tag = el?.tagName?.toLowerCase();
			if (tag === "input" || tag === "textarea" || el?.isContentEditable) return;
			if (rows.length === 0) return;
			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				setFocusedIndex((i) => Math.min(rows.length - 1, i + 1));
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				setFocusedIndex((i) => Math.max(0, i - 1));
			} else if (e.key === "Enter") {
				const target = rows[focusedIndex];
				if (target) {
					e.preventDefault();
					openEntry(target);
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
		// biome-ignore lint/correctness/useExhaustiveDependencies: openEntry only closes over stable store actions
	}, [rows, focusedIndex, selectSession, setCenter]);

	const count = (t: Tab) => (t === "all" ? groups.all.length : groups.entries[t].length);
	// Approval/question need an answer and 运行中 is not finished, so none is "read" in bulk.
	// Schedule todos are never touched here.
	const bulk: InboxSessionKind[] = ["unread", "error", "interrupted"];
	const readable = bulk
		.filter((k) => tab === "all" || tab === k)
		.flatMap((k) => groups.byKind[k]);
	const markAllRead = async () => {
		await Promise.all(readable.map((s) => markSessionSeen(s.id)));
		toast.info(`已将 ${readable.length} 个会话标为已读`);
	};
	const headerBtn =
		"inline-flex items-center gap-1 rounded-lg border border-[var(--border-divider)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]";

	const renderRow = (e: InboxEntry) => {
		const idx = rows.indexOf(e);
		const onOpen = () => {
			setFocusedIndex(idx);
			openEntry(e);
		};
		const key = e.type === "session" ? `s:${e.session.id}` : `t:${e.todo.id}`;
		return e.type === "session" ? (
			<InboxRow key={key} entry={e} focused={idx === focusedIndex} onOpen={onOpen} />
		) : (
			<ScheduleRow
				key={key}
				todo={e.todo}
				focused={idx === focusedIndex}
				onOpen={onOpen}
				onAct={(action) => void actTodo(e.todo.id, action)}
			/>
		);
	};

	return (
		<div className="flex h-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]">
			<div className="shrink-0 border-b border-[var(--border-divider)] px-6 pt-3.5">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<h2 className="text-sm font-semibold">收件箱</h2>
						<span className="hidden text-[11px] text-[var(--text-dim)] sm:inline">
							j/k 切换 · Enter 打开
						</span>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={markAllRead}
							disabled={readable.length === 0}
							className={`${headerBtn} disabled:cursor-not-allowed disabled:opacity-40`}
							title="将当前列表中的未读、报错与中断会话全部标为已读"
						>
							<CheckCheck className="h-3.5 w-3.5" />
							全部已读
						</button>
						<button
							type="button"
							onClick={async () => {
								await loadSessions();
								await useTodos.getState().refresh();
								toast.info("已刷新数据");
							}}
							className={headerBtn}
							title="刷新列表"
						>
							<RefreshCw className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							onClick={() => openSettings("inbox")}
							className={headerBtn}
							title="收件箱设置"
						>
							<SettingsIcon className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
				<div className="mt-2 flex gap-1" role="tablist">
					{TABS.map((t) => (
						<button
							key={t.id}
							type="button"
							role="tab"
							aria-selected={tab === t.id}
							onClick={() => {
								setTab(t.id);
								setFocusedIndex(0);
							}}
							className={`-mb-px border-b-2 px-2.5 pb-2 text-xs transition-colors ${
								tab === t.id
									? "border-[var(--primary)] text-[var(--text)]"
									: "border-transparent text-[var(--text-dim)] hover:text-[var(--text)]"
							}`}
						>
							{t.label}
							<span className="ml-1 font-mono text-[10px] text-[var(--text-dim)]">{count(t.id)}</span>
						</button>
					))}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto px-6 py-4">
				<div className="mx-auto max-w-4xl">
					{rows.length === 0 ? (
						<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-divider)] py-16 text-center">
							<CheckCircle2 className="mb-3 h-8 w-8 text-[var(--text-dim)]" />
							<h3 className="text-sm font-semibold">{EMPTY_TEXT[tab]}</h3>
						</div>
					) : tab === "all" ? (
						<div className="space-y-5">
							{INBOX_ORDER.filter((k) => groups.entries[k].length > 0).map((k) => (
								<section key={k}>
									<h4 className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold text-[var(--text-dim)]">
										{SECTION_LABEL[k]}
										<span className="font-mono text-[10px]">{groups.entries[k].length}</span>
									</h4>
									<div>{groups.entries[k].map(renderRow)}</div>
								</section>
							))}
						</div>
					) : (
						<div>{rows.map(renderRow)}</div>
					)}
				</div>
			</div>
		</div>
	);
}

/** Sidebar-matching status symbol for an inbox session kind. */
function KindMark({ kind }: { kind: InboxSessionKind }) {
	switch (kind) {
		case "approval":
			return (
				<span className="shrink-0 whitespace-nowrap rounded-[4px] bg-sky-500/15 px-1 text-[9px] font-semibold leading-[14px] text-sky-400">
					待审批
				</span>
			);
		case "question":
			return (
				<span className="shrink-0 whitespace-nowrap rounded-[4px] bg-sky-500/15 px-1 text-[9px] font-semibold leading-[14px] text-sky-400">
					提问
				</span>
			);
		case "error":
			return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-red-500" title="报错" />;
		case "interrupted":
			return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-amber-500" title="中断" />;
		case "unread":
			return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-blue-500" title="未读" />;
		case "running":
			return <Loader2 size={11} className="shrink-0 animate-spin text-[var(--text-muted)]" />;
	}
}

function rowClass(focused: boolean): string {
	return `flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] ${
		focused ? "bg-[var(--bg-hover)] ring-1 ring-[var(--border-divider)]" : ""
	}`;
}

function InboxRow({
	entry,
	focused,
	onOpen,
}: {
	entry: Extract<InboxEntry, { type: "session" }>;
	focused: boolean;
	onOpen: () => void;
}) {
	const s = entry.session;
	const kind = entry.kind;
	const pendingTitle = useLive((st) => {
		if (kind !== "approval" && kind !== "question") return null;
		for (const req of st.sessions[s.id]?.pendingUi ?? []) {
			const r = req.request as { title?: unknown; message?: unknown } | null;
			if (typeof r?.title === "string" && r.title) return r.title;
			if (typeof r?.message === "string" && r.message) return r.message;
		}
		return null;
	});

	const dir = s.repoRoot ?? s.cwd;
	const project = dir.split(/[\\/]/).filter(Boolean).pop() ?? "";
	const branch = s.git?.branch;
	const resultText = s.lastAssistant ?? s.result?.summary ?? "";
	let detail: string;
	switch (kind) {
		case "approval":
		case "question":
			detail = pendingTitle ?? s.lastAssistant ?? "";
			break;
		case "error":
		case "interrupted":
			detail = `${kind === "interrupted" ? "中断" : "报错"}${resultText ? ` · ${resultText}` : ""}`;
			break;
		case "unread":
			detail = s.lastAssistant ?? "";
			break;
		case "running":
			detail = `运行中…${s.model ? ` · ${s.model}` : ""}`;
			break;
	}

	return (
		<button
			type="button"
			ref={(el) => {
				if (focused && el) el.scrollIntoView({ block: "nearest" });
			}}
			onClick={onOpen}
			className={rowClass(focused)}
		>
			<div className="flex w-full min-w-0 items-center gap-2">
				<KindMark kind={kind} />
				<span className="min-w-0 shrink truncate text-sm font-medium">
					{s.title || s.label || s.id}
				</span>
				<span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-dim)]">
					{project}
					{branch ? ` · ${branch}` : ""}
				</span>
				<span className="shrink-0 text-[11px] tabular-nums text-[var(--text-dim)]">
					{relativeTime(s.updatedAt)}
				</span>
			</div>
			<div className="w-full truncate pl-[15px] text-xs text-[var(--text-dim)]">
				{detail || "\u00a0"}
			</div>
		</button>
	);
}

function ScheduleRow({
	todo,
	focused,
	onOpen,
	onAct,
}: {
	todo: Todo;
	focused: boolean;
	onOpen: () => void;
	onAct: (action: "done" | "ignore") => void;
}) {
	const actBtn =
		"inline-flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--border-divider)] px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-panel)] hover:text-[var(--text)]";
	return (
		<div
			ref={(el) => {
				if (focused && el) el.scrollIntoView({ block: "nearest" });
			}}
			className={rowClass(focused)}
		>
			<div className="flex w-full min-w-0 items-center gap-2">
				<button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
					<span className="shrink-0 whitespace-nowrap rounded-[4px] bg-blue-500/15 px-1 text-[9px] font-semibold leading-[14px] text-blue-300">
						定时任务
					</span>
					<span className="min-w-0 flex-1 truncate text-sm font-medium">{todo.title}</span>
					<span className="shrink-0 text-[11px] tabular-nums text-[var(--text-dim)]">
						{relativeTime(todo.createdAt)}
					</span>
				</button>
				<button type="button" className={actBtn} onClick={() => onAct("done")} title="标为完成">
					<Check className="h-3 w-3" />
					完成
				</button>
				<button type="button" className={actBtn} onClick={() => onAct("ignore")} title="忽略">
					<X className="h-3 w-3" />
					忽略
				</button>
			</div>
			<div className="w-full truncate pl-[15px] text-xs text-[var(--text-dim)]">
				{todo.detail || "\u00a0"}
			</div>
		</div>
	);
}
