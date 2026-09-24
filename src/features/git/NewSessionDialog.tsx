/** [C] New-session dialog (docs/ARCHITECTURE.md §11 C). */

import clsx from "clsx";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionMeta } from "../../lib/contracts";
import { appPaths, getSettings, gitCreateWorktree, gitSummary, rpcSend, rpcStart } from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { defaultSlug, isInside } from "./helpers";
import { errMsg } from "./ui";

const CUSTOM = "__custom";
const APPROVAL_MODES = [
	{ value: "", label: "默认（跟随设置）" },
	{ value: "always-ask", label: "always-ask · 每步都问" },
	{ value: "write", label: "write · 只问执行类" },
	{ value: "yolo", label: "yolo · 全部自动批准" },
];

/**
 * Always mounted; opened via `ui.openModal("new-session", {workspaceId?, cwd?})`.
 * Workspace/cwd picker, model, approval mode, optional isolated worktree and
 * first prompt.
 */
export function NewSessionDialog() {
	const modal = useUi((s) => s.modal);
	if (modal?.name !== "new-session") return null;
	return <NewSessionForm props={modal.props} />;
}

function NewSessionForm({ props }: { props: Record<string, unknown> }) {
	const workspaces = useSessions((s) => s.workspaces);
	const sessions = useSessions((s) => s.sessions);
	const upsert = useSessions((s) => s.upsert);
	const closeModal = useUi((s) => s.closeModal);
	const selectSession = useUi((s) => s.selectSession);

	const propCwd = typeof props.cwd === "string" ? props.cwd : "";
	const propWs = typeof props.workspaceId === "string" ? props.workspaceId : "";

	const [wsSel, setWsSel] = useState(() => {
		if (propWs && workspaces.some((w) => w.id === propWs)) return propWs;
		if (propCwd && workspaces.some((w) => w.path === propCwd)) {
			return workspaces.find((w) => w.path === propCwd)?.id ?? CUSTOM;
		}
		return propCwd ? CUSTOM : (workspaces[0]?.id ?? CUSTOM);
	});
	const [customCwd, setCustomCwd] = useState(propCwd);
	const [globalDir, setGlobalDir] = useState("");
	const [model, setModel] = useState("");
	const [approval, setApproval] = useState("");
	const [useWorktree, setUseWorktree] = useState(false);
	const [wtName, setWtName] = useState("");
	const [wtTouched, setWtTouched] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isRepo, setIsRepo] = useState<boolean | null>(null);
	const repoCheck = useRef(0);

	useEffect(() => {
		appPaths()
			.then((p) => setGlobalDir(p.globalDir))
			.catch(() => {});
		getSettings()
			.then((s) => setApproval(s.defaultApprovalMode))
			.catch(() => {});
	}, []);

	const cwd = useMemo(() => {
		if (wsSel === CUSTOM) return customCwd.trim();
		const ws = workspaces.find((w) => w.id === wsSel);
		if (!ws) return customCwd.trim();
		return ws.kind === "global" ? globalDir || ws.path : ws.path;
	}, [wsSel, workspaces, customCwd, globalDir]);

	// Detect whether the chosen cwd is inside a git repo (gates the worktree option).
	useEffect(() => {
		const seq = ++repoCheck.current;
		setIsRepo(null);
		if (!cwd) {
			setIsRepo(false);
			return;
		}
		const t = setTimeout(() => {
			gitSummary(cwd)
				.then((s) => {
					if (repoCheck.current === seq) setIsRepo(s.isRepo);
				})
				.catch(() => {
					if (repoCheck.current === seq) setIsRepo(false);
				});
		}, 250);
		return () => clearTimeout(t);
	}, [cwd]);

	// Sessions already running in the same repo → suggest a worktree.
	const running = useMemo(() => {
		if (!cwd) return [];
		return Object.values(sessions).filter((s) => {
			if (!(s.live || s.status === "working")) return false;
			const root = s.repoRoot ?? s.cwd;
			return isInside(cwd, root) || isInside(s.cwd, cwd);
		});
	}, [sessions, cwd]);

	const slug = defaultSlug(wtName || propCwd || cwd || "session");
	const canSubmit = !!cwd && !busy && (!useWorktree || isRepo === true);

	const submit = async () => {
		if (!cwd) return;
		setBusy(true);
		setError(null);
		try {
			let target = cwd;
			if (useWorktree) {
				const wt = await gitCreateWorktree(cwd, wtName.trim() || slug);
				target = wt.path;
			}
			const live = await rpcStart({
				cwd: target,
				model: model.trim() || null,
				approvalMode: approval || null,
			});
			// Seed the store so the new session is selectable before the catalog
			// emits its own sessions:updated (which overwrites this stub).
			const now = new Date().toISOString();
			const stub: SessionMeta = {
				id: live.sessionId,
				tool: "omp",
				file: live.sessionFile,
				cwd: live.cwd,
				title: "",
				label: "",
				createdAt: now,
				updatedAt: now,
				parentId: null,
				forkDepth: 0,
				status: "working",
				unread: false,
				pending: null,
				live: true,
				externalPid: null,
				pinned: false,
				archived: false,
				workspaceId: wsSel === CUSTOM ? null : wsSel,
				repoRoot: null,
				git: null,
				result: null,
				lastAssistant: null,
				model: model.trim() || null,
			};
			upsert([stub]);
			const first = prompt.trim();
			if (first) {
				await rpcSend(live.sessionId, { type: "prompt", message: first });
			}
			selectSession(live.sessionId);
			closeModal();
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const input =
		"w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-indigo-500";

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
			onMouseDown={closeModal}
		>
			<div
				className="w-[480px] rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-300"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="mb-3 flex items-center">
					<span className="flex-1 text-sm font-medium text-neutral-100">新会话</span>
					<button type="button" onClick={closeModal} className="rounded p-1 text-neutral-400 hover:bg-neutral-800">
						<X size={15} />
					</button>
				</div>

				<label className="mb-1 block text-[11px] text-neutral-400">工作区 / 目录</label>
				<select value={wsSel} onChange={(e) => setWsSel(e.target.value)} className={clsx(input, "mb-2")}>
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
					<input
						value={customCwd}
						onChange={(e) => setCustomCwd(e.target.value)}
						placeholder="/绝对/路径"
						className={clsx(input, "mb-2 font-mono")}
					/>
				)}

				<div className="mb-2 flex gap-2">
					<div className="flex-1">
						<label className="mb-1 block text-[11px] text-neutral-400">模型（可选）</label>
						<input
							value={model}
							onChange={(e) => setModel(e.target.value)}
							placeholder="默认"
							className={input}
						/>
					</div>
					<div className="flex-1">
						<label className="mb-1 block text-[11px] text-neutral-400">审批模式</label>
						<select value={approval} onChange={(e) => setApproval(e.target.value)} className={input}>
							{APPROVAL_MODES.map((m) => (
								<option key={m.value} value={m.value}>
									{m.label}
								</option>
							))}
						</select>
					</div>
				</div>

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
					<input
						value={wtName}
						onChange={(e) => {
							setWtName(e.target.value);
							setWtTouched(true);
						}}
						placeholder={`worktree 名称（默认 ${slug}）`}
						className={clsx(input, "mb-2 font-mono")}
					/>
				)}
				{!wtTouched && useWorktree && (
					<div className="-mt-1 mb-2 text-[10px] text-neutral-500">将创建 omp/{slug} 分支</div>
				)}

				{running.length > 0 && !useWorktree && isRepo === true && (
					<div className="mb-2 flex items-center gap-1.5 rounded border border-amber-800/60 bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-200">
						<AlertTriangle size={12} className="shrink-0" />
						同仓库已有 {running.length} 个会话在跑，建议开 worktree
					</div>
				)}

				<label className="mb-1 block text-[11px] text-neutral-400">第一条消息（可选）</label>
				<textarea
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					rows={3}
					placeholder="创建后立即发送给 Agent"
					className={clsx(input, "mb-3 resize-none")}
				/>

				{error && <div className="mb-2 text-xs text-rose-400">{error}</div>}

				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={closeModal}
						className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
					>
						取消
					</button>
					<button
						type="button"
						disabled={!canSubmit}
						onClick={submit}
						className="rounded bg-indigo-600 px-4 py-1.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-40"
					>
						{busy ? "创建中…" : "创建会话"}
					</button>
				</div>
			</div>
		</div>
	);
}
