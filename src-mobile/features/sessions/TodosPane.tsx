import { memo, useState } from "react";
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
	const session = useSessions((s) => (t.sessionId ? s.byId[t.sessionId] : undefined));
	const choices = todoChoices(t);
	const run = async (key: string, fn: () => Promise<boolean>) => {
		setBusy(key);
		try {
			await fn();
		} finally {
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
			{t.detail && <div className="m-selectable text-m-sm whitespace-pre-wrap break-words text-m-text-2">{t.detail}</div>}
			<div className="flex flex-wrap justify-end gap-2 pt-2">
				<Button size="sm" className="min-h-11" variant="ghost" disabled={busy !== null} busy={busy === "ignore"} onClick={() => void run("ignore", () => useTodos.getState().act(t.id, "ignore"))}>
					忽略
				</Button>
				{t.sessionId && (
					<Button size="sm" className="min-h-11" variant="tonal" onClick={() => nav.push(paths.chat(t.sessionId as string))}>
						打开会话
					</Button>
				)}
				{choices ? (
					choices.map((c) => (
						<Button
							key={c.id}
							size="sm"
							className="min-h-11"
							variant={c.primary ? "primary" : "tonal"}
							disabled={busy !== null}
							busy={busy === `c:${c.id}`}
							onClick={() => void run(`c:${c.id}`, () => useTodos.getState().respond(t, c))}
						>
							{c.label}
						</Button>
					))
				) : !t.payload?.uiRequest ? (
					<Button size="sm" className="min-h-11" variant="primary" disabled={busy !== null} busy={busy === "done"} onClick={() => void run("done", () => useTodos.getState().act(t.id, "done"))}>
						完成
					</Button>
				) : null}
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
