/**
 * UI state: selected session, center view, right tab, modals (§10). [LEAD]
 */

import { create } from "zustand";

export type CenterView = "home" | "session" | "doc" | "backlog" | "settings";
export type RightTab = "sidechat" | "heatmap" | "todos" | "git" | "services";

export interface UiState {
	centerView: CenterView;
	selectedSessionId: string | null;
	docPath: string | null;
	rightTab: RightTab;
	rightOpen: boolean;
	/** Settings section to show when the settings view opens (e.g. from the theme menu). */
	settingsSection: string | null;
	sessionViewMode: Record<string, "chat" | "terminal">;
	modal: { name: string; props: Record<string, unknown> } | null;
	selectSession(id: string | null): void;
	openDoc(path: string): void;
	setCenter(v: CenterView): void;
	setRightTab(t: RightTab): void;
	toggleRight(): void;
	openSettings(section?: string): void;
	setSessionViewMode(id: string, m: "chat" | "terminal"): void;
	openModal(name: string, props?: Record<string, unknown>): void;
	closeModal(): void;
}

export const useUi = create<UiState>((set) => ({
	centerView: "home",
	selectedSessionId: null,
	docPath: null,
	rightTab: "todos",
	rightOpen: true,
	settingsSection: null,
	sessionViewMode: {},
	modal: null,
	selectSession: (id) =>
		set((s) => ({
			selectedSessionId: id,
			centerView: id ? "session" : s.centerView === "session" ? "home" : s.centerView,
		})),
	openDoc: (path) => set({ docPath: path, centerView: "doc" }),
	setCenter: (v) => set({ centerView: v }),
	setRightTab: (t) => set({ rightTab: t, rightOpen: true }),
	toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
	openSettings: (section) =>
		set({ centerView: "settings", settingsSection: section ?? null }),
	setSessionViewMode: (id, m) =>
		set((s) => ({ sessionViewMode: { ...s.sessionViewMode, [id]: m } })),
	openModal: (name, props = {}) => set({ modal: { name, props } }),
	closeModal: () => set({ modal: null }),
}));
