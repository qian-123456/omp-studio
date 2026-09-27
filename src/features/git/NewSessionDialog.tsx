/** [C] New-session dialog (docs/ARCHITECTURE.md §11 C). */

import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { AlertTriangle, FolderOpen, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSession, sendFirstPrompt } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	appPaths,
	deleteSession,
	gitCreateWorktree,
	gitListBranches,
	gitSummary,
	listModels,
	rpcListLive,
	rpcSend,
	validatePath,
} from "../../lib/ipc";
import {
	type ModelOption,
	parseModels,
	toModelKey,
} from "../../lib/models";
import { ModelSelect } from "../../components/ModelSelect";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useSettings } from "../settings/store";
import { defaultSlug } from "./helpers";

const CUSTOM = "__custom";
const CUSTOM_MODEL = "__custom_model";
const isMac =
	typeof navigator !== "undefined" &&
	/Macintosh|Mac OS X|macOS/i.test(navigator.userAgent);

/**
 * Always mounted; opened via `ui.openModal("new-session" | "newSession", {workspaceId?, cwd?})`.
 * Workspace/cwd picker, model, optional isolated worktree and first prompt.
 * Approval mode is not a per-session choice here — it follows Settings.
 */
export function NewSessionDialog() {
	const modal = useUi((s) => s.modal);
	if (modal?.name !== "new-session" && modal?.name !== "newSession") return null;
	return <NewSessionForm props={modal.props} />;
}

