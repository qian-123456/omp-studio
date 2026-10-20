/** Route map: nav section id → section component (ids per `NAV_GROUPS`). */
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
import {
	FilesSection,
	HelperModelsSection,
	MemorySection,
	ShellSection,
	SkillsSection,
	SubagentsSection,
	ThinkingSection,
	ToolsSection,
	WebSection,
} from "./OmpPages";
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
	privacy: PrivacySection,
	about: AboutSection,
	providers: ProvidersSection,
	"omp-roles": RolesSection,
	thinking: ThinkingSection,
	"helper-models": HelperModelsSection,
	"model-fallback": FallbackSection,
	"context-window": ContextWindowSection,
	sessions: SessionsSection,
	inbox: InboxSection,
	doctor: DoctorSection,
	"agents-md": AgentsMdSection,
	"prompt-composition": PromptCompositionSection,
	tools: ToolsSection,
	files: FilesSection,
	shell: ShellSection,
	subagents: SubagentsSection,
	memory: MemorySection,
	skills: SkillsSection,
	mobile: MobileSettingsSection,
	mcp: McpSettingsSection,
	plugins: PluginsSettingsSection,
	web: WebSection,
	advanced: AdvancedSection,
};
