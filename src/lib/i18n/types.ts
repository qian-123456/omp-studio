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
			subagentsGroup: string;
			subagents: string;
			subagentsLead: string;
			agentAssignments: string;
			agentAssignmentsLead: string;
			advancedGroup: string;
			advanced: string;
			advancedLead: string;
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
