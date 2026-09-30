/** [B] Right tab: side-chat forks of the selected session. */

import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
	ArrowUp,
	CornerUpLeft,
	ExternalLink,
	GitBranch,
	Loader2,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { useEffect, useRef, useState } from "react";
import type { SessionMeta } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { acceptSession, createSideChat, getTranscript } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { SessionView } from "../chat/SessionView";
import { compareSessionLabels } from "./labelSort";

const MAX_DEPTH = 3;

interface ContextMenuState {
	x: number;
	y: number;
	session: SessionMeta;
}

export function SideChatPanel() {
	const selectedId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const openModal = useUi((s) => s.openModal);
	const sessions = useSessions((s) => s.sessions);
	const sideChatRequest = useComposer((s) => s.sideChatRequest);
	const clearSideChatRequest = useComposer((s) => s.clearSideChatRequest);
	const [childId, setChildId] = useState<string | null>(null);
	const [question, setQuestion] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [pendingSelection, setPendingSelection] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	const parent = selectedId ? sessions[selectedId] : undefined;
	const children = Object.values(sessions)
		.filter((s) => s.parentId === selectedId)
		.sort((a, b) => compareSessionLabels(a.label, b.label));
	const tooDeep = (parent?.forkDepth ?? 0) >= MAX_DEPTH;

	// Esc returns to list when viewing a child session
	useEscapeKey(() => setChildId(null), childId !== null && contextMenu === null);
	// Esc closes context menu
	useEscapeKey(() => setContextMenu(null), contextMenu !== null);

	// Consume a pending side-chat request (selection toolbar / other features).
	useEffect(() => {
		if (!sideChatRequest || sideChatRequest.parentSessionId !== selectedId)
			return;
		clearSideChatRequest();
		// The selection is carried into createSideChat when the user hits send.
		setPendingSelection(sideChatRequest.selection ?? null);
		setChildId(null);
		setTimeout(() => textareaRef.current?.focus(), 50);
	}, [sideChatRequest, selectedId, clearSideChatRequest]);
	useEffect(() => {
		setChildId(null);
		setPendingSelection(null);
		setError(null);
		setContextMenu(null);
	}, [selectedId]);

	const create = async () => {
		const q = question.trim();
		if (!q || !selectedId || busy) return;
		setBusy(true);
		setError(null);
		try {
			const info = await createSideChat(
				selectedId,
				q,
				pendingSelection ?? undefined,
			);
			setQuestion("");
			setPendingSelection(null);
			setChildId(info.sessionId);
			if (textareaRef.current) {
				textareaRef.current.style.height = "auto";
			}
			void useSessions.getState().load().catch(() => {});
		} catch (err) {
			const msg = errMsg(err);
			setError(msg);
			toast.error(`创建侧聊失败: ${msg}`);
		} finally {
			setBusy(false);
		}
	};

	const handleSendBackToParent = async (targetChildId: string) => {
		const parentId = sessions[targetChildId]?.parentId ?? selectedId;
		if (!parentId) {
			toast.error("未找到父会话");
			return;
		}

		let items = useLive.getState().sessions[targetChildId]?.items ?? [];
		if (items.length === 0) {
			try {
				const page = await getTranscript(targetChildId);
				items = page.items ?? [];
			} catch (err) {
				console.error("Failed to fetch transcript for sidechat", err);
			}
		}

		const assistantItems = items.filter(
			(it) => it.kind === "assistant" && it.text && it.text.trim().length > 0,
		);
		const lastAssistant = assistantItems[assistantItems.length - 1];

		if (!lastAssistant || !lastAssistant.text) {
			toast.info("侧聊中暂无助手回复可回传");
			return;
		}

		useComposer.getState().addAnnotation(parentId, {
			source: "message",
			text: lastAssistant.text,
			itemId: lastAssistant.id,
		});
		selectSession(parentId);
		toast.success("已注入父会话输入框");
	};

	const handleDelete = async (childSessionId: string, label: string) => {
		setContextMenu(null);
		const ok = await confirmDialog(
			`确定要删除侧聊分支「${label}」吗？此操作不可逆。`,
			{
				danger: true,
				title: "删除侧聊",
				okLabel: "删除",
			},
		);
		if (!ok) return;
		try {
			try {
				await invoke("delete_session", { sessionId: childSessionId });
				toast.success(`侧聊 ${label} 已删除`);
			} catch {
				await acceptSession(childSessionId, true);
				toast.info(`无法删除，已改为归档`);
			}
			if (childId === childSessionId) {
				setChildId(null);
			}
			void useSessions.getState().load().catch(() => {});
		} catch (e) {
			toast.error(`删除侧聊失败: ${errMsg(e)}`);
		}
	};

	if (!selectedId) {
		return (
			<div className="p-3 text-xs text-neutral-500">选择一个会话后可开侧聊</div>
		);
	}

	// Selected child → embedded compact SessionView.
	if (childId) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex shrink-0 items-center gap-1 border-b border-neutral-800 px-2 py-1">
					<button
						type="button"
						onClick={() => setChildId(null)}
						title="返回侧聊列表 (Esc)"
						className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
					>
						← 返回列表 (Esc)
					</button>
					<div className="flex-1" />
					<button
						type="button"
						onClick={() => void handleSendBackToParent(childId)}
						title="将侧聊最后一条助手回复回传至父会话输入框"
						className="flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-600/20 px-2 py-0.5 text-[11px] text-indigo-300 hover:bg-indigo-600/30 hover:text-indigo-200 transition-colors"
					>
						<CornerUpLeft size={11} />
						回传给父会话
					</button>
					<button
						type="button"
						onClick={() => selectSession(childId)}
						title="在主聊天视图中打开此侧聊"
						className="rounded px-1.5 py-0.5 text-[11px] text-indigo-400 hover:bg-neutral-800 hover:text-indigo-300 transition-colors"
					>
						在主视图打开
					</button>
				</div>
				<div className="min-h-0 flex-1">
					<SessionView sessionId={childId} compact />
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 border-b border-[var(--border-divider)] px-3 py-2 text-[11px] text-neutral-400">
				{parent
					? `侧聊 · ${parent.label} ${parent.title}`
					: "侧聊"}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{children.length === 0 && (
					<div className="py-4 text-center text-[11px] text-neutral-600">
						还没有侧聊。在正文中划选文字或在下方快速提问。
					</div>
				)}
				{children.map((c) => (
					<div
						key={c.id}
						onContextMenu={(e) => {
							e.preventDefault();
							const menuWidth = 160;
							const menuHeight = 160;
							const x =
								e.clientX + menuWidth > window.innerWidth
									? Math.max(8, e.clientX - menuWidth)
									: e.clientX;
							const y =
								e.clientY + menuHeight > window.innerHeight
									? Math.max(8, e.clientY - menuHeight)
									: e.clientY;
							setContextMenu({ x, y, session: c });
						}}
						className="group mb-1 flex w-full items-center gap-2 rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
					>
						<button
							type="button"
							onClick={() => setChildId(c.id)}
							className="flex min-w-0 flex-1 items-center gap-2 text-left"
						>
							<GitBranch size={12} className="shrink-0 text-indigo-400" />
							<span className="shrink-0 font-mono text-[11px] text-indigo-300">
								{c.label}
							</span>
							<span
								className="min-w-0 flex-1 truncate text-[12px] text-neutral-300"
								title={c.title}
							>
								{c.title}
							</span>
							<ChildStatus id={c.id} fallback={c.status} />
						</button>
						<button
							type="button"
							title="删除侧聊"
							onClick={(e) => {
								e.stopPropagation();
								void handleDelete(c.id, c.label);
							}}
							className="shrink-0 rounded p-1 text-neutral-500 opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-rose-400 focus:opacity-100 transition-opacity"
						>
							<Trash2 size={12} />
						</button>
					</div>
				))}
			</div>

			{/* Context menu for child session */}
			<FloatingLayer
				anchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
				layer="menu"
				placement="bottom-start"
				offset={2}
				onDismiss={() => setContextMenu(null)}
				className="min-w-36 py-1 text-xs"
			>
				{contextMenu && (
					<>
						<button
							type="button"
							onClick={() => {
								setChildId(contextMenu.session.id);
								setContextMenu(null);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
						>
							<GitBranch size={13} className="text-indigo-400" />
							在侧栏查看
						</button>
						<button
							type="button"
							onClick={() => {
								selectSession(contextMenu.session.id);
								setContextMenu(null);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
						>
							<ExternalLink size={13} className="text-indigo-400" />
							在主视图打开
						</button>
						<button
							type="button"
							onClick={() => {
								void handleSendBackToParent(contextMenu.session.id);
								setContextMenu(null);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
						>
							<CornerUpLeft size={13} className="text-indigo-400" />
							回传给父会话
						</button>
						<div className="my-1 border-t border-[var(--border-divider)]" />
						<button
							type="button"
							onClick={() => {
								const sid = contextMenu.session.id;
								const slabel = contextMenu.session.label;
								setContextMenu(null);
								void handleDelete(sid, slabel);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
						>
							<Trash2 size={13} />
							删除侧聊
						</button>
					</>
				)}
			</FloatingLayer>

			<div className="shrink-0 border-t border-[var(--border-divider)] p-2.5">
				{tooDeep ? (
					<div className="flex flex-col items-center gap-2 rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] p-3 text-center">
						<div className="text-[12px] font-medium text-neutral-300">
							已达分支嵌套深度上限（3 层）
						</div>
						<div className="text-[11px] leading-relaxed text-neutral-400">
							侧聊分支最多支持 3 层嵌套，无法在此分支下继续创建子侧聊。请创建新的主会话以继续开展工作。
						</div>
						<button
							type="button"
							onClick={() => openModal("newSession")}
							className="mt-1 flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-500 transition-colors"
						>
							<Plus size={13} />
							新建主会话
						</button>
					</div>
				) : (
					<>
						{error && (
							<div className="mb-2 text-[11px] text-rose-400">{error}</div>
						)}

						<div className="rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] shadow-xs focus-within:border-[#0A84FF]/60 focus-within:ring-1 focus-within:ring-[#0A84FF]/30 p-2.5 transition-all">
							{/* Context inheritance capsule */}
							{parent && (
								<div className="mb-2 flex items-center gap-1.5 rounded border border-indigo-900/40 bg-indigo-950/20 px-2 py-1 text-[11px] text-indigo-300">
									<GitBranch size={11} className="shrink-0 text-indigo-400" />
									<span className="min-w-0 truncate">
										摘要继承: {parent.label}
										{parent.title ? ` · ${parent.title}` : ""}
									</span>
								</div>
							)}

							{/* Removable quote capsule */}
							{pendingSelection && (
								<div className="mb-2 flex items-start gap-1.5 rounded border border-neutral-800 bg-neutral-900/80 px-2 py-1.5 text-[11px] text-neutral-400">
									<span className="shrink-0 font-medium text-indigo-400">
										引用：
									</span>
									<span
										className="min-w-0 flex-1 line-clamp-2 break-all text-neutral-300"
										title={pendingSelection}
									>
										{pendingSelection}
									</span>
									<button
										type="button"
										title="移除引用"
										onClick={() => setPendingSelection(null)}
										className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 focus:opacity-100 transition-colors"
									>
										<X size={12} />
									</button>
								</div>
							)}

							<textarea
								ref={textareaRef}
								value={question}
								onChange={(e) => {
									setQuestion(e.target.value);
									e.target.style.height = "auto";
									e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										if (isComposing(e)) return;
										e.preventDefault();
										void create();
									}
								}}
								placeholder="输入侧聊提问... (Enter 发送，Shift+Enter 换行)"
								rows={1}
								className="w-full resize-none bg-transparent text-[12px] leading-relaxed text-neutral-100 placeholder:text-neutral-500/60 outline-none max-h-32 min-h-[44px]"
							/>

							<div className="mt-1 flex items-center justify-between gap-2 pt-1 text-[11px] text-neutral-500">
								<div className="flex items-center gap-1 text-[11px] text-neutral-500 select-none">
									<span>💡 独立侧聊分支</span>
								</div>
								<button
									type="button"
									disabled={busy || !question.trim()}
									onClick={() => void create()}
									title={busy ? "正在创建侧聊…" : "创建侧聊 (Enter)"}
									className={clsx(
										"h-6 w-6 rounded-full flex items-center justify-center transition-all duration-150",
										busy
											? "bg-neutral-800 text-neutral-400 cursor-not-allowed"
											: question.trim()
												? "bg-white text-neutral-950 hover:bg-neutral-200 active:scale-95 shadow-sm"
												: "bg-neutral-800 text-neutral-500 cursor-not-allowed",
									)}
								>
									{busy ? (
										<Loader2 size={12} className="animate-spin text-neutral-400" />
									) : (
										<ArrowUp size={13} />
									)}
								</button>
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function ChildStatus({
	id,
	fallback,
}: {
	id: string;
	fallback: string;
}) {
	const streaming = useLive((s) => s.sessions[id]?.streaming === true);
	const label = streaming ? "运行中" : fallback === "idle" ? "空闲" : fallback;
	return (
		<span className="shrink-0 text-[10px] text-neutral-500">{label}</span>
	);
}
