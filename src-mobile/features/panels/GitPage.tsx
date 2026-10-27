import { GitBranch, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { relTime } from "../../core/lib/format";
import type { PageProps } from "../../core/nav";
import { BottomSheet, Chip, DiffView, EmptyState, PageHeader, PullToRefresh, Spinner, toast } from "../../ui";
import { ActionButton, ErrorState, LoadGate, Loading } from "./PanelState";
import { useLayer, useLoad } from "./hooks";
import { groupGitStatus, splitPath, statusTone } from "./pure";
import type { GitFile } from "./pure";

interface GitStatus {
	isRepo: boolean;
	branch: string | null;
	files: GitFile[];
}
interface Branch {
	name: string;
	displayName?: string;
	isRemote: boolean;
	isCurrentWorktree: boolean;
	upstream?: string | null;
	lastCommitMessage?: string | null;
}
interface Commit {
	sha: string;
	short: string;
	subject: string;
	author: string;
	ts: string;
}
type Tab = "status" | "branches" | "log";
type DiffTarget = { title: string; query: string };

const q = encodeURIComponent;
export async function gitCommitSuggest(base: string): Promise<string> {
	const res = await api<{ suggestion?: string }>("POST", `${base}/suggest`);
	return res?.suggestion ?? "";
}

const TABS: readonly [Tab, string][] = [
	["status", "变更"],
	["branches", "分支"],
	["log", "历史"],
];

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
				<div className="flex gap-2 px-4 pb-2">
					{TABS.map(([t, label]) => (
						<Chip key={t} active={tab === t} onClick={() => setTab(t)}>
							{label}
						</Chip>
					))}
				</div>
			</PageHeader>
			{tab === "status" && <StatusTab base={base} onDiff={setDiff} />}
			{tab === "branches" && <BranchesTab base={base} />}
			{tab === "log" && <LogTab base={base} onDiff={setDiff} />}
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
			<PageHeader title={target.title} onBack={onClose} />
			<div className="min-h-0 flex-1 overflow-auto overscroll-contain">
				{state.loading && <Loading />}
				{state.error !== null && <ErrorState message={state.error} onRetry={() => void state.reload()} />}
				{state.data &&
					(state.data.diff.trim() ? <DiffView diff={state.data.diff} /> : <EmptyState title="没有差异" />)}
			</div>
		</div>
	);
}

