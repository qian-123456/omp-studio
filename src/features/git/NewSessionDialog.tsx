/** [C] New-session dialog (docs/ARCHITECTURE.md §11 C). */

import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { Z_LAYER } from "../../components/FloatingLayer";
import { AlertTriangle, FolderOpen, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSession, sendFirstPrompt } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	appPaths,
	deleteSession,
	gitBadge,
	gitCreateWorktree,
	gitListBranches,
	gitSummary,
	rpcListLive,
	rpcSend,
	validatePath,
} from "../../lib/ipc";
import {
	type ModelOption,
	parseModels,
	toModelKey,
} from "../../lib/models";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { ModelSelect } from "../../components/ModelSelect";
import { NativeSelect } from "../../components/NativeSelect";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { useSettings } from "../settings/store";
import { defaultSlug, runningInRepo } from "./helpers";

const CUSTOM = "__custom";
const isMac =
	typeof navigator !== "undefined" &&
	/Macintosh|Mac OS X|macOS/i.test(navigator.userAgent);

const INPUT_CLASS =
	"w-full rounded-lg hairline bg-[var(--bg)] px-2.5 py-1.5 text-xs text-neutral-200 outline-none focus:ring-1 focus:ring-[#0A84FF]/50 transition-colors";

/**
 * Always mounted; opened via `ui.openModal("new-session",
 * {workspaceId?, cwd?, branch?, useWorktree?})`.
 * - `useWorktree: true` → 「新建工作树会话」: fixed repo `cwd`, base branch
 *   (prefilled from `branch`), branch prefix and worktree dir only.
 * - otherwise → generic form: workspace/cwd picker, model, optional isolated
 *   worktree and first prompt.
 * Approval mode is not a per-session choice here — it follows Settings.
 */
