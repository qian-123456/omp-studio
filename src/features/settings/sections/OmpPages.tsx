import { useT } from "../../../stores/language";
import { AgentDefsPanel } from "./AgentDefsPanel";
import { MemoryFilesPanel } from "./MemoryFilesPanel";
import { OmpSettingsPage } from "../OmpSettingsList";

export function ThinkingSection() {
	const { t } = useT();
	return <OmpSettingsPage page="thinking" title={t("settings.nav.thinking")} description={t("settings.nav.thinkingLead")} />;
}

export function HelperModelsSection() {
	const { t } = useT();
	return <OmpSettingsPage page="helper-models" title={t("settings.nav.helperModels")} description={t("settings.nav.helperModelsLead")} />;
}

export function ToolsSection() {
	const { t } = useT();
	return <OmpSettingsPage page="tools" title={t("settings.nav.tools")} description={t("settings.nav.toolsLead")} />;
}

export function FilesSection() {
	const { t } = useT();
	return <OmpSettingsPage page="files" title={t("settings.nav.files")} description={t("settings.nav.filesLead")} />;
}

export function ShellSection() {
	const { t } = useT();
	return <OmpSettingsPage page="shell" title={t("settings.nav.shell")} description={t("settings.nav.shellLead")} />;
}

export function SubagentsSection() {
	const { t } = useT();
	return (
		<OmpSettingsPage
			page="subagents"
			title={t("settings.nav.subagents")}
			description={t("agentDefs.subagentsPageLead")}
			lead={<AgentDefsPanel />}
		/>
	);
}

export function MemorySection() {
	const { t } = useT();
	return (
		<OmpSettingsPage page="memory" title={t("settings.nav.memory")} description={t("settings.nav.memoryLead")}>
			<MemoryFilesPanel />
		</OmpSettingsPage>
	);
}

export function SkillsSection() {
	const { t } = useT();
	return <OmpSettingsPage page="skills" title={t("settings.nav.skills")} description={t("settings.nav.skillsLead")} />;
}

export function WebSection() {
	const { t } = useT();
	return <OmpSettingsPage page="web" title={t("settings.nav.web")} description={t("settings.nav.webLead")} />;
}
