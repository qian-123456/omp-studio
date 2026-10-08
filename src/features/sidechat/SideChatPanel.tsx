/** [B] Right tab: side-chat forks of the selected session. */

import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
	ArrowUp,
	Check,
	ChevronDown,
	CornerUpLeft,
	ExternalLink,
	GitBranch,
	Loader2,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { ModelMenuContent } from "../../components/ModelSelect";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionMeta } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { acceptSession, createSideChat, getTranscript } from "../../lib/ipc";
import { type ModelOption, resolveCurrentModel, toModelKey } from "../../lib/models";
import { sessionDisplayName } from "../../lib/sessionName";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { SessionView } from "../chat/SessionView";
import { startNewSessionFromContext } from "../sessions/newSession";
import { compareSessionLabels } from "./labelSort";

const MAX_DEPTH = 3;
const NO_MODELS: ModelOption[] = [];
function getThinkingLabel(level: string) {
	switch (level) {
		case "off":
			return { label: "关闭思考", desc: "不启用思考过程" };
		case "minimal":
			return { label: "微量思考", desc: "最少思考 tokens" };
		case "low":
			return { label: "低档思考", desc: "适度思考" };
		case "medium":
			return { label: "中档思考", desc: "平衡思考与速度" };
		case "high":
			return { label: "高档思考", desc: "深度思考推理" };
		case "max":
			return { label: "最大思考", desc: "极限推理" };
		case "auto":
		default:
			return { label: "思考: 自动", desc: "遵循模型默认设置" };
	}
}


interface ContextMenuState {
	x: number;
	y: number;
	session: SessionMeta;
}

