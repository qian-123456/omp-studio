import { Camera, Check, CircleCheck, CircleX, Image as ImageIcon, Lightbulb, ListChecks, PenLine, Plus, RotateCcw, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, apiUrl, errorMessage, upload } from "../../core/api";
import { baseName, relTime, sessionName } from "../../core/lib/format";
import { useSessions } from "../../core/stores/sessions";
import { STATUS_LABEL as SESSION_STATUS } from "../../core/types";
import type { MobileSession } from "../../core/types";
import {
	BottomSheet,
	Button,
	Chip,
	confirm,
	EmptyState,
	Field,
	IconButton,
	inputCls,
	ListGroup,
	ListRow,
	openImage,
	PageHeader,
	PullToRefresh,
	Segmented,
	toast,
} from "../../ui";
import { LoadState, Select, useLoad } from "./controls";
import {
	buildCreatePayload,
	buildDispatch,
	buildEditPatch,
	captureError,
	commonProjectDir,
	filterIdeas,
	groupIdeas,
	imageRefs,
	isActive,
	KIND_LABEL,
	mergeItems,
	sessionRefs,
	STATUS_LABEL,
	tabCounts,
} from "./ideas";
import type { Idea, IdeaKind, IdeaTab } from "./ideas";
import { SketchPad } from "./SketchPad";

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as IdeaKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const imageUrl = (path: string): string => apiUrl(`/ideas/image?path=${encodeURIComponent(path)}`);
const ICON = { size: 22, strokeWidth: 1.75 } as const;
/** Inputs inside sheets sit on `--m-bg-elev`, where the card tone separates better than `--m-surface`. */
const sheetInput = `${inputCls} bg-m-card! resize-none leading-6`;

interface Draft {
	blob: Blob;
	url: string;
}

function Thumbs({ paths }: { paths: string[] }) {
	if (!paths.length) return null;
	const urls = paths.map(imageUrl);
	return (
		<div className="flex flex-wrap gap-2 px-5">
			{urls.map((u) => (
				<button key={u} type="button" onClick={() => openImage({ src: u, alt: "想法图片" })} className="h-20 w-20 overflow-hidden rounded-m-md bg-m-surface">
					<img src={u} alt="想法图片" loading="lazy" className="h-full w-full object-cover" />
				</button>
			))}
		</div>
	);
}

function ErrorText({ children }: { children: ReactNode }) {
	return (
		<p role="alert" className="m-selectable px-1 text-m-sm break-words text-m-danger">
			{children}
		</p>
	);
}

function Tile({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-m-md bg-m-card text-m-text shadow-m-card active:bg-m-surface-hover"
		>
			<span className="text-m-text-2">{icon}</span>
			<span className="text-m-sm whitespace-nowrap">{label}</span>
		</button>
	);
}

/* ---------------------------------------------------------------- capture */

