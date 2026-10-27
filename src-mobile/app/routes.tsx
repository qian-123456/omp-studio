import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { PageProps, RouteName } from "../core/nav";

type Page = LazyExoticComponent<ComponentType<PageProps>>;

/**
 * Lazy route table. Every page is exported from its slice's `features/<slice>/index.ts`; each slice is a
 * separate chunk loaded on first visit. Slice owners replace the placeholder components, never this table.
 */
export const ROUTES: Record<Exclude<RouteName, "notFound">, Page> = {
	home: lazy(() => import("../features/sessions").then((m) => ({ default: m.HomePage }))),
	chat: lazy(() => import("../features/chat").then((m) => ({ default: m.ChatPage }))),
	subagents: lazy(() => import("../features/subagents").then((m) => ({ default: m.SubagentsPage }))),
	subagent: lazy(() => import("../features/subagents").then((m) => ({ default: m.SubagentDetailPage }))),
	files: lazy(() => import("../features/panels").then((m) => ({ default: m.FilesPage }))),
	git: lazy(() => import("../features/panels").then((m) => ({ default: m.GitPage }))),
	terminal: lazy(() => import("../features/panels").then((m) => ({ default: m.TerminalPage }))),
	plan: lazy(() => import("../features/panels").then((m) => ({ default: m.PlanPage }))),
	sidechat: lazy(() => import("../features/panels").then((m) => ({ default: m.SidechatPage }))),
	services: lazy(() => import("../features/panels").then((m) => ({ default: m.ServicesPage }))),
	inbox: lazy(() => import("../features/sessions").then((m) => ({ default: m.InboxPage }))),
	search: lazy(() => import("../features/sessions").then((m) => ({ default: m.SearchPage }))),
	schedules: lazy(() => import("../features/more").then((m) => ({ default: m.SchedulesPage }))),
	scheduleNew: lazy(() => import("../features/more").then((m) => ({ default: m.ScheduleNewPage }))),
	schedule: lazy(() => import("../features/more").then((m) => ({ default: m.ScheduleDetailPage }))),
	scheduleRuns: lazy(() => import("../features/more").then((m) => ({ default: m.ScheduleRunsPage }))),
	skills: lazy(() => import("../features/more").then((m) => ({ default: m.SkillsPage }))),
	ideas: lazy(() => import("../features/more").then((m) => ({ default: m.IdeasPage }))),
	settings: lazy(() => import("../features/settings").then((m) => ({ default: m.SettingsPage }))),
	settingsRoles: lazy(() => import("../features/settings").then((m) => ({ default: m.SettingsRolesPage }))),
	settingsProviders: lazy(() => import("../features/settings").then((m) => ({ default: m.SettingsProvidersPage }))),
	settingsFallbacks: lazy(() => import("../features/settings").then((m) => ({ default: m.SettingsFallbacksPage }))),
	settingsContext: lazy(() => import("../features/settings").then((m) => ({ default: m.SettingsContextPage }))),
	quota: lazy(() =>
		import("../features/settings").then((m) => ({
			default: "QuotaPage" in m && m.QuotaPage ? (m.QuotaPage as ComponentType<PageProps>) : () => null,
		})),
	),
};
