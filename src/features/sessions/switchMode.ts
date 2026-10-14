import type { SpaceMode } from "../../lib/contracts";
import { useUi } from "../../stores/ui";
import { useSidebarStore } from "./sidebarStore";

/**
 * User-initiated mode switch. Modes are isolated: the center area never keeps
 * showing a session of the mode being left, so switching lands on the blank
 * start view of the target mode (which opens a fresh draft there).
 */
export function switchSpaceMode(mode: SpaceMode): void {
	if (useSidebarStore.getState().activeMode === mode) return;
	useSidebarStore.getState().setActiveMode(mode);
	useUi.getState().leaveSession();
}
