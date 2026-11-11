import type { BacklogItem, SpaceMode } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { listWorkspaces } from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { tNow } from "../../stores/language";
import { selectSessionOrDraft, usePendingSession } from "../sessions/pendingSession";
import { useSidebarStore } from "../sessions/sidebarStore";
import { fillIdeasIntoComposer } from "./fillComposer";
import { splitByProject } from "./ideasLogic";

/** Prepare editable local drafts per project; only an explicit composer send delivers ideas. */
export async function openIdeasInDrafts(
	items: BacklogItem[],
	currentProject: string | null,
): Promise<{ draftIds: string[]; error: string | null }> {
	if (items.length === 0) return { draftIds: [], error: null };
	const draftIds: string[] = [];
	const previousDraftId = usePendingSession.getState().selectedId;
	try {
		const activeMode = useSidebarStore.getState().activeMode;
		const globalPath = activeMode === "chat"
			? (await listWorkspaces()).find((workspace) => workspace.kind === "global")?.path
			: undefined;
		// Resolve every destination before opening anything, so a missing directory is atomic.
		const targets = splitByProject(items).map((group): { group: BacklogItem[]; cwd: string; mode: SpaceMode } => {
			const cwd = group[0]?.projectDir ?? currentProject ?? globalPath;
			if (!cwd?.trim()) throw new Error(tNow("backlog.noProjectDirInMode"));
			const mode = globalPath && cwd === globalPath ? "chat" : activeMode === "chat" ? "code" : activeMode;
			return { group, cwd, mode };
		});
		for (const { group, cwd, mode } of targets) {
			const id = usePendingSession.getState().open({ cwd, mode });
			fillIdeasIntoComposer(id, group);
			draftIds.push(id);
		}
		selectSessionOrDraft(draftIds[0]);
		useComposer.getState().focusComposer(draftIds[0]);
		return { draftIds, error: null };
	} catch (error) {
		// open() selects locally; a partial failure must keep the source view and all prepared input.
		usePendingSession.getState().select(previousDraftId);
		const message = errMsg(error);
		return {
			draftIds,
			error: draftIds.length > 0
				? tNow("backlog.openDraftPartialFailed", { count: draftIds.length, error: message })
				: message,
		};
	}
}
