import { Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths, type PageProps } from "../../core/nav";
import { relTime, sessionName } from "../../core/lib/format";
import { events } from "../../core/sse";
import { Button, EmptyState, ListGroup, PageHeader, PullToRefresh, Spinner, toast } from "../../ui";
import { INBOX_TITLES, inboxSections, type InboxData } from "./inbox";
import { STATUS_DOT, statusLine } from "./SessionRow";
import { TodosPane } from "./TodosPane";
import { openTodos, startTodosSync, useTodos } from "./todos";
import type { TreeSession } from "./tree";

/** One session inside an inbox card: tap opens it; unread/error rows carry a 「已读」 capsule. */
function InboxRow({ s, onOpen, onSeen }: { s: TreeSession; onOpen: () => void; onSeen?: () => void }) {
	const st = s.status || "idle";
	const line = [statusLine(s), relTime(s.updatedAt)].filter(Boolean).join(" · ");
	return (
		<div className="m-list-row flex items-stretch pl-4 active:bg-m-surface-hover">
			<span aria-hidden className="flex w-6 shrink-0 items-center justify-center">
				<span className={`size-2.5 rounded-m-pill ${STATUS_DOT[st] ?? "bg-m-surface-2"}`} />
			</span>
			<span className="m-list-sep ml-4 flex min-w-0 flex-1 items-center gap-2 pr-3">
				<button type="button" onClick={onOpen} className="min-h-14 min-w-0 flex-1 py-3 text-left">
					<span className="block text-m-md break-words text-m-text">{sessionName(s)}</span>
					{line && <span className="mt-0.5 block text-m-xs break-words text-m-text-3">{line}</span>}
				</button>
				{onSeen && (
					<Button size="sm" className="min-h-11" variant="tonal" onClick={onSeen}>
						已读
					</Button>
				)}
			</span>
		</div>
	);
}

export function InboxPage(_props: PageProps) {
	const [data, setData] = useState<InboxData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [readingAll, setReadingAll] = useState(false);
	const readPending = useRef(false);
	const todoCount = useTodos((s) => openTodos(s.todos).length);
	const todosReady = useTodos((s) => s.loaded && !s.error);
	const alive = useRef(true);

	const load = useCallback(async () => {
		try {
			const d = await api<InboxData>("GET", "/left/inbox");
			if (!alive.current) return;
			setData(d);
			setError(null);
		} catch (e) {
			if (alive.current) setError(errorMessage(e));
		}
	}, []);

	useEffect(() => {
		alive.current = true;
		void load();
		const offTodos = startTodosSync();
		let t: ReturnType<typeof setTimeout> | undefined;
		const soon = () => {
			clearTimeout(t);
			t = setTimeout(() => void load(), 400);
		};
		const offs = [events.on("session", soon), events.on("hello", soon), events.on("resync", soon)];
		return () => {
			alive.current = false;
			clearTimeout(t);
			offTodos();
			offs.forEach((o) => o());
		};
	}, [load]);

	const seen = useCallback(
		async (s: TreeSession) => {
			try {
				await api("POST", `/left/inbox/${encodeURIComponent(s.id)}/seen`);
				await load();
			} catch (e) {
				toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
			}
		},
		[load],
	);

	const readAll = async () => {
		if (readPending.current) return;
		readPending.current = true;
		setReadingAll(true);
		try {
			const r = await api<{ count?: number }>("POST", "/left/inbox/read-all");
			toast(`已标记 ${r.count ?? 0} 个会话`, { kind: "success" });
			await load();
		} catch (e) {
			toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			readPending.current = false;
			if (alive.current) setReadingAll(false);
		}
	};

	const sections = data ? inboxSections(data) : [];
	const canReadAll = !!data && ((data.unread?.length ?? 0) > 0 || (data.error?.length ?? 0) > 0);

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-m-bg-elev">
			<PageHeader
				title="收件箱"
				className="bg-m-bg-elev!"
				right={
					canReadAll ? (
						<Button size="sm" className="min-h-11" variant="ghost" busy={readingAll} onClick={() => void readAll()}>
							全部已读
						</Button>
					) : undefined
				}
			/>
			<PullToRefresh
				onRefresh={() => Promise.allSettled([load(), useTodos.getState().load()])}
				className="pb-[calc(var(--m-safe-bottom)+24px)]"
			>
				{error && <div role="alert" className="flex flex-col items-center gap-4 px-6 py-6 text-center"><p className="m-selectable text-m-sm break-words text-m-danger">加载失败：{error}</p><Button onClick={() => void load()}>重试</Button></div>}
				{!data && !error && (
					<div role="status" aria-label="加载收件箱" className="flex justify-center p-10 text-m-text-3">
						<Spinner size={20} />
					</div>
				)}
				<TodosPane />
				{data && !error && todosReady && sections.length === 0 && todoCount === 0 && (
					<EmptyState icon={<Inbox size={26} strokeWidth={1.75} />} title="收件箱是空的" hint="需要你处理的会话和待办会出现在这里" />
				)}
				{sections.map(({ key, items }) => {
					const markable = key === "unread" || key === "error";
					return (
						<div key={key} data-sec={key}>
							<ListGroup title={`${INBOX_TITLES[key] ?? key} · ${items.length}`}>
								{items.map((s) => (
									<InboxRow
										key={s.id}
										s={s}
										onOpen={() => {
											if (markable) void seen(s);
											nav.push(paths.chat(s.id));
										}}
										onSeen={markable ? () => void seen(s) : undefined}
									/>
								))}
							</ListGroup>
						</div>
					);
				})}
			</PullToRefresh>
		</div>
	);
}