export function SideChatPanel() {
	const selectedId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
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
	const catalog = useModelOptions();
	const models = catalog ?? NO_MODELS;
	// "" = inherit the parent session's model.
	const [selectedModel, setSelectedModel] = useState("");
	const [thinking, setThinking] = useState("auto");
	const [modelOpen, setModelOpen] = useState(false);
	const modelMenuRef = useRef<HTMLDivElement>(null);
	const [thinkingOpen, setThinkingOpen] = useState(false);
	const thinkingMenuRef = useRef<HTMLDivElement>(null);


	useEffect(() => {
		void useModelCatalog.getState().refresh();
	}, []);
	const selectedModelOption = models.find(
		(m) => toModelKey(m.provider, m.id) === selectedModel,
	);
	const thinkingLevels = selectedModelOption?.thinking?.length
		? ["auto", ...selectedModelOption.thinking.filter((l) => l !== "auto"), "off"]
		: ["auto", "off", "minimal", "low", "medium", "high", "xhigh"];

	const parent = selectedId ? sessions[selectedId] : undefined;
	const children = Object.values(sessions)
		.filter((s) => s.parentId === selectedId)
		.sort((a, b) => compareSessionLabels(a.label, b.label));
	const tooDeep = (parent?.forkDepth ?? 0) >= MAX_DEPTH;
	const parentModel = useMemo(
		() => resolveCurrentModel(parent?.model, models),
		[parent?.model, models],
	);
	const activeModel = useMemo(
		() => (selectedModel ? resolveCurrentModel(selectedModel, models) : parentModel),
		[selectedModel, models, parentModel],
	);
	const displayModelName = activeModel.label || activeModel.id || "选择模型";


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
			// omp `--model` accepts a `provider/id:thinking` suffix.
			const modelArg = selectedModel
				? thinking !== "auto"
					? `${selectedModel}:${thinking}`
					: selectedModel
				: null;
			const info = await createSideChat(
				selectedId,
				q,
				pendingSelection ?? undefined,
				modelArg ?? undefined,
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
			<div className="p-3 text-xs text-[var(--text-40)]">选择一个会话后可开侧聊</div>
		);
	}

	// Selected child → embedded compact SessionView.
	if (childId) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex shrink-0 items-center gap-1 border-b border-[var(--line)] px-2 py-1">
					<button
						type="button"
						onClick={() => setChildId(null)}
						title="返回侧聊列表 (Esc)"
						className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-40)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] transition-colors"
					>
						← 返回列表 (Esc)
					</button>
					<div className="flex-1" />
					<button
						type="button"
						onClick={() => void handleSendBackToParent(childId)}
						title="将侧聊最后一条助手回复回传至父会话输入框"
						className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] transition-colors"
					>
						<CornerUpLeft size={11} />
						回传给父会话
					</button>
					<button
						type="button"
						onClick={() => selectSession(childId)}
						title="在主聊天视图中打开此侧聊"
						className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-40)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] transition-colors"
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
			<div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-3 py-2">
				<div className="flex items-center gap-1.5 min-w-0">
					<span className="text-[12px] font-medium text-[var(--text)]">独立侧聊</span>
					{parent && (
						<span
							className="text-[11px] text-[var(--text-40)] truncate max-w-[200px]"
							title={sessionDisplayName(parent)}
						>
							· 基于 {sessionDisplayName(parent)}
						</span>
					)}
				</div>
				<span className="text-[11px] text-[var(--text-40)] shrink-0">
					{children.length > 0 ? `${children.length} 个分支` : "暂无分支"}
				</span>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{children.length === 0 && (
					<div className="py-4 text-center text-[11px] text-[var(--text-40)]">
						还没有侧聊。在正文中划选文字或在下方快速提问。
					</div>
				)}
				{children.map((c, idx) => {
					const childLabel =
						c.label && c.label !== parent?.label
							? c.label
							: `${parent?.label || "#?"}.${idx + 1}`;
					const childTitle = sessionDisplayName(c);
					return (
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
							className="group mb-1 flex w-full items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-left hover:bg-[var(--ghost-hover)] transition-colors"
						>
							<button
								type="button"
								onClick={() => setChildId(c.id)}
								className="flex min-w-0 flex-1 items-center gap-2 text-left"
							>
								<GitBranch size={12} className="shrink-0 text-indigo-400" />
								<span className="shrink-0 font-mono text-[11px] text-[var(--text-60)]">
									{childLabel}
								</span>
								<span
									className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-80)]"
									title={childTitle}
								>
									{childTitle}
								</span>
								<ChildStatus id={c.id} fallback={c.status} />
							</button>
							<button
								type="button"
								title="删除侧聊"
								onClick={(e) => {
									e.stopPropagation();
									void handleDelete(c.id, childLabel);
								}}
								className="shrink-0 rounded p-1 text-[var(--text-40)] opacity-0 group-hover:opacity-100 hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] focus:opacity-100 transition-opacity"
							>
								<Trash2 size={12} />
							</button>
						</div>
					);
				})}
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
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] transition-colors"
						>
							<GitBranch size={13} className="text-[var(--text-40)]" />
							在侧栏查看
						</button>
						<button
							type="button"
							onClick={() => {
								selectSession(contextMenu.session.id);
								setContextMenu(null);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] transition-colors"
						>
							<ExternalLink size={13} className="text-[var(--text-40)]" />
							在主视图打开
						</button>
						<button
							type="button"
							onClick={() => {
								void handleSendBackToParent(contextMenu.session.id);
								setContextMenu(null);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] transition-colors"
						>
							<CornerUpLeft size={13} className="text-[var(--text-40)]" />
							回传给父会话
						</button>
						<div className="my-1 border-t border-[var(--line)]" />
						<button
							type="button"
							onClick={() => {
								const sid = contextMenu.session.id;
								const slabel = contextMenu.session.label;
								setContextMenu(null);
								void handleDelete(sid, slabel);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--status-error)] hover:bg-[var(--ghost-hover)] transition-colors"
						>
							<Trash2 size={13} />
							删除侧聊
						</button>
					</>
				)}
			</FloatingLayer>

			<div className="shrink-0 border-t border-[var(--line)] px-3 pb-3 pt-2">
				{tooDeep ? (
					<div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-3 text-center">
						<div className="text-[12px] font-medium text-[var(--text)]">
							已达分支嵌套深度上限（3 层）
						</div>
						<div className="text-[11px] leading-relaxed text-[var(--text-40)]">
							侧聊分支最多支持 3 层嵌套，无法在此分支下继续创建子侧聊。请创建新的主会话以继续开展工作。
						</div>
						<button
							type="button"
							onClick={() => void startNewSessionFromContext()}
							className="mt-1 flex items-center gap-1.5 rounded-md bg-[var(--text)] px-3 py-1.5 text-[12px] font-medium text-[var(--bg-panel)] hover:opacity-90 transition-opacity"
						>
							<Plus size={13} />
							新建主会话
						</button>
					</div>
				) : (
					<>
						{error && (
							<div className="mb-2 text-[11px] text-[var(--status-error)]">{error}</div>
						)}

						<div className="relative rounded-[22px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)] shadow-xs transition-colors focus-within:border-[var(--hairline-strong,var(--border))]">
							{/* Removable quote pill */}
							{pendingSelection && (
								<div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0.5">
									<span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--ghost-hover)] px-2 py-0.5 text-[11px] text-[var(--text-60)] max-w-full">
										<span className="truncate max-w-[200px]" title={pendingSelection}>
											引用: {pendingSelection}
										</span>
										<button
											type="button"
											onClick={() => setPendingSelection(null)}
											className="shrink-0 text-[var(--text-40)] hover:text-[var(--text)] transition-colors"
											title="移除引用"
										>
											<X size={10} />
										</button>
									</span>
								</div>
							)}

							<textarea
								ref={textareaRef}
								value={question}
								onChange={(e) => {
									setQuestion(e.target.value);
									e.target.style.height = "auto";
									e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										if (isComposing(e)) return;
										e.preventDefault();
										void create();
									}
								}}
								placeholder="输入侧聊消息，/ 命令，Enter 发送…"
								rows={1}
								className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 font-sans text-[13px] leading-[1.5] text-[var(--text)] placeholder:text-[var(--text-30,var(--text-dim))] outline-none max-h-36 min-h-[44px]"
							/>

							<div className="flex items-center justify-between gap-2 px-2.5 pb-2 text-[12px]">
								<div className="flex items-center gap-1 select-none">
									{/* Model Picker */}
									<div className="relative" ref={modelMenuRef}>
										<button
											type="button"
											onClick={() => setModelOpen((v) => !v)}
											title={`侧聊模型: ${displayModelName}${selectedModel ? "" : " (继承主会话)"}`}
											className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors select-none"
										>
											<span className="truncate max-w-36">{displayModelName}</span>
											<ChevronDown size={10} className="shrink-0 text-[var(--text-30,var(--text-dim))]" />
										</button>

										{modelOpen && (
											<FloatingLayer
												anchor={modelMenuRef.current}
												placement="top-start"
												offset={6}
												layer="popover"
												ignoreRefs={[modelMenuRef]}
												onDismiss={() => setModelOpen(false)}
												className="w-[320px] rounded-xl border border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] py-1 shadow-lg"
											>
												<ModelMenuContent
													models={catalog}
													currentValue={selectedModel}
													extras={[{ value: "", label: parentModel.label ? `继承主会话 (${parentModel.label})` : "继承主会话模型" }]}
													onSelect={(key) => {
														setSelectedModel(key);
														setThinking("auto");
														setModelOpen(false);
													}}
												/>
											</FloatingLayer>
										)}
									</div>

									{/* Thinking Level Picker */}
									<div className="relative" ref={thinkingMenuRef}>
										<button
											type="button"
											onClick={() => setThinkingOpen((v) => !v)}
											title={`思考等级: ${getThinkingLabel(thinking).label}`}
											className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors select-none"
										>
											<span className="truncate">{thinking}</span>
											<ChevronDown size={10} className="shrink-0 text-[var(--text-30,var(--text-dim))]" />
										</button>

										{thinkingOpen && (
											<FloatingLayer
												anchor={thinkingMenuRef.current}
												placement="top-start"
												offset={6}
												layer="popover"
												ignoreRefs={[thinkingMenuRef]}
												onDismiss={() => setThinkingOpen(false)}
												className="w-[200px] rounded-xl border border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] py-1 shadow-lg"
											>
												<div className="border-b border-[var(--line)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-40)]">
													思考等级
												</div>
												<div className="py-0.5">
													{thinkingLevels.map((lvl) => {
														const opt = getThinkingLabel(lvl);
														const isSelected = thinking === lvl;
														return (
															<button
																key={lvl}
																type="button"
																onClick={() => {
																	setThinking(lvl);
																	setThinkingOpen(false);
																}}
																className={clsx(
																	"flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors",
																	isSelected
																		? "bg-[var(--ghost-hover)] font-medium text-[var(--text)]"
																		: "text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]",
																)}
															>
																<span>{opt.label}</span>
																{isSelected && <Check size={12} className="text-[var(--text)]" />}
															</button>
														);
													})}
												</div>
											</FloatingLayer>
										)}
									</div>
								</div>

								{/* Send Button */}
								<button
									type="button"
									disabled={busy || !question.trim()}
									onClick={() => void create()}
									title={busy ? "正在创建侧聊…" : "创建侧聊 (Enter)"}
									className={clsx(
										"flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150 shrink-0",
										busy
											? "bg-[var(--bg-hover)] text-[var(--text-40)] cursor-not-allowed"
											: question.trim()
												? "bg-[var(--text)] text-[var(--bg-panel)] hover:opacity-90 active:scale-95 shadow-xs"
												: "bg-[var(--bg-hover)] text-[var(--text-30,var(--text-dim))] cursor-not-allowed",
									)}
								>
									{busy ? (
										<Loader2 size={13} className="animate-spin text-[var(--text-40)]" />
									) : (
										<ArrowUp size={14} className="stroke-[2.5]" />
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
		<span className="shrink-0 text-[10px] text-[var(--text-40)]">{label}</span>
	);
}

