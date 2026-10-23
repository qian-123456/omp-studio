/**
 * Session-search entry point used by the shortcut dispatcher
 * (features/shortcuts/dispatcher.ts owns the key handling).
 */

import { useUi } from "../../stores/ui";
import { useSearchDialog } from "./search/searchStore";

/**
 * Opens the sidebar (which hosts the dialog) and the global session search
 * dialog; while it is already open this re-focuses and selects its input (S19).
 */
export function focusSidebarSearch(): void {
	useUi.getState().setSidebarOpen(true);
	useSearchDialog.getState().openDialog();
}