export function NewSessionDialog() {
	const modal = useUi((s) => s.modal);
	if (modal?.name !== "new-session") return null;
	if (modal.props.useWorktree === true && typeof modal.props.cwd === "string") {
		return <WorktreeSessionForm props={modal.props} />;
	}
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
	const catalogModels = useModelOptions();
	// rpc `get_available_models` fallback, used only while the catalog is empty.
	const [rpcModels, setRpcModels] = useState<ModelOption[]>([]);
	const availableModels =
		catalogModels && catalogModels.length > 0 ? catalogModels : rpcModels;
	const [modelSel, setModelSel] = useState("");
	const [planYolo, setPlanYolo] = useState(false);
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
	/** Linked-worktree name when `cwd` already is one (null = main checkout). */
	const [linkedWt, setLinkedWt] = useState<string | null>(null);
	const repoCheck = useRef(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: fetch models once per dialog open (sessions read via getState)
	useEffect(() => {
		appPaths()
			.then((p) => setGlobalDir(p.globalDir))
			.catch(() => {});

		void useModelCatalog
			.getState()
			.refresh()
			.then(() => {
				if ((useModelCatalog.getState().models?.length ?? 0) > 0) return;
				const liveSession = Object.values(useSessions.getState().sessions).find(
					(s) => s.live,
				);
				if (!liveSession) {
					toast.error("获取可用模型失败");
					return;
				}
				rpcSend(liveSession.id, { type: "get_available_models" })
					.then((resp) => {
						const data =
							resp && typeof resp === "object" && "data" in resp
								? resp.data
								: resp;
						const m = parseModels(data);
						if (m.length > 0) setRpcModels(m);
						else toast.error("获取可用模型失败");
					})
					.catch((err) => {
						toast.error(`获取可用模型失败: ${errMsg(err)}`);
					});
			});
	}, []);

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
		setLinkedWt(null);
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
		gitBadge(cwd)
			.then((b) => {
				if (seq === repoCheck.current) setLinkedWt(b?.worktree ?? null);
			})
			.catch(() => {});
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


	// Sessions already running in the same checkout (same worktree of the
	// same repo) → suggest a worktree. Other worktrees don't conflict.
	const running = useMemo(
		() =>
			runningInRepo(Object.values(sessions), cwd).filter(
				(s) => (s.git?.worktree ?? null) === linkedWt,
			),
		[sessions, cwd, linkedWt],
	);

	// Never derive the name from the cwd path: that yields slugs like
	// `users-<name>-documents-<repo>`. Timestamp fallback when nothing typed.
	const slug = defaultSlug(wtName || prompt);
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
				title: "选择目录",
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
				const wt = await gitCreateWorktree(cwd, wtName.trim() || slug, {
					branch: `${branchPrefix}${wtName.trim() || slug}`,
					base: baseBranch || undefined,
				});
				await useWorktrees.getState().refresh().catch(() => {});
				target = wt.path;
			}
			const { sessionId, stub } = await createSession({
				cwd: target,
				model: modelSel || defaultModel || null,
				approvalMode: null, // per-session approval removed — Settings owns it
				workspaceId: wsSel === CUSTOM ? null : wsSel,
				planYolo: planYolo || null,
				prompt,
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

	const input = INPUT_CLASS;

	return (
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) closeModal();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="new-session-dialog-title"
				className="w-[500px] max-w-[calc(100vw-2rem)] max-h-[min(90vh,760px)] flex flex-col rounded-2xl bg-[var(--bg-panel)] p-5 text-neutral-300 shadow-apple-modal hairline"
				onMouseDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => handleDialogKeyDown(e, canSubmit ? submit : null)}
			>
				<div className="mb-3 flex items-center shrink-0">
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

				<div className="flex-1 min-h-0 overflow-y-auto pr-1">
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
				<NativeSelect
					autoFocus
					value={wsSel}
					onChange={(e) => setWsSel(e.target.value)}
					containerClassName="mb-2"
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
				</NativeSelect>
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
						align="start"
						widthClass="w-full"
						icon={false}
						label={
							modelSel
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
						]}
						allowCustom
						onSelect={(v: string) => setModelSel(v.trim())}
					/>
				</div>

				{/* Approval mode intentionally not in the primary dialog — it
				    lives in Settings (会话管理 → 默认审批模式) and applies via
				    `approvalMode: null` (follow default). */}

				<label className="mb-2 flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
					<input
						type="checkbox"
						checked={planYolo}
						onChange={(e) => setPlanYolo(e.target.checked)}
					/>
					<span>规划模式</span>
					<span className="text-[10px] text-neutral-400">（先只读规划并自动进入实施）</span>
				</label>

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
					{linkedWt ? "另建一个新工作树" : "在独立工作树中运行"}
					<span className="text-[10px] text-neutral-500">（单独的文件夹，改动互不影响）</span>
					{isRepo === false && <span className="text-[10px]">（所选目录不是 git 仓库）</span>}
				</label>
				{linkedWt && !useWorktree && (
					<div className="mb-2 text-[11px] text-emerald-300/90">
						将直接在已有工作树「{linkedWt}」中运行，无需勾选上面的选项
					</div>
				)}
				{useWorktree && (
					<div className="mb-2.5 rounded-xl hairline bg-[var(--bg)]/60 p-3">
						<WorktreeFields
							branches={branches}
							baseBranch={baseBranch}
							setBaseBranch={setBaseBranch}
							branchPrefix={branchPrefix}
							setBranchPrefix={setBranchPrefix}
							wtName={wtName}
							setWtName={setWtName}
							slug={slug}
						/>
					</div>
				)}

				{running.length > 0 && !useWorktree && isRepo === true && (
					<div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
						<AlertTriangle size={12} className="shrink-0" />
						同仓库已有 {running.length} 个会话在运行，建议开独立工作树
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

				</div>

				<div className="flex items-center justify-between shrink-0 pt-3 border-t border-[var(--border-divider)] mt-2">
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

/** Cmd/Ctrl+Enter submits; Tab cycles focus inside the dialog. */
function handleDialogKeyDown(
	e: React.KeyboardEvent<HTMLDivElement>,
	submit: (() => Promise<void>) | null,
) {
	if (isComposing(e)) return;
	if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
		e.preventDefault();
		if (submit) void submit();
		return;
	}
	if (e.key !== "Tab") return;
	const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
		'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
	)).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
	if (controls.length === 0) return;
	const first = controls[0];
	const last = controls[controls.length - 1];
	const active = document.activeElement as HTMLElement;
	if (e.shiftKey && (active === first || !controls.includes(active))) {
		e.preventDefault();
		last?.focus();
	} else if (!e.shiftKey && (active === last || !controls.includes(active))) {
		e.preventDefault();
		first?.focus();
	}
}

function WorktreeFields({
	branches,
	baseBranch,
	setBaseBranch,
	branchPrefix,
	setBranchPrefix,
	wtName,
	setWtName,
	slug,
	checkoutBranch,
}: {
	branches: string[];
	baseBranch: string;
	setBaseBranch: (v: string) => void;
	branchPrefix: string;
	setBranchPrefix: (v: string) => void;
	wtName: string;
	setWtName: (v: string) => void;
	slug: string;
	/** Existing branch to check out; hides base-branch and prefix inputs. */
	checkoutBranch?: string;
}) {
	return (
		<div className="space-y-2.5">
			{!checkoutBranch && (
			<div className="grid grid-cols-2 gap-2">
				<div>
					<label className="text-[10px] text-neutral-400 block mb-1">
						从哪个分支分出
					</label>
					<NativeSelect
						value={baseBranch}
						onChange={(e) => setBaseBranch(e.target.value)}
					>
						{branches.length > 0 ? (
							branches.map((b) => (
								<option key={b} value={b}>
									{b}
								</option>
							))
						) : (
							<option value="">当前所在版本</option>
						)}
					</NativeSelect>
				</div>
				<div>
					<label className="text-[10px] text-neutral-400 block mb-1">
						新分支名前缀
					</label>
					<input
						type="text"
						value={branchPrefix}
						onChange={(e) => setBranchPrefix(e.target.value)}
						placeholder="例如 omp/"
						className={clsx(INPUT_CLASS, "font-mono")}
					/>
				</div>
			</div>
			)}

			<div>
				<label className="text-[10px] text-neutral-400 block mb-1">
					工作树目录名
				</label>
				<input
					value={wtName}
					onChange={(e) => setWtName(e.target.value)}
					placeholder={`文件夹名（默认 ${slug}）`}
					className={clsx(INPUT_CLASS, "font-mono")}
				/>
			</div>

			<div className="text-[11px] text-neutral-400">
				{checkoutBranch ? (
					<>
						将检出已有分支：
						<span className="font-mono text-[#70b1ff] ml-1">{checkoutBranch}</span>
					</>
				) : (
					<>
						将创建新分支：
						<span className="font-mono text-[#70b1ff] ml-1">
							{branchPrefix}
							{wtName.trim() || slug}
						</span>
						{baseBranch && (
							<span className="text-neutral-500 ml-1">（从 {baseBranch} 分出）</span>
						)}
					</>
				)}
			</div>
		</div>
	);
}

