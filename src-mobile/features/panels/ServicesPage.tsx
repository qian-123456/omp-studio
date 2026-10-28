import { Server } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../core/api";
import { sessionName } from "../../core/lib/format";
import type { PageProps } from "../../core/nav";
import { useSessions } from "../../core/stores/sessions";
import { Button, Chip, EmptyState, ListGroup, ListRow, PageHeader, PullToRefresh, Segmented, confirm, toast } from "../../ui";
import { LoadGate } from "./PanelState";
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

type Scope = "dev" | "all";
const SCOPES: ReadonlyArray<{ value: Scope; label: string }> = [
	{ value: "dev", label: "开发服务" },
	{ value: "all", label: "全部端口" },
];

export function ServicesPage(_props: PageProps) {
	const [scope, setScope] = useState<Scope>("dev");
	const [stopping, setStopping] = useState<number | null>(null);
	const byId = useSessions((s) => s.byId);
	const state = useLoad((signal) => api<Service[]>("GET", `/services?all=${scope === "all"}`, undefined, { signal }), [scope]);
	useResync(() => void state.reload(true));

	const stop = async (s: Service) => {
		const ok = await confirm({
			title: "停止服务",
			message: `确定停止 ${s.name}？端口 ${s.port}，PID ${s.pid}。`,
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
			<PageHeader title="服务" subtitle="本机正在监听的端口">
				<div className="px-4 pt-1 pb-3">
					<Segmented label="服务范围" value={scope} options={SCOPES} onChange={setScope} />
				</div>
			</PageHeader>
			<PullToRefresh onRefresh={() => state.reload(true)}>
				<LoadGate state={state}>
					{(rows) =>
						rows.length === 0 ? (
							<EmptyState icon={<Server size={22} strokeWidth={1.75} />} title="没有正在运行的服务" hint="开发服务启动后会出现在这里" />
						) : (
							<div className="pt-2" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 24px)" }}>
								<ListGroup>
									{rows.map((s) => {
										const sess = s.sessionId ? byId[s.sessionId] : undefined;
										const owner = sess ? sessionName(sess) : s.sessionId ? `会话 ${s.sessionId}` : null;
										return (
											<div key={`${s.pid}:${s.port}`} className="m-list-row pb-4">
												<ListRow
													icon={<Server size={22} strokeWidth={1.75} />}
													title={<span className="break-all">{s.name}</span>}
													subtitle={
														<span className="mt-1 flex flex-wrap gap-1.5">
															<Chip tone="accent">端口 {s.port}</Chip>
															<Chip>PID {s.pid}</Chip>
															{s.memoryKb ? <Chip>{Math.round(s.memoryKb / 1024)} MB</Chip> : null}
															{s.startedByApp && <Chip tone="success">由应用启动</Chip>}
														</span>
													}
												/>
												<div className="px-4">
													<div className="m-selectable mt-3 rounded-m-sm bg-m-surface-2 px-3 py-2 font-m-mono text-m-xs break-all text-m-text-2">
														{s.command}
													</div>
													{(s.cwd || owner) && (
														<div className="mt-3 space-y-1 text-m-xs break-all text-m-text-3">
															{s.cwd && <div className="m-selectable">{s.cwd}</div>}
															{owner && <div>来自：{owner}</div>}
														</div>
													)}
													<div className="mt-3 flex justify-end">
														<Button variant="danger" busy={stopping === s.pid} onClick={() => void stop(s)}>
															停止
														</Button>
													</div>
												</div>
											</div>
										);
									})}
								</ListGroup>
							</div>
						)
					}
				</LoadGate>
			</PullToRefresh>
		</div>
	);
}
