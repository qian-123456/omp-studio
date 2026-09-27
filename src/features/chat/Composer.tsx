/** [B] Composer: annotation pills, slash autocomplete, held queue,
 * steer/stop, model + thinking pickers, /fork interception. */

import clsx from "clsx";
import {
	AlertCircle,
	ArrowUp,
	Bot,
	Brain,
	Check,
	ChevronDown,
	CornerDownRight,
	Loader2,
	Plus,
	ShieldCheck,
	Square,
	X,
	Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSideChat, listModels, listWorkspaceFiles, readTextFile, rpcEnsureLive, rpcSend, saveClipboardImage, sessionUsage } from "../../lib/ipc";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../settings/store";
import { ContextRing } from "./ContextRing";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { isComposing } from "../../lib/hooks";
import { formatWithAnnotations, useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useHeldQueue } from "./heldQueue";
import { abortTurn, sendPrompt, useAbortState } from "./send";
import {
	buildSetModelPayload,
	extractThinkingLevels,
	type ModelOption,
	parseModels,
	resolveCurrentModel,
	toModelKey,
} from "../../lib/models";
import { ModelMenuContent } from "../../components/ModelSelect";
/** Tooltip descriptions for known thinking levels. The visible label is the
 * raw omp level name (low/high/xhigh/…), English, matching the omp TUI. */
const THINKING_DESCS: Record<string, string> = {
	auto: "跟随模型的默认力度",
	off: "不启用深度推理思考",
	minimal: "轻度推理，适合简单问答",
	low: "较少推理步骤，响应较快",
	medium: "均衡推理与响应速度",
	high: "完整多步推理，适合复杂分析",
	xhigh: "高强度推理，适合复杂推演",
	max: "无限制深度推理，耗费最多预算",
};

function thinkingLabel(level: string): { label: string; desc: string } {
	return { label: level, desc: THINKING_DESCS[level] ?? "" };
}

const EMPTY_LIST: string[] = [];

interface SlashToken {
	query: string;
	start: number;
	end: number;
}

function getSlashToken(fullText: string, cursor: number): SlashToken | null {
	const beforeCursor = fullText.slice(0, cursor);
	const match = /(?:^|\s)(\/([^\s/]*))$/.exec(beforeCursor);
	if (!match) return null;
	const fullToken = match[1];
	const query = match[2];
	const start = beforeCursor.length - fullToken.length;
	return { query, start, end: cursor };
}

