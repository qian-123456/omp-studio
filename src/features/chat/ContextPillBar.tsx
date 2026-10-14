/**
 * Codex-style context pills on the top edge of the Composer card:
 * project (workspace) picker on the left, git branch picker on the right.
 */
import clsx from "clsx";
import {
	Check,
	ChevronDown,
	Folder,
	FolderPlus,
	GitBranch,
	Globe,
	PanelRight,
	Plus,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { BranchInfo, Workspace } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { addWorkspace, gitBadge, gitListBranchesDetailed, gitRepoRoot } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { startSessionInDir } from "../sessions/newSession";
import { runSessionBash, shellQuote } from "./sessionShell";

const PILL =
	"flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium text-[var(--text-80,var(--text))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] select-none";
const ROW =
	"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-[var(--text)] hover:bg-[var(--ghost-hover,var(--bg-hover))]";

function PopoverSearch({
	value,
	onChange,
	placeholder,
	onEnter,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
	onEnter?: () => void;
}) {
	return (
		<div className="flex items-center gap-1.5 border-b border-[var(--line,var(--border-divider))] px-2.5 py-2">
			<Search size={13} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
			<input
				autoFocus
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && onEnter) {
						e.preventDefault();
						onEnter();
					}
				}}
				placeholder={placeholder}
				className="w-full bg-transparent text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-30,var(--text-dim))]"
			/>
		</div>
	);
}

function ActionRow({
	icon,
	label,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button type="button" onClick={onClick} className={clsx(ROW, "text-[var(--text-60,var(--text-muted))]")}>
			<span className="flex w-4 shrink-0 justify-center">{icon}</span>
			<span className="truncate">{label}</span>
		</button>
	);
}

export function WorkspacePickerPopover({
	anchor,
	ignoreRefs,
	activeWorkspaceId,
	onClose,
}: {
	anchor: HTMLElement | null;
	ignoreRefs: RefObject<HTMLElement | null>[];
	activeWorkspaceId: string | null;
	onClose: () => void;
}) {
	const workspaces = useSessions((s) => s.workspaces);
	const [query, setQuery] = useState("");
	const projects = useMemo(() => {
		const q = query.trim().toLowerCase();
		return workspaces
			.filter((w) => w.kind !== "global")
			.filter((w) => !q || w.name.toLowerCase().includes(q) || w.path.toLowerCase().includes(q))
			.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
	}, [workspaces, query]);

	const pick = (ws: Workspace) => {
		onClose();
		if (ws.id === activeWorkspaceId) return;
		void startSessionInDir(ws, false);
	};

	const browse = async () => {
		onClose();
		try {
			const selected = await openDialog({ directory: true, multiple: false, title: "选择项目目录" });
			const path = typeof selected === "string" ? selected : selected?.[0];
			if (!path) return;
			const ws = await addWorkspace(path);
			await useSessions.getState().refreshWorkspaces();
			await startSessionInDir(ws, false);
		} catch (err) {
			toast.error(`添加工作区失败: ${errMsg(err)}`);
		}
	};

	const goGlobal = () => {
		onClose();
		const globalWs = useSessions.getState().workspaces.find((w) => w.kind === "global");
		if (!globalWs) {
			toast.error("未找到全局工作区");
			return;
		}
		if (globalWs.id === activeWorkspaceId) return;
		void startSessionInDir(globalWs, false);
	};

	return (
		<FloatingLayer
			anchor={anchor}
			placement="top-start"
			offset={6}
			layer="popover"
			ignoreRefs={ignoreRefs}
			onDismiss={onClose}
			className="w-[300px] rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)]"
		>
			<PopoverSearch
				value={query}
				onChange={setQuery}
				placeholder="搜索工作区 / 项目"
				onEnter={() => projects[0] && pick(projects[0])}
			/>
			<div className="max-h-64 overflow-y-auto p-1">
				{projects.length === 0 ? (
					<div className="px-2 py-2 text-[12px] text-[var(--text-40,var(--text-dim))]">无匹配的工作区</div>
				) : (
					projects.map((ws) => (
						<button key={ws.id} type="button" onClick={() => pick(ws)} title={ws.path} className={ROW}>
							<Folder size={13} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
							<span className="min-w-0 flex-1 truncate">{ws.name}</span>
							{ws.id === activeWorkspaceId && <Check size={13} className="shrink-0" />}
						</button>
					))
				)}
			</div>
			<div className="border-t border-[var(--line,var(--border-divider))] p-1">
				<ActionRow icon={<FolderPlus size={13} />} label="新建工作区…" onClick={() => void browse()} />
				<ActionRow icon={<Globe size={13} />} label="全局模式 (不关联项目)" onClick={goGlobal} />
			</div>
		</FloatingLayer>
	);
}
function validateBranchName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	if (trimmed.endsWith("/")) return 'Branch name cannot end with "/".';
	if (trimmed.startsWith("/")) return 'Branch name cannot start with "/".';
	if (/\s/.test(trimmed)) return "Branch name cannot contain spaces.";
	if (/[\^~:?*\[\\]/.test(trimmed)) return "Branch name contains invalid characters.";
	if (trimmed.includes("..")) return 'Branch name cannot contain "..".';
	return null;
}

