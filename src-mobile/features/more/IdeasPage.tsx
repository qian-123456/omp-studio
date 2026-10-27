import { Camera, Check, Image as ImageIcon, Lightbulb, PenLine, Plus, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiUrl, errorMessage, upload } from "../../core/api";
import { baseName, relTime, sessionName } from "../../core/lib/format";
import { useSessions } from "../../core/stores/sessions";
import { STATUS_LABEL as SESSION_STATUS } from "../../core/types";
import { BottomSheet, Chip, confirm, EmptyState, HeaderButton, openImage, PageHeader, PullToRefresh, toast } from "../../ui";
import { btnCls, btnDangerCls, btnPrimaryCls, Field, inputCls, LoadState, Segmented, useLoad } from "./controls";
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

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as IdeaKind[]).map((k) => [k, KIND_LABEL[k]] as const);
const imageUrl = (path: string): string => apiUrl(`/ideas/image?path=${encodeURIComponent(path)}`);

interface Draft {
	blob: Blob;
	url: string;
}

function Thumbs({ paths }: { paths: string[] }) {
	if (!paths.length) return null;
	const urls = paths.map(imageUrl);
	return (
		<div className="flex flex-wrap gap-2">
			{urls.map((u) => (
				<button key={u} type="button" onClick={() => openImage({ src: u, alt: "想法图片" })} className="h-16 w-16 overflow-hidden rounded-m-md border border-m-border bg-m-surface">
					<img src={u} alt="想法图片" loading="lazy" className="h-full w-full object-cover" />
				</button>
			))}
		</div>
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
						<button type="button" className={`${btnCls} flex-1`} onClick={onClose}>
							取消
						</button>
						<button type="button" className={`${btnPrimaryCls} flex-1`} disabled={saving} onClick={() => void save()}>
							{saving ? "保存中" : "保存"}
						</button>
					</div>
				}
			>
				<div className="flex flex-col gap-4 p-4">
					<textarea
						className={`${inputCls} min-h-28 py-2`}
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
						<button type="button" className={btnCls} onClick={() => album.current?.click()}>
							<ImageIcon size={16} /> 相册
						</button>
						<button type="button" className={btnCls} onClick={() => camera.current?.click()}>
							<Camera size={16} /> 拍照
						</button>
						<button type="button" className={btnCls} onClick={() => setSketch(true)}>
							<PenLine size={16} /> 草图
						</button>
					</div>
					<input ref={album} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
					<input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
					{files.length > 0 && (
						<div className="flex flex-wrap gap-2">
							{files.map((f, i) => (
								<div key={f.url} className="relative h-16 w-16">
									<img src={f.url} alt={`待上传图片 ${i + 1}`} className="h-full w-full rounded-m-md border border-m-border object-cover" />
									<button
										type="button"
										aria-label="移除图片"
										onClick={() => remove(i)}
										className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-m-pill bg-m-text text-m-bg"
									>
										<X size={14} />
									</button>
								</div>
							))}
						</div>
					)}
					<Field label="所属项目">
						<select className={inputCls} value={dir} onChange={(e) => setDir(e.target.value)}>
							<option value="">全局（不属于项目）</option>
							{dirs.map((d) => (
								<option key={d} value={d}>
									{baseName(d)}　{d}
								</option>
							))}
						</select>
					</Field>
					{error && (
						<div role="alert" className="break-words text-m-sm text-m-danger">
							{error}
						</div>
					)}
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
		if (!idea || !(await confirm({ title: "删除想法", message: "确定删除这条想法？", danger: true }))) return;
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
			title={idea ? `编辑 · ${STATUS_LABEL[idea.status] ?? idea.status}` : undefined}
			footer={
				<div className="flex gap-2">
					<button type="button" className={`${btnCls} flex-1`} onClick={onClose}>
						取消
					</button>
					<button type="button" className={`${btnPrimaryCls} flex-1`} disabled={busy} onClick={save}>
						保存
					</button>
				</div>
			}
		>
			{idea && (
				<div className="flex flex-col gap-4 p-4">
					<textarea className={`${inputCls} min-h-32 py-2`} rows={5} value={text} aria-label="内容" onChange={(e) => { setText(e.target.value); setError(null); }} />
					<Segmented label="类型" value={kind} options={KIND_OPTIONS} onChange={setKind} />
					<Thumbs paths={imageRefs(idea).map((r) => r.path as string)} />
					<div className="flex flex-col gap-1 text-m-sm text-m-text-3">
						<span>项目：{idea.projectDir ? baseName(idea.projectDir) : "全局"}</span>
						{sess.map((r) => (
							<span key={r.sessionId} className="break-all">
								关联会话：{sessionName(byId[r.sessionId as string]) || (r.sessionId as string).slice(0, 8)}
							</span>
						))}
					</div>
					{error && (
						<div role="alert" className="break-words text-m-sm text-m-danger">
							{error}
						</div>
					)}
					<div className="grid grid-cols-2 gap-2">
						{isActive(idea) ? (
							<>
								<button type="button" className={btnCls} disabled={busy} onClick={() => void patch({ status: "done" }, "已完成")}>
									<Check size={16} /> 完成
								</button>
								<button type="button" className={btnCls} disabled={busy} onClick={() => void patch({ status: "closed" }, "已关闭")}>
									关闭
								</button>
							</>
						) : (
							<button type="button" className={btnCls} disabled={busy} onClick={() => void patch({ status: "inbox" }, "已重新打开")}>
								重新打开
							</button>
						)}
						<button type="button" className={btnCls} onClick={() => { const i = idea.id; onClose(); onDispatch(i); }}>
							<Send size={16} /> 派发
						</button>
						<button type="button" className={btnDangerCls} onClick={() => void del()}>
							删除
						</button>
					</div>
				</div>
			)}
		</BottomSheet>
	);
}

