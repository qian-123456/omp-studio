/** Settings ▸ 高级 (`advanced`): status extension, data backup / import / reset. */
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, Download, FileDown, FileText, FileUp, FolderOpen, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../../stores/language";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import type { OmpInfo } from "../../../lib/contracts";
import { appPaths, installStatusExtensionGlobally, ompInfo, readTextFile, writeTextFile } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { useOmpConfigStore } from "../ompConfigStore";
import { DEFAULT_SETTINGS } from "../store";
import { useAppSettings } from "../useAppSettings";
import { validateSettingsShape } from "../validation";
import { OmpSections } from "../OmpSettingsList";
import { Notice } from "../../../components/Notice";
import { SectionJumpBar } from "../SectionJumpBar";
import { Button, Chip, CommitInput, SectionHeader, SettingRow, SettingsCard } from "../ui";

export function AdvancedSection() {
	const { t } = useT();
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
			toast.error(t("settingsSections.advanced.detectFailed", { error: errMsg(e) }));
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
			toast.error(t("settingsSections.advanced.revealFailed", { what, error: errMsg(e) }));
		}
	};

	const reloadOmp = async () => {
		await Promise.all([loadOmp(true), refreshInfo()]);
		const err = useOmpConfigStore.getState().error;
		if (err) toast.error(t("settingsSections.advanced.reloadConfigFailed", { error: err }));
		else toast.success(t("settingsSections.advanced.reloadConfigSuccess"));
	};

	const ompStatus = infoLoading && !info ? (
		<Chip tone="neutral" icon={Loader2}>{t("settingsSections.advanced.detecting")}</Chip>
	) : info?.found ? (
		<span className="inline-flex flex-wrap items-center gap-2">
			<Chip tone="success" icon={CheckCircle2}>{t("settingsSections.advanced.found", { version: info.version ?? t("settingsSections.advanced.versionUnknown") })}</Chip>
			<span className="font-mono">{info.resolvedPath}</span>
		</span>
	) : info ? (
		<Notice tone="warning">
			{t("settingsSections.advanced.notFoundNotice")}
		</Notice>
	) : null;
	const handleInstallExtension = async () => {
		setInstalling(true);
		setInstallResult(null);
		try {
			const res = await installStatusExtensionGlobally();
			toast.success(t("settingsSections.advanced.extensionSuccess"));
			setInstallResult(res || t("settingsSections.advanced.extensionInstalled"));
		} catch (err) {
			const msg = errMsg(err);
			toast.error(t("settingsSections.advanced.extensionFailed", { error: msg }));
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
			toast.error(t("settingsSections.advanced.openDataDirFailed", { error: errMsg(err) }));
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
			toast.success(t("settingsSections.advanced.settingsExported"));
		} catch (err) {
			toast.error(t("settingsSections.advanced.exportFailed", { error: errMsg(err) }));
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
				toast.error(t("settingsSections.advanced.invalidJson"));
				return;
			}
			const validation = validateSettingsShape(parsed);
			if (!validation.ok) {
				toast.error(t("settingsSections.advanced.validationFailed", { error: validation.error }));
				return;
			}
			const ok = await confirmDialog(t("settingsSections.advanced.importConfirm"), {
				danger: true,
				okLabel: t("settingsSections.advanced.importOk"),
			});
			if (!ok) return;
			try {
				await save(validation.value);
			} catch {
				return; // save() already toasted the failure.
			}
			toast.success(t("settingsSections.advanced.importSuccess"));
		} catch (err) {
			toast.error(t("settingsSections.advanced.importFailed", { error: errMsg(err) }));
		}
	};

	const handleResetSettings = async () => {
		const first = await confirmDialog(t("settingsSections.advanced.resetConfirm1"), {
			danger: true,
			okLabel: t("settingsSections.advanced.resetConfirm1Ok"),
		});
		if (!first) return;
		const second = await confirmDialog(
			t("settingsSections.advanced.resetConfirm2"),
			{ danger: true, okLabel: t("settingsSections.advanced.resetConfirm2Ok") },
		);
		if (!second) return;
		try {
			await save(DEFAULT_SETTINGS);
			toast.success(t("settingsSections.advanced.resetSuccess"));
		} catch {
			// save() already toasted the failure.
		}
	};

	return (
		<div className="space-y-6">
			<SectionHeader title={t("settingsSections.advanced.title")} description={t("settingsSections.advanced.description")} />

			<SectionJumpBar />
			<SettingsCard jump={t("settingsSections.advanced.jumpEnv")} title={t("settingsSections.advanced.titleEnv")}>
				<SettingRow
					fieldId="ompBinary"
					stacked
					label={t("settingsSections.advanced.ompBinaryLabel")}
					description={t("settingsSections.advanced.ompBinaryDesc")}
					hint={ompStatus}
					control={
						<CommitInput
							mono
							aria-label={t("settingsSections.advanced.ompBinaryLabel")}
							placeholder="omp"
							value={settings?.ompBinary ?? ""}
							validate={(v) => (v ? null : t("settingsSections.advanced.ompBinaryNotEmpty"))}
							onCommit={(v) => save({ ompBinary: v })}
						/>
					}
				/>
				<SettingRow
					fieldId="ompConfigFiles"
					stacked
					label={t("settingsSections.advanced.ompConfigLabel")}
					description={t("settingsSections.advanced.ompConfigDesc")}
					hint={
						<>
							{info ? <span className="font-mono">{info.configPath}</span> : null}
							{info && !info.configExists ? t("settingsSections.advanced.ompConfigNotCreated") : null}
							{ompError ? <span className="text-[var(--status-error)]"> {t("settingsSections.advanced.ompConfigReadFailed", { error: ompError })}</span> : null}
						</>
					}
					control={
						<div className="flex flex-wrap items-center gap-2">
							<Button icon={FileText} disabled={!info?.configExists} title={!info?.configExists ? t("settingsSections.advanced.configNotCreated") : undefined} onClick={() => info && void reveal(info.configPath, t("settingsSections.advanced.configFile"))}>{t("settingsSections.advanced.revealConfig")}</Button>
							<Button icon={FolderOpen} disabled={!info} title={!info ? t("settingsSections.advanced.ompDirNotRead") : undefined} onClick={() => info && void reveal(info.agentDir, t("settingsSections.advanced.directory"))}>{t("settingsSections.advanced.openOmpDir")}</Button>
							<Button
								icon={RefreshCw}
								loading={ompLoading || infoLoading}
								onClick={() => void reloadOmp()}
							>
								{t("settingsSections.advanced.reloadOmp")}
							</Button>
						</div>
					}
				/>
			</SettingsCard>
			<SettingsCard jump={t("settingsSections.advanced.jumpExtension")} title={t("settingsSections.advanced.titleExtension")}>
				<SettingRow
					fieldId="installStatusExtension"
					label={t("settingsSections.advanced.installExtensionLabel")}
					description={t("settingsSections.advanced.installExtensionDesc")}
					control={
						<Button icon={Download} loading={installing} onClick={handleInstallExtension}>{installing ? t("settingsSections.advanced.installingExtension") : t("settingsSections.advanced.installExtension")}</Button>
					}
				>
					{installResult && (
						<div className="rounded-lg bg-[var(--well-bg)] hairline p-2 text-[11px] font-mono text-[var(--text-muted)]">
							{installResult}
						</div>
					)}
				</SettingRow>
			</SettingsCard>

			<SettingsCard jump={t("settingsSections.advanced.jumpData")} title={t("settingsSections.advanced.titleData")}>
				<SettingRow
					fieldId="dataManagement"
					stacked
					label={t("settingsSections.advanced.dataManagementLabel")}
					description={t("settingsSections.advanced.dataManagementDesc")}
					control={
						<div className="flex flex-wrap items-center gap-2">
							<Button icon={FolderOpen} onClick={handleOpenDataDir}>{t("settingsSections.advanced.openDataDir")}</Button>
							<Button icon={FileDown} onClick={handleExportSettings}>{t("settingsSections.advanced.exportSettings")}</Button>
							<Button icon={FileUp} onClick={handleImportSettings}>{t("settingsSections.advanced.importSettings")}</Button>
						</div>
					}
				/>
				<SettingRow
					fieldId="resetSettings"
					danger
					label={t("settingsSections.advanced.resetSettingsLabel")}
					description={t("settingsSections.advanced.resetSettingsDesc")}
					control={
						<Button variant="danger" icon={RotateCcw} onClick={handleResetSettings}>
							{t("settingsSections.advanced.resetSettings")}
						</Button>
					}
				/>
			</SettingsCard>

			<OmpSections page="advanced" />
		</div>
	);
}
