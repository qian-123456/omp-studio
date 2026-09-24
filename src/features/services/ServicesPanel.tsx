import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { Copy, ExternalLink, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceInfo } from "../../lib/contracts";
import { onServicesChanged } from "../../lib/events";
import { servicesList, servicesStop } from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { confirmDialog, copyText, errMsg, useShortPath } from "../git/ui";

/** [C] Right tab: local listening services (dev-like by default). */
export function ServicesPanel() {
	const [all, setAll] = useState(false);
	const [rows, setRows] = useState<ServiceInfo[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const sessions = useSessions((s) => s.sessions);
	const selectSession = useUi((s) => s.selectSession);
	const short = useShortPath();
	const allRef = useRef(all);
	allRef.current = all;

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			setRows(await servicesList(allRef.current));
			setError(null);
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setLoading(false);
		}
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the filter flips
	useEffect(() => {
		refresh();
	}, [all, refresh]);

	useEffect(() => {
		// Payload is the default (dev-only) list; "all" mode refetches.
		const un = onServicesChanged((list) => (allRef.current ? refresh() : setRows(list)));
		return () => {
			un.then((f) => f());
		};
	}, [refresh]);

	const stop = async (s: ServiceInfo) => {
		const ok = await confirmDialog(`停止 ${s.name}（pid ${s.pid}，端口 ${s.port}）？`, {
			danger: true,
			title: "停止服务",
			okLabel: "停止",
		});
		if (!ok) return;
		try {
			await servicesStop(s.pid);
			await refresh();
		} catch (e) {
			setError(errMsg(e));
		}
	};

	const copy = async (url: string) => {
		try {
			await copyText(url);
			setCopied(url);
			setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
		} catch (e) {
			setError(errMsg(e));
		}
	};

	return (
		<div className="text-xs">
			<div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
				<span className="flex-1 text-neutral-300">本地服务 {rows && <span className="text-neutral-500">({rows.length})</span>}</span>
				<label className="flex items-center gap-1 text-[11px] text-neutral-400">
					<input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
					显示全部
				</label>
				<button type="button" title="刷新" onClick={refresh} className="rounded p-1 text-neutral-400 hover:bg-neutral-800">
					<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
				</button>
			</div>
			{error && <div className="px-3 py-1.5 text-rose-400">{error}</div>}
			{rows?.length === 0 && (
				<div className="p-3 text-neutral-500">{all ? "没有监听中的端口" : "没有检测到开发服务（可勾选「显示全部」）"}</div>
			)}
			<ul>
				{rows?.map((s) => {
					const session = s.sessionId ? sessions[s.sessionId] : undefined;
					return (
						<li key={`${s.pid}:${s.port}`} className="group border-b border-neutral-800/60 px-3 py-1.5 hover:bg-neutral-800/40">
							<div className="flex items-center gap-2">
								<span className="font-mono text-sm text-sky-300">:{s.port}</span>
								<span className="min-w-0 flex-1 truncate text-neutral-200" title={s.command}>
									{s.name}
									<span className="ml-1 text-[10px] text-neutral-500">pid {s.pid}</span>
									{s.startedByApp && <span className="ml-1 text-[10px] text-emerald-400">时光机</span>}
								</span>
								<div className="flex shrink-0 gap-0.5">
									<IconBtn title="在浏览器打开" onClick={() => openUrl(s.url)}>
										<ExternalLink size={12} />
									</IconBtn>
									<IconBtn title={copied === s.url ? "已复制" : "复制地址"} onClick={() => copy(s.url)}>
										<Copy size={12} className={clsx(copied === s.url && "text-emerald-400")} />
									</IconBtn>
									<IconBtn title="停止" danger onClick={() => stop(s)}>
										<Square size={12} />
									</IconBtn>
								</div>
							</div>
							<div className="mt-0.5 flex gap-2 text-[10px] text-neutral-500">
								{s.cwd && (
									<span className="min-w-0 truncate" title={s.cwd}>
										{short(s.cwd)}
									</span>
								)}
								{session && (
									<button
										type="button"
										onClick={() => selectSession(session.id)}
										className="shrink-0 text-indigo-400 hover:underline"
									>
										{session.label} {session.title}
									</button>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function IconBtn({
	title,
	danger,
	onClick,
	children,
}: {
	title: string;
	danger?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			onClick={onClick}
			className={clsx(
				"rounded p-1 text-neutral-400 hover:bg-neutral-700",
				danger ? "hover:text-rose-300" : "hover:text-neutral-100",
			)}
		>
			{children}
		</button>
	);
}
