/** Settings ▸ 关于与更新 (`about`): app version, omp version and `omp update`. */
import { ArrowUpCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { confirmDialog } from "../../../lib/dialogs";
import { ompVersionLabel, useOmpUpdate } from "../../../stores/ompUpdate";
import { SETTINGS_BUTTON_CLASS, SectionHeader, SettingRow, SettingsCard } from "../ui";

export function AboutSection() {
	const { appVersion, info, status, checking, updating, lastCheckedAt, error, lastOutput, loadInfo, check, runUpdate } =
		useOmpUpdate();
	const [logOpen, setLogOpen] = useState(false);

	useEffect(() => {
		void loadInfo();
	}, [loadInfo]);

	const ompVersion = ompVersionLabel(info, status);

	const handleUpdate = async () => {
		const target = status?.updateAvailable && status.latest ? ` ${status.latest}` : "";
		const ok = await confirmDialog(
			`将运行 omp update 把 omp 升级到最新版本${target}。已运行的会话需重启后才会使用新版本。`,
			{ okLabel: "更新 omp" },
		);
		if (ok) await runUpdate();
	};

	const latestHint = checking ? (
		<span className="inline-flex items-center gap-1 text-neutral-400">
			<Loader2 className="h-3 w-3 animate-spin" /> 正在检查…
		</span>
	) : error ? (
		<span className="text-amber-400">检查失败：{error}</span>
	) : status?.updateAvailable ? (
		<span className="inline-flex items-center gap-1 text-indigo-300">
			<ArrowUpCircle className="h-3 w-3" /> 有新版本 {status.latest}
		</span>
	) : status ? (
		<span className="inline-flex items-center gap-1 text-emerald-400">
			<CheckCircle2 className="h-3 w-3" /> 已是最新版本
		</span>
	) : (
		<span className="text-neutral-500">尚未检查</span>
	);

	return (
		<div className="space-y-6">
			<SectionHeader title="关于与更新" description="查看本产品与 omp 的版本，检查并安装 omp 更新。" />

			<SettingsCard title="版本">
				<SettingRow
					label="本产品"
					description="OMP 工作台桌面应用"
					control={<span className="font-mono text-xs text-neutral-300">omp-workspace v{appVersion ?? "…"}</span>}
				/>
				<SettingRow
					label="omp 版本"
					description={info?.found ? <span className="font-mono">{info.resolvedPath}</span> : "未找到 omp，可在「高级」中设置 omp 程序位置"}
					control={<span className="font-mono text-xs text-neutral-300">{ompVersion ?? "未知"}</span>}
				/>
				<SettingRow
					label="最新版本"
					hint={latestHint}
					description={`上次检查：${lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : "从未"}`}
					control={
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								disabled={checking || updating}
								onClick={() => void check()}
								className={SETTINGS_BUTTON_CLASS}
							>
								<RefreshCw className={checking ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
								<span>检查更新</span>
							</button>
							<button
								type="button"
								disabled={checking || updating || !info?.found}
								onClick={() => void handleUpdate()}
								className={SETTINGS_BUTTON_CLASS}
							>
								{updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
								<span>{updating ? "正在更新…" : "更新 omp"}</span>
							</button>
						</div>
					}
				/>
			</SettingsCard>

			{lastOutput ? (
				<SettingsCard title="输出日志">
					<div className="px-4 py-3">
						<button
							type="button"
							onClick={() => setLogOpen((v) => !v)}
							className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"
						>
							{logOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
							<span>{logOpen ? "收起" : "展开"}上次检查 / 更新的输出</span>
						</button>
						{logOpen ? (
							<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-2 font-mono text-[11px] text-neutral-300">
								{lastOutput}
							</pre>
						) : null}
					</div>
				</SettingsCard>
			) : null}
		</div>
	);
}
