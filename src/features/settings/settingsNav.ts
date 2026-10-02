/** Settings shell state exposed to section components (search query + navigation). */
import { createContext, useContext } from "react";

export interface SettingsNavValue {
	/** Trimmed settings search query ("" when not searching). */
	query: string;
	/** Switch the active nav section (full nav id; use `ompSectionId` for OMP categories). */
	navigate: (sectionId: string) => void;
}

export const SettingsNavContext = createContext<SettingsNavValue>({
	query: "",
	navigate: () => {},
});

export function useSettingsNav(): SettingsNavValue {
	return useContext(SettingsNavContext);
}
