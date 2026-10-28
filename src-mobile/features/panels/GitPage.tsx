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

	if (diff) return <DiffPage base={base} target={diff} onClose={closeDiff} />;
	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="Git">
				<div className="px-4 pt-1 pb-3">
					<Segmented label="Git 视图" value={tab} options={TABS} onChange={setTab} />
				</div>
			</PageHeader>
			{tab === "status" ? <StatusTab base={base} onDiff={setDiff} /> : <LogTab base={base} onDiff={setDiff} />}
		</div>
	);
}

function DiffPage({ base, target, onClose }: { base: string; target: DiffTarget; onClose: () => void }) {
	const state = useLoad(
		(signal) => api<{ diff: string }>("GET", `${base}/diff?${target.query}`, undefined, { signal }),
		[base, target.query],
	);
	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="改动差异" onBack={onClose} />
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
	const files = state.data?.files ?? [];
	const stagedCount = useMemo(() => files.filter((f) => f.staged).length, [files]);
	const pendingPaths = useMemo(() => files.filter((f) => f.unstaged || f.status === "??").map((f) => f.path), [files]);

	const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
		if (busy) return false;
		setBusy(true);
		try {
			await fn();
			await state.reload(true);
			return true;
		} catch (e) {
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
		<PullToRefresh onRefresh={() => state.reload(true)}>
			<LoadGate state={state}>
				{(st) => {
					if (!st.isRepo) return <EmptyState icon={<GitBranch size={22} strokeWidth={1.75} />} title="当前目录不是 Git 仓库" />;
					return (
						<div style={{ paddingBottom: "calc(var(--m-safe-bottom) + 24px)" }}>
							<div className="flex flex-wrap items-center gap-2 px-5 pt-1 pb-1 text-m-sm text-m-text-2">
								<GitBranch size={18} strokeWidth={1.75} className="shrink-0" />
								<span className="m-selectable min-w-0 font-medium break-all text-m-text">{st.branch ?? "未在分支上"}</span>
							</div>
							{st.files.length === 0 ? (
								<EmptyState icon={<GitCommitHorizontal size={22} strokeWidth={1.75} />} title="没有改动" hint="工作区是干净的" />
							) : (
								<>
									<div className="flex items-center justify-between gap-3 px-8 pt-4 pb-2">
										<span className="text-m-xs font-medium whitespace-nowrap text-m-text-3">
											改动 {st.files.length} · 已暂存 {stagedCount}
										</span>
										{pendingPaths.length > 0 ? (
											<Button variant="ghost" disabled={busy} onClick={() => void stage("stage", pendingPaths)} className="-mr-4">
												全部暂存
											</Button>
										) : (
											<Button
												variant="ghost"
												disabled={busy}
												onClick={() => void stage("unstage", st.files.map((f) => f.path))}
												className="-mr-4"
											>
												全部取消暂存
											</Button>
										)}
									</div>
									<ListGroup>
										{st.files.map((f) => (
											<FileRow key={f.path} file={f} busy={busy} onStage={stage} onDiff={onDiff} />
										))}
									</ListGroup>
									<section className="mt-6 px-4">
										<h3 className="px-4 pb-2 text-m-xs font-medium whitespace-nowrap text-m-text-3">提交</h3>
										<textarea
											value={message}
											onChange={(e) => setMessage(e.target.value)}
											rows={3}
											aria-label="提交说明"
											placeholder="写一句提交说明"
											autoCapitalize="off"
											className={`${inputCls} block resize-none rounded-m-lg`}
										/>
										<div className="mt-3 flex items-center justify-end gap-2">
											<Button
												variant="tonal"
												icon={<Sparkles size={18} strokeWidth={1.75} />}
												busy={suggesting}
												disabled={busy}
												onClick={() => void suggest()}
											>
												AI 生成
											</Button>
											<Button
												variant="primary"
												disabled={busy || suggesting || stagedCount === 0 || !message.trim()}
												onClick={() => void commit()}
											>
												提交
											</Button>
										</div>
										{stagedCount === 0 && <p className="px-4 pt-2 text-right text-m-xs text-m-text-3">先暂存要提交的文件</p>}
									</section>
								</>
							)}
						</div>
					);
				}}
			</LoadGate>
		</PullToRefresh>
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
