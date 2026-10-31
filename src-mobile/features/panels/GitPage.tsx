import { FileDiff, GitBranch, GitCommitHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { relTime } from "../../core/lib/format";
import type { PageProps } from "../../core/nav";
import {
	Button,
	Chip,
	DiffView,
	EmptyState,
	inputCls,
	ListGroup,
	ListRow,
	PageHeader,
	PullToRefresh,
	Segmented,
	Switch,
	toast,
} from "../../ui";
import { ErrorState, LoadGate, Loading } from "./PanelState";
import { useLayer, useLoad } from "./hooks";
import { splitPath, stageState, statusTone } from "./pure";
import type { GitFile } from "./pure";
import { WorkspacePanelBar } from "./WorkspacePanelBar";

interface GitStatus {
	isRepo: boolean;
	branch: string | null;
	files: GitFile[];
}
interface Commit {
	sha: string;
	short: string;
	subject: string;
	author: string;
	ts: string;
}
type Tab = "status" | "log";
type DiffTarget = { title: string; query: string };

const q = encodeURIComponent;
export async function gitCommitSuggest(base: string): Promise<string> {
	const res = await api<{ suggestion?: string }>("POST", `${base}/suggest`);
	return res?.suggestion ?? "";
}

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
	{ value: "status", label: "改动" },
	{ value: "log", label: "历史" },
];

const STATUS_LABEL: Record<string, string> = { M: "修改", A: "新增", D: "删除", R: "重命名", "??": "新文件" };

export function GitPage({ route }: PageProps) {
	const id = route.params.id;
	const base = `/sessions/${q(id)}/git`;
	const [tab, setTab] = useState<Tab>("status");
	const [diff, setDiff] = useState<DiffTarget | null>(null);
	const closeDiff = () => setDiff(null);
	useLayer(diff !== null, closeDiff);

	if (diff) return <DiffPage sessionId={id} base={base} target={diff} onClose={closeDiff} />;
	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="Git">
				<div className="px-4 pt-1 pb-3">
					<Segmented label="Git 视图" value={tab} options={TABS} onChange={setTab} />
				</div>
			</PageHeader>
			<WorkspacePanelBar sessionId={id} current="git" />
			{tab === "status" ? <StatusTab base={base} onDiff={setDiff} /> : <LogTab base={base} onDiff={setDiff} />}
		</div>
	);
}

function DiffPage({ sessionId, base, target, onClose }: { sessionId: string; base: string; target: DiffTarget; onClose: () => void }) {
	const state = useLoad(
		(signal) => api<{ diff: string }>("GET", `${base}/diff?${target.query}`, undefined, { signal }),
		[base, target.query],
	);
	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="改动差异" onBack={onClose} />
			<WorkspacePanelBar sessionId={sessionId} current="git" />
			<div
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2"
				style={{ paddingBottom: "calc(var(--m-safe-bottom) + 24px)" }}
			>
				<h1 className="m-selectable mb-3 px-1 text-m-lg font-medium break-all text-m-text">{target.title}</h1>
				{state.loading && <Loading />}
				{state.error !== null && <ErrorState message={state.error} onRetry={() => void state.reload()} />}
				{state.data &&
					(state.data.diff.trim() ? (
						<DiffView diff={state.data.diff} className="m-selectable rounded-m-lg" />
					) : (
						<EmptyState icon={<FileDiff size={22} strokeWidth={1.75} />} title="没有差异" />
					))}
			</div>
		</div>
	);
}

