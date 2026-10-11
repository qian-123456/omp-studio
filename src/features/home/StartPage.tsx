import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	ArrowUp,
	Bug,
	CalendarClock,
	Check,
	ChevronDown,
	FlaskConical,
	FolderOpen,
	FolderPlus,
	GitCompare,
	Inbox,
	LayoutGrid,
	Loader2,
	Sparkles,
} from "lucide-react";
import { ModelSelect } from "../../components/ModelSelect";
import { FloatingLayer } from "../../components/FloatingLayer";
import { createSession, sendFirstPrompt } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { isComposing, useHomeDir } from "../../lib/hooks";
import { appPaths, deleteSession, rpcListLive } from "../../lib/ipc";
import { type ModelOption, toModelKey } from "../../lib/models";
import { basename, shortPath } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { useSettings } from "../settings/store";

const CUSTOM = "__custom";
const START_PROMPT_KEY = "omp_start_page_prompt";
const isMac =
	typeof navigator !== "undefined" &&
	/Macintosh|Mac OS X|macOS/i.test(navigator.userAgent);

/** Codex-style shortcut prompts: clicking one fills the composer and starts the session. */
const QUICK_PROMPTS = [
	{ icon: LayoutGrid, color: "text-indigo-400 bg-indigo-500/10", text: "分析当前工作区代码结构与架构" },
	{ icon: GitCompare, color: "text-emerald-400 bg-emerald-500/10", text: "检查 git 改动并总结变更点" },
	{ icon: Bug, color: "text-rose-400 bg-rose-500/10", text: "审查最近提交并排查潜在 Bug" },
	{ icon: FlaskConical, color: "text-amber-400 bg-amber-500/10", text: "为当前项目运行测试并报告问题" },
] as const;

