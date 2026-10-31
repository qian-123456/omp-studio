import { memo, useEffect, useId, useRef, useState } from "react";
import { nav, paths } from "../../core/nav";
import { sessionName } from "../../core/lib/format";
import { useSessions } from "../../core/stores/sessions";
import { Button, Chip, type ChipTone } from "../../ui";
import { KIND_LABEL, openTodos, todoChoices, useTodos, type Todo } from "./todos";

const TONE: Record<string, ChipTone> = {
	approval: "warn",
	question: "accent",
	error: "danger",
	interrupted: "danger",
	review: "success",
};

const TodoCard = memo(function TodoCard({ t }: { t: Todo }) {
	const [busy, setBusy] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [hasLongDetail, setHasLongDetail] = useState(false);
	const detailRef = useRef<HTMLDivElement>(null);
	const detailId = useId();
	const pending = useRef(false);
	const session = useSessions((s) => (t.sessionId ? s.byId[t.sessionId] : undefined));
	const choices = todoChoices(t);
	const primary = choices?.find((choice) => choice.primary) ?? choices?.[0];
	useEffect(() => {
		const el = detailRef.current;
		if (!el) return;
		const measure = () => {
			const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
			setHasLongDetail(el.scrollHeight > lineHeight * 3 + 1);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [t.detail]);
	const run = async (key: string, fn: () => Promise<boolean>) => {
		if (pending.current) return;
		pending.current = true;
		setBusy(key);
		try {
			await fn();
		} finally {
			pending.current = false;
			setBusy(null);
		}
	};
	return (
		<article className="flex flex-col gap-2 rounded-m-lg bg-m-card p-4 shadow-m-card">
			<div className="flex flex-wrap items-center gap-2">
				<Chip tone={TONE[t.kind] ?? "neutral"}>{KIND_LABEL[t.kind] || t.kind}</Chip>
				{session && <span className="min-w-0 text-m-xs break-words text-m-text-3">{sessionName(session)}</span>}
			</div>
			<div className="m-selectable text-m-md font-medium break-words text-m-text">{t.title}</div>
			{t.detail && (
				<div>
					<div ref={detailRef} id={detailId} className={`m-selectable text-m-sm whitespace-pre-wrap break-words text-m-text-2 ${expanded ? "" : "line-clamp-3"}`}>{t.detail}</div>
					{(hasLongDetail || expanded) && <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded((value) => !value)} className="min-h-11 min-w-11 py-2 text-m-sm whitespace-nowrap text-m-accent">{expanded ? "收起" : "展开全部"}</button>}
				</div>
			)}
			<div className="flex flex-col gap-2 pt-2">
				<div className="flex min-w-0 flex-col">
					{primary ? (
						<Button size="sm" className="min-h-11 min-w-11 whitespace-normal! break-words" variant="primary" disabled={busy !== null} busy={busy === `c:${primary.id}`} onClick={() => void run(`c:${primary.id}`, () => useTodos.getState().respond(t, primary))}>
							<span className={primary.label.length > 16 ? "break-words" : "whitespace-nowrap"}>{primary.label}</span>
						</Button>
					) : !t.payload?.uiRequest ? (
						<Button size="sm" className="min-h-11 whitespace-nowrap" variant="primary" disabled={busy !== null} busy={busy === "done"} onClick={() => void run("done", () => useTodos.getState().act(t.id, "done"))}>完成</Button>
					) : t.sessionId ? (
						<Button size="sm" className="min-h-11 whitespace-nowrap" variant="primary" onClick={() => nav.push(paths.chat(t.sessionId as string))}>打开会话</Button>
					) : null}
				</div>
				<div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
					{choices?.filter((choice) => choice !== primary).map((choice) => (
						<Button key={choice.id} size="sm" className="min-h-11 min-w-11 max-w-full whitespace-normal! break-words" variant="tonal" disabled={busy !== null} busy={busy === `c:${choice.id}`} onClick={() => void run(`c:${choice.id}`, () => useTodos.getState().respond(t, choice))}>
							<span className={choice.label.length > 16 ? "break-words" : "whitespace-nowrap"}>{choice.label}</span>
						</Button>
					))}
					{t.sessionId && (primary || !t.payload?.uiRequest) && <Button size="sm" className="min-h-11 whitespace-nowrap" variant="tonal" onClick={() => nav.push(paths.chat(t.sessionId as string))}>打开会话</Button>}
					<Button size="sm" className="min-h-11 whitespace-nowrap" variant="ghost" disabled={busy !== null} busy={busy === "ignore"} onClick={() => void run("ignore", () => useTodos.getState().act(t.id, "ignore"))}>忽略</Button>
				</div>
			</div>
		</article>
	);
});

/** Open todo cards and recoverable load state at the top of the inbox. */
export function TodosPane() {
	const todos = useTodos((s) => s.todos);
	const loaded = useTodos((s) => s.loaded);
	const loading = useTodos((s) => s.loading);
	const error = useTodos((s) => s.error);
	const open = openTodos(todos);
	if (!open.length && !error && loaded) return null;
	return (
		<section className="px-4" aria-label="待办" aria-busy={loading || !loaded}>
			<h3 className="px-4 pt-5 pb-2 text-m-xs font-medium whitespace-nowrap text-m-text-3">待办 · {open.length}</h3>
			{!loaded && !error && <p role="status" className="px-4 py-3 text-m-sm text-m-text-3">正在加载待办</p>}
			{error && (
				<div role="alert" className="mb-3 flex flex-col items-start gap-3 rounded-m-lg bg-m-card p-4 shadow-m-card">
					<p className="m-selectable text-m-sm whitespace-pre-wrap break-words text-m-danger">待办加载失败：{error}</p>
					<Button size="sm" className="min-h-11" variant="tonal" busy={loading} onClick={() => void useTodos.getState().load()}>重试加载待办</Button>
				</div>
			)}
			<div className="flex flex-col gap-3">
				{open.map((t) => (
					<TodoCard key={t.id} t={t} />
				))}
			</div>
		</section>
	);
}