export function Composer({
	sessionId,
	readonly,
	compact,
}: {
	sessionId: string;
	/** External session — observation only. */
	readonly?: boolean;
	compact?: boolean;
}) {
	const [busy, setBusy] = useState(false);
	const [menuIndex, setMenuIndex] = useState(0);
	const [menuDismissed, setMenuDismissed] = useState(false);
	const [cursorPos, setCursorPos] = useState(0);
	const [historyIdx, setHistoryIdx] = useState(-1);
	const draftBeforeHistory = useRef("");
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
	const [editingComment, setEditingComment] = useState("");
	const [models, setModels] = useState<ModelOption[] | null>(null);
	const [modelOpen, setModelOpen] = useState(false);
	const modelMenuRef = useRef<HTMLDivElement>(null);

	const [thinkingOpen, setThinkingOpen] = useState(false);
	const thinkingMenuRef = useRef<HTMLDivElement>(null);

	const taRef = useRef<HTMLTextAreaElement>(null);

	// Draft state bound to useComposer store so switching sessions does not lose input
	const text = useComposer((s) => s.drafts[sessionId] ?? "");
	const setDraft = useComposer((s) => s.setDraft);
	const clearDraft = useComposer((s) => s.clearDraft);
	const setText = (nextText: string) => setDraft(sessionId, nextText);

	const history = useComposer((s) => s.history);
	const pushHistory = useComposer((s) => s.pushHistory);
	const focusNonce = useComposer((s) => s.focusNonce[sessionId]);

	const live = useLive((s) => s.sessions[sessionId]);
	const streaming = live?.streaming === true;
	const commands = live?.commands ?? [];
	const annotations = useComposer(
		(s) => s.annotations[sessionId] ?? EMPTY_LIST,
	);
	const addAnnotation = useComposer((s) => s.addAnnotation);
	const updateAnnotation = useComposer((s) => s.updateAnnotation);
	const removeAnnotation = useComposer((s) => s.removeAnnotation);
	const clearAnnotations = useComposer((s) => s.clearAnnotations);
	const scrollToItem = useLive((s) => s.scrollToItem);

	const held = useHeldQueue((s) => s.queues[sessionId] ?? EMPTY_LIST);
	const setDismissed = useHeldQueue((s) => s.setDismissed);
	const selectSession = useUi((s) => s.selectSession);
	const setRightTab = useUi((s) => s.setRightTab);


	// @ file-completion state
	const sessionMeta = useSessions((s) => s.sessions[sessionId]);
	const [atFiles, setAtFiles] = useState<string[] | null>(null);
	const atToken = useMemo(() => {
		const beforeCursor = text.slice(0, cursorPos);
		const m = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
		if (!m) return null;
		return { query: m[1], start: beforeCursor.length - m[1].length - 1 };
	}, [text, cursorPos]);
	const atMenu = useMemo(() => {
		if (!atToken || !atFiles) return [];
		const q = atToken.query.toLowerCase();
		return atFiles
			.filter((p) => !q || p.toLowerCase().includes(q))
			.slice(0, 10);
	}, [atToken, atFiles]);
	useEffect(() => {
		if (atToken && atFiles === null) {
			const cwd = sessionMeta?.cwd;
			if (!cwd) return;
			void listWorkspaceFiles(cwd)
				.then(setAtFiles)
				.catch(() => setAtFiles([]));
		}
	}, [atToken !== null, atFiles === null, sessionMeta?.cwd]);
	const isAborting = useAbortState((s) => s.aborting[sessionId] === true);

	// Settings & approval mode
	const settings = useSettings((s) => s.settings);
	const updateSettings = useSettings((s) => s.update);
	const approvalMode = settings?.defaultApprovalMode || "write";
	const handleToggleApprovalMode = async () => {
		const nextMode = approvalMode === "yolo" ? "write" : "yolo";
		try {
			await updateSettings({ defaultApprovalMode: nextMode });
			toast.success(
				`已切换权限模式: ${nextMode === "yolo" ? "完全访问" : "需确认写入"}`,
			);
		} catch (err) {
			toast.error(`切换权限模式失败: ${errMsg(err)}`);
		}
	};

	// Context usage calculations for ContextRing
	const contextRaw = live?.state?.contextUsage;
	const contextUsageObj =
		typeof contextRaw === "object" && contextRaw !== null
			? (contextRaw as Record<string, unknown>)
			: null;
	const contextPct =
		typeof contextUsageObj?.percent === "number"
			? contextUsageObj.percent
			: undefined;

	// Total tokens summary
	const [totalTokensStr, setTotalTokensStr] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		sessionUsage(sessionId)
			.then((u) => {
				if (!cancelled && u.available) {
					setTotalTokensStr(`${(u.tokens / 1000).toFixed(1)}k tok`);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [sessionId, streaming]);

	// Plus button: attach file or insert @
	const handleAddAttachment = async () => {
		try {
			const selected = await openDialog({
				multiple: false,
				directory: false,
				title: "选择附加文件",
			});
			if (!selected) return;
			const filePath = typeof selected === "string" ? selected : selected[0];
			if (!filePath) return;
			try {
				const content = await readTextFile(filePath);
				addAnnotation(sessionId, {
					source: "doc",
					file: filePath,
					text: content,
				});
				toast.success("已添加文件引用");
			} catch (readErr) {
				toast.error(`读取文件失败: ${errMsg(readErr)}`);
			}
		} catch (dialogErr) {
			toast.error(`打开文件对话框失败: ${errMsg(dialogErr)}`);
		}
	};
	useEffect(() => setMenuIndex(0), [atToken?.query]);

	// Focus textarea whenever focusNonce increments (e.g. from SelectionToolbar)
	useEffect(() => {
		if (focusNonce) {
			taRef.current?.focus();
		}
	}, [focusNonce]);

	// Slash autocomplete at cursor position
	const slashToken = useMemo(() => {
		if (menuDismissed) return null;
		return getSlashToken(text, cursorPos);
	}, [text, cursorPos, menuDismissed]);

	const menu = useMemo(() => {
		if (!slashToken) return [];
		const q = slashToken.query.toLowerCase();
		return [
			{ name: "fork", description: "分叉一个侧聊", hint: "<问题>" },
			...commands.map((c) => ({
				name: c.name,
				description: c.description ?? "",
				hint: c.hint ?? "",
			})),
		]
			.filter((c) => c.name.toLowerCase().startsWith(q))
			.slice(0, 8);
	}, [slashToken, commands]);

	useEffect(() => setMenuIndex(0), [slashToken?.query]);

	const state = live?.state ?? {};
	const currentThinking = (state.thinkingLevel as string | undefined) ?? "auto";

	const current = useMemo(
		() => resolveCurrentModel(state.model ?? sessionMeta?.model, models),
		[state.model, sessionMeta?.model, models],
	);

	// Thinking levels: prefer the live model's own `thinking` block from
	// get_state (always present for the running session); fall back to the
	// models catalog entry (unreliable — get_available_models can exceed the
	// rpc transport limit and models.db caches use the object shape).
	const currentModelOption = useMemo(
		() =>
			models?.find(
				(m) => current.value && toModelKey(m.provider, m.id) === current.value,
			) ?? models?.find((m) => m.id === current.id && m.provider === current.provider),
		[models, current],
	);
	const thinkingLevels = useMemo(() => {
		const stateThinking = extractThinkingLevels(
			(state.model as Record<string, unknown> | undefined)?.thinking,
		);
		const supported =
			stateThinking.length > 0
				? stateThinking
				: (currentModelOption?.thinking ?? []);
		// omp TUI always offers "auto" (model default); "off" when reasoning exists.
		const levels = ["auto", ...supported.filter((l) => l !== "auto")];
		if (supported.length > 0 && !levels.includes("off")) levels.push("off");
		return levels;
	}, [state.model, currentModelOption]);
	const curThinkingObj = thinkingLabel(currentThinking);
	const loadModels = async () => {
		if (models !== null && models.length > 0) return;
		// Prefer the CLI-backed listModels (`omp models --json`): same filtered,
		// slim payload NewSessionDialog uses. get_available_models is only a
		// fallback — large catalogs exceed the rpc transport limit there.
		try {
			const listed = await listModels();
			if (listed && listed.length > 0) {
				setModels(parseModels(listed));
				return;
			}
		} catch {
			/* rpc fallback below */
		}

		try {
			if (live?.alive) {
				const resp = (await rpcSend(sessionId, {
					type: "get_available_models",
				})) as Record<string, unknown>;
				const parsed = parseModels(resp.data ?? resp);
				setModels(parsed);
			}
		} catch {
			setModels([]);
		}
	};

	// Preload models regardless of session alive state
	useEffect(() => {
		void loadModels();
	}, [sessionId, live?.alive]);

	// Reset aborting state once streaming stops
	useEffect(() => {
		if (!streaming && isAborting) {
			useAbortState.getState().setAborting(sessionId, false);
		}
	}, [streaming, isAborting, sessionId]);

	// Auto-resizing textarea with max height constraint
	useEffect(() => {
		const ta = taRef.current;
		if (!ta) return;
		ta.style.height = "auto";
		const minH = compact ? 42 : 58;
		const maxH = 220;
		const nextH = Math.min(Math.max(ta.scrollHeight, minH), maxH);
		ta.style.height = `${nextH}px`;
		ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
	}, [text, compact]);

	// Close model and thinking dropdowns on outside click or Esc
	useEffect(() => {
		if (!modelOpen && !thinkingOpen) return;
		const onDown = (e: MouseEvent) => {
			if (modelOpen && !modelMenuRef.current?.contains(e.target as Node)) {
				setModelOpen(false);
			}
			if (thinkingOpen && !thinkingMenuRef.current?.contains(e.target as Node)) {
				setThinkingOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (isComposing({ nativeEvent: e, key: e.key })) return;
				e.stopPropagation();
				setModelOpen(false);
				setThinkingOpen(false);
			}
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [modelOpen, thinkingOpen]);

	const applySlashCommand = (cmdName: string) => {
		if (!slashToken) return;
		const before = text.slice(0, slashToken.start);
		const after = text.slice(slashToken.end);
		const replacement = `/${cmdName} `;
		const nextText = `${before}${replacement}${after}`;
		setText(nextText);
		const nextCursor = before.length + replacement.length;
		setCursorPos(nextCursor);
		setMenuDismissed(true);
		setTimeout(() => {
			if (taRef.current) {
				taRef.current.focus();
				taRef.current.setSelectionRange(nextCursor, nextCursor);
			}
		}, 0);
	};

	// @ completion: replace the @token with @"<path>" and keep typing.
	const applyAtCompletion = (path: string) => {
		if (!atToken) return;
		const before = text.slice(0, atToken.start);
		const after = text.slice(cursorPos);
		const replacement = `@"${path}" `;
		const nextText = `${before}${replacement}${after}`;
		setText(nextText);
		const nextCursor = before.length + replacement.length;
		setCursorPos(nextCursor);
		setAtFiles(null); // reset; re-fetch next @
		setTimeout(() => {
			taRef.current?.focus();
			taRef.current?.setSelectionRange(nextCursor, nextCursor);
		}, 0);
	};

	const fork = async (question: string) => {
		try {
			const info = await createSideChat(sessionId, question.trim());
			clearDraft(sessionId);
			setRightTab("sidechat");
			selectSession(info.sessionId);
		} catch (err) {
			toast.error(`创建侧聊失败: ${errMsg(err)}`);
		}
	};

	const submit = async (steer: boolean) => {
		const raw = text;
		if (!raw.trim() || busy) return;
		const trimmedRaw = raw.trim();
		if (
			trimmedRaw === "/fork" ||
			trimmedRaw.startsWith("/fork ") ||
			trimmedRaw.startsWith("/fork\t")
		) {
			const question = trimmedRaw.replace(/^\/fork\s*/, "").trim();
			if (!question) {
				toast.info("用法: /fork <问题>");
				return;
			}
			await fork(question);
			return;
		}
		const message = formatWithAnnotations(raw, annotations);
		setBusy(true);
		try {
			await sendPrompt(sessionId, message, { steer });
			pushHistory(raw.trim());
			clearDraft(sessionId);
			clearAnnotations(sessionId);
		} catch (err) {
			toast.error(`发送失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const handleAbort = async () => {
		try {
			await abortTurn(sessionId);
			toast.info("已请求停止当前回合");
		} catch (err) {
			toast.error(`停止失败: ${errMsg(err)}`);
		}
	};
	const fileToBase64 = (file: File | Blob): Promise<string> =>
		new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				const commaIdx = result.indexOf(",");
				resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result);
			};
			reader.onerror = (err) => reject(err);
			reader.readAsDataURL(file);
		});

	const processImageFile = async (file: File | Blob) => {
		try {
			const base64 = await fileToBase64(file);
			const savedPath = await saveClipboardImage(base64);
			addAnnotation(sessionId, {
				source: "doc",
				file: savedPath,
				text: `[图片: ${savedPath}]`,
			});
			toast.success(
				`已附加图片: ${file instanceof File ? file.name : "剪贴板图片"}`,
			);
		} catch (err) {
			toast.error(`处理图片失败: ${errMsg(err)}`);
		}
	};

	const processTextFile = async (file: File) => {
		try {
			const content = await file.text();
			addAnnotation(sessionId, {
				source: "doc",
				file: file.name,
				text: content,
			});
			toast.success(`已附加文件内容: ${file.name}`);
		} catch (err) {
			toast.error(`读取文件失败: ${errMsg(err)}`);
		}
	};

	const onDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDraggingOver(true);
	};

	const onDragLeave = (e: React.DragEvent<HTMLTextAreaElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDraggingOver(false);
	};

	const onDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDraggingOver(false);
		const files = Array.from(e.dataTransfer.files);
		if (files.length === 0) return;
		for (const file of files) {
			if (file.type.startsWith("image/")) {
				await processImageFile(file);
			} else {
				await processTextFile(file);
			}
		}
	};

	const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		let handledImage = false;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.type.startsWith("image/")) {
				const blob = item.getAsFile();
				if (blob) {
					handledImage = true;
					await processImageFile(blob);
				}
			}
		}
		if (handledImage) {
			e.preventDefault();
		}
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (isComposing(e)) return;

		// @ file-completion navigation — takes precedence over slash.
		if (atMenu.length > 0 && atToken) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setMenuIndex(
					(i) => (i + (e.key === "ArrowDown" ? 1 : -1) + atMenu.length) % atMenu.length,
				);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				applyAtCompletion(atMenu[menuIndex]);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setAtFiles(null);
				return;
			}
		}

		// Slash menu keyboard navigation
		if (menu.length > 0 && slashToken) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setMenuIndex(
					(i) => (i + (e.key === "ArrowDown" ? 1 : -1) + menu.length) % menu.length,
				);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				applySlashCommand(menu[menuIndex].name);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setMenuDismissed(true);
				return;
			}
		}

		// Prompt history navigation on empty text
		if (e.key === "ArrowUp") {
			if (text === "" && history.length > 0) {
				e.preventDefault();
				draftBeforeHistory.current = "";
				const targetIdx = history.length - 1;
				setHistoryIdx(targetIdx);
				setText(history[targetIdx]);
				return;
			}
			if (historyIdx !== -1) {
				e.preventDefault();
				if (historyIdx > 0) {
					const targetIdx = historyIdx - 1;
					setHistoryIdx(targetIdx);
					setText(history[targetIdx]);
				}
				return;
			}
		}
		if (e.key === "ArrowDown") {
			if (historyIdx !== -1) {
				e.preventDefault();
				if (historyIdx < history.length - 1) {
					const targetIdx = historyIdx + 1;
					setHistoryIdx(targetIdx);
					setText(history[targetIdx]);
				} else {
					setHistoryIdx(-1);
					setText(draftBeforeHistory.current);
				}
				return;
			}
		}

		if (e.key === "Enter") {
			if (e.metaKey || e.ctrlKey) {
				e.preventDefault();
				void submit(true);
			} else if (!e.shiftKey) {
				e.preventDefault();
				void submit(false);
			}
		}
	};

	if (readonly) {
		return (
			<div className="border-t border-neutral-800 px-3 py-2 text-center text-[12px] text-neutral-500">
				只读观察 — 接管后可操作
			</div>
		);
	}


	return (
		<div className="shrink-0 border-t border-neutral-800">
			{/* Model / thinking / held controls live inside the composer box's
			    bottom bar (Codex-style) — rendered below the textarea. */}

			{/* Annotation pills. Clickable to navigate to original message or in-place edit comment. */}
			{annotations.length > 0 && (
				<div className="flex flex-wrap gap-1 px-3 pt-2">
					{annotations.map((a, i) => {
						const isEditing = editingAnnId === a.id;
						if (isEditing) {
							return (
								<div
									key={a.id}
									className="flex items-center gap-1 rounded-full border border-indigo-500 bg-neutral-900 px-2 py-0.5 text-[11px] shadow-sm"
								>
									<span className="shrink-0 text-neutral-400">
										[{i + 1}] {a.file ?? a.source}
										{a.lines ? ` ${a.lines}` : ""}:
									</span>
									<input
										type="text"
										autoFocus
										value={editingComment}
										placeholder="输入批注 (Enter保存, Esc取消)..."
										onChange={(e) => setEditingComment(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												if (isComposing(e)) return;
												e.preventDefault();
												e.stopPropagation();
												updateAnnotation(sessionId, a.id, {
													comment: editingComment.trim() || undefined,
												});
												setEditingAnnId(null);
											} else if (e.key === "Escape") {
												e.preventDefault();
												e.stopPropagation();
												setEditingAnnId(null);
											}
										}}
										onBlur={() => {
											updateAnnotation(sessionId, a.id, {
												comment: editingComment.trim() || undefined,
											});
											setEditingAnnId(null);
										}}
										className="w-32 bg-transparent text-neutral-100 outline-none placeholder:text-neutral-600 focus:w-48 transition-all"
									/>
								</div>
							);
						}
						return (
							<span
								key={a.id}
								onClick={() => {
									setEditingAnnId(a.id);
									setEditingComment(a.comment ?? "");
								}}
								title={`点击修改批注${a.comment ? `\n批注: ${a.comment}` : ""}${a.text ? `\n原内容: ${a.text}` : ""}`}
								className="group flex max-w-72 cursor-pointer items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800/70 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-indigo-500 hover:text-neutral-100"
							>
								<span className="truncate">
									[{i + 1}] {a.file ?? a.source}
									{a.lines ? ` ${a.lines}` : ""}
									{a.comment ? `：${a.comment}` : ""}
								</span>
								{a.itemId && (
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											scrollToItem(sessionId, a.itemId!);
										}}
										title="定位到原消息"
										className="text-neutral-500 hover:text-indigo-300"
									>
										<CornerDownRight size={10} />
									</button>
								)}
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										removeAnnotation(sessionId, a.id);
									}}
									title="删除引用"
									className="text-neutral-500 hover:text-neutral-200"
								>
									<X size={10} />
								</button>
							</span>
						);
					})}
				</div>
			)}

			<div className="relative px-3 py-2">
				{/* Slash-command menu floats above the composer box */}
				{/* @ file-completion menu — same floating-above-box pattern */}
				{atMenu.length > 0 && atToken && (
					<div className="absolute bottom-full left-3 right-3 mb-1 max-h-64 overflow-y-auto overflow-x-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-lg">
						{atMenu.map((p, i) => (
							<button
								key={p}
								type="button"
								onMouseDown={(e) => {
									e.preventDefault();
									applyAtCompletion(p);
								}}
								className={clsx(
									"flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
									i === menuIndex
										? "bg-neutral-800 text-neutral-100"
										: "text-neutral-300",
								)}
							>
								<span className="truncate font-mono text-neutral-300">{p}</span>
							</button>
						))}
					</div>
				)}
				{menu.length > 0 && slashToken && (
					<div className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-lg">
						{menu.map((c, i) => (
							<button
								key={c.name}
								type="button"
								onMouseDown={(e) => {
									e.preventDefault();
									applySlashCommand(c.name);
								}}
								className={clsx(
									"flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-[12px]",
									i === menuIndex
										? "bg-neutral-800 text-neutral-100"
										: "text-neutral-300",
								)}
							>
								<span className="font-mono text-indigo-300">/{c.name}</span>
								{c.hint && <span className="text-neutral-500">{c.hint}</span>}
								<span className="truncate text-neutral-500">{c.description}</span>
							</button>
						))}
					</div>
				)}

				{/* Composer box: textarea on top, bottom bar inside (Codex-style rounded card) */}
				<div
					className={clsx(
						"relative rounded-2xl border bg-neutral-900/90 shadow-sm backdrop-blur-sm transition-all duration-200",
						isDraggingOver
							? "border-indigo-500 bg-indigo-950/20 ring-2 ring-indigo-500/30"
							: "border-neutral-800/80 focus-within:border-neutral-700 focus-within:ring-1 focus-within:ring-neutral-700/40",
					)}
				>
					<textarea
						ref={taRef}
						data-composer={sessionId}
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							setCursorPos(e.target.selectionStart ?? e.target.value.length);
							setMenuDismissed(false);
							if (historyIdx !== -1) setHistoryIdx(-1);
						}}
						onSelect={(e) =>
							setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)
						}
						onKeyUp={(e) =>
							setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)
						}
						onClick={(e) =>
							setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)
						}
						onKeyDown={onKeyDown}
						onDragOver={onDragOver}
						onDragLeave={onDragLeave}
						onDrop={(e) => void onDrop(e)}
						onPaste={(e) => void onPaste(e)}
						rows={compact ? 2 : 3}
						placeholder={
							streaming
								? "输入消息... (Enter 暂存，⌘Enter 插队)"
								: "提出后续修改要求... (Enter 发送，Shift+Enter 换行，/ 命令，@ 文件)"
						}
						style={{ outline: "none", boxShadow: "none" }}
						className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13px] leading-relaxed text-neutral-100 outline-none !outline-none focus:outline-none focus:ring-0 placeholder:text-neutral-500/60"
					/>

					{/* Bottom bar: + button, permission pill, context ring (left); model/thinking pills, send/stop (right) */}
					<div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1 text-[11px] text-neutral-500">
						{/* Left side actions */}
						<div className="flex items-center gap-1.5">
							{/* Plus button for attachments / annotations */}
							<button
								type="button"
								onClick={() => void handleAddAttachment()}
								title="添加附件或引用文件 (@ 文件)"
								className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
							>
								<Plus size={14} />
							</button>

							{/* Permission / Approval Mode Pill */}
							<button
								type="button"
								onClick={handleToggleApprovalMode}
								title={`权限模式: ${approvalMode === "yolo" ? "完全访问" : "需确认写入"} (点击切换)`}
								className={clsx(
									"flex items-center gap-1 text-[11px] font-medium transition-colors",
									approvalMode === "yolo"
										? "text-amber-400 hover:text-amber-300 hover:bg-amber-950/30 px-2 py-0.5 rounded-md"
										: "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60 px-2 py-0.5 rounded-md",
								)}
							>
								{approvalMode === "yolo" ? (
									<AlertCircle size={12} className="shrink-0 text-amber-400" />
								) : (
									<ShieldCheck size={12} className="shrink-0 text-neutral-400" />
								)}
								<span>{approvalMode === "yolo" ? "完全访问" : "需确认写入"}</span>
								<ChevronDown
									size={10}
									className={clsx(
										"shrink-0",
										approvalMode === "yolo" ? "text-amber-500/70" : "text-neutral-500",
									)}
								/>
							</button>
						</div>

						{/* Right side actions */}
						<div className="flex items-center gap-1.5">
							{/* Context Ring (极简圆环图案) */}
							<ContextRing
								percent={contextPct}
								usageObj={contextUsageObj}
								totalTokensStr={totalTokensStr}
								className="shrink-0"
							/>

							{/* Model picker pill (always visible) */}
							<div className="relative" ref={modelMenuRef}>
								<button
									type="button"
									onClick={() => {
										setModelOpen((v) => !v);
										if (!models || models.length === 0) void loadModels();
									}}
									title={current.label || sessionMeta?.model || "选择模型"}
									className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
								>
									<Bot size={11} className="shrink-0 text-neutral-400" />
									<span className={clsx("truncate", compact ? "max-w-24" : "max-w-36")}>
										{current.label ||
											sessionMeta?.model ||
											(models === null ? "加载中…" : "选择模型…")}
									</span>
									<ChevronDown size={10} className="shrink-0 text-neutral-500" />
								</button>

								{modelOpen && (
									<div className="absolute bottom-full right-0 z-30 mb-1 w-[400px] rounded-xl border border-neutral-700 bg-neutral-900/95 py-1 shadow-2xl backdrop-blur-md">
										<ModelMenuContent
											models={models}
											currentValue={current.value}
											onSelect={async (key) => {
												const payload = buildSetModelPayload(key, models);
												if (payload) {
													try {
														if (!live?.alive) {
															await rpcEnsureLive(sessionId);
														}
														await rpcSend(sessionId, payload);
														await rpcSend(sessionId, { type: "get_state" });
														toast.success("已切换模型");
													} catch (err) {
														toast.error(`切换模型失败: ${errMsg(err)}`);
													}
												}
												setModelOpen(false);
											}}
										/>
									</div>
								)}
							</div>

							{/* Thinking-level picker (per-model levels) */}
							{thinkingLevels.length > 0 && (
								<div className="relative" ref={thinkingMenuRef}>
									<button
										type="button"
										onClick={() => setThinkingOpen((v) => !v)}
										title={
											curThinkingObj
												? `思考等级: ${curThinkingObj.label}${curThinkingObj.desc ? ` (${curThinkingObj.desc})` : ""}`
												: "配置思考等级"
										}
										className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
									>
										<Brain size={11} className="shrink-0 text-neutral-400" />
										<span className="truncate">
											{curThinkingObj?.label ?? "思考等级"}
										</span>
										<ChevronDown size={10} className="shrink-0 text-neutral-500" />
									</button>

									{thinkingOpen && (
										<div className="absolute bottom-full right-0 z-30 mb-1 w-[260px] rounded-xl border border-neutral-700 bg-neutral-900/95 py-1 shadow-2xl backdrop-blur-md">
											<div className="border-b border-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-400">
												思考等级
											</div>
											<div className="py-0.5">
												{thinkingLevels.map((level) => {
													const opt = thinkingLabel(level);
													const isSelected = currentThinking === level;
													return (
														<button
															key={level}
															type="button"
															onClick={async () => {
																if (live?.alive) {
																	try {
																		await rpcSend(sessionId, {
																			type: "set_thinking_level",
																			level,
																		});
																	} catch (err) {
																		toast.error(errMsg(err));
																	}
																}
																setThinkingOpen(false);
															}}
															className={clsx(
																"flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors",
																isSelected
																	? "bg-indigo-600/20 text-indigo-300"
																	: "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100",
															)}
														>
															<div className="min-w-0 pr-2">
																<div className="font-medium">{opt.label}</div>
																{opt.desc && (
 																	<div className="text-[10px] text-neutral-500">
 																		{opt.desc}
 																	</div>
 																)}
 															</div>
 															{isSelected && (
 																<Check
 																	size={13}
 																	className="shrink-0 text-indigo-400"
 																/>
 															)}
 														</button>
 													);
 												})}
 											</div>
 										</div>
 									)}
 								</div>
 							)}

 							{/* Held queue count pill (clickable to un-dismiss) */}
							{held.length > 0 && (
								<button
									type="button"
									onClick={() => setDismissed(sessionId, false)}
									title="点击查看排队消息"
									className="flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800/80 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-700 transition-colors"
								>
									<CornerDownRight size={11} className="text-neutral-400" />
									<span>排队 {held.length}</span>
								</button>
							)}

							{/* Send / streaming controls (Codex circular button with ArrowUp) */}
							<div className="flex items-center gap-1.5">
								{streaming ? (
									<>
										<button
											type="button"
											onClick={() => void handleAbort()}
											disabled={isAborting}
											title={isAborting ? "正在停止当前回合…" : "停止当前回合"}
											className="flex h-7 w-7 items-center justify-center rounded-full border border-rose-800/50 bg-neutral-800 text-rose-400 transition-colors hover:bg-rose-950/80 disabled:opacity-50"
										>
											{isAborting ? (
												<Loader2 size={13} className="animate-spin" />
											) : (
												<Square size={11} />
											)}
										</button>
										{text.trim() && (
											<>
												<button
													type="button"
													title="排队消息，待本回合结束后自动处理 (Enter)"
													className="flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700 hover:text-white disabled:opacity-40 transition-colors"
												>
													<CornerDownRight size={11} className="text-neutral-400" />
													<span>排队</span>
												</button>
												<button
													type="button"
													onClick={() => void submit(true)}
													disabled={busy}
													title="立即插队发送打断 (⌘Enter)"
													className="flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] text-white hover:bg-indigo-500 disabled:opacity-40"
												>
													<Zap size={11} />
													<span>插队</span>
												</button>
											</>
										)}
									</>
								) : (
									<button
										type="button"
										onClick={() => void submit(false)}
										disabled={busy || !text.trim()}
										title="发送消息 (Enter)"
										className={clsx(
											text.trim() && !busy
												? "flex h-7 w-7 items-center justify-center rounded-full bg-white text-neutral-950 hover:bg-neutral-200 active:scale-95 shadow-sm transition-all duration-150"
												: "flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800/80 text-neutral-500 cursor-not-allowed transition-all duration-200",
										)}
									>
										<ArrowUp size={14} />
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
