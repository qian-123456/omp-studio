import { Server } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../core/api";
import { sessionName } from "../../core/lib/format";
import type { PageProps } from "../../core/nav";
import { useSessions } from "../../core/stores/sessions";
import { Chip, EmptyState, PageHeader, PullToRefresh, confirm, toast } from "../../ui";
import { ActionButton, LoadGate } from "./PanelState";
import { useLoad, useResync } from "./hooks";

interface Service {
	pid: number;
	name: string;
	port: number;
	cwd: string | null;
	command: string;
	url?: string;
	sessionId: string | null;
	startedByApp: boolean;
	memoryKb: number | null;
}

export function ServicesPage(_props: PageProps) {
	const [all, setAll] = useState(false);
	const [stopping, setStopping] = useState<number | null>(null);
	const byId = useSessions((s) => s.byId);
	const state = useLoad((signal) => api<Service[]>("GET", `/services?all=${all}`, undefined, { signal }), [all]);
	useResync(() => void state.reload(true));

	const stop = async (s: Service) => {
		const ok = await confirm({
			title: "停止服务",
			message: `确定停止服务 ${s.name}（PID ${s.pid}，端口 :${s.port}）？`,
			confirmText: "停止",
			danger: true,
		});
		if (!ok) return;
		setStopping(s.pid);
		try {
			await api("POST", `/services/${s.pid}/stop`);
			toast("已停止", { kind: "success" });
		} catch (e) {
			toast(`停止失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setStopping(null);
			void state.reload(true);
		}
	};

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="服务" subtitle="监听中的本地服务">
				<div className="flex gap-2 px-4 pb-2">
					<Chip active={!all} onClick={() => setAll(false)}>
						仅开发服务
					</Chip>
					<Chip active={all} onClick={() => setAll(true)}>
						全部端口
					</Chip>
				</div>
			</PageHeader>
			<PullToRefresh onRefresh={() => state.reload(true)}>
				<LoadGate state={state}>
					{(rows) =>
						rows.length === 0 ? (
							<EmptyState icon={<Server size={32} />} title="没有监听中的服务" />
						) : (
							<ul className="m-0 list-none space-y-3 p-3">
								{rows.map((s) => {
									const sess = s.sessionId ? byId[s.sessionId] : undefined;
									const sessLabel = sess ? sessionName(sess) : s.sessionId ? `会话 ${s.sessionId}` : "无所属会话";
									return (
										<li key={s.pid} className="rounded-m-lg border border-m-border bg-m-surface p-3">
											<div className="flex flex-wrap items-center gap-2">
												<Chip tone="accent">:{s.port}</Chip>
												<Chip>PID {s.pid}</Chip>
												<span className="min-w-0 break-all text-m-md font-medium text-m-text">{s.name}</span>
												{s.startedByApp && <Chip tone="neutral">应用启动</Chip>}
											</div>
											<div className="mt-2 break-all font-m-mono text-m-xs text-m-text-2">{s.command}</div>
											<div className="mt-2 space-y-0.5 text-m-xs text-m-text-3">
												{s.cwd && <div className="break-all">目录：{s.cwd}</div>}
												<div>所属：{sessLabel}</div>
												{s.memoryKb && <div>内存：{(s.memoryKb / 1024).toFixed(0)} MB</div>}
											</div>
											<div className="mt-2 flex justify-end">
												<ActionButton tone="danger" disabled={stopping === s.pid} onClick={() => void stop(s)}>
													停止服务
												</ActionButton>
											</div>
										</li>
									);
								})}
							</ul>
						)
					}
				</LoadGate>
			</PullToRefresh>
		</div>
	);
}