function StatusTab({ base, onDiff }: { base: string; onDiff: (t: DiffTarget) => void }) {
	const state = useLoad((signal) => api<GitStatus>("GET", `${base}/status`, undefined, { signal }), [base]);
	const [busy, setBusy] = useState(false);
	const [sheet, setSheet] = useState(false);
	const [suggesting, setSuggesting] = useState(false);
	const msgRef = useRef<HTMLTextAreaElement>(null);

	const handleSuggest = async () => {
		if (suggesting || busy) return;
		setSuggesting(true);
		try {
			const text = await gitCommitSuggest(base);
			if (text) {
				if (msgRef.current) msgRef.current.value = text;
			} else {
				toast("未能生成提交建议", { kind: "error" });
			}
		} catch (e) {
			toast(`建议失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setSuggesting(false);
		}
	};
	const groups = useMemo(() => groupGitStatus(state.data?.files ?? []), [state.data]);

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
	const stage = (kind: "stage" | "unstage", paths: string[]) =>
		act(() => api("POST", `${base}/${kind}`, { paths }));
	const commit = async () => {
		const message = msgRef.current?.value.trim() ?? "";
		if (!message) {
			toast("请输入提交信息", { kind: "error" });
			return;
		}
		const ok = await act(() => api("POST", `${base}/commit`, { message }));
		if (ok) {
			setSheet(false);
			toast("已提交", { kind: "success" });
		}
	};
	const closeSheet = () => setSheet(false);

	return (
		<>
			<PullToRefresh onRefresh={() => state.reload(true)}>
				<LoadGate state={state}>
					{(st) => {
						if (!st.isRepo) return <EmptyState title="当前目录不是 Git 仓库" />;
						return (
							<div className="pb-24">
								<div className="flex items-center gap-2 border-b border-m-border px-4 py-3 text-m-sm text-m-text-2">
									<GitBranch size={16} className="shrink-0" />
									<span className="whitespace-nowrap">分支</span>
									<b className="min-w-0 break-all text-m-text">{st.branch ?? "(detached)"}</b>
								</div>
								{st.files.length === 0 && <EmptyState title="工作区干净" />}
								<Section title="已暂存" files={groups.staged} staged busy={busy} onStage={stage} onDiff={onDiff} />
								<Section title="未暂存" files={groups.unstaged} busy={busy} onStage={stage} onDiff={onDiff} />
								<Section title="未跟踪" files={groups.untracked} busy={busy} onStage={stage} onDiff={onDiff} />
							</div>
						);
					}}
				</LoadGate>
			</PullToRefresh>
			{state.data?.isRepo && (
				<div
					className="shrink-0 border-t border-m-border bg-m-bg px-4 pt-2"
					style={{ paddingBottom: "calc(var(--m-safe-bottom) + 8px)" }}
				>
					<ActionButton
						tone="primary"
						className="w-full"
						disabled={groups.staged.length === 0 || busy}
						onClick={() => setSheet(true)}
					>
						提交已暂存的变更（{groups.staged.length}）
					</ActionButton>
				</div>
			)}
			<BottomSheet
				open={sheet}
				onClose={closeSheet}
				title="提交变更"
				footer={
					<div className="flex gap-2 p-3">
						<ActionButton className="flex-1" onClick={closeSheet}>
							取消
						</ActionButton>
						<ActionButton tone="primary" className="flex-1" disabled={busy || suggesting} onClick={() => void commit()}>
							确认提交（{groups.staged.length}）
						</ActionButton>
					</div>
				}
			>
				<div className="p-4">
					<div className="mb-2 flex items-center justify-between">
						<span className="text-m-sm text-m-text-2">提交说明</span>
						<button
							type="button"
							disabled={busy || suggesting}
							onClick={() => void handleSuggest()}
							className="flex min-h-8 items-center gap-1.5 rounded-m-pill border border-m-border px-3 text-m-xs font-medium text-m-accent active:bg-m-surface-hover disabled:opacity-50"
						>
							{suggesting ? <Spinner size={12} /> : <Sparkles size={14} />}
							AI 建议
						</button>
					</div>
					<textarea
						ref={msgRef}
						rows={4}
						placeholder="输入提交信息，或点击右上角 AI 建议"
						autoCapitalize="off"
						className="w-full resize-none rounded-m-md border border-m-border bg-m-surface p-3 text-m-md text-m-text outline-none focus:border-m-accent"
					/>
				</div>
			</BottomSheet>
		</>
	);
}

function Section({
	title,
	files,
	staged = false,
	busy,
	onStage,
	onDiff,
}: {
	title: string;
	files: GitFile[];
	staged?: boolean;
	busy: boolean;
	onStage: (kind: "stage" | "unstage", paths: string[]) => Promise<boolean>;
	onDiff: (t: DiffTarget) => void;
}) {
	if (files.length === 0) return null;
	const kind = staged ? "unstage" : "stage";
	return (
		<section>
			<div className="flex items-center justify-between gap-2 bg-m-surface px-4 py-1">
				<span className="whitespace-nowrap text-m-sm font-semibold text-m-text-2">
					{title}（{files.length}）
				</span>
				<ActionButton disabled={busy} onClick={() => void onStage(kind, files.map((f) => f.path))}>
					{staged ? "全部取消暂存" : "全部暂存"}
				</ActionButton>
			</div>
			{files.map((f) => {
				const { name, dir } = splitPath(f.path);
				return (
					<div key={f.path} className="flex items-center gap-2 border-b border-m-border pl-4 pr-2">
						<Chip tone={statusTone(f.status)} className="w-9 justify-center">
							{f.status}
						</Chip>
						<button
							type="button"
							onClick={() =>
								onDiff({
									title: `${name}${staged ? "（已暂存）" : ""}`,
									query: `path=${q(f.path)}&staged=${staged}`,
								})
							}
							className="min-h-14 min-w-0 flex-1 py-2 text-left active:bg-m-surface-hover"
						>
							<span className="block break-all text-m-md text-m-text">{name}</span>
							{dir && <span className="block break-all text-m-xs text-m-text-3">{dir}</span>}
						</button>
						<ActionButton disabled={busy} onClick={() => void onStage(kind, [f.path])}>
							{staged ? "取消暂存" : "暂存"}
						</ActionButton>
					</div>
				);
			})}
		</section>
	);
}

function BranchesTab({ base }: { base: string }) {
	const state = useLoad((signal) => api<Branch[]>("GET", `${base}/branches`, undefined, { signal }), [base]);
	return (
		<PullToRefresh onRefresh={() => state.reload(true)}>
			<LoadGate state={state}>
				{(bs) =>
					bs.length === 0 ? (
						<EmptyState title="没有分支" />
					) : (
						<ul className="m-0 list-none p-0">
							{bs.map((b) => (
								<li key={b.name} className="border-b border-m-border px-4 py-3">
									<div className="flex flex-wrap items-center gap-2">
										<span className="min-w-0 break-all text-m-md text-m-text">{b.displayName || b.name}</span>
										{b.isCurrentWorktree && <Chip tone="accent">当前</Chip>}
										{b.isRemote && <Chip>远程</Chip>}
									</div>
									{b.upstream && <div className="break-all text-m-xs text-m-text-3">跟踪 {b.upstream}</div>}
									{b.lastCommitMessage && (
										<div className="break-words text-m-xs text-m-text-3">{b.lastCommitMessage}</div>
									)}
								</li>
							))}
						</ul>
					)
				}
			</LoadGate>
		</PullToRefresh>
	);
}

function LogTab({ base, onDiff }: { base: string; onDiff: (t: DiffTarget) => void }) {
	const state = useLoad((signal) => api<Commit[]>("GET", `${base}/log?limit=50`, undefined, { signal }), [base]);
	return (
		<PullToRefresh onRefresh={() => state.reload(true)}>
			<LoadGate state={state}>
				{(cs) =>
					cs.length === 0 ? (
						<EmptyState title="没有提交" />
					) : (
						<ul className="m-0 list-none p-0">
							{cs.map((c) => (
								<li key={c.sha}>
									<button
										type="button"
										onClick={() => onDiff({ title: c.short, query: `commit=${q(c.sha)}` })}
										className="block min-h-14 w-full border-b border-m-border px-4 py-3 text-left active:bg-m-surface-hover"
									>
										<span className="block break-words text-m-md text-m-text">{c.subject}</span>
										<span className="mt-0.5 flex items-center gap-2 text-m-xs text-m-text-3">
											<code className="font-m-mono">{c.short}</code>
											<span className="min-w-0 break-all">{c.author}</span>
											<span className="ml-auto whitespace-nowrap">{relTime(c.ts)}</span>
										</span>
									</button>
								</li>
							))}
						</ul>
					)
				}
			</LoadGate>
		</PullToRefresh>
	);
}