function StatusTab({ base, onDiff }: { base: string; onDiff: (t: DiffTarget) => void }) {
	const state = useLoad((signal) => api<GitStatus>("GET", `${base}/status`, undefined, { signal }), [base]);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [suggesting, setSuggesting] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const files = state.data?.files ?? [];
	const stagedCount = useMemo(() => files.filter((f) => f.staged).length, [files]);
	const pendingPaths = useMemo(() => files.filter((f) => f.unstaged || f.status === "??").map((f) => f.path), [files]);
	const stagedPaths = useMemo(() => files.filter((f) => f.staged).map((f) => f.path), [files]);

	const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
		if (busy) return false;
		setBusy(true);
		setActionError(null);
		try {
			await fn();
			await state.reload(true);
			return true;
		} catch (e) {
			setActionError(errorMessage(e));
			toast(errorMessage(e), { kind: "error" });
			return false;
		} finally {
			setBusy(false);
		}
	};
	const stage = (kind: "stage" | "unstage", paths: string[]) => act(() => api("POST", `${base}/${kind}`, { paths }));

	const suggest = async () => {
		if (suggesting || busy) return;
		setSuggesting(true);
		try {
			const text = await gitCommitSuggest(base);
			if (text) setMessage(text);
			else toast("没能生成提交说明", { kind: "error" });
		} catch (e) {
			toast(`生成失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setSuggesting(false);
		}
	};
	const commit = async () => {
		const msg = message.trim();
		if (!msg) {
			toast("请先写提交说明", { kind: "error" });
			return;
		}
		if (await act(() => api("POST", `${base}/commit`, { message: msg }))) {
			setMessage("");
			toast("已提交", { kind: "success" });
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<PullToRefresh onRefresh={() => state.reload(true)}>
				<LoadGate state={state}>
					{(st) => {
						if (!st.isRepo) return <EmptyState icon={<GitBranch size={22} strokeWidth={1.75} />} title="当前目录不是 Git 仓库" />;
						return (
							<div className="pb-6">
								<div className="flex flex-wrap items-center gap-2 px-5 pt-1 pb-1 text-m-sm text-m-text-2">
									<GitBranch size={18} strokeWidth={1.75} className="shrink-0" />
									<span className="m-selectable min-w-0 font-medium break-all text-m-text">{st.branch ?? "未在分支上"}</span>
								</div>
								{st.files.length === 0 ? (
									<EmptyState icon={<GitCommitHorizontal size={22} strokeWidth={1.75} />} title="没有改动" hint="工作区是干净的" />
								) : (
									<>
										<div className="px-5 pt-3 text-m-xs text-m-text-3">改动 {st.files.length} · 已暂存 {stagedCount} · 单个文件用右侧开关</div>
										<div className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-2">
											<Button variant="tonal" disabled={busy || pendingPaths.length === 0} onClick={() => void stage("stage", pendingPaths)}>
												暂存全部 {pendingPaths.length} 项
											</Button>
											<Button variant="ghost" disabled={busy || stagedPaths.length === 0} onClick={() => void stage("unstage", stagedPaths)}>
												取消全部暂存 {stagedPaths.length} 项
											</Button>
										</div>
										<ListGroup>
											{st.files.map((f) => <FileRow key={f.path} file={f} busy={busy} onStage={stage} onDiff={onDiff} />)}
										</ListGroup>
									</>
								)}
							</div>
						);
					}}
				</LoadGate>
			</PullToRefresh>
			{state.data?.isRepo && (
				<section className="shrink-0 border-t border-m-border bg-m-bg px-4 pt-3" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 8px)" }}>
					{actionError && <p role="alert" className="m-selectable mb-2 text-m-sm break-words text-m-danger">{actionError}</p>}
					<textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} aria-label="提交说明" placeholder="写一句提交说明" autoCapitalize="off" className={`${inputCls} block max-h-28 resize-none rounded-m-lg`} />
					<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
						<span className="text-m-xs text-m-text-3">只提交已暂存的 {stagedCount} 项</span>
						<div className="flex shrink-0 gap-2">
							<Button variant="tonal" icon={<Sparkles size={18} strokeWidth={1.75} />} busy={suggesting} disabled={busy} onClick={() => void suggest()}>AI 生成</Button>
							<Button variant="primary" busy={busy} disabled={suggesting || stagedCount === 0 || !message.trim()} onClick={() => void commit()}>提交暂存项</Button>
						</div>
					</div>
					{stagedCount === 0 && <p className="pt-1 text-m-xs text-m-text-3">先暂存要提交的文件</p>}
				</section>
			)}
		</div>
	);
}

function FileRow({
	file,
	busy,
	onStage,
	onDiff,
}: {
	file: GitFile;
	busy: boolean;
	onStage: (kind: "stage" | "unstage", paths: string[]) => Promise<boolean>;
	onDiff: (t: DiffTarget) => void;
}) {
	const { name, dir } = splitPath(file.path);
	const st = stageState(file);
	const fullyStaged = st === "staged";
	const partial = st === "partial";
	return (
		<div className="m-list-row flex w-full items-center pl-4">
			<button
				type="button"
				onClick={() => onDiff({ title: name, query: `path=${q(file.path)}&staged=${fullyStaged}` })}
				className="m-list-sep flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pr-3 text-left active:bg-m-surface-hover"
			>
				<Chip tone={statusTone(file.status)} className="min-w-12 justify-center">
					{STATUS_LABEL[file.status] ?? file.status}
				</Chip>
				<span className="min-w-0 flex-1">
					<span className="block text-m-md break-all text-m-text">{name}</span>
					{(dir || partial) && (
						<span className="mt-0.5 block text-m-xs break-all text-m-text-3">
							{dir}
							{dir && partial ? " · " : ""}
							{partial ? "部分已暂存" : ""}
						</span>
					)}
				</span>
			</button>
			<span className="m-list-sep flex min-h-14 shrink-0 items-center self-stretch pr-3">
				<span className="pr-2 text-m-xs whitespace-nowrap text-m-text-3">{fullyStaged ? "已暂存" : partial ? "暂存整项" : "暂存此项"}</span>
				<Switch
					label={`暂存 ${file.path}`}
					checked={fullyStaged}
					disabled={busy}
					onChange={(next) => void onStage(next ? "stage" : "unstage", [file.path])}
				/>
			</span>
		</div>
	);
}

function LogTab({ base, onDiff }: { base: string; onDiff: (t: DiffTarget) => void }) {
	const state = useLoad((signal) => api<Commit[]>("GET", `${base}/log?limit=50`, undefined, { signal }), [base]);
	return (
		<PullToRefresh onRefresh={() => state.reload(true)}>
			<LoadGate state={state}>
				{(cs) =>
					cs.length === 0 ? (
						<EmptyState icon={<GitCommitHorizontal size={22} strokeWidth={1.75} />} title="还没有提交" />
					) : (
						<div className="pt-2" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 24px)" }}>
							<ListGroup>
								{cs.map((c) => (
									<ListRow
										key={c.sha}
										title={c.subject}
										subtitle={
											<span className="flex flex-wrap items-center gap-x-2">
												<code className="font-m-mono">{c.short}</code>
												<span className="break-all">{c.author}</span>
												<span className="whitespace-nowrap">{relTime(c.ts)}</span>
											</span>
										}
										onClick={() => onDiff({ title: c.short, query: `commit=${q(c.sha)}` })}
									/>
								))}
							</ListGroup>
						</div>
					)
				}
			</LoadGate>
		</PullToRefresh>
	);
}
