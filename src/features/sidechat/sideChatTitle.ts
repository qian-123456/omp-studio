/** Stable display names for side chats: 「侧边对话1」, 「侧边对话2」… per parent session. */

import type { SessionMeta } from "../../lib/contracts";
import { compareSessionLabels } from "./labelSort";

type SideChatLike = Pick<SessionMeta, "id" | "parentId" | "createdAt" | "label"> &
	Partial<Pick<SessionMeta, "kind">>;

/** Creation order: createdAt, then natural label order, then id (total, stable). */
function compareCreation(a: SideChatLike, b: SideChatLike): number {
	if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
	return compareSessionLabels(a.label, b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Display title of side chat `sessionId`, numbered by creation order among the
 * side chats of the same parent. Closing a tab never renumbers (only existing
 * sessions count). Returns null when the session is not a side chat of a parent.
 */
export function sideChatTitle(
	sessionId: string,
	sessions: Readonly<Record<string, SideChatLike>>,
): string | null {
	const self = sessions[sessionId];
	if (!self?.parentId || self.kind === "fork") return null;
	const siblings = Object.values(sessions)
		.filter((s) => s.parentId === self.parentId && s.kind !== "fork")
		.sort(compareCreation);
	const index = siblings.findIndex((s) => s.id === sessionId);
	return index < 0 ? null : `侧边对话${index + 1}`;
}

/** Title of a not-yet-created side chat tab. */
export const NEW_SIDE_CHAT_TITLE = "新侧边对话";
