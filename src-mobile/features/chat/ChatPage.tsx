import { Menu, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "../../core/nav";
import { useSession } from "../../core/stores/sessions";
import { PageHeader, Spinner, HeaderButton } from "../../ui";
import { STATUS_LABEL, isDraftId } from "../../core/types";
import { baseName, sessionName } from "../../core/lib/format";
import { NewSessionSheet } from "../sessions";
import { SubagentCapsule } from "../subagents";
import "./chat.css";
import { ChatCtx, type ChatUi, type MessageTarget } from "./ChatContext";
import { ChatController, isDeadStatus } from "./chatStore";
import { Composer } from "./components/Composer";
import { HeaderMenu } from "./components/HeaderMenu";
import { MessageActionsSheet } from "./components/MessageActions";
import { MessageList } from "./components/MessageList";
import { PendingCards } from "./components/PendingCards";
import { StatCard } from "./components/StatLine";
import type { RequestStat } from "./lib/requestStats";
import { useChat } from "./ChatContext";

const DOT: Record<string, string> = {
	working: "bg-m-success",
	awaiting_approval: "bg-m-warn",
	awaiting_answer: "bg-m-warn",
	error: "bg-m-danger",
	interrupted: "bg-m-danger",
};

function Header({ sessionId, onNew, onMenu }: { sessionId: string; onNew: () => void; onMenu: () => void }) {
	const session = useSession(sessionId);
	const working = useChat((s) => s.working);
	const status = working ? "working" : (session?.status ?? "idle");
	const label = working ? "回复中" : (STATUS_LABEL[status] ?? status);
	const title = sessionName(session) || (isDraftId(sessionId) ? "新会话" : "会话");
	return (
		<PageHeader
			title={title}
			subtitle={
				<span className="flex items-center gap-1.5">
					<span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[status] ?? "bg-m-text-3"}`} />
					<span className="whitespace-nowrap">{label}</span>
					{session?.cwd && <span className="min-w-0 truncate">· {baseName(session.cwd)}</span>}
				</span>
			}
			right={
				<>
					<button
						type="button"
						onClick={onNew}
						className="mr-1 flex min-h-9 items-center gap-1 whitespace-nowrap rounded-m-pill border border-m-border px-3 text-m-sm font-medium active:bg-m-surface-hover"
					>
						<Plus size={16} />
						新建
					</button>
					<HeaderButton icon={<Menu size={22} />} label="菜单" onClick={onMenu} />
				</>
			}
		>
			<SubagentCapsule sessionId={sessionId} />
		</PageHeader>
	);
}

function ResumeBar({ sessionId }: { sessionId: string }) {
	const { controller } = useUi();
	const session = useSession(sessionId);
	const working = useChat((s) => s.working);
	const [busy, setBusy] = useState(false);
	if (!isDeadStatus(session?.status, working)) return null;
	return (
		<div className="flex shrink-0 items-center gap-3 border-t border-m-border bg-m-surface px-4 py-2">
			<span className="min-w-0 flex-1 text-m-sm text-m-text-2">会话{STATUS_LABEL[session?.status ?? ""] ?? "已停止"}，发送消息或点击恢复</span>
			<button
				type="button"
				disabled={busy}
				onClick={() => {
					setBusy(true);
					void controller.resume().finally(() => setBusy(false));
				}}
				className="min-h-11 whitespace-nowrap rounded-m-pill bg-m-accent px-5 text-m-sm font-medium text-m-accent-text active:opacity-80 disabled:opacity-50"
			>
				{busy ? <Spinner size={14} /> : "恢复"}
			</button>
		</div>
	);
}

import { useChatUi as useUi } from "./ChatContext";

export function ChatPage({ route }: PageProps) {
	const id = route.params.id;
	const [controller, setController] = useState<ChatController | null>(null);
	const [target, setTarget] = useState<MessageTarget | null>(null);
	const [stat, setStat] = useState<RequestStat | null>(null);
	const [menu, setMenu] = useState(false);
	const [newOpen, setNewOpen] = useState(false);
	const session = useSession(id);

	useEffect(() => {
		const c = new ChatController(id);
		c.start();
		setController(c);
		return () => {
			c.dispose();
			setController(null);
		};
	}, [id]);

	const ui = useMemo<ChatUi | null>(
		() => (controller ? { controller, openActions: setTarget, openStat: setStat } : null),
		[controller],
	);

	if (!ui || !controller) {
		return (
			<div className="flex flex-1 items-center justify-center text-m-text-3">
				<Spinner size={22} />
			</div>
		);
	}
	return (
		<ChatCtx.Provider value={ui}>
			<div className="flex min-h-0 flex-1 flex-col bg-m-bg">
				<Header sessionId={id} onNew={() => setNewOpen(true)} onMenu={() => setMenu(true)} />
				<MessageList sessionId={id} />
				<PendingCards />
				<ResumeBar sessionId={id} />
				<Composer sessionId={id} />
			</div>
			<MessageActionsSheet target={target} onClose={() => setTarget(null)} controller={controller} />
			<StatCard stat={stat} onClose={() => setStat(null)} />
			<HeaderMenu open={menu} onClose={() => setMenu(false)} sessionId={id} />
			<NewSessionSheet open={newOpen} onClose={() => setNewOpen(false)} defaultCwd={session?.cwd} />
		</ChatCtx.Provider>
	);
}
