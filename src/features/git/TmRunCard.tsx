import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { Copy, ExternalLink, FolderOpen, Maximize2, Minimize2, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TmRun } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { onTmLog } from "../../lib/events";
import { gitSummary, tmStop } from "../../lib/ipc";
import { basename } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";
import { appendLog, stripAnsi } from "./helpers";

/** Live view of one time-machine run: log tail, URL, stop/discard. */
export function TmRunCard({
	run,
	onGone,
	onUpdate,
}: {
	run: TmRun;
	onGone: () => void;
	/** Called after a stop so the parent list entry drops its running state. */
	onUpdate?: (run: TmRun) => void;
}) {
	const { t } = useT();
	const [log, setLog] = useState<string[]>(() =>
		run.logTail ? run.logTail.split("\n").map(stripAnsi) : [],
	);
	const [info, setInfo] = useState(run);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [logExpanded, setLogExpanded] = useState(false);
	const boxRef = useRef<HTMLPreElement>(null);

	useEffect(() => {
		setInfo(run);
		setLog(run.logTail ? run.logTail.split("\n").map(stripAnsi) : []);
	}, [run]);

	useEffect(() => {
		const un = onTmLog((p) => {
			if (p.runId !== run.id) return;
			setLog((lines) => appendLog(lines, stripAnsi(p.line)));
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
		if (remove) {
			let dirtyWarning = "";
			try {
				const sum = await gitSummary(info.worktree);
				if (sum.hasUncommitted && sum.files.length > 0) {
					dirtyWarning = t("worktree.tm.dirtyWarning", { count: sum.files.length });
				}
			} catch {
				// Ignore inspection error; proceed to dialog
			}
			const ok = await confirmDialog(t("worktree.tm.discardConfirm", { worktree: info.worktree, dirtyWarning }), {
				danger: true,
				title: t("worktree.tm.discardTitle"),
				okLabel: t("worktree.tm.discardOk"),
			});
			if (!ok) return;
		}
		setBusy(true);
		setError(null);
		try {
			await tmStop(info.id, remove);
			if (remove) {
				onGone();
			} else {
				const next = { ...info, pid: null };
				setInfo(next);
				onUpdate?.(next);
			}
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const copyUrl = async () => {
		if (!info.url) return;
		await copyText(info.url);
		toast.success(t("worktree.tm.copiedUrl"));
	};

	const copyAllLogs = async () => {
		if (log.length === 0) return;
		await copyText(log.join("\n"));
		toast.success(t("worktree.tm.copiedLogs"));
	};

	const running = info.pid !== null && info.pid !== undefined;

	return (
		<div className="mt-1.5 rounded border border-neutral-700 bg-neutral-950/70 p-2 text-[11px]">
			<div className="mb-1 flex items-center gap-1.5">
				<span className={running ? "h-2 w-2 rounded-full bg-emerald-400" : "h-2 w-2 rounded-full bg-neutral-600"} />
				<span className="min-w-0 flex-1 truncate text-neutral-400" title={info.command || info.worktree}>
					{info.command || t("worktree.tm.onlyCreatedDir", { dir: basename(info.worktree) })}
				</span>
				{info.url && (
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onClick={() => openUrl(info.url as string)}
							className="flex items-center gap-0.5 text-sky-400 hover:underline"
							title={t("worktree.tm.openInBrowser")}
						>
							{info.url} <ExternalLink size={11} />
						</button>
						<button
							type="button"
							onClick={copyUrl}
							className="rounded p-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
							title={t("worktree.tm.copyUrl")}
							aria-label={t("worktree.tm.copyUrl")}
						>
							<Copy size={11} />
						</button>
					</div>
				)}
			</div>

			{log.length > 0 && (
				<div className="relative mt-1">
					<div className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded bg-neutral-900/80 px-1 py-0.5 text-[10px] text-neutral-400 backdrop-blur">
						<button
							type="button"
							onClick={copyAllLogs}
							className="hover:text-neutral-200"
							title={t("worktree.tm.copyAllLogs")}
							aria-label={t("worktree.tm.copyAllLogs")}
						>
							<Copy size={11} />
						</button>
						<button
							type="button"
							onClick={() => setLogExpanded(!logExpanded)}
							className="hover:text-neutral-200"
							title={logExpanded ? t("worktree.tm.collapseLogHeight") : t("worktree.tm.expandLogHeight")}
							aria-label={logExpanded ? t("worktree.tm.collapseLogHeight") : t("worktree.tm.expandLogHeight")}
						>
							{logExpanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
						</button>
					</div>
					<pre
						ref={boxRef}
						className={clsx(
							"overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-900/50 p-1.5 font-mono text-[10px] text-neutral-400",
							logExpanded ? "max-h-96" : "max-h-36",
						)}
					>
						{log.join("\n")}
					</pre>
				</div>
			)}

			{error && <div className="mt-1 text-rose-400">{error}</div>}

			<div className="mt-1.5 flex gap-1.5">
				<button
					type="button"
					onClick={() => revealItemInDir(info.worktree)}
					className="flex items-center gap-1 rounded px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-800"
				>
					<FolderOpen size={12} /> {t("worktree.tm.openDir")}
				</button>
				{running && (
					<button
						type="button"
						disabled={busy}
						onClick={() => stop(false)}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-300 hover:bg-neutral-800"
					>
						<Square size={12} /> {t("worktree.tm.stop")}
					</button>
				)}
				<button
					type="button"
					disabled={busy}
					onClick={() => stop(true)}
					className="flex items-center gap-1 rounded px-1.5 py-0.5 text-rose-300 hover:bg-neutral-800"
				>
					<Trash2 size={12} /> {t("worktree.tm.discard")}
				</button>
			</div>
		</div>
	);
}