/**
 * 「新建工作树会话」: creates `prefix + name` from the chosen base branch in a
 * new worktree of the fixed repo `cwd`, opens a session there (model follows
 * the Settings default) and focuses its composer.
 */
function WorktreeSessionForm({ props }: { props: Record<string, unknown> }) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeModal = useUi((s) => s.closeModal);
	const defaultModel = useSettings((s) => s.settings?.newSessionModel);
	const repo = props.cwd as string;
	const propWs = typeof props.workspaceId === "string" ? props.workspaceId : null;
	const propBranch =
		typeof props.branch === "string" && props.branch.trim() ? props.branch.trim() : "";
	const repoName = repo.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || repo;

	const [branches, setBranches] = useState<string[]>([]);
	const [baseBranch, setBaseBranch] = useState("");
	const [branchPrefix, setBranchPrefix] = useState("omp/");
	const [wtName, setWtName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEscapeKey(closeModal);

	useEffect(() => {
		const previous = document.activeElement;
		dialogRef.current?.querySelector<HTMLElement>("select, input")?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	}, []);

	useEffect(() => {
		if (propBranch) return; // existing-branch mode needs no base branch
		let cancelled = false;
		gitListBranches(repo)
			.then((list) => {
				if (cancelled || !Array.isArray(list)) return;
				setBranches(list);
				setBaseBranch((prev) => (prev && list.includes(prev) ? prev : (list[0] ?? "")));
			})
			.catch((err) => {
				if (!cancelled) toast.error(`获取分支列表失败: ${errMsg(err)}`);
			});
		return () => {
			cancelled = true;
		};
	}, [repo, propBranch]);

	// Never derive the name from the cwd path; timestamp fallback when empty.
	const slug = useMemo(() => defaultSlug(wtName || propBranch), [wtName, propBranch]);
	const canSubmit = !busy;

	const submit = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const name = wtName.trim() || slug;
			const wt = await gitCreateWorktree(repo, name, {
				// Existing-branch mode checks that branch out; otherwise create
				// `prefix + name` from `baseBranch`.
				branch: propBranch || `${branchPrefix}${name}`,
				base: propBranch || !baseBranch ? undefined : baseBranch,
			});
			await useWorktrees.getState().refresh().catch(() => {});
			const { sessionId, stub } = await createSession({
				cwd: wt.path,
				model: defaultModel || null,
				workspaceId: propWs,
			});
			useSessions.getState().upsert([stub]);
			useUi.getState().selectSession(sessionId);
			closeModal();
			useComposer.getState().focusComposer(sessionId);
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) closeModal();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="new-session-dialog-title"
				className="w-[500px] max-w-[calc(100vw-2rem)] flex flex-col rounded-2xl bg-[var(--bg-panel)] p-5 text-neutral-300 shadow-apple-modal hairline"
				onMouseDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => handleDialogKeyDown(e, canSubmit ? submit : null)}
			>
				<div className="mb-3 flex items-center shrink-0">
					<span id="new-session-dialog-title" className="flex-1 text-[15px] font-semibold tracking-tight text-[var(--text)]">新建工作树会话</span>
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

				<div className="mb-3 truncate text-[11px] text-neutral-400" title={repo}>
					<span className="text-neutral-200">{repoName}</span>
					<span className="mx-1">·</span>
					<span className="font-mono">{repo}</span>
				</div>

				<WorktreeFields
					branches={branches}
					baseBranch={baseBranch}
					setBaseBranch={setBaseBranch}
					branchPrefix={branchPrefix}
					setBranchPrefix={setBranchPrefix}
					wtName={wtName}
					setWtName={setWtName}
					slug={slug}
					checkoutBranch={propBranch}
				/>

				{error && <div className="mt-2 text-xs text-rose-400">{error}</div>}

				<div className="flex items-center justify-between shrink-0 pt-3 border-t border-[var(--border-divider)] mt-3">
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
							{busy ? "创建中…" : "创建"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
