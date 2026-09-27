import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	ArrowUp,
	Check,
	ChevronDown,
	FolderOpen,
	FolderPlus,
	Loader2,
} from "lucide-react";
import { ModelSelect } from "../../components/ModelSelect";
import { createSession, sendFirstPrompt } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { isComposing, useHomeDir } from "../../lib/hooks";
import { appPaths, deleteSession, listModels, rpcListLive } from "../../lib/ipc";
import { type ModelOption, parseModels, toModelKey } from "../../lib/models";
import { basename, shortPath } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useSettings } from "../settings/store";

const CUSTOM = "__custom";
const CUSTOM_MODEL = "__custom_model";
const isMac =
	typeof navigator !== "undefined" &&
	/Macintosh|Mac OS X|macOS/i.test(navigator.userAgent);
export function StartPage() {
	const workspaces = useSessions((s) => s.workspaces);
	const selectSession = useUi((s) => s.selectSession);
	const defaultModel = useSettings((s) => s.settings?.newSessionModel);

	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const [wsSel, setWsSel] = useState(() => workspaces[0]?.id ?? CUSTOM);
	const [customCwd, setCustomCwd] = useState("");
	const [globalDir, setGlobalDir] = useState("");
	const [wsOpen, setWsOpen] = useState(false);
	const wsMenuRef = useRef<HTMLDivElement>(null);
	const home = useHomeDir();

	const [availableModels, setAvailableModels] = useState<ModelOption[]>(() => {
		try {
			const cached = localStorage.getItem("ompws:cached-models");
			if (cached) {
				const parsed = JSON.parse(cached);
				if (Array.isArray(parsed)) return parsed;
			}
		} catch {
			/* ignore */
		}
		return [];
	});
	const [modelSel, setModelSel] = useState("");
	const [customModel, setCustomModel] = useState("");

	useEffect(() => {
		appPaths()
			.then((p) => setGlobalDir(p.globalDir))
			.catch(() => {});
		listModels()
			.then((models) => {
				if (Array.isArray(models) && models.length > 0) {
					const parsed = parseModels(models);
					if (parsed.length > 0) {
						setAvailableModels(parsed);
						try {
							localStorage.setItem(
								"ompws:cached-models",
								JSON.stringify(parsed),
							);
						} catch {
							/* ignore */
						}
						return;
					}
				}
				setAvailableModels((prev) => {
					if (prev.length === 0) {
						toast.error("获取可用模型失败: 返回列表为空");
					}
					return prev;
				});
			})
			.catch((err) => {
				toast.error(`获取可用模型失败: ${errMsg(err)}`);
			});
	}, []);

	useEffect(() => {
		if (wsSel === CUSTOM && !customCwd && workspaces.length > 0) {
			setWsSel(workspaces[0].id);
		}
	}, [workspaces, wsSel, customCwd]);

	// Close workspace dropdown on outside click or Esc
	useEffect(() => {
		if (!wsOpen) return;
		const onDown = (e: MouseEvent) => {
			if (!wsMenuRef.current?.contains(e.target as Node)) setWsOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.isComposing) setWsOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [wsOpen]);

	const cwd = useMemo(() => {
		if (wsSel === CUSTOM) return customCwd.trim();
		const w = workspaces.find((x) => x.id === wsSel);
		if (!w) return customCwd.trim();
		return w.kind === "global" ? globalDir : w.path;
	}, [wsSel, workspaces, customCwd, globalDir]);

	const wsLabel = useMemo(() => {
		if (wsSel === CUSTOM) {
			const p = customCwd.trim();
			return p ? basename(p) : "目录…";
		}
		const w = workspaces.find((x) => x.id === wsSel);
		if (!w) return "目录";
		return w.kind === "global" ? "全局工作区" : (w.name ?? basename(w.path));
	}, [wsSel, workspaces, customCwd]);

	const pickDirectory = async () => {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: "选择工作区目录",
				defaultPath: customCwd || undefined,
			});
			if (selected && typeof selected === "string") {
				setWsSel(CUSTOM);
				setCustomCwd(selected);
			}
		} catch (e) {
			toast.error(errMsg(e));
		}
		setWsOpen(false);
	};

	const effectiveModel =
		modelSel === CUSTOM_MODEL ? customModel.trim() : modelSel;

	const submit = async () => {
		const targetPrompt = prompt.trim();
		if (!cwd || !targetPrompt || busy) return;
		setBusy(true);
		let createdSessionId: string | null = null;
		try {
			const { sessionId, stub } = await createSession({
				cwd,
				model: effectiveModel || defaultModel || null,
				approvalMode: null,
				workspaceId: wsSel === CUSTOM ? null : wsSel,
			});
			createdSessionId = sessionId;
			useSessions.getState().upsert([stub]);
			try {
				await sendFirstPrompt(sessionId, targetPrompt);
			} catch (promptErr) {
				let isLive = false;
				try {
					const liveList = await rpcListLive();
					isLive = liveList.some((s) => s.sessionId === sessionId);
				} catch {
					isLive = false;
				}

				if (isLive) {
					selectSession(sessionId);
					setPrompt("");
					toast.error(`会话已创建，但发送第一条消息失败: ${errMsg(promptErr)}`);
					return;
				}

				useSessions.getState().remove([sessionId]);
				await deleteSession(sessionId).catch(() => {});
				toast.error(`创建会话失败: ${errMsg(promptErr)}`);
				return;
			}
			selectSession(sessionId);
			setPrompt("");
		} catch (e) {
			if (createdSessionId) {
				useSessions.getState().remove([createdSessionId]);
				await deleteSession(createdSessionId).catch(() => {});
			}
			toast.error(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const canSubmit = !!cwd && !!prompt.trim() && !busy;

	return (
		<div className="relative flex h-full w-full flex-col items-center justify-center px-4 select-none">
			<div className="relative flex w-full max-w-[700px] flex-col items-center">
				<h1 className="self-start text-xl font-semibold tracking-[-0.018em] text-neutral-100">
					新会话
				</h1>

				<div className="relative mt-4 flex w-full flex-wrap items-center gap-2 rounded-[14px] bg-[var(--bg-panel)] shadow-apple-card hairline p-3.5 focus-within:shadow-[0_0_0_0.5px_var(--hairline-strong),var(--shadow-apple-card)] transition-all">
					<textarea
						ref={inputRef}
						autoFocus
						rows={4}
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								e.preventDefault();
								void submit();
							}
						}}
						aria-label="任务内容"
						placeholder={`输入任务或需求（按 ${isMac ? "Cmd+Enter" : "Ctrl+Enter"} 发送）`}
						className="w-full resize-none bg-transparent px-1 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
					/>

					{/* Workspace Pill */}
					<div className="relative shrink-0" ref={wsMenuRef}>
						<button
							type="button"
							onClick={() => setWsOpen((v) => !v)}
							title={`工作目录: ${cwd || "未选择"}`}
							className="flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95"
						>
							<FolderOpen size={13} className="shrink-0 text-amber-400" />
							<span className="max-w-[130px] truncate font-medium">
								{wsLabel}
							</span>
							<ChevronDown size={11} className="shrink-0 text-neutral-500" />
						</button>

						{wsOpen && (
							<div className="absolute bottom-full left-0 z-30 mb-2 w-[280px] rounded-xl vibrancy-popover shadow-apple-modal hairline py-1.5">
								<div className="border-b border-[var(--border-divider)] px-3 py-1 text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">
									工作目录
								</div>
								<div className="max-h-60 overflow-y-auto py-1">
									{workspaces.map((w) => {
										const label =
											w.kind === "global"
												? "全局工作区"
												: (w.name ?? basename(w.path));
										const path = w.kind === "global" ? globalDir : w.path;
										const isSelected = wsSel === w.id;
										return (
											<button
												key={w.id}
												type="button"
												onClick={() => {
													setWsSel(w.id);
													setWsOpen(false);
												}}
												className={clsx(
													"flex w-[calc(100%-8px)] mx-1 items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
													isSelected
														? "bg-[#0A84FF]/15 text-[#0A84FF] font-medium"
														: "text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100",
												)}
											>
												<div className="min-w-0 pr-2">
													<div className="truncate font-medium">{label}</div>
													<div className="truncate font-mono text-[10px] text-neutral-500">
														{shortPath(path, home)}
													</div>
												</div>
												{isSelected && (
													<Check
														size={13}
														className="shrink-0 text-[#0A84FF]"
													/>
												)}
											</button>
										);
									})}

									<div className="my-1 border-t border-[var(--border-divider)]" />

									<button
										type="button"
										onClick={() => void pickDirectory()}
										className="flex w-[calc(100%-8px)] mx-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
									>
										<FolderPlus
											size={13}
											className="shrink-0 text-neutral-400"
										/>
										<span>选择其他目录…</span>
									</button>
								</div>
							</div>
						)}
					</div>

					{/* Model Selector Chip */}
					<div className="shrink-0">
						<ModelSelect
							direction="up"
							widthClass="w-[min(360px,calc(100vw-40px))]"
							label={
								modelSel === CUSTOM_MODEL
									? (customModel.trim() || "自定义…")
									: modelSel
										? (availableModels.find(
												(m: ModelOption) =>
													toModelKey(m.provider, m.id) === modelSel,
											)?.name ?? modelSel)
										: (defaultModel || "默认模型")
							}
							buttonClass="flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
							models={availableModels.length > 0 ? availableModels : null}
							currentValue={modelSel}
							extras={[
								{ value: "", label: "默认（跟随全局设置）" },
								{
									value: CUSTOM_MODEL,
									label: "自定义模型…",
									hint: "手动输入模型标识",
								},
							]}
							onSelect={(v: string) => setModelSel(v)}
						/>
					</div>

					{modelSel === CUSTOM_MODEL && (
						<input
							type="text"
							value={customModel}
							onChange={(e) => setCustomModel(e.target.value)}
							placeholder="provider/model-id"
							className="w-32 shrink-0 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 font-mono text-xs text-neutral-200 outline-none focus:ring-1 focus:ring-[#0A84FF]/50"
						/>
					)}

					{/* Send / Action Button */}
					<button
						type="button"
						onClick={() => void submit()}
						disabled={!canSubmit}
						title={
							cwd
								? busy
									? "创建中…"
									: `开始会话 (${isMac ? "Cmd+Enter" : "Ctrl+Enter"})`
								: "请先选择工作目录"
						}
						aria-label="开始会话"
						className={clsx(
							"ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
							canSubmit
								? "bg-neutral-100 text-neutral-950 shadow-md hover:opacity-90 active:scale-95"
								: "cursor-not-allowed bg-[var(--bg-active-fill)] text-neutral-500",
						)}
					>
						{busy ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<ArrowUp size={15} strokeWidth={2.4} />
						)}
					</button>
				</div>

			</div>
		</div>
	);
}