function CaptureSheet({
	open,
	onClose,
	dirs,
	onCreated,
}: {
	open: boolean;
	onClose: () => void;
	dirs: string[];
	onCreated: (it: Idea) => void;
}) {
	const [text, setText] = useState("");
	const [kind, setKind] = useState<IdeaKind>("idea");
	const [dir, setDir] = useState("");
	const [files, setFiles] = useState<Draft[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [sketch, setSketch] = useState(false);
	const album = useRef<HTMLInputElement>(null);
	const camera = useRef<HTMLInputElement>(null);
	const filesRef = useRef(files);
	filesRef.current = files;

	useEffect(() => {
		if (!open) return;
		setText("");
		setKind("idea");
		setDir("");
		setError(null);
		setSaving(false);
		return () => {
			for (const f of filesRef.current) URL.revokeObjectURL(f.url);
			setFiles([]);
		};
	}, [open]);

	const add = (list: FileList | null) => {
		if (!list) return;
		setFiles((p) => [...p, ...[...list].map((blob) => ({ blob, url: URL.createObjectURL(blob) }))]);
		setError(null);
	};
	const remove = (i: number) =>
		setFiles((p) => {
			const f = p[i];
			if (f) URL.revokeObjectURL(f.url);
			return p.filter((_, j) => j !== i);
		});

	const save = async () => {
		const err = captureError(text, files.length);
		setError(err);
		if (err) return;
		setSaving(true);
		try {
			const imagePaths: string[] = [];
			for (const f of files) imagePaths.push((await upload("/ideas/images", f.blob)).path);
			const it = await api<Idea>("POST", "/ideas", buildCreatePayload({ text, kind, imagePaths, projectDir: dir }));
			onCreated(it);
			toast("已添加", { kind: "success" });
			onClose();
		} catch (e) {
			setError(`添加失败：${errorMessage(e)}`);
			setSaving(false);
		}
	};

	return (
		<>
			<BottomSheet
				open={open}
				onClose={onClose}
				title="添加想法"
				footer={
					<div className="flex gap-2">
						<Button block className="flex-1" onClick={onClose}>
							取消
						</Button>
						<Button variant="primary" block className="flex-1" busy={saving} onClick={() => void save()}>
							保存
						</Button>
					</div>
				}
			>
				<div className="flex flex-col gap-4 px-4 pt-1 pb-3">
					<textarea
						className={`${sheetInput} min-h-32`}
						rows={4}
						value={text}
						placeholder="记下想法或 Bug"
						aria-label="内容"
						onChange={(e) => {
							setText(e.target.value);
							setError(null);
						}}
					/>
					<Segmented label="类型" value={kind} options={KIND_OPTIONS} onChange={setKind} />
					<div className="grid grid-cols-3 gap-2">
						<Tile icon={<ImageIcon {...ICON} />} label="相册" onClick={() => album.current?.click()} />
						<Tile icon={<Camera {...ICON} />} label="拍照" onClick={() => camera.current?.click()} />
						<Tile icon={<PenLine {...ICON} />} label="草图" onClick={() => setSketch(true)} />
					</div>
					<input ref={album} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
					<input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
					{files.length > 0 && (
						<div className="flex flex-wrap gap-3 pt-1">
							{files.map((f, i) => (
								<div key={f.url} className="relative h-20 w-20">
									<img src={f.url} alt={`待上传图片 ${i + 1}`} className="h-full w-full rounded-m-md object-cover" />
									<button
										type="button"
										aria-label="移除图片"
										onClick={() => remove(i)}
										className="absolute -top-3 -right-3 flex h-11 w-11 items-center justify-center"
									>
										<span className="flex h-6 w-6 items-center justify-center rounded-m-pill bg-m-text text-m-bg">
											<X size={14} />
										</span>
									</button>
								</div>
							))}
						</div>
					)}
					<Field label="所属项目" hint={dir || undefined}>
						<Select value={dir} onChange={setDir} className="bg-m-card!">
							<option value="">全局（不属于项目）</option>
							{dirs.map((d) => (
								<option key={d} value={d}>
									{baseName(d)}
								</option>
							))}
						</Select>
					</Field>
					{error && <ErrorText>{error}</ErrorText>}
				</div>
			</BottomSheet>
			<SketchPad
				open={sketch}
				onClose={() => setSketch(false)}
				onDone={(png) => setFiles((p) => [...p, { blob: png, url: URL.createObjectURL(png) }])}
			/>
		</>
	);
}

/* ---------------------------------------------------------------- edit */

function EditSheet({
	idea,
	onClose,
	onChanged,
	onDeleted,
	onDispatch,
}: {
	idea: Idea | null;
	onClose: () => void;
	onChanged: (it: Idea) => void;
	onDeleted: (id: string) => void;
	onDispatch: (id: string) => void;
}) {
	const [text, setText] = useState("");
	const [kind, setKind] = useState<IdeaKind>("idea");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const byId = useSessions((s) => s.byId);
	const id = idea?.id;
	useEffect(() => {
		if (!idea) return;
		setText(idea.text);
		setKind(idea.kind);
		setError(null);
		setBusy(false);
		// reset only when a different idea opens, not when the same one is patched
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id]);

	const patch = async (body: Record<string, unknown>, msg: string) => {
		if (!idea) return;
		setBusy(true);
		try {
			onChanged(await api<Idea>("PATCH", `/ideas/${encodeURIComponent(idea.id)}`, body));
			toast(msg, { kind: "success" });
			onClose();
		} catch (e) {
			setError(`操作失败：${errorMessage(e)}`);
			setBusy(false);
		}
	};
	const save = () => {
		if (!idea) return;
		if (!text.trim()) return setError("内容不能为空");
		const p = buildEditPatch(idea, text, kind);
		if (!Object.keys(p).length) return onClose();
		void patch(p, "已保存");
	};
	const del = async () => {
		if (!idea || !(await confirm({ title: "删除想法", message: "确定删除这条想法？", danger: true, confirmText: "删除" }))) return;
		try {
			await api("DELETE", `/ideas/${encodeURIComponent(idea.id)}`);
			onDeleted(idea.id);
			toast("已删除", { kind: "success" });
			onClose();
		} catch (e) {
			setError(`删除失败：${errorMessage(e)}`);
		}
	};

	const sess = idea ? sessionRefs(idea) : [];
	return (
		<BottomSheet
			open={!!idea}
			onClose={onClose}
			title="编辑想法"
			subtitle={idea ? `${STATUS_LABEL[idea.status] ?? idea.status} · ${idea.projectDir ? baseName(idea.projectDir) : "全局"}` : undefined}
			footer={
				<div className="flex gap-2">
					<Button block className="flex-1" onClick={onClose}>
						取消
					</Button>
					<Button variant="primary" block className="flex-1" disabled={busy} onClick={save}>
						保存
					</Button>
				</div>
			}
		>
			{idea && (
				<div className="flex flex-col gap-4 pt-1 pb-3">
					<div className="flex flex-col gap-4 px-4">
						<textarea
							className={`${sheetInput} min-h-32`}
							rows={5}
							value={text}
							aria-label="内容"
							onChange={(e) => {
								setText(e.target.value);
								setError(null);
							}}
						/>
						<Segmented label="类型" value={kind} options={KIND_OPTIONS} onChange={setKind} />
					</div>
					<Thumbs paths={imageRefs(idea).map((r) => r.path as string)} />
					{sess.length > 0 && (
						<div className="flex flex-col gap-0.5 px-5 text-m-xs text-m-text-3">
							{sess.map((r) => (
								<span key={r.sessionId} className="break-words">
									关联会话：{sessionName(byId[r.sessionId as string]) || (r.sessionId as string).slice(0, 8)}
								</span>
							))}
						</div>
					)}
					{error && (
						<div className="px-4">
							<ErrorText>{error}</ErrorText>
						</div>
					)}
					<ListGroup>
						<ListRow
							icon={<Send {...ICON} />}
							title="派发到会话"
							onClick={() => {
								const i = idea.id;
								onClose();
								onDispatch(i);
							}}
						/>
						{isActive(idea) ? (
							<>
								<ListRow icon={<CircleCheck {...ICON} />} title="标记完成" disabled={busy} chevron={false} onClick={() => void patch({ status: "done" }, "已完成")} />
								<ListRow icon={<CircleX {...ICON} />} title="关闭" disabled={busy} chevron={false} onClick={() => void patch({ status: "closed" }, "已关闭")} />
							</>
						) : (
							<ListRow icon={<RotateCcw {...ICON} />} title="重新打开" disabled={busy} chevron={false} onClick={() => void patch({ status: "inbox" }, "已重新打开")} />
						)}
						<ListRow icon={<Trash2 {...ICON} />} title="删除" danger chevron={false} onClick={() => void del()} />
					</ListGroup>
				</div>
			)}
		</BottomSheet>
	);
}

/* ---------------------------------------------------------------- dispatch */

function RadioMark({ on }: { on: boolean }) {
	return (
		<span
			aria-hidden
			className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-m-pill transition-colors duration-(--m-dur-fast) ${
				on ? "bg-m-accent text-m-accent-text" : "border-2 border-m-border-strong"
			}`}
		>
			{on && <Check size={14} strokeWidth={2.5} />}
		</span>
	);
}

function DispatchSheet({
	ids,
	items,
	onClose,
	onDone,
}: {
	ids: string[] | null;
	items: Idea[];
	onClose: () => void;
	onDone: (updated: Idea[]) => void;
}) {
	const list = useSessions((s) => s.list);
	const [target, setTarget] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const open = !!ids;
	useEffect(() => {
		if (open) {
			setTarget("");
			setBusy(false);
			setError(null);
		}
	}, [open]);
	const cands = useMemo(() => list.filter((s) => !s.archived), [list]);
	const n = ids?.length ?? 0;

	const go = async () => {
		if (!ids) return;
		setBusy(true);
		setError(null);
		try {
			const req = buildDispatch(ids, target, commonProjectDir(items, ids));
			const r = await api<{ items?: Idea[] }>("POST", req.path, req.body);
			onDone(r.items ?? []);
			toast("已派发", { kind: "success" });
			void useSessions.getState().refresh().catch(() => {});
			onClose();
		} catch (e) {
			setError(`派发失败：${errorMessage(e)}`);
			setBusy(false);
		}
	};

	const row = (id: string, name: string, sub: string) => (
		<button
			key={id || "new"}
			type="button"
			role="radio"
			aria-checked={target === id}
			onClick={() => setTarget(id)}
			className="m-list-row flex w-full items-center gap-4 pl-4 text-left active:bg-m-surface-hover"
		>
			<RadioMark on={target === id} />
			<span className="m-list-sep min-h-14 min-w-0 flex-1 py-3 pr-4">
				<span className="block text-m-md break-words text-m-text">{name}</span>
				<span className="mt-0.5 block text-m-xs break-words text-m-text-3">{sub}</span>
			</span>
		</button>
	);

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			title="派发到会话"
			subtitle={n > 1 ? `将 ${n} 项合并为一条提示发送` : "选择目标会话"}
			fullHeight
			footer={
				<div className="flex flex-col gap-2">
					{error && <ErrorText>{error}</ErrorText>}
					<Button variant="primary" block busy={busy} onClick={() => void go()}>
						{n > 1 ? `派发 ${n} 项` : "派发"}
					</Button>
				</div>
			}
		>
			<div role="radiogroup" aria-label="目标会话" className="pb-4">
				<ListGroup>{row("", "新会话", "在条目所属项目中新建会话")}</ListGroup>
				{cands.length > 0 && (
					<ListGroup title="已有会话">
						{cands.map((s) => row(s.id, sessionName(s), `${baseName(s.cwd)} · ${SESSION_STATUS[s.status] ?? s.status}`))}
					</ListGroup>
				)}
			</div>
		</BottomSheet>
	);
}

/* ---------------------------------------------------------------- page */

function IdeaRow({
	it,
	selecting,
	picked,
	onTap,
	byId,
}: {
	it: Idea;
	selecting: boolean;
	picked: boolean;
	onTap: () => void;
	byId: Record<string, MobileSession>;
}) {
	const imgs = imageRefs(it).length;
	const sess = sessionRefs(it);
	const tgt = it.targetSessionId ? byId[it.targetSessionId] : null;
	return (
		<button
			type="button"
			data-testid="idea-card"
			aria-pressed={selecting ? picked : undefined}
			onClick={onTap}
			className={`m-list-row flex w-full items-start gap-3 pl-5 text-left active:bg-m-surface-hover ${picked ? "bg-m-accent-soft/40" : ""}`}
		>
			{selecting && (
				<span className="pt-4">
					<RadioMark on={picked} />
				</span>
			)}
			<span className="m-list-sep min-w-0 flex-1 py-3.5 pr-5">
				<span className="flex items-center gap-1.5">
					<Chip tone={it.kind === "bug" ? "danger" : "accent"}>{KIND_LABEL[it.kind] ?? it.kind}</Chip>
					<Chip>{STATUS_LABEL[it.status] ?? it.status}</Chip>
					<span className="ml-auto text-m-xs whitespace-nowrap text-m-text-3">{relTime(it.createdAt)}</span>
				</span>
				<span className="mt-2 block text-m-md break-words whitespace-pre-wrap text-m-text">{it.text}</span>
				{(imgs > 0 || sess.length > 0 || tgt) && (
					<span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-m-xs text-m-text-3">
						{imgs > 0 && <span className="whitespace-nowrap">{imgs} 张图片</span>}
						{sess.map((r) => (
							<span key={r.sessionId} className="break-words">
								会话：{sessionName(byId[r.sessionId as string]) || (r.sessionId as string).slice(0, 8)}
							</span>
						))}
						{tgt && <span className="break-words">派发至：{sessionName(tgt)}</span>}
					</span>
				)}
			</span>
		</button>
	);
}

export function IdeasPage() {
	const { data, setData, error, loading, reload } = useLoad(() => api<Idea[]>("GET", "/ideas"));
	const sessions = useSessions((s) => s.list);
	const byId = useSessions((s) => s.byId);
	const [tab, setTab] = useState<IdeaTab>("active");
	const [selecting, setSelecting] = useState(false);
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [capture, setCapture] = useState(false);
	const [editId, setEditId] = useState<string | null>(null);
	const [dispatchIds, setDispatchIds] = useState<string[] | null>(null);

	useEffect(() => {
		if (!useSessions.getState().loaded) void useSessions.getState().refresh().catch(() => {});
	}, []);

	const items = data ?? [];
	const counts = tabCounts(items);
	const list = useMemo(() => filterIdeas(items, tab), [items, tab]);
	const groups = useMemo(() => groupIdeas(list, null), [list]);
	const dirs = useMemo(
		() => [...new Set([...items.map((i) => i.projectDir), ...sessions.map((s) => s.cwd)].filter((d): d is string => !!d))],
		[items, sessions],
	);
	const editing = items.find((i) => i.id === editId) ?? null;

	const changeTab = (t: IdeaTab) => {
		setTab(t);
		setPicked(new Set());
	};
	const toggleSelect = () => {
		setSelecting((s) => !s);
		setPicked(new Set());
	};
	const upsert = (it: Idea) => setData((d) => (d ? (d.some((x) => x.id === it.id) ? mergeItems(d, [it]) : [it, ...d]) : [it]));

	const tabs = [
		{ value: "active", label: `进行中 ${counts.active}` },
		{ value: "done", label: `已完成 ${counts.done}` },
		{ value: "all", label: `全部 ${counts.all}` },
	] as const;

	return (
		<div className="relative flex h-full min-h-0 flex-col bg-m-bg-elev text-m-text">
			<PageHeader
				title="想法"
				className="bg-m-bg-elev!"
				right={
					<>
						{tab !== "done" && list.length > 0 && (
							<IconButton
								variant={selecting ? "tinted" : "plain"}
								icon={selecting ? <X {...ICON} /> : <ListChecks {...ICON} />}
								label={selecting ? "退出多选" : "多选"}
								pressed={selecting}
								onClick={toggleSelect}
							/>
						)}
						<IconButton variant="filled" icon={<Plus {...ICON} />} label="添加想法" onClick={() => setCapture(true)} />
					</>
				}
			>
				<div className="px-4 pt-1 pb-3">
					<Segmented label="筛选" value={tab} options={tabs} onChange={changeTab} />
				</div>
			</PageHeader>
			<PullToRefresh onRefresh={reload}>
				{data === null ? (
					<LoadState loading={loading} error={error} onRetry={reload} />
				) : list.length === 0 ? (
					<EmptyState
						className="min-h-[60dvh]"
						icon={<Lightbulb size={26} strokeWidth={1.75} />}
						title={tab === "done" ? "暂无已完成的条目" : tab === "all" ? "还没有任何想法" : "还没有想法"}
						hint="随手记下想法或 Bug，之后一键派发给 agent"
						action={
							<Button variant="primary" icon={<Plus size={18} />} onClick={() => setCapture(true)}>
								添加想法
							</Button>
						}
					/>
				) : (
					<div style={{ paddingBottom: `calc(var(--m-safe-bottom) + ${selecting ? 104 : 24}px)` }}>
						{error && <p className="m-selectable px-8 pt-3 text-m-sm break-words text-m-danger">刷新失败：{error}</p>}
						{groups.map((g) => (
							<ListGroup key={g.dir || "global"} title={`${g.label} · ${g.items.length}`}>
								{g.items.map((it) => (
									<IdeaRow
										key={it.id}
										it={it}
										byId={byId}
										selecting={selecting}
										picked={picked.has(it.id)}
										onTap={() => {
											if (!selecting) return setEditId(it.id);
											setPicked((p) => {
												const n = new Set(p);
												if (n.has(it.id)) n.delete(it.id);
												else n.add(it.id);
												return n;
											});
										}}
									/>
								))}
							</ListGroup>
						))}
					</div>
				)}
			</PullToRefresh>
			{selecting && (
				<div className="pointer-events-none absolute inset-x-4 z-(--z-banner) flex justify-center" style={{ bottom: "calc(var(--m-safe-bottom) + 16px)" }}>
					<div className="pointer-events-auto flex w-full items-center gap-3 rounded-m-pill bg-m-surface py-1.5 pr-1.5 pl-5 shadow-m-pop">
						<span className="flex-1 text-m-md whitespace-nowrap">已选 {picked.size} 项</span>
						<Button variant="primary" icon={<Send size={18} />} disabled={picked.size === 0} onClick={() => setDispatchIds([...picked])}>
							派发所选
						</Button>
					</div>
				</div>
			)}
			<CaptureSheet open={capture} onClose={() => setCapture(false)} dirs={dirs} onCreated={(it) => { upsert(it); setTab("active"); }} />
			<EditSheet
				idea={editing}
				onClose={() => setEditId(null)}
				onChanged={upsert}
				onDeleted={(id) => setData((d) => (d ? d.filter((x) => x.id !== id) : d))}
				onDispatch={(id) => setDispatchIds([id])}
			/>
			<DispatchSheet
				ids={dispatchIds}
				items={items}
				onClose={() => setDispatchIds(null)}
				onDone={(updated) => {
					setData((d) => (d ? mergeItems(d, updated) : d));
					setSelecting(false);
					setPicked(new Set());
				}}
			/>
		</div>
	);
}
