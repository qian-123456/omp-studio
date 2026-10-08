/**
 * Route map: nav section id → section component. `omp-*` config categories
 * (except `omp-roles`) are rendered by OmpConfigSection in SettingsPage.
 */
import type { ComponentType } from "react";
import { AboutSection } from "./AboutSection";
import { AdvancedSection } from "./AdvancedSection";
import { AgentsMdSection } from "./AgentsMdSection";
import { AppearanceSection } from "./AppearanceSection";
import { ContextWindowSection } from "./ContextWindowSection";
import { GeneralSection } from "./GeneralSection";
import { DoctorSection, InboxSection } from "./InboxSection";
import { McpSettingsSection } from "./McpSettingsSection";
import { MobileSettingsSection } from "./MobileSettingsSection";
import { NotificationsSection } from "./NotificationsSection";
import { PluginsSettingsSection } from "./PluginsSettingsSection";
import { ProvidersSection } from "./ProvidersSection";
import { QuotaDashboardCard } from "./QuotaDashboardCard";
import { RolesSection } from "./RolesSection";
import { SessionsSection } from "./SessionsSection";

export const SECTION_COMPONENTS: Record<string, ComponentType> = {
	general: GeneralSection,
	appearance: AppearanceSection,
	notifications: NotificationsSection,
	"context-window": ContextWindowSection,
	quota: QuotaDashboardCard,
	providers: ProvidersSection,
	"omp-roles": RolesSection,
	sessions: SessionsSection,
	inbox: InboxSection,
	doctor: DoctorSection,
	"agents-md": AgentsMdSection,
	mobile: MobileSettingsSection,
	mcp: McpSettingsSection,
	plugins: PluginsSettingsSection,
	advanced: AdvancedSection,
	about: AboutSection,
};
