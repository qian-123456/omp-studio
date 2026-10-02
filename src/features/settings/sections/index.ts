/**
 * Route map: nav section id → section component. `omp-*` config categories
 * (except `omp-roles`) are rendered by OmpConfigSection in SettingsPage.
 */
import type { ComponentType } from "react";
import { AdvancedSection } from "./AdvancedSection";
import { AgentsMdSection } from "./AgentsMdSection";
import { AppearanceSection } from "./AppearanceSection";
import { GeneralSection } from "./GeneralSection";
import { InboxSection } from "./InboxSection";
import { McpSettingsSection } from "./McpSettingsSection";
import { MobileSettingsSection } from "./MobileSettingsSection";
import { ModelContextSection } from "./ModelContextSection";
import { NotificationsSection } from "./NotificationsSection";
import { PluginsSettingsSection } from "./PluginsSettingsSection";
import { ProvidersSection } from "./ProvidersSection";
import { RolesSection } from "./RolesSection";
import { SessionsSection } from "./SessionsSection";

export const SECTION_COMPONENTS: Record<string, ComponentType> = {
	general: GeneralSection,
	appearance: AppearanceSection,
	notifications: NotificationsSection,
	providers: ProvidersSection,
	"model-context": ModelContextSection,
	"omp-roles": RolesSection,
	sessions: SessionsSection,
	inbox: InboxSection,
	"agents-md": AgentsMdSection,
	mobile: MobileSettingsSection,
	mcp: McpSettingsSection,
	plugins: PluginsSettingsSection,
	advanced: AdvancedSection,
};
