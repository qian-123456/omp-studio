import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "../../core/nav";
import { useSession } from "../../core/stores/sessions";
import { Spinner } from "../../ui";
import { STATUS_LABEL } from "../../core/types";
import { MenuSheet } from "../sessions/MenuSheet";
import { NewSessionSheet } from "../sessions";
import "./chat.css";
import { ChatCtx, type ChatUi, type MessageTarget } from "./ChatContext";
import { ChatController, isDeadStatus } from "./chatStore";
import { Composer } from "./components/Composer";
import { HeaderMenu } from "./components/HeaderMenu";
import { ChatHeader } from "./components/ChatHeader";
import { sessionModelSource } from "./components/useModelFacts";
import { takeFirstSend } from "./lib/drafts";
import { MessageActionsSheet } from "./components/MessageActions";
import { MessageList } from "./components/MessageList";
import { ModelThinkingSheet } from "./components/ModelThinkingSheet";
import { PendingCards } from "./components/PendingCards";
import { StatCard } from "./components/StatLine";
import type { RequestStat } from "./lib/requestStats";
import { useChat, useChatUi as useUi } from "./ChatContext";

function Header({ onOpenMenu, onOpenPicker, onNew, onToolMenu }: { onOpenMenu: () => void; onOpenPicker: () => void; onNew: () => void; onToolMenu: () => void }) {
	const cstate = useChat((s) => s.cstate);
	return <ChatHeader model={cstate?.model} thinking={cstate?.thinkingLevel} onMenu={onOpenMenu} onModel={onOpenPicker} onNew={onNew} onTools={onToolMenu} />;
}

function ResumeBar({ sessionId }: { sessionId: string }) {
	const { controller } = useUi();
	const session = useSession(sessionId);
	const working = useChat((s) => s.working);
	const [busy, setBusy] = useState(false);
	if (!isDeadStatus(session?.status, working)) return null;
	return (
		<div className="flex shrink-0 items-center gap-3 border-t border-m-border bg-m-surface px-4 py-2">
			<span className="min-w-0 flex-1 text-m-sm text-m-text-2">
				会话{STATUS_LABEL[session?.status ?? ""] ?? "已停止"}，发送消息或点击恢复
			</span>
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

export function ChatPage({ route }: PageProps) {
	const id = route.params.id;
	const [controller, setController] = useState<ChatController | null>(null);
	const [target, setTarget] = useState<MessageTarget | null>(null);
	const [stat, setStat] = useState<RequestStat | null>(null);
	const [toolMenu, setToolMenu] = useState(false);
	const [menuSheet, setMenuSheet] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [newOpen, setNewOpen] = useState(false);
	const session = useSession(id);

	const modelSource = useMemo(() => sessionModelSource(id), [id]);

	useEffect(() => {
		if (!controller || controller.id !== id) return;
		const first = takeFirstSend(id);
		if (first !== null) void controller.send(first, "followUp");
	}, [controller, id]);
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

	if (!ui || !controller || controller.id !== id) {
		return (
			<div className="flex flex-1 items-center justify-center text-m-text-3">
				<Spinner size={22} />
			</div>
		);
	}

	return (
		<ChatCtx.Provider value={ui}>
			<div className="flex min-h-0 flex-1 flex-col bg-m-bg">
				<Header
					onOpenMenu={() => setMenuSheet(true)}
					onOpenPicker={() => setPickerOpen(true)}
					onNew={() => setNewOpen(true)}
					onToolMenu={() => setToolMenu(true)}
				/>
				<MessageList sessionId={id} />
				<PendingCards />
				<ResumeBar sessionId={id} />
				<Composer sessionId={id} />
			</div>
			<MessageActionsSheet target={target} onClose={() => setTarget(null)} controller={controller} />
			<StatCard stat={stat} onClose={() => setStat(null)} />
			<HeaderMenu open={toolMenu} onClose={() => setToolMenu(false)} sessionId={id} />
			<MenuSheet open={menuSheet} onClose={() => setMenuSheet(false)} onNewSession={() => setNewOpen(true)} />
			<NewSessionSheet open={newOpen} onClose={() => setNewOpen(false)} defaultCwd={session?.cwd} />
			<ModelThinkingSheet
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				source={modelSource}
				currentLevel={controller.state.cstate?.thinkingLevel ?? null}
				onFacts={(f) => controller.patchState({ ...(f.model ? { model: f.model } : {}), thinkingLevel: f.thinkingLevel })}
			/>
		</ChatCtx.Provider>
	);
}
