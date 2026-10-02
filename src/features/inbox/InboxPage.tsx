import { CheckCircle2, Loader2, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Attention, SessionMeta } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { ATTENTION_ORDER } from "./attention";
import { useInboxGroups } from "./useInboxBadge";

type Tab = "all" | "unread" | "error" | "awaiting";

const TABS: { id: Tab; label: string }[] = [
	{ id: "all", label: "全部" },
	{ id: "unread", label: "未读" },
	{ id: "error", label: "中断" },
	{ id: "awaiting", label: "待回复" },
];

const SECTION_LABEL: Record<Attention, string> = {
	awaiting: "待回复",
	error: "报错 / 中断",
	unread: "已完成，未查看",
	running: "运行中",
};

const EMPTY_TEXT: Record<Tab, string> = {
	all: "暂时没有需要你关注的会话",
	unread: "没有未查看的已完成会话",
	error: "没有报错或中断的会话",
	awaiting: "没有等你回复的会话",
};

export function InboxPage() {
	const groups = useInboxGroups();
	const selectSession = useUi((s) => s.selectSession);
	const openSettings = useUi((s) => s.openSettings);
	const loadSessions = useSessions((s) => s.load);
	const [tab, setTab] = useState<Tab>("all");
	const [focusedIndex, setFocusedIndex] = useState(0);

	const rows = tab === "all" ? groups.all : groups.byKind[tab];

	// Keep focus valid when rows disappear (viewed / answered / expired).
	useEffect(() => {
		setFocusedIndex((i) => Math.max(0, Math.min(i, rows.length - 1)));
	}, [rows.length]);

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
					selectSession(target.id);
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [rows, focusedIndex, selectSession]);

	const count = (t: Tab) => (t === "all" ? groups.all.length : groups.byKind[t].length);
	const headerBtn =
		"inline-flex items-center gap-1 rounded-lg border border-[var(--border-divider)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]";

	const renderRow = (s: SessionMeta) => {
		const idx = rows.indexOf(s);
		return (
			<InboxRow
				key={s.id}
				session={s}
				focused={idx === focusedIndex}
				onOpen={() => {
					setFocusedIndex(idx);
					selectSession(s.id);
				}}
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
							j/k 切换 · Enter 进入会话
						</span>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={async () => {
								await loadSessions();
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
									? "border-[var(--primary)] font-semibold text-[var(--text)]"
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
							{ATTENTION_ORDER.filter((k) => groups.byKind[k].length > 0).map((k) => (
								<section key={k}>
									<h4 className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold text-[var(--text-dim)]">
										{SECTION_LABEL[k]}
										<span className="font-mono text-[10px]">{groups.byKind[k].length}</span>
									</h4>
									<div>{groups.byKind[k].map(renderRow)}</div>
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

/** Sidebar-matching status symbol for an attention kind. */
function AttentionMark({ kind }: { kind: Attention }) {
	switch (kind) {
		case "awaiting":
			return (
				<span className="shrink-0 whitespace-nowrap rounded-[4px] bg-sky-500/15 px-1 text-[9px] font-semibold leading-[14px] text-sky-400">
					待回复
				</span>
			);
		case "error":
			return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-red-500" title="中断" />;
		case "unread":
			return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-blue-500" title="未读" />;
		case "running":
			return <Loader2 size={11} className="shrink-0 animate-spin text-[var(--text-muted)]" />;
	}
}

function InboxRow({
	session: s,
	focused,
	onOpen,
}: {
	session: SessionMeta;
	focused: boolean;
	onOpen: () => void;
}) {
	const kind = s.attention ?? "unread";
	const pendingTitle = useLive((st) => {
		if (kind !== "awaiting") return null;
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
		case "awaiting":
			detail = pendingTitle ?? s.lastAssistant ?? "";
			break;
		case "error":
			detail = `${s.status === "interrupted" ? "中断" : "报错"}${resultText ? ` · ${resultText}` : ""}`;
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
			className={`flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] ${
				focused ? "bg-[var(--bg-hover)] ring-1 ring-[var(--border-divider)]" : ""
			}`}
		>
			<div className="flex w-full min-w-0 items-center gap-2">
				<AttentionMark kind={kind} />
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
