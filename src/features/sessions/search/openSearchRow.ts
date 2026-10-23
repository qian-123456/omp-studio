import { useTurnNav } from "../../../stores/turnNav";
import { useUi } from "../../../stores/ui";
import { switchSpaceMode } from "../switchMode";
import { useSidebarStore } from "../sidebarStore";
import type { SearchRow } from "./searchModel";

/**
 * Open a result: switch to the session's space when it lives in another mode
 * (modes are isolated), select it, and — for a content hit — queue a jump to
 * the matched message. The chat consumes the pending target once the
 * transcript has loaded (MessageList `revealTurn`), so ordering here is only
 * "mode, then session, then target".
 */
export function openSearchRow(row: SearchRow): void {
	const { session, hit } = row;
	if (useSidebarStore.getState().activeMode !== session.mode) switchSpaceMode(session.mode);
	useUi.getState().selectSession(session.id);
	if (hit) useTurnNav.getState().showTurn(session.id, hit.entryId);
}