function NewSessionForm({ props }: { props: Record<string, unknown> }) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const workspaces = useSessions((s) => s.workspaces);
	const sessions = useSessions((s) => s.sessions);
	const upsert = useSessions((s) => s.upsert);
	const closeModal = useUi((s) => s.closeModal);
	const selectSession = useUi((s) => s.selectSession);
	const defaultModel = useSettings((s) => s.settings?.newSessionModel);

	useEscapeKey(closeModal);

	useEffect(() => {
		const previous = document.activeElement;
		(dialogRef.current?.querySelector<HTMLElement>("select, input, textarea")
			?? dialogRef.current?.querySelector<HTMLElement>("button"))?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	}, []);

	const propCwd = typeof props.cwd === "string" ? props.cwd : "";
	const propWs = typeof props.workspaceId === "string" ? props.workspaceId : "";

	const [wsSel, setWsSel] = useState(() => {
		if (propWs && workspaces.some((w) => w.id === propWs)) return propWs;
		const match = workspaces.find((w) => w.path === propCwd);
		if (match) return match.id;
		if (propCwd) return CUSTOM;
		return workspaces[0]?.id ?? CUSTOM;
	});
	const [customCwd, setCustomCwd] = useState(propCwd);
	const [globalDir, setGlobalDir] = useState("");
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
	const [useWorktree, setUseWorktree] = useState(Boolean(props.useWorktree));
	const [wtName, setWtName] = useState("");
	const [customCwdError, setCustomCwdError] = useState<string | null>(null);
	const [branches, setBranches] = useState<string[]>([]);
	const [baseBranch, setBaseBranch] = useState("");
	const [branchPrefix, setBranchPrefix] = useState("omp/");
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isRepo, setIsRepo] = useState<boolean | null>(null);
	const repoCheck = useRef(0);

	useEffect(() => {
		appPaths()
			.then((p) => setGlobalDir(p.globalDir))
			.catch(() => {});

		// Model fetching: listModels() IPC priority, cached in localStorage
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
				fallbackLiveModels();
			})
			.catch((err) => {
				fallbackLiveModels(err);
			});

		function fallbackLiveModels(initialErr?: unknown) {
			const liveSession = Object.values(sessions).find((s) => s.live);
			if (liveSession) {
				rpcSend(liveSession.id, { type: "get_available_models" })
					.then((resp) => {
						const data =
							resp && typeof resp === "object" && "data" in resp
								? resp.data
								: resp;
						const m = parseModels(data);
						if (m.length > 0) {
							setAvailableModels(m);
							try {
								localStorage.setItem(
									"ompws:cached-models",
									JSON.stringify(m),
								);
							} catch {
								/* ignore */
							}
						}
					})
					.catch(() => {
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
								toast.error("获取可用模型失败");
							})
							.catch((err) => {
								toast.error(`获取可用模型失败: ${errMsg(err)}`);
							});
					});
			} else {
				toast.error(`获取可用模型失败${initialErr ? `: ${errMsg(initialErr)}` : ""}`);
			}
		}
	}, [sessions]);

	// Debounced validatePath on custom cwd
	useEffect(() => {
		if (wsSel !== CUSTOM || !customCwd.trim()) {
			setCustomCwdError(null);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			validatePath(customCwd.trim())
				.then((res) => {
					if (cancelled) return;
					if (!res.exists) {
						setCustomCwdError("路径不存在");
					} else if (!res.isDir) {
						setCustomCwdError("指定路径不是一个目录");
					} else {
						setCustomCwdError(null);
					}
				})
				.catch((err) => {
					if (!cancelled) setCustomCwdError(errMsg(err));
				});
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [wsSel, customCwd]);

	const cwd = useMemo(() => {
		if (wsSel === CUSTOM) return customCwd.trim();
		const w = workspaces.find((x) => x.id === wsSel);
		if (!w) return customCwd.trim();
		return w.kind === "global" ? globalDir : w.path;
	}, [wsSel, workspaces, customCwd, globalDir]);

	// Detect whether the chosen cwd is inside a git repo (gates the worktree option).
	useEffect(() => {
		if (!cwd) {
			setIsRepo(null);
			return;
		}
		const seq = ++repoCheck.current;
		gitSummary(cwd)
			.then((s) => {
				if (seq === repoCheck.current) setIsRepo(s.isRepo);
			})
			.catch(() => {
				if (seq === repoCheck.current) setIsRepo(false);
			});
	}, [cwd]);
	// Fetch branches when selected cwd is a git repo
	useEffect(() => {
		if (isRepo && cwd) {
			gitListBranches(cwd)
				.then((list) => {
					if (Array.isArray(list) && list.length > 0) {
						setBranches(list);
						setBaseBranch((prev) =>
							prev && list.includes(prev) ? prev : list[0],
						);
					}
				})
				.catch((err) => {
					toast.error(`获取分支列表失败: ${errMsg(err)}`);
				});
		} else {
			setBranches([]);
		}
	}, [isRepo, cwd]);


	// Sessions already running in the same repo → suggest a worktree.
	const running = useMemo(() => {
		if (!cwd) return [];
		return Object.values(sessions).filter(
			(s) => s.cwd && (s.cwd === cwd || s.cwd.startsWith(`${cwd}/`)),
		);
	}, [sessions, cwd]);

	const slug = defaultSlug(wtName || propCwd || cwd || "session");
	const effectiveModel = modelSel === CUSTOM_MODEL ? customModel.trim() : modelSel;
	const canSubmit =
		!!cwd &&
		!busy &&
		(wsSel !== CUSTOM || !customCwdError) &&
		(!useWorktree || isRepo === true);

	const handleBrowse = async () => {
		try {
			const selected = await open({
				directory: true,
				multiple: false,
				title: "选择工作区目录",
				defaultPath: customCwd || propCwd || undefined,
			});
			if (selected && typeof selected === "string") {
				setWsSel(CUSTOM);
				setCustomCwd(selected);
			}
		} catch (e) {
			toast.error(errMsg(e));
		}
	};

	const submit = async () => {
		if (!cwd || !canSubmit) return;
		setBusy(true);
		setError(null);
		let createdSessionId: string | null = null;
		try {
			let target = cwd;
			if (useWorktree) {
				const finalBranchName = `${branchPrefix}${wtName.trim() || slug}`;
				const wt = await gitCreateWorktree(cwd, finalBranchName);
				target = wt.path;
			}
			const { sessionId, stub } = await createSession({
				cwd: target,
				model: effectiveModel || defaultModel || null,
				approvalMode: null, // per-session approval removed — Settings owns it
				workspaceId: wsSel === CUSTOM ? null : wsSel,
			});
			createdSessionId = sessionId;
			upsert([stub]);
			try {
				await sendFirstPrompt(sessionId, prompt);
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
					closeModal();
					toast.error(`会话已创建，但发送第一条消息失败: ${errMsg(promptErr)}`);
					return;
				}

				useSessions.getState().remove([sessionId]);
				await deleteSession(sessionId).catch(() => {});
				setError(`发送初始消息失败: ${errMsg(promptErr)}`);
				return;
			}
			selectSession(sessionId);
			closeModal();
		} catch (e) {
			if (createdSessionId) {
				useSessions.getState().remove([createdSessionId]);
				await deleteSession(createdSessionId).catch(() => {});
			}
			setError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const input =
		"w-full rounded-lg hairline bg-[var(--bg)] px-2.5 py-1.5 text-xs text-neutral-200 outline-none focus:ring-1 focus:ring-[#0A84FF]/50 transition-colors";

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) closeModal();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="new-session-dialog-title"
				className="w-[500px] rounded-2xl bg-[var(--bg-panel)] p-5 text-neutral-300 shadow-apple-modal hairline"
				onMouseDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (isComposing(e)) return;
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
						e.preventDefault();
						if (canSubmit) void submit();
						return;
					}
					if (e.key === "Tab") {
						const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
							'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
						)).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
						if (controls.length === 0) return;
						const first = controls[0];
						const last = controls[controls.length - 1];
						if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							last?.focus();
						} else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							first?.focus();
						}
					}
				}}
			>
				<div className="mb-3 flex items-center">
					<span id="new-session-dialog-title" className="flex-1 text-[15px] font-semibold tracking-tight text-[var(--text)]">新会话</span>
					<button
						type="button"
						title="关闭 (Esc)"
						aria-label="关闭对话框"
						onClick={closeModal}
						className="press-scale rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
					>
						<X size={15} />
					</button>
				</div>

				<div className="mb-1 flex items-center justify-between">
					<label className="text-[11px] text-neutral-400">工作区 / 目录</label>
					<button
						type="button"
						onClick={handleBrowse}
						className="press-scale flex items-center gap-1 text-[11px] text-[#0A84FF] hover:text-[#0A84FF]/80 transition-colors"
					>
						<FolderOpen size={12} />
						<span>浏览系统目录…</span>
					</button>
				</div>
				<select
					autoFocus
					value={wsSel}
					onChange={(e) => setWsSel(e.target.value)}
					className={clsx(input, "mb-2")}
				>
					{propCwd && !workspaces.some((w) => w.path === propCwd) && (
						<option value={CUSTOM}>传入目录：{propCwd}</option>
					)}
					{workspaces.map((w) => (
						<option key={w.id} value={w.id}>
							{w.kind === "global" ? "🌐 " : ""}
							{w.name}（{w.path}）
						</option>
					))}
					<option value={CUSTOM}>自定义路径…</option>
				</select>
				{wsSel === CUSTOM && (
					<div className="mb-2">
						<div className="flex gap-1.5">
							<input
								value={customCwd}
								onChange={(e) => setCustomCwd(e.target.value)}
								placeholder="/绝对/路径"
								className={clsx(
									input,
									"font-mono flex-1",
									customCwdError &&
										"border-rose-500 text-rose-200 focus:border-rose-500 ring-1 ring-rose-500/50",
								)}
							/>
							<button
								type="button"
								onClick={handleBrowse}
								className="press-scale flex shrink-0 items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
								title="浏览目录"
								aria-label="浏览系统目录"
							>
								<FolderOpen size={13} />
								<span>浏览…</span>
							</button>
						</div>
						{customCwdError && (
							<div className="mt-1 text-[11px] text-rose-400">
								{customCwdError}
							</div>
						)}
					</div>
				)}

				<div className="mb-2">
					<label className="mb-1 block text-[11px] text-neutral-400">
						模型（可选）
					</label>
					<ModelSelect
						direction="down"
						widthClass="w-full"
						icon={false}
						label={
							modelSel === CUSTOM_MODEL
								? "自定义模型…"
								: modelSel
									? (availableModels.find(
											(m) => toModelKey(m.provider, m.id) === modelSel,
										)?.name ?? modelSel)
									: (defaultModel || "默认（跟随设置）")
						}
						buttonClass={`${input} flex items-center justify-between text-left`}
						models={availableModels.length > 0 ? availableModels : []}
						currentValue={modelSel}
						extras={[
							{ value: "", label: "默认（跟随设置）" },
							{
								value: CUSTOM_MODEL,
								label: "自定义模型…",
								hint: "手动输入",
							},
						]}
						onSelect={(v: string) => setModelSel(v)}
					/>
				</div>

				{modelSel === CUSTOM_MODEL && (
					<input
						value={customModel}
						onChange={(e) => setCustomModel(e.target.value)}
						placeholder="例如 anthropic/claude-3-7-sonnet"
						className={clsx(input, "mb-2 font-mono")}
					/>
				)}

				{/* Approval mode intentionally not in the primary dialog — it
				    lives in Settings (会话管理 → 默认审批模式) and applies via
				    `approvalMode: null` (follow default). */}

				<label
					className={clsx(
						"mb-2 flex items-center gap-2 text-xs",
						isRepo === false ? "text-neutral-600" : "text-neutral-300",
					)}
				>
					<input
						type="checkbox"
						checked={useWorktree}
						disabled={isRepo !== true}
						onChange={(e) => setUseWorktree(e.target.checked)}
					/>
					在独立 worktree 中运行
					{isRepo === false && <span className="text-[10px]">（所选目录不是 git 仓库）</span>}
				</label>
				{useWorktree && (
					<div className="mb-2.5 rounded-xl hairline bg-[var(--bg)]/60 p-3 space-y-2.5">
						<div className="grid grid-cols-2 gap-2">
							<div>
								<label className="text-[10px] text-neutral-400 block mb-1">
									基准分支
								</label>
								<select
									value={baseBranch}
									onChange={(e) => setBaseBranch(e.target.value)}
									className={input}
								>
									{branches.length > 0 ? (
										branches.map((b) => (
											<option key={b} value={b}>
												{b}
											</option>
										))
									) : (
										<option value="">当前分支 (HEAD)</option>
									)}
								</select>
							</div>
							<div>
								<label className="text-[10px] text-neutral-400 block mb-1">
									分支前缀
								</label>
								<input
									type="text"
									value={branchPrefix}
									onChange={(e) => setBranchPrefix(e.target.value)}
									placeholder="例如 omp/"
									className={clsx(input, "font-mono")}
								/>
							</div>
						</div>

						<div>
							<label className="text-[10px] text-neutral-400 block mb-1">
								Worktree 名称
							</label>
							<input
								value={wtName}
								onChange={(e) => {
									setWtName(e.target.value);
								}}
								placeholder={`worktree 名称（默认 ${slug}）`}
								className={clsx(input, "font-mono")}
							/>
						</div>

						<div className="text-[11px] text-neutral-400">
							将创建分支：
							<span className="font-mono text-[#70b1ff] ml-1">
								{branchPrefix}
								{wtName.trim() || slug}
							</span>
							{baseBranch && (
								<span className="text-neutral-500 ml-1">
									(基于 {baseBranch})
								</span>
							)}
						</div>
					</div>
				)}

				{running.length > 0 && !useWorktree && isRepo === true && (
					<div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
						<AlertTriangle size={12} className="shrink-0" />
						同仓库已有 {running.length} 个会话在跑，建议开 worktree
					</div>
				)}

				<label className="mb-1 block text-[11px] text-neutral-400">第一条消息（可选）</label>
				<textarea
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					rows={3}
					placeholder={`创建后立即发送给 Agent（支持 ${isMac ? "Cmd+Enter" : "Ctrl+Enter"} 快速创建）`}
					className={clsx(input, "mb-3 resize-none")}
				/>

				{error && <div className="mb-2 text-xs text-rose-400">{error}</div>}

				<div className="flex items-center justify-between">
					<span className="text-[11px] text-neutral-400">按 {isMac ? "Cmd+Enter" : "Ctrl+Enter"} 快速提交</span>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={closeModal}
							className="press-scale rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
						>
							取消
						</button>
						<button
							type="button"
							disabled={!canSubmit}
							onClick={submit}
							className="press-scale rounded-lg bg-[#0A84FF] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0A84FF]/90 disabled:opacity-40 transition-colors"
						>
							{busy ? "创建中…" : "创建会话"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
