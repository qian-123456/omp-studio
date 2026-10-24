/** Supported application locales. */
export type Locale = "zh-CN" | "en-US";

export const DEFAULT_LOCALE: Locale = "zh-CN";

export interface LocaleOption {
	value: Locale;
	label: string;
	nativeLabel: string;
}

export const SUPPORTED_LOCALES: LocaleOption[] = [
	{ value: "zh-CN", label: "简体中文", nativeLabel: "简体中文" },
	{ value: "en-US", label: "English", nativeLabel: "English" },
];

/**
 * Strict schema for all UI translation strings.
 * Both zh-CN and en-US dictionaries must fulfill this structure.
 */
export interface TranslationSchema {
	common: {
		confirm: string;
		cancel: string;
		save: string;
		saved: string;
		delete: string;
		reset: string;
		resetToDefault: string;
		edit: string;
		close: string;
		copy: string;
		copied: string;
		search: string;
		loading: string;
		success: string;
		failed: string;
		retry: string;
		back: string;
		previousStep: string;
		nextStep: string;
		finish: string;
		none: string;
		all: string;
		status: string;
		actions: string;
		more: string;
		settings: string;
		expand: string;
		collapse: string;
		refresh: string;
	};
	status: {
		working: string;
		awaitingApproval: string;
		awaitingAnswer: string;
		review: string;
		idle: string;
		error: string;
		interrupted: string;
		suspended: string;
		external: string;
	};
	time: {
		justNow: string;
		minutesAgo: string;
		hoursAgo: string;
		daysAgo: string;
		today: string;
		yesterday: string;
		last7Days: string;
		earlier: string;
	};
	hero: {
		greetingMorning: string;
		greetingAfternoon: string;
		greetingEvening: string;
		greetingNight: string;
	};
	sidebar: {
		newSession: string;
		searchSessions: string;
		projects: string;
		addWorkspaceDir: string;
		unassignedWorkspaces: string;
		cleanedWorktrees: string;
		archiveAll: string;
		assignToWorkspace: string;
		emptyNoSessions: string;
	};
	sessionActions: {
		rename: string;
		pin: string;
		unpin: string;
		archive: string;
		unarchive: string;
		acceptAndArchive: string;
		delete: string;
		batchArchive: string;
		batchPin: string;
		batchDelete: string;
		showInFinder: string;
	};
	composer: {
		placeholderDefault: string;
		placeholderStreaming: string;
		placeholderReadonly: string;
		send: string;
		sendShortcut: string;
		resume: string;
		stop: string;
	};
	rightPanel: {
		sidechat: string;
		explorer: string;
		git: string;
		services: string;
		heatmap: string;
		terminal: string;
		plan: string;
		files: string;
	};
	topbar: {
		back: string;
		terminal: string;
		expandSidebar: string;
		collapseSidebar: string;
		expandRightPanel: string;
		collapseRightPanel: string;
		doc: string;
		inbox: string;
		schedules: string;
		skills: string;
	};
	settings: {
		title: string;
		searchPlaceholder: string;
		language: string;
		languageDesc: string;
		nav: {
			generalGroup: string;
			general: string;
			generalLead: string;
			shortcuts: string;
			shortcutsLead: string;
			storage: string;
			storageLead: string;
			appearance: string;
			appearanceLead: string;
			notifications: string;
			notificationsLead: string;
			privacy: string;
			privacyLead: string;
			modelsGroup: string;
			models: string;
			modelsLead: string;
			providers: string;
			providersLead: string;
			thinking: string;
			thinkingLead: string;
			helperModels: string;
			helperModelsLead: string;
			modelFallback: string;
			modelFallbackLead: string;
			contextWindow: string;
			contextWindowLead: string;
			sessionsGroup: string;
			sessions: string;
			sessionsLead: string;
			inbox: string;
			inboxLead: string;
			doctor: string;
			doctorLead: string;
			agentsMd: string;
			agentsMdLead: string;
			promptComposition: string;
			promptCompositionLead: string;
			agentCapabilitiesGroup: string;
			tools: string;
			toolsLead: string;
			files: string;
			filesLead: string;
			shell: string;
			shellLead: string;
			subagents: string;
			subagentsLead: string;
			memory: string;
			memoryLead: string;
			skills: string;
			skillsLead: string;
			connectionsGroup: string;
			mobile: string;
			mobileLead: string;
			mcp: string;
			mcpLead: string;
			plugins: string;
			pluginsLead: string;
			web: string;
			webLead: string;
			advancedGroup: string;
			advanced: string;
			advancedLead: string;
			helpGroup: string;
			guide: string;
			guideLead: string;
			about: string;
			aboutLead: string;
		};
		appearance: {
			title: string;
			description: string;
			theme: string;
			themeCard: string;
			typographyAndLayout: string;
			footerLocalOnly: string;
			fontSize: string;
			fontSizeDesc: string;
			uiScale: string;
			uiScaleDesc: string;
			zoom: string;
			zoomDesc: string;
			zoomKeysHint: string;
			requestStats: string;
			conversationDisplay: string;
		};
		general: {
			title: string;
			description: string;
			newSessionDefaults: string;
			globalDefaultModel: string;
			globalDefaultModelDesc: string;
			modifyInRoles: string;
			approvalMode: string;
			longTermRules: string;
			longTermRulesDesc: string;
			editInRules: string;
			interface: string;
			capsuleVisible: string;
			capsuleVisibleDesc: string;
			windowWorktreeTitle: string;
			windowWorktreeTitleDesc: string;
		};
	};
	bottomBar: {
		memoryFootprint: string;
		zoomIn: string;
		zoomOut: string;
		resetZoom: string;
		ompVersionTip: string;
		ompNewVersion: string;
		viewGitPanel: string;
	};
	shortcuts: {
		zoomHint: string;
	};
}
