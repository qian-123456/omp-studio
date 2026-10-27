import { ChevronRight, Globe, RefreshCw, Ruler, Bot } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { EmptyState, ListRow, PageHeader, PullToRefresh, Spinner } from "../../ui";
import { OmpSettings } from "./OmpSettings";
import { Section } from "./controls";
import { AppearanceSection, ConnectionSection, NotifySection, PermissionSection, type MobileInfo } from "./sections";
import { isApprovalMode, type ApprovalMode, type OmpValue } from "./settingsMap";

interface SettingsData {
	appVersion?: string | null;
	mobile?: MobileInfo;
	defaultModel?: string | null;
	defaultModelSource?: string | null;
	defaultApprovalMode?: string | null;
	omp?: Record<string, OmpValue>;
	ompError?: string | null;
}

interface DirEntry {
	path: string;
	label?: string;
}

/** Project scope for the roles / fallbacks sub-pages; kept for the lifetime of the page module like the old UI. */
let scopeCwd: string | null = null;

export const withCwd = (path: string, cwd: string | null): string => (cwd ? `${path}?cwd=${encodeURIComponent(cwd)}` : path);

function NavCard({ icon, title, desc, to }: { icon: ReactNode; title: string; desc: string; to: () => void }) {
	return <ListRow icon={icon} title={title} subtitle={desc} right={<ChevronRight size={18} />} onClick={to} />;
}

export function SettingsPage() {
	const [data, setData] = useState<SettingsData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [dirs, setDirs] = useState<DirEntry[]>([]);
	const [cwd, setCwd] = useState<string | null>(scopeCwd);

	const load = useCallback(async () => {
		try {
			setData(await api<SettingsData>("GET", "/left/settings"));
			setError(null);
		} catch (e) {
			setError(errorMessage(e, "加载失败"));
		}
	}, []);

	useEffect(() => {
		void load();
		api<{ dirs?: DirEntry[] }>("GET", "/left/dirs")
			.then((r) => setDirs(r.dirs ?? []))
			.catch(() => setDirs([]));
	}, [load]);

	const mode: ApprovalMode | null = isApprovalMode(data?.defaultApprovalMode) ? data.defaultApprovalMode : null;
	const patch = (p: Partial<SettingsData>) => setData((d) => (d ? { ...d, ...p } : d));

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg text-m-text">
			<PageHeader title="设置" />
			<PullToRefresh onRefresh={load} className="min-h-0 flex-1 overflow-y-auto">
				<div className="pb-[calc(var(--m-safe-bottom)+24px)]">
					{!data && !error && (
						<div className="flex justify-center py-16">
							<Spinner />
						</div>
					)}
					{error && !data && <EmptyState title="加载失败" hint={error} action={<button type="button" onClick={() => void load()} className="min-h-11 rounded-m-md border border-m-border px-4 text-m-sm whitespace-nowrap">重试</button>} />}
					<AppearanceSection />
					{data && (
						<>
							<PermissionSection mode={mode} onChanged={(m) => patch({ defaultApprovalMode: m })} />
						</>
					)}
					<NotifySection />
					{data && (
						<>
							<Section title="模型与高级管理">
								<div className="flex items-center gap-3 border-b border-m-border px-4 py-3">
									<span className="text-m-sm whitespace-nowrap text-m-text-3">配置目标</span>
									<select
										aria-label="配置目标"
										value={cwd ?? ""}
										onChange={(e) => {
											scopeCwd = e.target.value || null;
											setCwd(scopeCwd);
										}}
										className="min-h-11 min-w-0 flex-1 rounded-m-md border border-m-border bg-m-bg px-2 text-m-sm text-m-text"
									>
										<option value="">全局配置（对所有项目生效）</option>
										{dirs.map((d) => (
											<option key={d.path} value={d.path}>
												项目：{d.label || d.path.split("/").pop()}
											</option>
										))}
									</select>
								</div>
								<NavCard icon={<Bot size={20} />} title="模型角色与思考深度" desc="分模型配置主力模型与思考深度" to={() => nav.push(withCwd(paths.settingsRoles(), cwd))} />
								<NavCard icon={<Globe size={20} />} title="模型与供应商管理" desc="配置 API Key、BaseUrl 并即时测试连通性" to={() => nav.push(paths.settingsProviders())} />
								<NavCard icon={<RefreshCw size={20} />} title="模型故障回退链" desc="主模型失败时按顺位自动尝试的备用梯队" to={() => nav.push(withCwd(paths.settingsFallbacks(), cwd))} />
								<NavCard icon={<Ruler size={20} />} title="上下文窗口大小" desc="直接调整各模型的上下文 token 上限" to={() => nav.push(paths.settingsContext())} />
							</Section>
							{data.ompError && (
								<p className="mx-4 mt-5 rounded-m-md bg-m-surface p-3 text-m-xs leading-relaxed text-m-warn">
									无法读取 OMP 配置，下列 OMP 设置暂不可改：{data.ompError}
								</p>
							)}
							<OmpSettings omp={data.omp ?? {}} onValue={(key, value) => patch({ omp: { ...data.omp, [key]: value } })} />
							<ConnectionSection
								mobile={data.mobile ?? {}}
								appVersion={data.appVersion}
								defaultModel={data.defaultModel}
								defaultModelSource={data.defaultModelSource}
							/>
						</>
					)}
				</div>
			</PullToRefresh>
		</div>
	);
}
