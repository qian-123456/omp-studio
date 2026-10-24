/**
 * Settings ▸ 通用 (`general`): new-session defaults, UI switches, Git delivery,
 * plus the omp 系统 section (sleep prevention).
 */
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../../stores/language";
import { Segmented } from "../../../components/Segmented";
import { ompConfigSet } from "../../../lib/ipc";
import { toModelKey } from "../../../lib/models";
import { formatShortModel } from "../../chat/turnGrouping";
import { asRecord, roleValue, splitRoleValue } from "../modelRoles";
import { useOmpConfigStore } from "../ompConfigStore";
import { useSettingsNav } from "../settingsNav";
import { openSettingsTarget } from "../settingsTargets";
import { useAppSettings, useCatalogModels } from "../useAppSettings";
import { OmpSections } from "../OmpSettingsList";
import {
	Button,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
	useSaveStatus,
} from "../ui";
import { SectionJumpBar } from "../SectionJumpBar";

type ApprovalMode = "always-ask" | "write" | "yolo";


export function GeneralSection() {
	const { t } = useT();
	const { settings, save } = useAppSettings();
	const { models } = useCatalogModels();
	const { navigate } = useSettingsNav();
	const approvalSave = useSaveStatus();
	const ompEntries = useOmpConfigStore((s) => s.entries);
	const ompLoaded = useOmpConfigStore((s) => s.loaded);
	const loadOmp = useOmpConfigStore((s) => s.load);

	// Cache last known default role in localStorage so frame 1 renders accurately
	const [cachedRole, setCachedRole] = useState<string | null>(() => {
		try {
			return localStorage.getItem("ompws:cached-default-role");
		} catch {
			return null;
		}
	});

	useEffect(() => {
		void loadOmp();
	}, [loadOmp]);

	// ── Global default model (OMP modelRoles.default) ──
	const currentRoles = asRecord(ompEntries.find((e) => e.key === "modelRoles")?.value);
	const liveRole = roleValue(currentRoles, "default");
	const defaultRole = (ompLoaded ? liveRole : (cachedRole ?? liveRole)) ?? null;

	useEffect(() => {
		if (ompLoaded && liveRole) {
			try {
				localStorage.setItem("ompws:cached-default-role", liveRole);
				setCachedRole(liveRole);
			} catch {
				/* ignore */
			}
		}
	}, [ompLoaded, liveRole]);

	const defaultSelector = defaultRole ? splitRoleValue(defaultRole).selector : "";
	const matchedModel = models.find((m) => toModelKey(m.provider, m.id) === defaultSelector);
	const fallbackShortName = defaultSelector ? formatShortModel(defaultSelector) : "";
	// ModelSelect appends " · <level>" itself when currentValue carries a suffix.
	const modelLabel = defaultRole
		? (matchedModel?.id ?? (fallbackShortName || defaultRole))
		: (ompLoaded ? t("settingsSections.general.defaultModelOmpBuiltin") : t("settingsSections.general.loading"));

	const approvalOptions: { value: ApprovalMode; label: string; desc: string }[] = useMemo(
		() => [
			{
				value: "always-ask",
				label: t("settingsSections.general.approvalAlwaysAskLabel"),
				desc: t("settingsSections.general.approvalAlwaysAskDesc"),
			},
			{
				value: "write",
				label: t("settingsSections.general.approvalWriteLabel"),
				desc: t("settingsSections.general.approvalWriteDesc"),
			},
			{
				value: "yolo",
				label: t("settingsSections.general.approvalYoloLabel"),
				desc: t("settingsSections.general.approvalYoloDesc"),
			},
		],
		[t],
	);

	const approval = (settings?.defaultApprovalMode ?? "write") as ApprovalMode;
	const currentApprovalOption = approvalOptions.find((o) => o.value === approval) ?? approvalOptions[1];
	return (
		<div className="space-y-6">
			<SectionHeader title={t("settingsSections.general.title")} description={t("settingsSections.general.description")} />
			<SectionJumpBar />

			<SettingsCard jump={t("settingsSections.general.jumpNewSession")} title={t("settingsSections.general.titleNewSession")}>
				<SettingRow
					fieldId="newSessionModel"
					label={t("settingsSections.general.defaultModelLabel")}
					description={t("settingsSections.general.defaultModelDesc")}
					control={
						<div className="flex min-w-0 items-center gap-2">
							<span className="min-w-0 truncate text-xs text-[var(--text-muted)]" title={defaultRole ?? undefined}>
								{modelLabel}
							</span>
							<Button size="sm" variant="ghost" onClick={() => openSettingsTarget("models")}>
								{t("settingsSections.general.goToModelRoles")}
								<ChevronRight className="h-3 w-3" />
							</Button>
						</div>
					}
				/>

				<SettingRow
					fieldId="defaultApprovalMode"
					label={t("settingsSections.general.approvalModeLabel")}
					description={currentApprovalOption.desc}
					status={approvalSave.status}
					statusError={approvalSave.error}
					control={
						<Segmented
							value={approval}
							onChange={(v) =>
								void approvalSave.run(async () => {
									await save({ defaultApprovalMode: v });
									try {
										await ompConfigSet("tools.approvalMode", v);
										await loadOmp(true);
									} catch {
										// Ignore if omp tool schema differs
									}
								})
							}
							options={approvalOptions.map((o) => ({
								value: o.value,
								title: o.desc,
								label:
									o.value === "yolo" ? (
										<span className="inline-flex items-center gap-1 text-[var(--status-warning)]">
											<AlertTriangle className="h-3 w-3" />
											{o.label}
										</span>
									) : (
										o.label
									),
							}))}
						/>
					}
				/>

				<SettingRow
					fieldId="agentsMdShortcut"
					label={t("settingsSections.general.agentsMdLabel")}
					description={t("settingsSections.general.agentsMdDesc")}
					control={
						<Button size="sm" variant="ghost" onClick={() => navigate("agents-md")}>
							{t("settingsSections.general.goToRulesFiles")}
							<ChevronRight className="h-3 w-3" />
						</Button>
					}
				/>
			</SettingsCard>

			<SettingsCard jump={t("settingsSections.general.jumpUi")} title={t("settingsSections.general.titleUi")}>
				<ToggleRow
					fieldId="capsuleVisible"
					label={t("settingsSections.general.capsuleLabel")}
					description={t("settingsSections.general.capsuleDesc")}
					checked={settings?.capsuleVisible ?? true}
					onChange={(v) => save({ capsuleVisible: v })}
				/>
				<ToggleRow
					fieldId="windowWorktreeTitle"
					label={t("settingsSections.general.windowWorktreeTitleLabel")}
					description={t("settingsSections.general.windowWorktreeTitleDesc")}
					checked={settings?.windowWorktreeTitle ?? true}
					onChange={(v) => save({ windowWorktreeTitle: v })}
				/>
				<ToggleRow
					fieldId="smartContextRouting"
					label={t("settingsSections.general.smartContextRoutingLabel")}
					description={t("settingsSections.general.smartContextRoutingDesc")}
					checked={settings?.smartContextRouting ?? true}
					onChange={(v) => save({ smartContextRouting: v })}
				/>
			</SettingsCard>

			<SettingsCard jump={t("settingsSections.general.jumpGit")} title={t("settingsSections.general.titleGit")}>
				<SettingRow
					fieldId="gitDeliveryMode"
					label={t("settingsSections.general.gitDeliveryModeLabel")}
					description={t("settingsSections.general.gitDeliveryModeDesc")}
					hint={t("settingsSections.general.gitDeliveryModeHint")}
					control={
						<Segmented
							value={(settings?.gitDeliveryMode as "pr" | "direct") ?? "pr"}
							onChange={(v) => void save({ gitDeliveryMode: v })}
							options={[
								{
									value: "pr",
									label: t("settingsSections.general.gitDeliveryPrLabel"),
									title: t("settingsSections.general.gitDeliveryPrTitle"),
								},
								{
									value: "direct",
									label: t("settingsSections.general.gitDeliveryDirectLabel"),
									title: t("settingsSections.general.gitDeliveryDirectTitle"),
								},
							]}
						/>
					}
				/>
			</SettingsCard>

			<OmpSections page="general" />
		</div>
	);
}
