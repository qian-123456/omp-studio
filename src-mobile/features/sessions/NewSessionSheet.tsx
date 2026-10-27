import { Check, ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { useSessions } from "../../core/stores/sessions";
import { BottomSheet, Spinner, toast } from "../../ui";
import { ModelPicker, type PickerModel } from "../../ui/ModelPicker";
import { createInput, initialNewSession, newSessionReducer, preselectCwd } from "./newSession";
import { modeLabel, type DirEntry } from "./tree";

const KIND_TITLE: Record<string, string> = { workspace: "工作区", worktree: "工作树", global: "无项目" };
const KIND_ORDER = ["workspace", "worktree", "global"];

const btn = "inline-flex min-h-11 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-m-md px-4 text-m-md font-medium disabled:opacity-50";
const primaryBtn = `${btn} bg-m-accent text-m-accent-text`;
const secondaryBtn = `${btn} border border-m-border bg-m-surface text-m-text`;

interface Load<T> {
	data: T | null;
	error: string | null;
	loading: boolean;
}

/** Group directories by kind in a fixed order, keeping the server order inside each group. */
export function groupDirs(dirs: readonly DirEntry[]): { kind: string; title: string; dirs: DirEntry[] }[] {
	const out: { kind: string; title: string; dirs: DirEntry[] }[] = [];
	for (const kind of [...KIND_ORDER, ...dirs.map((d) => d.kind).filter((k) => !KIND_ORDER.includes(k))]) {
		if (out.some((g) => g.kind === kind)) continue;
		const list = dirs.filter((d) => d.kind === kind);
		if (list.length) out.push({ kind, title: KIND_TITLE[kind] ?? kind, dirs: list });
	}
	return out;
}

function DirStep({
	load,
	cwd,
	onPick,
	onRetry,
}: {
	load: Load<DirEntry[]>;
	cwd: string | null;
	onPick: (cwd: string) => void;
	onRetry: () => void;
}) {
	if (load.loading && !load.data)
		return (
			<div className="flex items-center justify-center gap-2 p-8 text-m-sm text-m-text-3">
				<Spinner size={18} />
				加载目录
			</div>
		);
	if (load.error)
		return (
			<div className="flex flex-col items-center gap-3 p-6 text-center">
				<div className="select-text break-words text-m-sm text-m-danger">加载目录失败：{load.error}</div>
				<button type="button" onClick={onRetry} className={secondaryBtn}>
					重试
				</button>
			</div>
		);
	const groups = groupDirs(load.data ?? []);
	if (!groups.length) return <div className="p-8 text-center text-m-sm text-m-text-3">没有可用目录</div>;
	return (
		<div className="flex flex-col gap-3 px-4 pb-3" role="radiogroup" aria-label="选择目录">
			{groups.map((g) => (
				<div key={g.kind} className="flex flex-col gap-2">
					<div className="text-m-xs font-medium text-m-text-3">{g.title}</div>
					{g.dirs.map((d) => {
						const active = d.path === cwd;
						return (
							<button
								key={d.path}
								type="button"
								role="radio"
								aria-checked={active}
								onClick={() => onPick(d.path)}
								className={`flex min-h-11 items-center gap-3 rounded-m-md border px-3 py-2 text-left ${
									active ? "border-m-accent bg-m-surface-2" : "border-m-border bg-m-surface"
								}`}
							>
								<span className="min-w-0 flex-1">
									<span className="block break-words text-m-md text-m-text">{d.label || d.path}</span>
									<span className="block break-all text-m-xs text-m-text-3">{d.path}</span>
								</span>
								{d.kind !== "global" && d.mode && (
									<span className="shrink-0 whitespace-nowrap rounded-m-pill bg-m-surface-2 px-2 py-0.5 text-m-xs text-m-text-2">
										{modeLabel(d.mode)}
									</span>
								)}
								{active && <Check size={18} className="shrink-0 text-m-accent" />}
							</button>
						);
					})}
				</div>
			))}
		</div>
	);
}

/**
 * New-session wizard: 1) directory, 2) model + thinking. 「上一步」 keeps every choice; the model step is optional
 * (「直接创建」 / 「使用默认模型」 use the workspace default).
 */
export function NewSessionSheet({ open, onClose, defaultCwd }: { open: boolean; onClose: () => void; defaultCwd?: string }) {
	const [state, dispatch] = useReducer(newSessionReducer, defaultCwd, initialNewSession);
	const [dirs, setDirs] = useState<Load<DirEntry[]>>({ data: null, error: null, loading: false });
	const [models, setModels] = useState<Load<PickerModel[]> & { cwd: string | null }>({
		data: null,
		error: null,
		loading: false,
		cwd: null,
	});
	const [defaultModel, setDefaultModel] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const defaultCwdRef = useRef(defaultCwd);
	defaultCwdRef.current = defaultCwd;

	const loadDirs = useCallback(() => {
		setDirs((d) => ({ ...d, error: null, loading: true }));
		api<{ dirs: DirEntry[] }>("GET", "/left/dirs")
			.then((r) => setDirs({ data: r.dirs ?? [], error: null, loading: false }))
			.catch((e) => setDirs({ data: null, error: errorMessage(e), loading: false }));
	}, []);

	// Opening restarts the wizard and refetches the directory list.
	useEffect(() => {
		if (!open) return;
		dispatch({ type: "reset", cwd: null });
		setCreating(false);
		loadDirs();
	}, [open, loadDirs]);

	// Preselect `defaultCwd` once the directory list is known (only when nothing is chosen yet).
	useEffect(() => {
		if (!open || !dirs.data || state.cwd) return;
		const pre = preselectCwd(dirs.data, defaultCwdRef.current);
		if (pre) dispatch({ type: "pickDir", cwd: pre });
	}, [open, dirs.data, state.cwd]);

	const loadModels = useCallback((cwd: string) => {
		setModels({ data: null, error: null, loading: true, cwd });
		api<{ models?: PickerModel[] }>("GET", `/left/roles?cwd=${encodeURIComponent(cwd)}`)
			.then((r) => setModels({ data: r.models ?? [], error: null, loading: false, cwd }))
			.catch((e) => setModels({ data: null, error: errorMessage(e), loading: false, cwd }));
	}, []);

	// The catalog is fetched when the model step opens (cached per directory; back/forward does not refetch).
	useEffect(() => {
		if (!open || state.step !== "model" || !state.cwd) return;
		if (models.cwd !== state.cwd) loadModels(state.cwd);
	}, [open, state.step, state.cwd, models.cwd, loadModels]);

	useEffect(() => {
		if (!open || state.step !== "model" || defaultModel !== null) return;
		api<{ defaultModel?: string | null }>("GET", "/left/settings")
			.then((r) => setDefaultModel(r.defaultModel ?? ""))
			.catch(() => setDefaultModel(""));
	}, [open, state.step, defaultModel]);

	const create = async () => {
		const input = createInput(state, dirs.data ?? []);
		if (!input || creating) return;
		setCreating(true);
		try {
			const { id } = await useSessions.getState().createSession(input);
			onClose();
			nav.push(paths.chat(id));
		} catch (e) {
			toast(`新建失败：${errorMessage(e)}`, { kind: "error" });
			setCreating(false);
		}
	};

	const onModel = state.step === "model";
	const footer = onModel ? (
		<div className="flex gap-2">
			<button type="button" className={secondaryBtn} onClick={() => dispatch({ type: "back" })} disabled={creating}>
				<ChevronLeft size={18} />
				上一步
			</button>
			<button type="button" className={primaryBtn} onClick={() => void create()} disabled={creating}>
				{creating && <Spinner size={16} />}
				创建会话
			</button>
		</div>
	) : (
		<div className="flex gap-2">
			<button type="button" className={secondaryBtn} disabled={!state.cwd || creating} onClick={() => void create()}>
				{creating && <Spinner size={16} />}
				直接创建
			</button>
			<button type="button" className={primaryBtn} disabled={!state.cwd} onClick={() => dispatch({ type: "next" })}>
				下一步
			</button>
		</div>
	);

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			fullHeight
			title={onModel ? "选择模型" : "在哪个目录新建会话"}
			footer={footer}
		>
			{!onModel ? (
				<DirStep load={dirs} cwd={state.cwd} onPick={(cwd) => dispatch({ type: "pickDir", cwd })} onRetry={loadDirs} />
			) : (
				<div className="flex h-full min-h-0 flex-col gap-3 px-4 pb-3">
					<div className="break-all text-m-xs text-m-text-3">目录：{state.cwd}</div>
					<button
						type="button"
						role="radio"
						aria-checked={state.model === null}
						onClick={() => dispatch({ type: "pickModel", model: null })}
						className={`flex min-h-11 items-center gap-3 rounded-m-md border px-3 py-2 text-left ${
							state.model === null ? "border-m-accent bg-m-surface-2" : "border-m-border bg-m-surface"
						}`}
					>
						<span className="min-w-0 flex-1">
							<span className="block text-m-md text-m-text">使用默认模型</span>
							{defaultModel && <span className="block break-all text-m-xs text-m-text-3">{defaultModel}</span>}
						</span>
						{state.model === null && <Check size={18} className="shrink-0 text-m-accent" />}
					</button>
					{models.loading && (
						<div className="flex items-center justify-center gap-2 p-6 text-m-sm text-m-text-3">
							<Spinner size={18} />
							加载模型
						</div>
					)}
					{models.error && (
						<div className="flex flex-col items-center gap-3 p-4 text-center">
							<div className="select-text break-words text-m-sm text-m-danger">加载模型失败：{models.error}</div>
							<button type="button" className={secondaryBtn} onClick={() => state.cwd && loadModels(state.cwd)}>
								重试
							</button>
						</div>
					)}
					{models.data && (
						<ModelPicker
							className="min-h-0 flex-1"
							value={state.model}
							models={models.data}
							onChange={(m) => dispatch({ type: "pickModel", model: m })}
							thinking={{ value: state.thinking, onChange: (level) => dispatch({ type: "setThinking", level }) }}
						/>
					)}
				</div>
			)}
		</BottomSheet>
	);
}
