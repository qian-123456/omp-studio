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
	sessionViewMode: Record<string, "chat" | "terminal">;
	modal: { name: string; props: Record<string, unknown> } | null;
	selectSession(id: string | null): void;
	openDoc(path: string): void;
	setCenter(v: CenterView): void;
	setRightTab(t: RightTab): void;
	toggleRight(): void;
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
	setSessionViewMode: (id, m) =>
		set((s) => ({ sessionViewMode: { ...s.sessionViewMode, [id]: m } })),
	openModal: (name, props = {}) => set({ modal: { name, props } }),
	closeModal: () => set({ modal: null }),
}));
