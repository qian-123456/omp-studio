/** [P] Composer privacy state: per-session draft ranges (in memory) + derived highlights. */

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { privacySessionEntryIds } from "../../../lib/ipc";
import { usePrivacy } from "../../../stores/privacy";
import {
	EMPTY_DRAFT,
	computeHighlights,
	rebaseDraft,
	type Highlight,
	type PrivacyDraft,
} from "./composerPrivacy";

interface DraftStore {
	drafts: Record<string, PrivacyDraft>;
	update(sessionId: string, fn: (d: PrivacyDraft) => PrivacyDraft): void;
	reset(sessionId: string): void;
}

export const usePrivacyDrafts = create<DraftStore>((set) => ({
	drafts: {},
	update: (sessionId, fn) =>
		set((s) => ({ drafts: { ...s.drafts, [sessionId]: fn(s.drafts[sessionId] ?? EMPTY_DRAFT) } })),
	reset: (sessionId) =>
		set((s) => {
			const { [sessionId]: _removed, ...rest } = s.drafts;
			return { drafts: rest };
		}),
}));

/** Entry ids linked to the session; refreshed whenever the entry list changes. */
export function useSessionEntryIds(sessionId: string): ReadonlySet<string> {
	const entries = usePrivacy((s) => s.entries);
	const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
	useEffect(() => {
		let cancelled = false;
		privacySessionEntryIds(sessionId)
			.then((list) => {
				if (!cancelled) setIds(new Set(list));
			})
			.catch((err: unknown) => console.warn("[privacy] session entry ids failed", err));
		return () => {
			cancelled = true;
		};
	}, [sessionId, entries]);
	return ids;
}

export interface ComposerPrivacy {
	/** Draft state rebased onto the current text. */
	draft: PrivacyDraft;
	highlights: Highlight[];
	sessionEntryIds: ReadonlySet<string>;
	/** Apply a transition to the rebased draft. */
	update(fn: (d: PrivacyDraft) => PrivacyDraft): void;
	reset(): void;
}

export function useComposerPrivacy(sessionId: string, text: string): ComposerPrivacy {
	const stored = usePrivacyDrafts((s) => s.drafts[sessionId] ?? EMPTY_DRAFT);
	const updateStore = usePrivacyDrafts((s) => s.update);
	const resetStore = usePrivacyDrafts((s) => s.reset);
	const entries = usePrivacy((s) => s.entries);
	const sessionEntryIds = useSessionEntryIds(sessionId);
	const loaded = usePrivacy((s) => s.loaded);
	useEffect(() => {
		if (!loaded) void usePrivacy.getState().load().catch((err: unknown) => console.warn("[privacy] load failed", err));
	}, [loaded]);
	const draft = useMemo(() => rebaseDraft(stored, text), [stored, text]);
	// Persist the rebase so later edits diff against the latest text.
	useEffect(() => {
		if (draft !== stored) updateStore(sessionId, () => draft);
	}, [draft, stored, sessionId, updateStore]);
	const highlights = useMemo(
		() => computeHighlights({ text, draft, entries, sessionEntryIds }),
		[text, draft, entries, sessionEntryIds],
	);
	return {
		draft,
		highlights,
		sessionEntryIds,
		update: (fn) => updateStore(sessionId, (d) => fn(rebaseDraft(d, text))),
		reset: () => resetStore(sessionId),
	};
}
