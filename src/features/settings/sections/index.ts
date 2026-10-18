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
import { FallbackSection } from "./FallbackSection";
import { GeneralSection } from "./GeneralSection";
import { DoctorSection, InboxSection } from "./InboxSection";
import { McpSettingsSection } from "./McpSettingsSection";
import { MobileSettingsSection } from "./MobileSettingsSection";
import { NotificationsSection } from "./NotificationsSection";
import { PluginsSettingsSection } from "./PluginsSettingsSection";
import { PromptCompositionSection } from "./PromptCompositionSection";
import { PrivacySection } from "./PrivacySection";
import { ProvidersSection } from "./ProvidersSection";
import { RolesSection } from "./RolesSection";
import { SessionsSection } from "./SessionsSection";

export const SECTION_COMPONENTS: Record<string, ComponentType> = {
	general: GeneralSection,
	appearance: AppearanceSection,
	notifications: NotificationsSection,
	"context-window": ContextWindowSection,
	quota: ProvidersSection,
	providers: ProvidersSection,
	"omp-roles": RolesSection,
	"model-fallback": FallbackSection,
	sessions: SessionsSection,
	inbox: InboxSection,
	doctor: DoctorSection,
	"agents-md": AgentsMdSection,
	"prompt-composition": PromptCompositionSection,
	mobile: MobileSettingsSection,
	mcp: McpSettingsSection,
	plugins: PluginsSettingsSection,
	privacy: PrivacySection,
	advanced: AdvancedSection,
	about: AboutSection,
};
