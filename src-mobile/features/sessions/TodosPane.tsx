import { CheckCheck } from "lucide-react";
import { memo, useState } from "react";
import { nav, paths } from "../../core/nav";
import { sessionName } from "../../core/lib/format";
import { useSessions } from "../../core/stores/sessions";
import { Chip, EmptyState, Spinner } from "../../ui";
import { KIND_LABEL, openTodos, todoChoices, useTodos, type Todo } from "./todos";

const btn = "inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-m-pill px-4 text-m-sm font-medium disabled:opacity-50";
const secondary = `${btn} border border-m-border bg-m-surface text-m-text`;
const primary = `${btn} bg-m-accent text-m-accent-text`;
const danger = `${btn} border border-m-danger bg-m-surface text-m-danger`;

const TONE: Record<string, "warn" | "danger" | "accent" | "success" | "neutral"> = {
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
		const ok = await fn();
		if (!ok) setBusy(null);
	};
	return (
		<div className="flex flex-col gap-2 rounded-m-lg border border-m-border bg-m-surface p-3">
			<div className="flex flex-wrap items-center gap-2">
				<Chip tone={TONE[t.kind] ?? "neutral"}>{KIND_LABEL[t.kind] || t.kind}</Chip>
				{session && <span className="min-w-0 break-words text-m-xs text-m-text-3">{sessionName(session)}</span>}
			</div>
			<div className="break-words text-m-md font-medium text-m-text">{t.title}</div>
			{t.detail && <div className="whitespace-pre-wrap break-words text-m-sm text-m-text-2">{t.detail}</div>}
			<div className="flex flex-wrap gap-2 pt-1">
				{choices ? (
					choices.map((c) => (
						<button
							key={c.id}
							type="button"
							disabled={busy !== null}
							className={c.primary ? primary : secondary}
							onClick={() => void run(`c:${c.id}`, () => useTodos.getState().respond(t, c))}
						>
							{busy === `c:${c.id}` && <Spinner size={14} />}
							{c.label}
						</button>
					))
				) : (
					<button
						type="button"
						disabled={busy !== null}
						className={primary}
						onClick={() => void run("done", () => useTodos.getState().act(t.id, "done"))}
					>
						{busy === "done" && <Spinner size={14} />}
						完成
					</button>
				)}
				{t.sessionId && (
					<button type="button" className={secondary} onClick={() => nav.push(paths.chat(t.sessionId as string))}>
						打开会话
					</button>
				)}
				<button
					type="button"
					disabled={busy !== null}
					className={danger}
					onClick={() => void run("ignore", () => useTodos.getState().act(t.id, "ignore"))}
				>
					{busy === "ignore" && <Spinner size={14} />}
					忽略
				</button>
			</div>
		</div>
	);
});

export function TodosPane() {
	const todos = useTodos((s) => s.todos);
	const loaded = useTodos((s) => s.loaded);
	const open = openTodos(todos);
	if (!loaded)
		return (
			<div className="flex justify-center p-8 text-m-text-3">
				<Spinner size={20} />
			</div>
		);
	if (!open.length) return <EmptyState icon={<CheckCheck size={32} />} title="没有待办事项" />;
	return (
		<div className="flex flex-col gap-3 p-3">
			{open.map((t) => (
				<TodoCard key={t.id} t={t} />
			))}
		</div>
	);
}
