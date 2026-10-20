/** Settings shell state exposed to section components (search query + navigation). */
import { createContext, useContext } from "react";

export interface SettingsNavValue {
	/** Trimmed settings search query ("" when not searching). */
	query: string;
	/** Switch the active nav section (plain nav id, see NAV_GROUPS). */
	navigate: (sectionId: string) => void;
	/** Pending deep-link target (`data-field-id` or omp key) so tabbed pages can reveal the tab holding it. */
	focusKey: string | null;
}

export const SettingsNavContext = createContext<SettingsNavValue>({
	query: "",
	navigate: () => {},
	focusKey: null,
});

export function useSettingsNav(): SettingsNavValue {
	return useContext(SettingsNavContext);
}