export function StartPage() {
	const workspaces = useSessions((s) => s.workspaces);
	const sessions = useSessions((s) => s.sessions);
	const selectSession = useUi((s) => s.selectSession);
	const setCenter = useUi((s) => s.setCenter);
	const defaultModel = useSettings((s) => s.settings?.newSessionModel);

	const [prompt, setPrompt] = useState(() => {
		try {
			return localStorage.getItem(START_PROMPT_KEY) ?? "";
		} catch {
			return "";
		}
	});
	// Persist the draft; submit paths reset `prompt` to "" which clears it.
	useEffect(() => {
		try {
			if (prompt) localStorage.setItem(START_PROMPT_KEY, prompt);
			else localStorage.removeItem(START_PROMPT_KEY);
		} catch {
			/* storage unavailable */
		}
	}, [prompt]);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const [wsSel, setWsSel] = useState(() => workspaces[0]?.id ?? CUSTOM);
	const [customCwd, setCustomCwd] = useState("");
	const [globalDir, setGlobalDir] = useState("");
	const [wsOpen, setWsOpen] = useState(false);
	const wsButtonRef = useRef<HTMLButtonElement>(null);
	const home = useHomeDir();

	const availableModels = useModelOptions() ?? [];
	const [modelSel, setModelSel] = useState("");

	useEffect(() => {
		appPaths()
			.then((p) => setGlobalDir(p.globalDir))
			.catch(() => {});
		void useModelCatalog
			.getState()
			.refresh()
			.then(() => {
				if ((useModelCatalog.getState().models?.length ?? 0) === 0) {
					toast.error("获取可用模型失败");
				}
			});
	}, []);

	useEffect(() => {
		if (wsSel === CUSTOM && !customCwd && workspaces.length > 0) {
			setWsSel(workspaces[0].id);
		}
	}, [workspaces, wsSel, customCwd]);

	const recentWorkspaces = useMemo(() => {
		return workspaces
			.filter((w) => w.kind !== "global" || globalDir)
			.slice(0, 6);
	}, [workspaces, globalDir]);

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

	const submit = async (override?: string) => {
		const targetPrompt = (override ?? prompt).trim();
		if (!cwd || !targetPrompt || busy) return;
		setBusy(true);
		let createdSessionId: string | null = null;
		try {
			const { sessionId, stub } = await createSession({
				cwd,
				model: modelSel || defaultModel || null,
				approvalMode: null,
				workspaceId: wsSel === CUSTOM ? null : wsSel,
				prompt: targetPrompt,
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
		<div className="relative flex h-full w-full flex-col items-center overflow-y-auto px-6 py-10 select-none">
			<div className="relative flex w-full max-w-[700px] flex-col items-center my-auto">
				<div className="w-full text-center mb-6">
					<h1 className="text-2xl font-semibold tracking-[-0.018em] text-[var(--text)]">
						准备就绪，随时提问
					</h1>
					<p className="text-sm text-neutral-400 mt-2">
						在下方输入框描述你的任务，或者点击以下快捷指令开始
					</p>
				</div>

				{/* Quick prompt cards */}
				<div className="grid w-full grid-cols-2 gap-2.5 mb-5">
					{QUICK_PROMPTS.map(({ icon: Icon, color, text }) => (
						<button
							key={text}
							type="button"
							disabled={busy}
							onClick={() => {
								setPrompt(text);
								if (cwd) void submit(text);
								else toast.error("请先选择工作目录");
							}}
							className="flex items-center gap-3 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)]/60 p-3 text-left hover:bg-[var(--bg-hover)] transition-all active:scale-[0.99] disabled:opacity-50 group"
						>
							<div className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg group-hover:scale-105 transition-transform", color)}>
								<Icon size={16} />
							</div>
							<span className="min-w-0 text-xs font-medium text-[var(--text)]">{text}</span>
						</button>
					))}
				</div>

				<div className="sticky bottom-0 z-10 flex w-full flex-wrap items-center gap-2 rounded-2xl bg-[var(--bg-panel)] shadow-apple-card hairline p-3.5 focus-within:shadow-[0_0_0_0.5px_var(--hairline-strong),var(--shadow-apple-card)] transition-all">
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
						className="w-full resize-none bg-transparent px-1 py-2 text-sm text-[var(--text)] outline-none placeholder:text-neutral-500"
					/>

					{/* Workspace Pill */}
					<div className="relative shrink-0">
						<button
							ref={wsButtonRef}
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

						<FloatingLayer
							anchor={wsOpen ? wsButtonRef.current : null}
							layer="popover"
							placement="bottom-start"
							offset={6}
							onDismiss={() => setWsOpen(false)}
							ignoreRefs={[wsButtonRef]}
							className="w-[280px] py-1.5 shadow-apple-modal"
						>
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
									onClick={() => {
										setWsOpen(false);
										void pickDirectory();
									}}
									className="flex w-[calc(100%-8px)] mx-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
								>
									<FolderPlus
										size={13}
										className="shrink-0 text-neutral-400"
									/>
									<span>选择其他目录…</span>
								</button>
							</div>
						</FloatingLayer>
					</div>

					{/* Model Selector Chip */}
					<div className="shrink-0">
						<ModelSelect
							direction="up"
							align="start"
							widthClass="w-[min(360px,calc(100vw-40px))]"
							label={
								modelSel
										? (availableModels.find(
												(m: ModelOption) =>
													toModelKey(m.provider, m.id) === modelSel,
											)?.id ?? modelSel)
										: (defaultModel || "默认模型")
							}
							buttonClass="flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
							models={availableModels.length > 0 ? availableModels : null}
							currentValue={modelSel}
							extras={[
								{ value: "", label: "默认（跟随全局设置）" },
							]}
							allowCustom
							onSelect={(v: string) => setModelSel(v.trim())}
						/>
					</div>

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

				{/* Quick Links */}
				<div className="grid grid-cols-3 gap-2.5 w-full mt-5">
					<button
						type="button"
						onClick={() => setCenter("inbox")}
						className="flex items-center gap-3 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)]/60 p-3 text-left hover:bg-[var(--bg-hover)] transition-all active:scale-[0.99] group"
					>
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:scale-105 transition-transform">
							<Inbox size={16} />
						</div>
						<div className="min-w-0">
							<div className="text-xs font-medium text-[var(--text)]">收件箱</div>
							<div className="text-[11px] text-neutral-500 truncate">待办与通知处理</div>
						</div>
					</button>

					<button
						type="button"
						onClick={() => setCenter("schedules")}
						className="flex items-center gap-3 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)]/60 p-3 text-left hover:bg-[var(--bg-hover)] transition-all active:scale-[0.99] group"
					>
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 group-hover:scale-105 transition-transform">
							<CalendarClock size={16} />
						</div>
						<div className="min-w-0">
							<div className="text-xs font-medium text-[var(--text)]">定时任务</div>
							<div className="text-[11px] text-neutral-500 truncate">自动化周期任务</div>
						</div>
					</button>

					<button
						type="button"
						onClick={() => setCenter("skills")}
						className="flex items-center gap-3 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)]/60 p-3 text-left hover:bg-[var(--bg-hover)] transition-all active:scale-[0.99] group"
					>
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 group-hover:scale-105 transition-transform">
							<Sparkles size={16} />
						</div>
						<div className="min-w-0">
							<div className="text-xs font-medium text-[var(--text)]">Skills 管理</div>
							<div className="text-[11px] text-neutral-500 truncate">浏览并配置 Skill</div>
						</div>
					</button>
				</div>

				{/* Recent Projects */}
				{recentWorkspaces.length > 0 && (
					<div className="w-full mt-6">
						<div className="flex items-center justify-between mb-2">
							<span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
								最近项目
							</span>
							<button
								type="button"
								onClick={() => void pickDirectory()}
								className="flex items-center gap-1 text-[11px] text-[#0A84FF] hover:underline"
							>
								<FolderPlus size={11} />
								<span>打开项目…</span>
							</button>
						</div>
						<div className="grid grid-cols-2 gap-2">
							{recentWorkspaces.slice(0, 4).map((w) => {
								const label =
									w.kind === "global"
										? "全局工作区"
										: (w.name ?? basename(w.path));
								const path = w.kind === "global" ? globalDir : w.path;
								const isSelected = wsSel === w.id;
								const sessionCount = Object.values(sessions).filter(
									(s) => s.workspaceId === w.id || s.cwd === w.path,
								).length;

								return (
									<button
										key={w.id}
										type="button"
										onClick={() => {
											setWsSel(w.id);
											inputRef.current?.focus();
										}}
										className={clsx(
											"flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all active:scale-[0.99]",
											isSelected
												? "border-[#0A84FF]/50 bg-[#0A84FF]/5 shadow-xs"
												: "border-[var(--border-divider)] bg-[var(--well-bg)]/40 hover:bg-[var(--bg-hover)]",
										)}
									>
										<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-active-fill)] text-amber-400">
											<FolderOpen size={14} />
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex items-center justify-between gap-1">
												<span className="truncate text-xs font-medium text-[var(--text)]">
													{label}
												</span>
												{sessionCount > 0 && (
													<span className="text-[10px] text-neutral-500 font-mono shrink-0">
														{sessionCount} 会话
													</span>
												)}
											</div>
											<div className="truncate font-mono text-[10px] text-neutral-500">
												{shortPath(path, home)}
											</div>
										</div>
									</button>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
