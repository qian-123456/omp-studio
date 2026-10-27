import { ChevronDown, Menu, MoreVertical, Plus } from "lucide-react";
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
import { MessageActionsSheet } from "./components/MessageActions";
import { MessageList } from "./components/MessageList";
import { ModelThinkingSheet } from "./components/ModelThinkingSheet";
import { PendingCards } from "./components/PendingCards";
import { StatCard } from "./components/StatLine";
import { shortModel } from "./lib/models";
import type { RequestStat } from "./lib/requestStats";
import { useChat, useChatUi as useUi } from "./ChatContext";

function TopBar({
	onOpenMenu,
	onOpenPicker,
	onNew,
	onToolMenu,
}: {
	onOpenMenu: () => void;
	onOpenPicker: () => void;
	onNew: () => void;
	onToolMenu: () => void;
}) {
	const cstate = useChat((s) => s.cstate);
	const model = shortModel(cstate?.model ?? "") || "选择模型";
	const thinking = cstate?.thinkingLevel || "auto";

	return (
		<header
			className="sticky top-0 z-20 shrink-0 border-b border-m-border bg-m-bg text-m-text"
			style={{ paddingTop: "var(--m-safe-top)" }}
		>
			<div className="flex h-13 items-center justify-between gap-1 px-2">
				{/* Menu (left) */}
				<button
					type="button"
					aria-label="菜单"
					title="菜单"
					onClick={onOpenMenu}
					className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-m-pill text-m-text active:bg-m-surface-hover"
				>
					<Menu size={22} />
				</button>

				{/* Current model + thinking level pill (middle-left, tap opens bottom sheet picker) */}
				<button
					type="button"
					aria-label="选择模型和思考等级"
					onClick={onOpenPicker}
					className="flex min-h-9 max-w-[210px] shrink min-w-0 items-center gap-1.5 truncate rounded-m-pill border border-m-border bg-m-surface px-3 text-m-xs font-medium text-m-text active:bg-m-surface-hover"
				>
					<span className="truncate">{model}</span>
					<span className="text-m-text-3">·</span>
					<span className="shrink-0 text-m-text-2">思考 {thinking}</span>
					<ChevronDown size={14} className="shrink-0 text-m-text-3" />
				</button>

				<div className="min-w-0 flex-1" />

				{/* "新建对话" icon + Right tool menu (right) */}
				<div className="flex shrink-0 items-center">
					<button
						type="button"
						aria-label="新建对话"
						title="新建对话"
						onClick={onNew}
						className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-m-pill text-m-text active:bg-m-surface-hover"
					>
						<Plus size={22} />
					</button>
					<button
						type="button"
						aria-label="工具菜单"
						title="工具菜单"
						onClick={onToolMenu}
						className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-m-pill text-m-text active:bg-m-surface-hover"
					>
						<MoreVertical size={20} />
					</button>
				</div>
			</div>
		</header>
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
				<TopBar
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
				sessionId={id}
				currentLevel={controller.state.cstate?.thinkingLevel ?? null}
				onFacts={(f) => controller.patchState({ model: f.model, thinkingLevel: f.thinkingLevel })}
			/>
		</ChatCtx.Provider>
	);
}
