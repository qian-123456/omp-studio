/** Settings ▸ 高级 (`advanced`): status extension, data backup / import / reset. */
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertTriangle, CheckCircle2, Download, FileDown, FileText, FileUp, FolderOpen, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import type { OmpInfo } from "../../../lib/contracts";
import { appPaths, installStatusExtensionGlobally, ompInfo, readTextFile, writeTextFile } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { useOmpConfigStore } from "../ompConfigStore";
import { DEFAULT_SETTINGS } from "../store";
import { useAppSettings } from "../useAppSettings";
import { validateSettingsShape } from "../validation";
import { CommitInput, SETTINGS_BUTTON_CLASS, SectionHeader, SettingRow, SettingsCard } from "../ui";
export function AdvancedSection() {
	const { settings, save } = useAppSettings();
	const [installing, setInstalling] = useState(false);
	const [installResult, setInstallResult] = useState<string | null>(null);

	const ompLoading = useOmpConfigStore((s) => s.loading);
	const ompError = useOmpConfigStore((s) => s.error);
	const loadOmp = useOmpConfigStore((s) => s.load);

	const [info, setInfo] = useState<OmpInfo | null>(null);
	const [infoLoading, setInfoLoading] = useState(false);

	const refreshInfo = useCallback(async () => {
		setInfoLoading(true);
		try {
			setInfo(await ompInfo());
		} catch (e) {
			toast.error(`检测 omp 失败: ${errMsg(e)}`);
		} finally {
			setInfoLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadOmp();
	}, [loadOmp]);

	const ompBinary = settings?.ompBinary;
	useEffect(() => {
		if (ompBinary !== undefined) void refreshInfo();
	}, [ompBinary, refreshInfo]);

	const reveal = async (path: string, what: string) => {
		try {
			await revealItemInDir(path);
		} catch (e) {
			toast.error(`在访达中显示${what}失败: ${errMsg(e)}`);
		}
	};

	const reloadOmp = async () => {
		await Promise.all([loadOmp(true), refreshInfo()]);
		const err = useOmpConfigStore.getState().error;
		if (err) toast.error(`读取 OMP 配置失败: ${err}`);
		else toast.success("已重新读取 OMP 配置");
	};

	const ompStatus = infoLoading && !info ? (
		<span className="inline-flex items-center gap-1 text-neutral-400">
			<Loader2 className="h-3 w-3 animate-spin" /> 正在检测…
		</span>
	) : info?.found ? (
		<span className="inline-flex items-center gap-1 text-emerald-400">
			<CheckCircle2 className="h-3 w-3" />
			已找到 {info.version ?? "（版本未知）"}
			<span className="font-mono text-neutral-500">· {info.resolvedPath}</span>
		</span>
	) : info ? (
		<span className="inline-flex items-center gap-1 text-amber-400">
			<AlertTriangle className="h-3 w-3" />
			找不到这个程序，会话将无法启动。请填写 omp 的完整路径（终端运行 <code>which omp</code> 可查看）。
		</span>
	) : null;
	const handleInstallExtension = async () => {
		setInstalling(true);
		setInstallResult(null);
		try {
			const res = await installStatusExtensionGlobally();
			toast.success("全局扩展安装成功");
			setInstallResult(res || "安装成功");
		} catch (err) {
			const msg = errMsg(err);
			toast.error(`安装异常: ${msg}`);
			setInstallResult(msg);
		} finally {
			setInstalling(false);
		}
	};

	const handleOpenDataDir = async () => {
		try {
			const paths = await appPaths();
			await revealItemInDir(paths.dataDir);
		} catch (err) {
			toast.error(`打开数据目录失败: ${errMsg(err)}`);
		}
	};

	const handleExportSettings = async () => {
		if (!settings) return;
		try {
			const path = await saveDialog({
				defaultPath: "omp-workspace-settings.json",
				filters: [{ name: "JSON", extensions: ["json"] }],
			});
			if (!path) return;
			await writeTextFile(path, JSON.stringify(settings, null, "\t"));
			toast.success("设置已导出");
		} catch (err) {
			toast.error(`导出失败: ${errMsg(err)}`);
		}
	};

	const handleImportSettings = async () => {
		try {
			const path = await openDialog({
				multiple: false,
				directory: false,
				filters: [{ name: "JSON", extensions: ["json"] }],
			});
			if (!path || Array.isArray(path)) return;
			const text = await readTextFile(path);
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				toast.error("设置文件内容不是合法的 JSON");
				return;
			}
			const validation = validateSettingsShape(parsed);
			if (!validation.ok) {
				toast.error(`设置验证失败: ${validation.error}`);
				return;
			}
			const ok = await confirmDialog("导入会用文件里的内容覆盖当前全部设置，确定继续吗？", {
				danger: true,
				okLabel: "覆盖导入",
			});
			if (!ok) return;
			try {
				await save(validation.value);
			} catch {
				return; // save() already toasted the failure.
			}
			toast.success("设置已导入");
		} catch (err) {
			toast.error(`导入失败: ${errMsg(err)}`);
		}
	};

	const handleResetSettings = async () => {
		const first = await confirmDialog("确定要将所有设置恢复为默认值吗？", {
			danger: true,
			okLabel: "恢复默认",
		});
		if (!first) return;
		const second = await confirmDialog(
			"再次确认：全部设置（含通知、监工、隧道等）都会被重置，且无法撤销。",
			{ danger: true, okLabel: "确认重置" },
		);
		if (!second) return;
		try {
			await save(DEFAULT_SETTINGS);
			toast.success("已恢复默认设置");
		} catch {
			// save() already toasted the failure.
		}
	};

	return (
		<div className="space-y-6">
			<SectionHeader title="高级" description="数据备份、OMP 运行时路径与外部终端联动等高级选项。" />

			<SettingsCard title="OMP 环境与路径">
				<SettingRow
					fieldId="ompBinary"
					stacked
					label="omp 程序位置"
					description="本应用通过这个命令启动 AI 会话。一般填 omp 即可；装在非常规位置时填完整路径。"
					hint={ompStatus}
					control={
						<CommitInput
							mono
							aria-label="omp 程序位置"
							placeholder="omp"
							value={settings?.ompBinary ?? ""}
							validate={(v) => (v ? null : "omp 程序位置不能为空")}
							onCommit={(v) => save({ ompBinary: v })}
						/>
					}
				/>
				<SettingRow
					fieldId="ompConfigFiles"
					stacked
					label="omp 配置文件"
					description="omp 自己的设置保存在这里；在终端里用 omp 时也会读取同一份。"
					hint={
						<>
							{info ? <span className="font-mono">{info.configPath}</span> : null}
							{info && !info.configExists ? "（尚未创建，改过任意 omp 设置后生成）" : null}
							{ompError ? <span className="text-amber-400"> 读取失败：{ompError}</span> : null}
						</>
					}
					control={
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								disabled={!info?.configExists}
								onClick={() => info && void reveal(info.configPath, "配置文件")}
								className={SETTINGS_BUTTON_CLASS}
							>
								<FileText className="h-3.5 w-3.5" />
								<span>在访达中显示 config.yml</span>
							</button>
							<button
								type="button"
								disabled={!info}
								onClick={() => info && void reveal(info.agentDir, "目录")}
								className={SETTINGS_BUTTON_CLASS}
							>
								<FolderOpen className="h-3.5 w-3.5" />
								<span>打开 omp 数据目录</span>
							</button>
							<button
								type="button"
								disabled={ompLoading || infoLoading}
								onClick={() => void reloadOmp()}
								className={SETTINGS_BUTTON_CLASS}
							>
								<RefreshCw className={ompLoading || infoLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
								<span>重新读取 OMP 配置</span>
							</button>
						</div>
					}
				/>
			</SettingsCard>
			<SettingsCard title="外部终端联动">
				<SettingRow
					fieldId="installStatusExtension"
					label="让终端里的 omp 也显示在这里"
					description="安装一个小扩展到 ~/.omp/agent/extensions/，之后你在终端直接运行的 omp 对话也会出现在本应用的列表中。"
					control={
						<button
							type="button"
							disabled={installing}
							onClick={handleInstallExtension}
							className={SETTINGS_BUTTON_CLASS}
						>
							<Download className="h-3.5 w-3.5" />
							<span>{installing ? "正在安装…" : "安装扩展"}</span>
						</button>
					}
				>
					{installResult && (
						<div className="rounded-lg bg-[var(--well-bg)] hairline p-2 text-[11px] font-mono text-neutral-300">
							{installResult}
						</div>
					)}
				</SettingRow>
			</SettingsCard>

			<SettingsCard title="数据与备份">
				<SettingRow
					fieldId="dataManagement"
					stacked
					label="本应用的设置与数据"
					description="打开数据所在文件夹，或把设置导出成文件备份、换电脑时再导入。不包含 omp 自己的配置。"
					control={
						<div className="flex flex-wrap items-center gap-2">
							<button type="button" onClick={handleOpenDataDir} className={SETTINGS_BUTTON_CLASS}>
								<FolderOpen className="h-3.5 w-3.5" />
								<span>打开数据目录</span>
							</button>
							<button type="button" onClick={handleExportSettings} className={SETTINGS_BUTTON_CLASS}>
								<FileDown className="h-3.5 w-3.5" />
								<span>导出设置</span>
							</button>
							<button type="button" onClick={handleImportSettings} className={SETTINGS_BUTTON_CLASS}>
								<FileUp className="h-3.5 w-3.5" />
								<span>导入设置</span>
							</button>
						</div>
					}
				/>
				<SettingRow
					fieldId="resetSettings"
					danger
					label="恢复默认设置"
					description="把本应用的所有设置（通知、监工、远程访问等）恢复成刚安装时的样子，无法撤销。建议先导出备份。"
					control={
						<button
							type="button"
							onClick={handleResetSettings}
							className="inline-flex items-center gap-1.5 rounded-lg border border-rose-800/40 bg-rose-950/20 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-950/40 active:scale-95 transition-all"
						>
							<RotateCcw className="h-3.5 w-3.5" />
							<span>恢复默认</span>
						</button>
					}
				/>
			</SettingsCard>
		</div>
	);
}