export function CreateBranchDialog({
	sessionId,
	initialName,
	onClose,
	onCreated,
}: {
	sessionId: string;
	initialName?: string;
	onClose: () => void;
	onCreated: () => void;
}) {
	const [prefix, setPrefix] = useState("omp/");
	const [branchName, setBranchName] = useState(initialName || prefix);
	const [busy, setBusy] = useState(false);

	const error = validateBranchName(branchName);
	const isValid = branchName.trim().length > 0 && !error;

	const handleCreate = async () => {
		if (!isValid || busy) return;
		setBusy(true);
		try {
			await runSessionBash(sessionId, `git checkout -b ${shellQuote(branchName.trim())}`);
			toast.success(`已创建并检出分支 ${branchName.trim()}`);
			onCreated();
		} catch (err) {
			toast.error(`创建分支失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
			onClick={onClose}
		>
			<div
				className="w-[440px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--line,var(--border-divider))] bg-[var(--bg-panel)] p-5 shadow-apple-modal text-[var(--text)] transition-all animate-in fade-in zoom-in-95 duration-150"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						onClose();
					}
					if (e.key === "Enter" && isValid && !busy) {
						e.stopPropagation();
						void handleCreate();
					}
				}}
			>
				<div className="flex items-center justify-between mb-3.5">
					<h3 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">Create and checkout branch</h3>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg p-1 text-[var(--text-40,var(--text-dim))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors"
					>
						<X size={15} />
					</button>
				</div>

				<div className="mb-1.5 flex items-center justify-between text-xs">
					<label className="text-[12px] font-medium text-[var(--text-60,var(--text-muted))]">Branch name</label>
					<button
						type="button"
						onClick={() => {
							const next = window.prompt("Set default branch prefix:", prefix);
							if (next !== null) {
								setPrefix(next);
								if (!branchName || branchName === prefix) {
									setBranchName(next);
								}
							}
						}}
						className="text-[11.5px] text-[var(--text-40,var(--text-dim))] hover:text-[var(--text)] transition-colors"
					>
						Set prefix
					</button>
				</div>

				<div className="relative mb-2">
					<input
						autoFocus
						type="text"
						value={branchName}
						onChange={(e) => setBranchName(e.target.value)}
						placeholder="codex/feature-name"
						className={clsx(
							"w-full rounded-xl border bg-[var(--well-bg,#18181b)] px-3 py-2 text-[13px] font-mono text-[var(--text)] outline-none transition-colors",
							error
								? "border-rose-500/80 focus:border-rose-500 ring-1 ring-rose-500/30"
								: "border-[var(--line,var(--border-divider))] focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400/30",
						)}
					/>
				</div>

				{error && (
					<div className="mb-4 text-[12px] text-rose-400">
						{error}
					</div>
				)}

				<div className="flex items-center justify-end gap-2.5 mt-5">
					<button
						type="button"
						onClick={onClose}
						className="rounded-xl px-4 py-2 text-[12.5px] font-medium text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors"
					>
						Close
					</button>
					<button
						type="button"
						disabled={!isValid || busy}
						onClick={() => void handleCreate()}
						className="rounded-xl bg-[var(--text)] px-4 py-2 text-[12.5px] font-semibold text-[var(--bg)] hover:opacity-90 disabled:opacity-35 transition-opacity"
					>
						{busy ? "Creating…" : "Create and checkout"}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

function BranchPickerPopover({
	anchor,
	ignoreRef,
	sessionId,
	cwd,
	currentBranch,
	onChanged,
	onClose,
}: {
	anchor: HTMLElement | null;
	ignoreRef: RefObject<HTMLElement | null>;
	sessionId: string;
	cwd: string;
	currentBranch: string;
	onChanged: () => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const [branches, setBranches] = useState<BranchInfo[] | null>(null);
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const root = (await gitRepoRoot(cwd).catch(() => null)) ?? cwd;
			const list = await gitListBranchesDetailed(root).catch(() => []);
			if (!cancelled) setBranches(list.filter((b) => !b.isRemote));
		})();
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (branches ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));
	}, [branches, query]);

	const run = async (cmd: string, okMsg: string) => {
		onClose();
		try {
			await runSessionBash(sessionId, cmd);
			toast.success(okMsg);
			onChanged();
		} catch (err) {
			toast.error(`Git 操作失败: ${errMsg(err)}`);
		}
	};

	const checkout = (name: string) => {
		if (name === currentBranch) {
			onClose();
			return;
		}
		void run(`git checkout ${shellQuote(name)}`, `已切换到分支 ${name}`);
	};

	const [showCreateDialog, setShowCreateDialog] = useState(false);

	return (
		<FloatingLayer
			anchor={anchor}
			placement="top-start"
			offset={6}
			layer="popover"
			ignoreRefs={[ignoreRef]}
			onDismiss={onClose}
			className="w-[280px] rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)]"
		>
			<PopoverSearch
				value={query}
				onChange={setQuery}
				placeholder="搜索分支"
				onEnter={() => {
					if (filtered[0]) {
						checkout(filtered[0].name);
					} else {
						setShowCreateDialog(true);
					}
				}}
			/>
			<div className="px-3 pt-2 pb-1 text-[11px] font-medium text-[var(--text-40,var(--text-dim))]">分支</div>
			<div className="max-h-56 overflow-y-auto px-1 pb-1">
				{branches === null ? (
					<div className="px-2 py-2 text-[12px] text-[var(--text-40,var(--text-dim))]">加载中…</div>
				) : filtered.length === 0 ? (
					<div className="px-2 py-2 text-[12px] text-[var(--text-40,var(--text-dim))]">无匹配的分支</div>
				) : (
					filtered.map((b) => (
						<button key={b.name} type="button" onClick={() => checkout(b.name)} className={ROW}>
							<GitBranch size={13} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
							<span className="min-w-0 flex-1 truncate">{b.displayName || b.name}</span>
							{b.name === currentBranch && <Check size={13} className="shrink-0" />}
						</button>
					))
				)}
			</div>
			<div className="border-t border-[var(--line,var(--border-divider))] p-1">
				<ActionRow
					icon={<Plus size={13} />}
					label={query.trim() ? `创建并检出新分支 "${query.trim()}"…` : "创建并检出新分支…"}
					onClick={() => setShowCreateDialog(true)}
				/>
				<ActionRow
					icon={<PanelRight size={13} />}
					label="打开 Git 面板…"
					onClick={() => {
						onClose();
						useUi.getState().setRightTab("git");
					}}
				/>
			</div>
			{showCreateDialog && (
				<CreateBranchDialog
					sessionId={sessionId}
					initialName={query.trim()}
					onClose={() => setShowCreateDialog(false)}
					onCreated={() => {
						setShowCreateDialog(false);
						onChanged();
						onClose();
					}}
				/>
			)}
		</FloatingLayer>
	);
}

export function ContextPillBar({
	sessionId,
	onWorkspaceClick,
	workspaceBtnRef,
}: {
	sessionId: string;
	/** Workspace pill click — Composer owns the picker so it can also be
	 * opened from the Add menu after this bar has unmounted. */
	onWorkspaceClick: () => void;
	workspaceBtnRef: RefObject<HTMLButtonElement | null>;
}) {
	const meta = useSessions((s) => s.sessions[sessionId]);
	const workspaces = useSessions((s) => s.workspaces);
	const cwd = meta?.cwd ?? "";
	const workspace = workspaces.find((w) => w.id === meta?.workspaceId) ?? null;
	const isGlobal = !workspace || workspace.kind === "global";
	const wsLabel = isGlobal ? "全局" : workspace.name;

	const branchRef = useRef<HTMLButtonElement>(null);
	const [branchOpen, setBranchOpen] = useState(false);
	const [branch, setBranch] = useState<string | null | undefined>(undefined);
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		if (!cwd) {
			setBranch(null);
			return;
		}
		let cancelled = false;
		gitBadge(cwd)
			.then((b) => !cancelled && setBranch(b?.branch ?? null))
			.catch(() => !cancelled && setBranch(null));
		return () => {
			cancelled = true;
		};
	}, [cwd, nonce]);

	return (
		<div className="flex items-center gap-1.5 border-b border-[var(--line,var(--border-divider))] px-3.5 py-2 text-[var(--text-60,var(--text-muted))]">
			<button
				ref={workspaceBtnRef}
				type="button"
				onClick={onWorkspaceClick}
				title={cwd || "全局"}
				className={PILL}
			>
				{isGlobal ? <Globe size={14} className="shrink-0 text-neutral-400" /> : <Folder size={14} className="shrink-0 text-neutral-400" />}
				<span className="max-w-56 truncate">{wsLabel}</span>
				<ChevronDown size={11} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
			</button>

			{branch === null ? (
				<span className="px-2 py-1 text-[12.5px] text-[var(--text-40,var(--text-dim))]">未关联 Git</span>
			) : branch !== undefined ? (
				<>
					<button
						ref={branchRef}
						type="button"
						onClick={() => setBranchOpen((v) => !v)}
						title={`当前分支: ${branch}`}
						className={PILL}
					>
						<GitBranch size={14} className="shrink-0 text-neutral-400" />
						<span className="max-w-48 truncate">{branch}</span>
						<ChevronDown size={11} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
					</button>
					{branchOpen && (
						<BranchPickerPopover
							anchor={branchRef.current}
							ignoreRef={branchRef}
							sessionId={sessionId}
							cwd={cwd}
							currentBranch={branch}
							onChanged={() => setNonce((n) => n + 1)}
							onClose={() => setBranchOpen(false)}
						/>
					)}
				</>
			) : null}
		</div>
	);
}
