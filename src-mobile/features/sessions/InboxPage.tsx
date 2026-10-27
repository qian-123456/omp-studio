import { Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths, type PageProps } from "../../core/nav";
import { events } from "../../core/sse";
import { EmptyState, PageHeader, PullToRefresh, Spinner, toast } from "../../ui";
import { SessionRow } from "./SessionRow";
import type { TreeSession } from "./tree";

type InboxKey = "awaiting" | "error" | "unread" | "running";
type InboxData = Partial<Record<InboxKey, TreeSession[]>> & { order?: string[] };

export const INBOX_TITLES: Record<string, string> = { awaiting: "待回复", error: "中断 / 错误", unread: "未读", running: "运行中" };
const DEFAULT_ORDER = ["awaiting", "error", "unread", "running"];

/** Sections to show, in server order, skipping empty ones. */
export function inboxSections(d: InboxData): { key: string; items: TreeSession[] }[] {
	return (d.order?.length ? d.order : DEFAULT_ORDER)
		.map((key) => ({ key, items: d[key as InboxKey] ?? [] }))
		.filter((s) => s.items.length > 0);
}

const seenBtn =
	"mr-2 inline-flex min-h-11 shrink-0 items-center self-center whitespace-nowrap rounded-m-pill border border-m-border bg-m-surface px-3 text-m-sm text-m-text active:bg-m-surface-hover";

export function InboxPage(_props: PageProps) {
	const [data, setData] = useState<InboxData | null>(null);
	const [error, setError] = useState<string | null>(null);
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
		let t: ReturnType<typeof setTimeout> | undefined;
		const soon = () => {
			clearTimeout(t);
			t = setTimeout(() => void load(), 400);
		};
		const offs = [events.on("session", soon), events.on("hello", soon), events.on("resync", soon)];
		return () => {
			alive.current = false;
			clearTimeout(t);
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
		try {
			const r = await api<{ count?: number }>("POST", "/left/inbox/read-all");
			toast(`已标记 ${r.count ?? 0} 个会话`, { kind: "success" });
			await load();
		} catch (e) {
			toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
		}
	};

	const sections = data ? inboxSections(data) : [];
	const canReadAll = !!data && ((data.unread?.length ?? 0) > 0 || (data.error?.length ?? 0) > 0);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<PageHeader
				title="收件箱"
				right={
					<button
						type="button"
						disabled={!canReadAll}
						onClick={() => void readAll()}
						className="mr-2 inline-flex min-h-11 items-center whitespace-nowrap rounded-m-pill border border-m-border bg-m-surface px-4 text-m-sm font-medium text-m-text disabled:opacity-40"
					>
						全部已读
					</button>
				}
			/>
			<PullToRefresh onRefresh={load}>
				{error && !data && <div className="select-text break-words p-8 text-center text-m-sm text-m-danger">加载失败：{error}</div>}
				{!data && !error && (
					<div className="flex justify-center p-8 text-m-text-3">
						<Spinner size={20} />
					</div>
				)}
				{data && sections.length === 0 && <EmptyState icon={<Inbox size={32} />} title="收件箱是空的" />}
				{sections.map(({ key, items }) => {
					const markable = key === "unread" || key === "error";
					return (
						<section key={key} data-sec={key}>
							<div className="flex min-h-11 items-center gap-2 border-b border-m-border px-4 text-m-sm font-semibold text-m-text">
								{INBOX_TITLES[key] ?? key}
								<span className="inline-flex h-6 min-w-6 items-center justify-center rounded-m-pill bg-m-surface px-2 text-m-xs text-m-text-2">
									{items.length}
								</span>
							</div>
							{items.map((s) => (
								<SessionRow
									key={s.id}
									s={s}
									onOpen={(x) => {
										if (markable) void seen(x);
										nav.push(paths.chat(x.id));
									}}
									trailing={
										markable ? (
											<button type="button" className={seenBtn} onClick={() => void seen(s)}>
												已读
											</button>
										) : undefined
									}
								/>
							))}
						</section>
					);
				})}
			</PullToRefresh>
		</div>
	);
}
