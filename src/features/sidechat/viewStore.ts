/**
 * Side-chat panel view state, per parent session: which side chats are open
 * as right-panel tabs (`openTabs`, in display order) and which one is showing
 * (`openChild`). A tab id is either a real session id or a blank new-chat id
 * (`new:<n>`, no backend session until the user sends the first message).
 * Persisted so tabs survive panel collapse/expand and app restarts. Drafts of
 * blank tabs live in `useComposer.sideChatDrafts` keyed by the blank id. [LEAD]
 */

import { create } from "zustand";
import { useUi } from "../../stores/ui";
import { holdTranscript } from "../../stores/live";

const STORAGE_KEY = "omp_sidechat_open_child";
const TABS_STORAGE_KEY = "omp_sidechat_open_tabs";

/** Load a parentId -> childId map; empty and blank (never created) ids are dropped. */
function loadMap(key: string): Record<string, string> {
	try {
		if (typeof localStorage === "undefined") return {};
		const raw = localStorage.getItem(key);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === "string" && v && !isBlankTab(v)) out[k] = v;
		}
		return out;
	} catch {
		return {};
	}
}

/** Load a parentId -> childId[] map; non-string / empty / duplicate / blank ids are dropped (blank tabs hold no session and must not survive a reload). */
function loadTabs(key: string): Record<string, string[]> {
	try {
		if (typeof localStorage === "undefined") return {};
		const raw = localStorage.getItem(key);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		const out: Record<string, string[]> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (!Array.isArray(v)) continue;
			const ids = [...new Set(v.filter((x): x is string => typeof x === "string" && !!x && !isBlankTab(x)))];
			if (ids.length > 0) out[k] = ids;
		}
		return out;
	} catch {
		return {};
	}
}

function save(key: string, value: Record<string, unknown>): void {
	try {
		if (typeof localStorage === "undefined") return;
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* storage unavailable */
	}
}

/** Blank (not yet created) side-chat tab ids start with this prefix. */
export const NEW_TAB_PREFIX = "new:";

export const isBlankTab = (id: string): boolean => id.startsWith(NEW_TAB_PREFIX);

let blankSeq = 0;
/** A fresh blank tab id, unique across reloads. */
export const newBlankTabId = (): string =>
	`${NEW_TAB_PREFIX}${Date.now().toString(36)}${(blankSeq++).toString(36)}`;

/** Append `id` to `tabs` unless already present (new tabs go last). */
export function withTab(tabs: readonly string[], id: string): string[] {
	return tabs.includes(id) ? [...tabs] : [...tabs, id];
}

/** Replace tab `from` with `to` in place (blank tab bound to its new session). */
export function replaceTab(tabs: readonly string[], from: string, to: string): string[] {
	if (!tabs.includes(from)) return withTab(tabs, to);
	const swapped = tabs.map((t) => (t === from ? to : t));
	return swapped.filter((t, i) => swapped.indexOf(t) === i);
}

/**
 * Close tab `id`. If it was the active one, activate its right neighbour,
 * else its left neighbour, else none.
 */
export function closeTabResult(
	tabs: readonly string[],
	active: string | null,
	id: string,
): { tabs: string[]; active: string | null } {
	const idx = tabs.indexOf(id);
	if (idx < 0) return { tabs: [...tabs], active: active === id ? null : active };
	const next = tabs.filter((t) => t !== id);
	return {
		tabs: next,
		active: active === id ? (next[idx] ?? next[idx - 1] ?? null) : active,
	};
}

/** The tab showing for a parent: the stored active one if still open, else the first. */
export function resolveActiveTab(
	tabs: readonly string[] | undefined,
	stored: string | undefined,
): string | null {
	return stored && tabs?.includes(stored) ? stored : (tabs?.[0] ?? null);
}

export interface SideChatViewState {
	/** Active tab keyed by parent sessionId (persisted). */
	openChild: Record<string, string>;
	/** Tabs keyed by parent sessionId, display order (persisted). */
	openTabs: Record<string, string[]>;
	/** Last-used time per parent sessionId, ms (persisted). */
	usedAt: Record<string, number>;
	/** First message of a blank tab, shown as a pending bubble until it is bound (not persisted). */
	pending: Record<string, string>;
	/** Show tab `id` (opening it); `null` clears the active tab. */
	setOpenChild(parentId: string, id: string | null): void;
	/** Open a new blank tab, activate it, and return its id. */
	openBlankTab(parentId: string): string;
	/** The blank tab got its session: swap the id in place, keeping it active if it was. */
	bindTab(parentId: string, blankId: string, sessionId: string): void;
	setPending(blankId: string, text: string | null): void;
	/** Close one tab (the conversation itself is kept). Closing the last one closes the panel group. */
	closeTab(parentId: string, id: string): void;
	/** Drop view memory for removed sessions (as parent or as child tab). */
	pruneSessions(ids: readonly string[]): void;
}

