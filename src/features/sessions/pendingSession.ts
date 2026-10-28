/** Desktop-local new sessions. No omp process exists until the draft becomes meaningful. */

import { create } from "zustand";
import type { SessionMeta, SpaceMode } from "../../lib/contracts";
import type { CreateSessionOpts } from "../../lib/createSession";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { resolveWorkspaceIdForMode } from "./modes";
import { loadChip } from "../chat/slash/chip";

export const DRAFT_PREFIX = "local-draft:";
export const isLocalDraftId = (id: string): boolean => id.startsWith(DRAFT_PREFIX);

const STORAGE_KEY = "omp.localDrafts.v1";

export interface LocalDraft {
	id: string;
	cwd: string;
	mode: SpaceMode;
	groupId: string | null;
	opts: CreateSessionOpts;
	/** User-chosen model selector; starts as the opts model. */
	model: string | null;
	/** User-chosen thinking level; null leaves the process default untouched. */
	thinking: string | null;
	/** Prewarmed omp session owned by this draft (retained while set). */
	sessionId: string | null;
	startError: string | null;
}

interface PendingState {
	drafts: Record<string, LocalDraft>;
	/** Draft shown in the center pane while no real session is selected. */
	selectedId: string | null;
	/** Select (or create) the draft for `opts`, reusing a blank one in the same place. */
	open(opts: CreateSessionOpts): string;
	select(id: string | null): void;
	update(id: string, patch: Partial<Pick<LocalDraft, "model" | "thinking" | "startError">>): void;
	attach(id: string, sessionId: string | null): void;
	discard(id: string): void;
}

/** Composer content of a draft id: text, attachments, quotes, chip or plan mode. */
function hasComposerContent(id: string): boolean {
	const c = useComposer.getState();
	return Boolean(
		(c.drafts[id] ?? "").trim() ||
		(c.annotations[id]?.length ?? 0) ||
		(c.images[id]?.length ?? 0) ||
		(c.files[id]?.length ?? 0) ||
		loadChip(id),
	);
}

/** Model/thinking differ from what a fresh draft would start with. */
function hasChangedSettings(d: LocalDraft): boolean {
	return d.thinking !== null || d.model !== (d.opts.model ?? null);
}

/** A draft holding no user input at all (safe to reuse or release). */
export function isBlankLocalDraft(d: LocalDraft): boolean {
	return !hasComposerContent(d.id) && !hasChangedSettings(d);
}

let nextDraft = 1;

function loadPersisted(): Record<string, LocalDraft> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const list = JSON.parse(raw) as LocalDraft[];
		const out: Record<string, LocalDraft> = {};
		for (const d of list) {
			if (!d || typeof d.id !== "string" || !isLocalDraftId(d.id)) continue;
			const n = Number(d.id.slice(DRAFT_PREFIX.length));
			if (Number.isFinite(n)) nextDraft = Math.max(nextDraft, n + 1);
			// The process died with the previous run; only the input survives.
			const draft: LocalDraft = { ...d, sessionId: null, startError: null };
			if (!isBlankLocalDraft(draft)) out[d.id] = draft;
		}
		return out;
	} catch {
		return {};
	}
}

export function draftMeta(draft: LocalDraft): SessionMeta {
	const now = new Date().toISOString();
	return {
		id: draft.id, tool: "omp", file: "", cwd: draft.cwd,
		title: "", label: "", createdAt: now, updatedAt: now,
		parentId: null, forkDepth: 0, status: "idle", unread: false,
		pending: null, live: draft.sessionId !== null, externalPid: null,
		pinned: false, archived: false,
		workspaceId: draft.opts.workspaceId ??
			resolveWorkspaceIdForMode(useSessions.getState().workspaces, null, draft.cwd, draft.mode),
		repoRoot: null, git: null, result: null, lastAssistant: null,
		model: draft.model, attention: null, mode: draft.mode, groupId: draft.groupId,
		createdByApp: true,
	};
}

function matches(d: LocalDraft, opts: CreateSessionOpts): boolean {
	return d.cwd === opts.cwd && d.mode === (opts.mode ?? "code") &&
		d.groupId === (opts.groupId ?? null) &&
		(d.opts.model ?? null) === (opts.model ?? null);
}

/** Id of a blank draft already waiting in the same cwd + mode + group, if any. */
export function findBlankDraft(opts: CreateSessionOpts): string | null {
	const found = Object.values(usePendingSession.getState().drafts)
		.find((d) => matches(d, opts) && isBlankLocalDraft(d));
	return found?.id ?? null;
}

export const usePendingSession = create<PendingState>((set) => ({
	drafts: loadPersisted(), selectedId: null,
	open: (opts) => {
		const mode = opts.mode ?? "code";
		const groupId = opts.groupId ?? null;
		let id = findBlankDraft(opts);
		if (!id) {
			id = `${DRAFT_PREFIX}${nextDraft++}`;
			const draft: LocalDraft = {
				id, cwd: opts.cwd, mode, groupId, opts: { ...opts, mode, groupId },
				model: opts.model ?? null, thinking: null, sessionId: null, startError: null,
			};
			const created = id;
			set((s) => ({ drafts: { ...s.drafts, [created]: draft } }));
		}
		set({ selectedId: id });
		return id;
	},
	select: (id) => set({ selectedId: id }),
	update: (id, patch) => set((s) => s.drafts[id]
		? { drafts: { ...s.drafts, [id]: { ...s.drafts[id], ...patch } } }
		: s),
	attach: (id, sessionId) => set((s) => s.drafts[id]
		? { drafts: { ...s.drafts, [id]: { ...s.drafts[id], sessionId, startError: null } } }
		: s),
	discard: (id) => set((s) => {
		if (!s.drafts[id]) return s;
		const drafts = { ...s.drafts };
		delete drafts[id];
		return { drafts, selectedId: s.selectedId === id ? null : s.selectedId };
	}),
}));

/** Persist the surviving input (never the process) so a restart cannot lose it. */
let lastPersisted = usePendingSession.getState().drafts;
usePendingSession.subscribe((s) => {
	if (s.drafts === lastPersisted) return;
	lastPersisted = s.drafts;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.values(s.drafts)));
	} catch {
		/* storage unavailable */
	}
});

/** Row click: a draft row opens its local view; everything else is a normal selection. */
export function selectSessionOrDraft(id: string | null): void {
	if (id && isLocalDraftId(id)) {
		usePendingSession.getState().select(id);
		useUi.setState({
			selectedSessionId: null,
			selectedIds: new Set([id]),
			highlightId: id,
			centerView: "session",
		});
		return;
	}
	useUi.getState().selectSession(id);
}
