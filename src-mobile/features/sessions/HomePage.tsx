import { Menu, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { nav, paths, type PageProps } from "../../core/nav";
import { useConnection } from "../../core/stores/connection";
import { useSessions } from "../../core/stores/sessions";
import { HeaderButton, PageHeader, PullToRefresh } from "../../ui";
import { useSessionActions } from "./ActionSheets";
import { MenuSheet } from "./MenuSheet";
import { ModeSwitch } from "./ModeSwitch";
import { NewSessionSheet } from "./NewSessionSheet";
import { TodosPane } from "./TodosPane";
import { TreeView } from "./TreeView";
import { openTodos, startTodosSync, useTodos } from "./todos";
import { startTreeSync, useTree } from "./treeStore";

type Tab = "sessions" | "todos";

const CONN_LABEL: Record<string, string> = {
	open: "已连接",
	connecting: "连接中",
	closed: "重连中",
	idle: "连接中",
	unauthorized: "未授权",
};

function Tabs({ tab, onTab, todoCount }: { tab: Tab; onTab: (t: Tab) => void; todoCount: number }) {
	const cell = (active: boolean) =>
		`flex min-h-11 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-m-pill text-m-sm font-medium ${
			active ? "bg-m-accent text-m-accent-text" : "text-m-text-2 active:bg-m-surface-hover"
		}`;
	return (
		<div role="tablist" className="mx-3 my-2 flex shrink-0 gap-1 rounded-m-pill border border-m-border bg-m-surface p-1">
			<button type="button" role="tab" aria-selected={tab === "sessions"} className={cell(tab === "sessions")} onClick={() => onTab("sessions")}>
				会话
			</button>
			<button type="button" role="tab" aria-selected={tab === "todos"} className={cell(tab === "todos")} onClick={() => onTab("todos")}>
				待办
				{todoCount > 0 && (
					<span className="inline-flex h-5 min-w-5 items-center justify-center rounded-m-pill bg-m-danger px-1 text-m-xs text-m-accent-text">
						{todoCount}
					</span>
				)}
			</button>
		</div>
	);
}

export function HomePage(_props: PageProps) {
	const [tab, setTab] = useState<Tab>("sessions");
	const [newOpen, setNewOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const phase = useConnection((s) => s.phase);
	const todoCount = useTodos((s) => openTodos(s.todos).length);
	const { openActions, node } = useSessionActions();

	useEffect(() => {
		void useTree.getState().load();
		const offTree = startTreeSync();
		const offTodos = startTodosSync();
		return () => {
			offTree();
			offTodos();
		};
	}, []);

	const refresh = () =>
		Promise.allSettled([useTree.getState().load(), useSessions.getState().refresh(), useTodos.getState().load()]);

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<PageHeader
				title="omp-workspace"
				subtitle={CONN_LABEL[phase] ?? ""}
				onBack={false}
				right={
					<>
						<HeaderButton icon={<Search size={22} />} label="搜索" onClick={() => nav.push(paths.search())} />
						<HeaderButton icon={<Menu size={22} />} label="菜单" onClick={() => setMenuOpen(true)} />
					</>
				}
			/>
			<Tabs tab={tab} onTab={setTab} todoCount={todoCount} />
			<PullToRefresh onRefresh={refresh}>
				{tab === "sessions" ? (
					<>
						<div className="flex items-center gap-2 px-3 pb-2">
							<ModeSwitch />
							<button
								type="button"
								onClick={() => setNewOpen(true)}
								className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-m-pill bg-m-accent px-4 text-m-sm font-medium text-m-accent-text active:opacity-80"
							>
								<Plus size={18} />
								新建会话
							</button>
						</div>
						<TreeView onMore={openActions} />
						<div style={{ height: "calc(88px + var(--m-safe-bottom))" }} aria-hidden />
					</>
				) : (
					<TodosPane />
				)}
			</PullToRefresh>
			{tab === "sessions" && (
				<button
					type="button"
					aria-label="新建会话"
					onClick={() => setNewOpen(true)}
					className="absolute right-4 z-10 flex size-14 items-center justify-center rounded-full bg-m-accent text-m-accent-text shadow-m-pop active:opacity-80"
					style={{ bottom: "calc(16px + var(--m-safe-bottom))" }}
				>
					<Plus size={26} />
				</button>
			)}
			<NewSessionSheet open={newOpen} onClose={() => setNewOpen(false)} />
			<MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
			{node}
		</div>
	);
}