/** Per-parent last-used timestamps (ms). */
const USED_STORAGE_KEY = "omp_sidechat_used_at";
/** Tab memory of a parent unused this long is forgotten. */
export const SIDECHAT_MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function loadUsed(): Record<string, number> {
	try {
		if (typeof localStorage === "undefined") return {};
		const raw = localStorage.getItem(USED_STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const out: Record<string, number> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * Drop parents unused for 30 days; parents without a timestamp (data saved before
 * timestamps existed) are stamped `now`. Returns fresh maps, input is untouched.
 */
export function expireSideChatMemory(
	openChild: Record<string, string>,
	openTabs: Record<string, string[]>,
	usedAt: Record<string, number>,
	now: number,
): {
	openChild: Record<string, string>;
	openTabs: Record<string, string[]>;
	usedAt: Record<string, number>;
} {
	const out = { openChild: { ...openChild }, openTabs: { ...openTabs }, usedAt: {} as Record<string, number> };
	for (const parent of new Set([...Object.keys(openChild), ...Object.keys(openTabs)])) {
		const t = usedAt[parent] ?? now;
		if (now - t > SIDECHAT_MEMORY_TTL_MS) {
			delete out.openChild[parent];
			delete out.openTabs[parent];
		} else out.usedAt[parent] = t;
	}
	return out;
}

function initialState(): Pick<SideChatViewState, "openChild" | "openTabs" | "usedAt"> {
	const openChild = loadMap(STORAGE_KEY);
	const openTabs = loadTabs(TABS_STORAGE_KEY);
	// Migration: a stored active child always has a tab.
	for (const [parent, child] of Object.entries(openChild)) {
		openTabs[parent] = withTab(openTabs[parent] ?? [], child);
	}
	const kept = expireSideChatMemory(openChild, openTabs, loadUsed(), Date.now());
	save(STORAGE_KEY, kept.openChild);
	save(TABS_STORAGE_KEY, kept.openTabs);
	save(USED_STORAGE_KEY, kept.usedAt);
	return kept;
}

/** Persist all three maps, stamping `parentId` as used now and expiring stale parents. */
function persist(
	s: Pick<SideChatViewState, "openChild" | "openTabs" | "usedAt">,
	parentId: string,
): Pick<SideChatViewState, "openChild" | "openTabs" | "usedAt"> {
	const now = Date.now();
	const next = expireSideChatMemory(s.openChild, s.openTabs, { ...s.usedAt, [parentId]: now }, now);
	save(STORAGE_KEY, next.openChild);
	save(TABS_STORAGE_KEY, next.openTabs);
	save(USED_STORAGE_KEY, next.usedAt);
	return next;
}

export const useSideChatView = create<SideChatViewState>((set) => ({
	...initialState(),
	pending: {},
	pruneSessions: (ids) =>
		set((s) => {
			const gone = new Set(ids);
			const dead = (parent: string) => gone.has(parent);
			const openChild: Record<string, string> = {};
			const openTabs: Record<string, string[]> = {};
			const usedAt: Record<string, number> = {};
			let changed = false;
			for (const [p, c] of Object.entries(s.openChild)) {
				if (dead(p) || gone.has(c)) changed = true;
				else openChild[p] = c;
			}
			for (const [p, tabs] of Object.entries(s.openTabs)) {
				const kept = dead(p) ? [] : tabs.filter((t) => !gone.has(t));
				if (kept.length !== tabs.length) changed = true;
				if (kept.length > 0) openTabs[p] = kept;
			}
			for (const [p, t] of Object.entries(s.usedAt)) {
				if (!dead(p)) usedAt[p] = t;
			}
			if (!changed) return s;
			save(STORAGE_KEY, openChild);
			save(TABS_STORAGE_KEY, openTabs);
			save(USED_STORAGE_KEY, usedAt);
			return { openChild, openTabs, usedAt };
		}),
	setOpenChild: (parentId, id) =>
		set((s) => {
			const openChild = { ...s.openChild };
			const openTabs = { ...s.openTabs };
			if (id) {
				openChild[parentId] = id;
				openTabs[parentId] = withTab(openTabs[parentId] ?? [], id);
			} else {
				delete openChild[parentId];
			}
			return persist({ openChild, openTabs, usedAt: s.usedAt }, parentId);
		}),
	openBlankTab: (parentId) => {
		const id = newBlankTabId();
		useSideChatView.getState().setOpenChild(parentId, id);
		return id;
	},
	bindTab: (parentId, blankId, sessionId) =>
		set((s) => {
			const openChild = { ...s.openChild };
			const openTabs = { ...s.openTabs };
			openTabs[parentId] = replaceTab(openTabs[parentId] ?? [], blankId, sessionId);
			if (openChild[parentId] === blankId) openChild[parentId] = sessionId;
			return persist({ openChild, openTabs, usedAt: s.usedAt }, parentId);
		}),
	setPending: (blankId, text) =>
		set((s) => {
			const pending = { ...s.pending };
			if (text === null) delete pending[blankId];
			else pending[blankId] = text;
			return { pending };
		}),
	closeTab: (parentId, id) => {
		let emptied = false;
		set((s) => {
			const r = closeTabResult(
				s.openTabs[parentId] ?? [],
				s.openChild[parentId] ?? null,
				id,
			);
			const openChild = { ...s.openChild };
			const openTabs = { ...s.openTabs };
			if (r.active) openChild[parentId] = r.active;
			else delete openChild[parentId];
			if (r.tabs.length > 0) openTabs[parentId] = r.tabs;
			else delete openTabs[parentId];
			emptied = r.tabs.length === 0;
			return persist({ openChild, openTabs, usedAt: s.usedAt }, parentId);
		});
		// The closed conversation's transcript becomes evictable (LRU) instead of pinned forever.
		if (!isBlankTab(id)) holdTranscript(id)();
		// Last side-chat tab closed: leave the right panel normal.
		if (emptied) useUi.getState().closeRightTab("sidechat");
	},
}));

/** Open + expand the right panel on the side-chat group (the active tab stays showing). */
export function revealSideChat(): void {
	useUi.getState().setRightTab("sidechat");
}

/** Open a blank new side-chat tab for `parentId` and reveal the panel. Returns the tab id. */
export function openNewSideChat(parentId: string): string {
	const id = useSideChatView.getState().openBlankTab(parentId);
	revealSideChat();
	return id;
}
