/** [B] Right tab: side-chat forks of the selected session. */

import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
	ArrowUp,
	ChevronDown,
	CornerUpLeft,
	ExternalLink,
	GitBranch,
	Loader2,
	Plus,
	SendHorizontal,
	Trash2,
} from "lucide-react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { ModelMenuContent } from "../../components/ModelSelect";
import { ThinkingLevelPicker } from "../../components/ThinkingLevelPicker";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionMeta } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { acceptSession, createSideChat, getTranscript } from "../../lib/ipc";
import { type ModelOption, resolveCurrentModel, resolveThinkingLevels, toModelKey } from "../../lib/models";
import { sessionDisplayName } from "../../lib/sessionName";
import { toast } from "../../lib/toast";
import { type Annotation, formatWithAnnotations, sideChatAnnKey, useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { composeSelection, parseSelection, RESOLVABLE_ROLES, roleIdOf } from "../../components/modelSelectLogic";
import { ensureSettings, useSettings } from "../settings/store";
import { startNewSession } from "../sessions/newSession";
import { SessionView } from "../chat/SessionView";
import { AnnotationChip } from "../chat/AnnotationChip";
import { textAnnotationsOf } from "../chat/annotations";
import { sendPrompt } from "../chat/send";
import { compareSessionLabels } from "./labelSort";
import { MAX_SIDE_CHAT_DEPTH } from "./depth";
import {
	resolveSideChatModel,
	sideChatModelLabel,
	sideChatSelectorUsable,
} from "./modelDefault";
import { useSideChatView } from "./viewStore";

const NO_MODELS: ModelOption[] = [];
const EMPTY_ANNS: Annotation[] = [];

interface ContextMenuState {
	x: number;
	y: number;
	session: SessionMeta;
}

export function SideChatPanel() {
	const selectedId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);
	// Open child thread is persisted per parent session: it survives panel
	// collapse/expand, right-tab switches and restarts (unlike local state).
	const storedChildId = useSideChatView((s) =>
		selectedId ? (s.openChild[selectedId] ?? null) : null,
	);
	const childId = selectedId ? storedChildId : null;
	const setChildId = (id: string | null) => {
		if (selectedId) useSideChatView.getState().setOpenChild(selectedId, id);
	};
	const sideChatDrafts = useComposer((s) => s.sideChatDrafts);
	const setSideChatDraft = useComposer((s) => s.setSideChatDraft);
	const clearSideChatDraft = useComposer((s) => s.clearSideChatDraft);
	// Draft is strictly scoped to the parent session; no cross-parent leaking.
	const question = selectedId ? (sideChatDrafts[selectedId] ?? "") : "";
	const setQuestion = (val: string) => {
		if (selectedId) setSideChatDraft(selectedId, val);
	};
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	/** Question input of the slim staged-annotation bar in the open thread view. */
	const stagedInputRef = useRef<HTMLInputElement | null>(null);
	const catalog = useModelOptions();
	const models = catalog ?? NO_MODELS;
	const dedicatedSetting = useSettings((s) => s.settings?.sideChatModel);
	// "" = no per-panel override: use the dedicated setting, else inherit the parent.
	const [selectedModel, setSelectedModel] = useState("");
	// "" = no override: the dedicated setting's level, else the parent session's.
	const [thinking, setThinking] = useState("");
	const [modelOpen, setModelOpen] = useState(false);
	const modelMenuRef = useRef<HTMLDivElement>(null);
	const [thinkingOpen, setThinkingOpen] = useState(false);
	const parentThinking = useLive((s) => {
		const v = selectedId ? s.sessions[selectedId]?.state?.thinkingLevel : undefined;
		return typeof v === "string" ? v : undefined;
	});
	// Parent's live model capabilities (`thinking`): used when inheriting the parent model.
	const parentLiveThinking = useLive((s) => {
		const m = selectedId ? s.sessions[selectedId]?.state?.model : undefined;
		return m && typeof m === "object" ? (m as Record<string, unknown>).thinking : undefined;
	});


	useEffect(() => {
		void useModelCatalog.getState().refresh();
		ensureSettings();
	}, []);

	const effective = useMemo(
		() => resolveSideChatModel(selectedModel, dedicatedSetting, catalog),
		[selectedModel, dedicatedSetting, catalog],
	);
	const dedicatedPick = useMemo(
		() => parseSelection(dedicatedSetting),
		[dedicatedSetting],
	);
	const dedicatedUsable =
		dedicatedPick.selector !== "" && sideChatSelectorUsable(dedicatedPick.selector, catalog);
	const dedicatedLabel = dedicatedUsable ? sideChatModelLabel(dedicatedSetting, catalog) : "";
	const effectiveThinking = thinking || effective.level || parentThinking || "auto";

	const parent = selectedId ? sessions[selectedId] : undefined;
	const children = Object.values(sessions)
		.filter((s) => s.parentId === selectedId)
		.sort((a, b) => compareSessionLabels(a.label, b.label));
	const tooDeep = (parent?.forkDepth ?? 0) >= MAX_SIDE_CHAT_DEPTH;
	const parentModel = useMemo(
		() => resolveCurrentModel(parent?.model, models),
		[parent?.model, models],
	);
	const activeModel = useMemo(
		() => (effective.selector ? resolveCurrentModel(effective.selector, models) : parentModel),
		[effective.selector, models, parentModel],
	);
	const effectiveOption = models.find(
		(m) => toModelKey(m.provider, m.id) === activeModel.value,
	);
	// Live capabilities only describe the parent's model; use them only when inheriting it.
	const resolvedLevels = resolveThinkingLevels(
		effective.selector ? undefined : parentLiveThinking,
		effectiveOption?.thinking,
		effectiveThinking,
	);
	// Unknown capabilities (role selectors, catalog without `thinking`): offer the
	// standard ladder instead of a lone current level.
	const thinkingLevels =
		resolvedLevels.length > 1
			? resolvedLevels
			: Array.from(
					new Set([
						"auto",
						"off",
						"minimal",
						"low",
						"medium",
						"high",
						"xhigh",
						...resolvedLevels,
					]),
				);
	const effectiveRole = roleIdOf(effective.selector);
	const baseModelName = effectiveRole
		? RESOLVABLE_ROLES[effectiveRole]
		: (activeModel.label || activeModel.id || "选择模型");
	const displayModelName = baseModelName;
	const annKey = selectedId ? sideChatAnnKey(selectedId) : "";
	const stagedAll = useComposer((s) => s.annotations[annKey]) ?? EMPTY_ANNS;
	const stagedAnns = useMemo(() => textAnnotationsOf(stagedAll), [stagedAll]);
	// SelectionToolbar bumps this nonce each time it stages into our key.
	const stagedFocusNonce = useComposer((s) => (annKey ? s.focusNonce[annKey] : 0));
	const moveAnnotation = useComposer((s) => s.moveAnnotation);


	// Esc returns to list when viewing a child session
	useEscapeKey(() => setChildId(null), childId !== null && contextMenu === null);
	// Esc closes context menu
	useEscapeKey(() => setContextMenu(null), contextMenu !== null);

	// Focus whichever question input is mounted when a new annotation is staged
	// (also on first mount right after staging; a bumped-but-unconsumed nonce
	// never drops). Staged annotations live in the store, so nothing is lost
	// when this panel unmounts or the parent changes.
	const lastFocusNonceRef = useRef(0);
	useEffect(() => {
		const nonce = stagedFocusNonce ?? 0;
		if (!nonce || nonce === lastFocusNonceRef.current) return;
		lastFocusNonceRef.current = nonce;
		setTimeout(() => {
			const input =
				childId && stagedAnns.length > 0
					? stagedInputRef.current
					: textareaRef.current;
			input?.focus();
		}, 50);
	}, [stagedFocusNonce, childId, stagedAnns.length]);

	useEffect(() => {
		setError(null);
		setContextMenu(null);
	}, [selectedId]);

	const send = async () => {
		const q = question.trim();
		const parentId = selectedId;
		if (!parentId || busy || (!q && stagedAnns.length === 0)) return;
		const key = sideChatAnnKey(parentId);
		const anns = stagedAll;
		const selection = formatWithAnnotations("", anns) || undefined;
		const questionText = q || "请结合引用内容回答";
		const threadId = childId;
		setBusy(true);
		setError(null);
		try {
			if (threadId) {
				// Open thread: the question plus numbered quote blocks append to it.
				await sendPrompt(threadId, formatWithAnnotations(questionText, anns));
			} else {
				// omp `--model` accepts a `provider/id:thinking` suffix; the dedicated
				// setting's stored level applies unless the thinking picker overrides it.
				const modelArg = effective.selector
					? composeSelection(effective.selector, effectiveThinking === "auto" ? null : effectiveThinking)
					: null;
				const info = await createSideChat(
					parentId,
					questionText,
					selection,
					modelArg ?? undefined,
				);
				// Parent switched while creating: don't leak the child into the new parent.
				if (useUi.getState().selectedSessionId === parentId) {
					setChildId(info.sessionId);
				}
			}
			clearSideChatDraft(parentId);
			useComposer.getState().clearAnnotations(key);
			if (textareaRef.current) {
				textareaRef.current.style.height = "auto";
			}
			void useSessions.getState().load().catch(() => {});
		} catch (err) {
			const msg = errMsg(err);
			setError(msg);
			toast.error(`${threadId ? "发送侧聊消息失败" : "创建侧聊失败"}: ${msg}`);
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
				{/* Staged-annotation bar: quotes waiting on this parent append to
				    the open thread when sent from here (or the list composer). */}
				{stagedAnns.length > 0 && (
					<div className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] px-2 py-1.5">
						<div className="min-w-0 shrink-0">
							<AnnotationChip
								sessionId={annKey}
								anchorSessionId={selectedId}
								annotations={stagedAnns}
								onMove={(id) => moveAnnotation(annKey, selectedId, id)}
								moveLabel="移动到主对话"
							/>
						</div>
						<input
							ref={stagedInputRef}
							value={question}
							onChange={(e) => setQuestion(e.target.value)}
							onKeyDown={(e) => {
								if (e.key !== "Enter" || isComposing(e)) return;
								e.preventDefault();
								void send();
							}}
							placeholder="追问此侧聊（附引用），Enter 发送…"
							aria-label="追加到侧聊的问题"
							className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-30)]"
						/>
						<button
							type="button"
							disabled={busy}
							onClick={() => void send()}
							title="发送到当前侧聊 (Enter)"
							className={clsx(
								"flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all",
								busy
									? "bg-[var(--bg-hover)] text-[var(--text-40)] cursor-not-allowed"
									: "bg-[var(--text)] text-[var(--bg-panel)] hover:opacity-90 active:scale-95",
							)}
						>
							{busy ? (
								<Loader2 size={12} className="animate-spin" />
							) : (
								<SendHorizontal size={12} />
							)}
						</button>
					</div>
				)}
				<div className="min-h-0 flex-1">
					<SessionView sessionId={childId} compact />
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
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
							onClick={() => void startNewSession()}
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
							{/* Staged annotations chip: hover to review/edit, move or delete. */}
							{stagedAnns.length > 0 && (
								<div className="px-3 pt-2.5">
									<AnnotationChip
										sessionId={annKey}
										anchorSessionId={selectedId}
										annotations={stagedAnns}
										onMove={(id) => moveAnnotation(annKey, selectedId, id)}
										moveLabel="移动到主对话"
									/>
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
										void send();
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
											title={`侧聊模型: ${displayModelName}${effective.source === "picker" ? "" : effective.source === "setting" ? " (侧聊专属)" : " (跟随主会话)"}`}
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
													currentValue={effective.selector}
													extras={[
														{
															value: "",
															label: dedicatedUsable
																? `默认：${dedicatedLabel}`
																: parentModel.label
																	? `默认：跟随主会话 (${parentModel.label})`
																	: "默认：跟随主会话模型",
														},
													]}
													onSelect={(key) => {
														setSelectedModel(key);
														setThinking("");
														setModelOpen(false);
													}}
												/>
											</FloatingLayer>
										)}
									</div>

									{/* Thinking Level Picker (shared with the main composer) */}
									<ThinkingLevelPicker
										levels={thinkingLevels}
										value={effectiveThinking}
										open={thinkingOpen}
										onOpenChange={setThinkingOpen}
										onSelect={(lvl) => {
											setThinking(lvl);
											setThinkingOpen(false);
										}}
									/>
								</div>

								{/* Send Button */}
								<button
									type="button"
									disabled={busy || (!question.trim() && stagedAnns.length === 0)}
									onClick={() => void send()}
									title={
										busy
											? "正在创建侧聊…"
											: childId
												? "发送到当前侧聊 (Enter)"
												: "创建侧聊 (Enter)"
									}
									className={clsx(
										"flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150 shrink-0",
										busy
												? "bg-[var(--bg-hover)] text-[var(--text-40)] cursor-not-allowed"
												: question.trim() || stagedAnns.length > 0
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

