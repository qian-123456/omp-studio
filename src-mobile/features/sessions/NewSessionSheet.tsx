import { Check, ChevronLeft, Folder, FolderGit2, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { useSessions } from "../../core/stores/sessions";
import { BottomSheet, Button, Chip, ListGroup, Spinner, toast } from "../../ui";
import { ModelPicker, type PickerModel } from "../../ui/ModelPicker";
import { createInput, initialNewSession, newSessionReducer, preselectCwd } from "./newSession";
import { modeLabel, type DirEntry } from "./tree";

const KIND_TITLE: Record<string, string> = { workspace: "工作区", worktree: "工作树", global: "无项目" };
const KIND_ORDER = ["workspace", "worktree", "global"];

const KIND_ICON: Record<string, ReactNode> = {
	workspace: <Folder size={22} strokeWidth={1.75} />,
	worktree: <FolderGit2 size={22} strokeWidth={1.75} />,
	global: <MessageSquare size={22} strokeWidth={1.75} />,
};

/** Selectable row inside a grouped card (radio semantics, check mark on the right). */
function ChoiceRow({
	checked,
	onPick,
	icon,
	title,
	subtitle,
	tag,
}: {
	checked: boolean;
	onPick: () => void;
	icon?: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	tag?: ReactNode;
}) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			onClick={onPick}
			className="m-list-row flex w-full items-center gap-4 pl-4 text-left active:bg-m-surface-hover"
		>
			{icon != null && <span className="flex w-6 shrink-0 items-center justify-center text-m-text-2">{icon}</span>}
			<span className="m-list-sep flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pr-4">
				<span className="min-w-0 flex-1">
					<span className="block text-m-md break-words text-m-text">{title}</span>
					{subtitle != null && <span className="mt-0.5 block text-m-xs break-all text-m-text-3">{subtitle}</span>}
				</span>
				{tag}
				<span className="flex w-5 shrink-0 justify-center">{checked && <Check size={20} className="text-m-accent" />}</span>
			</span>
		</button>
	);
}

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
			<div className="flex items-center justify-center gap-2 p-10 text-m-sm text-m-text-3">
				<Spinner size={18} />
				加载目录
			</div>
		);
	if (load.error)
		return (
			<div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
				<div className="m-selectable text-m-sm break-words text-m-danger">加载目录失败：{load.error}</div>
				<Button onClick={onRetry}>重试</Button>
			</div>
		);
	const groups = groupDirs(load.data ?? []);
	if (!groups.length) return <div className="px-6 py-10 text-center text-m-sm text-m-text-3">没有可用目录</div>;
	return (
		<div className="flex flex-col pb-3" role="radiogroup" aria-label="选择目录">
			{groups.map((g) => (
				<ListGroup key={g.kind} title={g.title}>
						{g.dirs.map((d) => (
							<ChoiceRow
								key={d.path}
								checked={d.path === cwd}
								onPick={() => onPick(d.path)}
								icon={KIND_ICON[d.kind] ?? KIND_ICON.workspace}
								title={d.label || d.path}
								subtitle={d.label ? d.path : undefined}
								tag={d.kind !== "global" && d.mode ? <Chip>{modeLabel(d.mode)}</Chip> : undefined}
							/>
						))}
				</ListGroup>
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
	const dirsRequest = useRef(0);
	const modelsRequest = useRef(0);
	const createPending = useRef(false);

	const loadDirs = useCallback(() => {
		const request = ++dirsRequest.current;
		setDirs({ data: null, error: null, loading: true });
		api<{ dirs: DirEntry[] }>("GET", "/left/dirs")
			.then((r) => {
				if (request !== dirsRequest.current) return;
				const data = r.dirs ?? [];
				setDirs({ data, error: null, loading: false });
				const cwd = preselectCwd(data, defaultCwdRef.current);
				if (cwd) dispatch({ type: "pickDir", cwd });
			})
			.catch((e) => { if (request === dirsRequest.current) setDirs({ data: null, error: errorMessage(e), loading: false }); });
	}, []);

	// Opening restarts the wizard and refetches the directory list.
	useEffect(() => {
		if (!open) return;
		dispatch({ type: "reset", cwd: null });
		setCreating(createPending.current);
		setDirs({ data: null, error: null, loading: true });
		setModels({ data: null, error: null, loading: false, cwd: null });
		loadDirs();
		return () => { ++dirsRequest.current; ++modelsRequest.current; };
	}, [open, loadDirs]);


	const loadModels = useCallback((cwd: string) => {
		const request = ++modelsRequest.current;
		setModels({ data: null, error: null, loading: true, cwd });
		api<{ models?: PickerModel[] }>("GET", `/left/roles?cwd=${encodeURIComponent(cwd)}`)
			.then((r) => { if (request === modelsRequest.current) setModels({ data: r.models ?? [], error: null, loading: false, cwd }); })
			.catch((e) => { if (request === modelsRequest.current) setModels({ data: null, error: errorMessage(e), loading: false, cwd }); });
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
		if (!input || createPending.current) return;
		createPending.current = true;
		setCreating(true);
		try {
			const { id } = await useSessions.getState().createSession(input);
			onClose();
			nav.push(paths.chat(id));
		} catch (e) {
			toast(`新建失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			createPending.current = false;
			setCreating(false);
		}
	};

	const onModel = state.step === "model";
	const footer = onModel ? (
		<div className="flex gap-3">
			<Button
				className="flex-1"
				icon={<ChevronLeft size={18} strokeWidth={1.75} />}
				onClick={() => dispatch({ type: "back" })}
				disabled={creating}
			>
				上一步
			</Button>
			<Button className="flex-1" variant="primary" busy={creating} onClick={() => void create()}>
				创建会话
			</Button>
		</div>
	) : (
		<div className="flex gap-3">
			<Button className="flex-1" disabled={!state.cwd} busy={creating} onClick={() => void create()}>
				直接创建
			</Button>
			<Button className="flex-1" variant="primary" disabled={!state.cwd || creating} onClick={() => dispatch({ type: "next" })}>
				下一步
			</Button>
		</div>
	);

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			fullHeight
			title={onModel ? "选择模型" : "在哪个目录新建会话"}
			subtitle={onModel ? `第 2 步，共 2 步 · ${state.cwd ?? ""}` : "第 1 步，共 2 步"}
			footer={footer}
		>
			{!onModel ? (
				<DirStep load={dirs} cwd={state.cwd} onPick={(cwd) => dispatch({ type: "pickDir", cwd })} onRetry={loadDirs} />
			) : (
				<div className="flex h-full min-h-0 flex-col gap-3 pb-3">
					<div className="px-4">
						<ListGroup className="px-0!">
							<ChoiceRow
								checked={state.model === null}
								onPick={() => dispatch({ type: "pickModel", model: null })}
								title="使用默认模型"
								subtitle={defaultModel || undefined}
							/>
						</ListGroup>
					</div>
					{models.loading && (
						<div className="flex items-center justify-center gap-2 p-6 text-m-sm text-m-text-3">
							<Spinner size={18} />
							加载模型
						</div>
					)}
					{models.error && (
						<div className="flex flex-col items-center gap-4 px-6 py-6 text-center">
							<div className="m-selectable text-m-sm break-words text-m-danger">加载模型失败：{models.error}</div>
							<Button onClick={() => state.cwd && loadModels(state.cwd)}>重试</Button>
						</div>
					)}
					{models.data && (
						<ModelPicker
							className="min-h-0 flex-1 px-4"
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