/* ---------------------------------------------------------------- dispatch */

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
		<li key={id || "new"}>
			<button
				type="button"
				role="radio"
				aria-checked={target === id}
				onClick={() => setTarget(id)}
				className={`flex min-h-14 w-full items-center gap-3 border-b border-m-border px-4 py-2 text-left ${target === id ? "bg-m-surface-2" : "active:bg-m-surface-hover"}`}
			>
				<span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-m-pill border ${target === id ? "border-m-accent bg-m-accent text-m-accent-text" : "border-m-border"}`}>
					{target === id && <Check size={12} />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block break-words text-m-md">{name}</span>
					<span className="block break-all text-m-xs text-m-text-3">{sub}</span>
				</span>
			</button>
		</li>
	);

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			title="派发到会话"
			fullHeight
			footer={
				<div className="flex flex-col gap-2">
					{error && (
						<div role="alert" className="break-words text-m-sm text-m-danger">
							{error}
						</div>
					)}
					<div className="flex gap-2">
						<button type="button" className={`${btnCls} flex-1`} onClick={onClose}>
							取消
						</button>
						<button type="button" className={`${btnPrimaryCls} flex-1`} disabled={busy} onClick={() => void go()}>
							{busy ? "派发中" : n > 1 ? `派发 ${n} 项` : "派发"}
						</button>
					</div>
				</div>
			}
		>
			<div className="px-4 py-3 text-m-sm text-m-text-3">{n > 1 ? `将 ${n} 项合并为一条提示发送` : "选择目标会话"}</div>
			<ul role="radiogroup" aria-label="目标会话">
				{row("", "新会话", "在条目所属项目中新建会话")}
				{cands.map((s) => row(s.id, sessionName(s), `${baseName(s.cwd)} · ${SESSION_STATUS[s.status] ?? s.status}`))}
			</ul>
		</BottomSheet>
	);
}

/* ---------------------------------------------------------------- page */

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

	const tabs: ReadonlyArray<readonly [IdeaTab, string]> = [
		["active", `进行中 ${counts.active}`],
		["done", `已完成 ${counts.done}`],
		["all", `全部 ${counts.all}`],
	];

	return (
		<div className="relative flex h-full min-h-0 flex-col bg-m-bg text-m-text">
			<PageHeader
				title="想法"
				right={
					<>
						{tab !== "done" && list.length > 0 && (
							<button type="button" onClick={toggleSelect} className="min-h-11 whitespace-nowrap px-3 text-m-md text-m-accent">
								{selecting ? "取消多选" : "多选"}
							</button>
						)}
						<HeaderButton icon={<Plus size={22} />} label="添加想法" onClick={() => setCapture(true)} />
					</>
				}
			>
				<div className="px-4 pb-2">
					<Segmented label="筛选" value={tab} options={tabs} onChange={changeTab} />
				</div>
			</PageHeader>
			<PullToRefresh onRefresh={reload}>
				{data === null ? (
					<LoadState loading={loading} error={error} onRetry={reload} />
				) : list.length === 0 ? (
					<EmptyState
						icon={<Lightbulb size={40} />}
						title={tab === "done" ? "暂无已完成的条目" : tab === "all" ? "还没有任何想法" : "还没有想法"}
						hint="随手记下想法或 Bug，之后一键派发给 agent"
						action={
							<button type="button" className={btnCls} onClick={() => setCapture(true)}>
								添加想法
							</button>
						}
					/>
				) : (
					<div style={{ paddingBottom: `calc(var(--m-safe-bottom) + ${selecting ? 88 : 16}px)` }}>
						{error && <div className="px-4 pt-3 text-m-sm text-m-danger">刷新失败：{error}</div>}
						{groups.map((g) => (
							<section key={g.dir || "global"}>
								<div className="flex items-center gap-2 px-4 pb-1 pt-4 text-m-sm font-medium text-m-text-2">
									<span className="min-w-0 break-all">{g.label}</span>
									<span className="rounded-m-pill bg-m-surface px-2 text-m-xs text-m-text-3">{g.items.length}</span>
								</div>
								<ul className="flex flex-col gap-2 px-4">
									{g.items.map((it) => {
										const imgs = imageRefs(it).length;
										const sess = sessionRefs(it);
										const tgt = it.targetSessionId ? byId[it.targetSessionId] : null;
										const isPicked = picked.has(it.id);
										return (
											<li key={it.id}>
												<button
													type="button"
													data-testid="idea-card"
													aria-pressed={selecting ? isPicked : undefined}
													onClick={() => {
														if (!selecting) return setEditId(it.id);
														setPicked((p) => {
															const n = new Set(p);
															if (n.has(it.id)) n.delete(it.id);
															else n.add(it.id);
															return n;
														});
													}}
													className={`block w-full rounded-m-lg border p-3 text-left ${isPicked ? "border-m-accent bg-m-surface-2" : "border-m-border bg-m-surface"}`}
												>
													<div className="flex items-center gap-2">
														{selecting && (
															<span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-m-sm border ${isPicked ? "border-m-accent bg-m-accent text-m-accent-text" : "border-m-border"}`}>
																{isPicked && <Check size={12} />}
															</span>
														)}
														<Chip tone={it.kind === "bug" ? "danger" : "accent"}>{KIND_LABEL[it.kind] ?? it.kind}</Chip>
														<Chip>{STATUS_LABEL[it.status] ?? it.status}</Chip>
														<span className="ml-auto whitespace-nowrap text-m-xs text-m-text-3">{relTime(it.createdAt)}</span>
													</div>
													<div className="mt-2 whitespace-pre-wrap break-words text-m-md">{it.text}</div>
													{(imgs > 0 || sess.length > 0 || tgt) && (
														<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-m-xs text-m-text-3">
															{imgs > 0 && <span className="whitespace-nowrap">{imgs} 张图片</span>}
															{sess.map((r) => (
																<span key={r.sessionId} className="break-all">
																	会话：{sessionName(byId[r.sessionId as string]) || (r.sessionId as string).slice(0, 8)}
																</span>
															))}
															{tgt && <span className="break-all">派发至：{sessionName(tgt)}</span>}
														</div>
													)}
												</button>
											</li>
										);
									})}
								</ul>
							</section>
						))}
					</div>
				)}
			</PullToRefresh>
			{selecting && (
				<div
					className="absolute inset-x-0 bottom-0 z-(--z-banner) flex items-center justify-between gap-3 border-t border-m-border bg-m-bg px-4 pt-3"
					style={{ paddingBottom: "calc(var(--m-safe-bottom) + 12px)" }}
				>
					<span className="whitespace-nowrap text-m-md">已选 {picked.size}</span>
					<button type="button" className={btnPrimaryCls} disabled={picked.size === 0} onClick={() => setDispatchIds([...picked])}>
						派发所选
					</button>
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
