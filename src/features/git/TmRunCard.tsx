import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ExternalLink, FolderOpen, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TmRun } from "../../lib/contracts";
import { onTmLog } from "../../lib/events";
import { tmList, tmStop } from "../../lib/ipc";
import { appendLog, basename } from "./helpers";
import { confirmDialog, errMsg } from "./ui";

/** Live view of one time-machine run: log tail, URL, stop/discard. */
export function TmRunCard({ run, onGone }: { run: TmRun; onGone: () => void }) {
	const [log, setLog] = useState<string[]>(() => (run.logTail ? run.logTail.split("\n") : []));
	const [info, setInfo] = useState(run);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const boxRef = useRef<HTMLPreElement>(null);

	useEffect(() => {
		setInfo(run);
		setLog(run.logTail ? run.logTail.split("\n") : []);
	}, [run]);

	useEffect(() => {
		const un = onTmLog((p) => {
			if (p.runId !== run.id) return;
			setLog((l) => appendLog(l, p.line));
			// URL / exit state live in the backend snapshot; refresh on relevant lines.
			if (!/https?:\/\/|^\[进程/.test(p.line)) return;
			tmList()
				.then((runs) => {
					const r = runs.find((x) => x.id === run.id);
					if (r) setInfo(r);
				})
				.catch(() => {});
		});
		return () => {
			un.then((f) => f());
		};
	}, [run.id]);

	useEffect(() => {
		const el = boxRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [log]);

	const stop = async (remove: boolean) => {
		if (remove && !(await confirmDialog(`丢弃此版本的运行目录？\n${info.worktree}`, { danger: true }))) return;
		setBusy(true);
		setError(null);
		try {
			await tmStop(run.id, remove);
			if (remove) onGone();
			else setInfo((i) => ({ ...i, pid: null }));
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const running = info.pid !== null && info.pid !== undefined;
	return (
		<div className="mt-1.5 rounded border border-neutral-700 bg-neutral-950/70 p-2 text-[11px]">
			<div className="mb-1 flex items-center gap-1.5">
				<span className={running ? "h-2 w-2 rounded-full bg-emerald-400" : "h-2 w-2 rounded-full bg-neutral-600"} />
				<span className="min-w-0 flex-1 truncate text-neutral-400" title={info.command || info.worktree}>
					{info.command || `仅创建目录 ${basename(info.worktree)}`}
				</span>
				{info.url && (
					<button
						type="button"
						onClick={() => openUrl(info.url as string)}
						className="flex items-center gap-0.5 text-sky-400 hover:underline"
					>
						{info.url} <ExternalLink size={11} />
					</button>
				)}
			</div>
			{log.length > 0 && (
				<pre ref={boxRef} className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-neutral-400">
					{log.join("\n")}
				</pre>
			)}
			{error && <div className="mt-1 text-rose-400">{error}</div>}
			<div className="mt-1.5 flex gap-1.5">
				<button
					type="button"
					onClick={() => revealItemInDir(info.worktree)}
					className="flex items-center gap-1 rounded px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-800"
				>
					<FolderOpen size={12} /> 打开目录
				</button>
				{running && (
					<button
						type="button"
						disabled={busy}
						onClick={() => stop(false)}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-300 hover:bg-neutral-800"
					>
						<Square size={12} /> 停止
					</button>
				)}
				<button
					type="button"
					disabled={busy}
					onClick={() => stop(true)}
					className="flex items-center gap-1 rounded px-1.5 py-0.5 text-rose-300 hover:bg-neutral-800"
				>
					<Trash2 size={12} /> 丢弃
				</button>
			</div>
		</div>
	);
}
