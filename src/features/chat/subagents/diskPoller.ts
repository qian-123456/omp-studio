/**
 * Shared on-disk subagent list per parent session file.
 *
 * `subagentList` re-reads the parent's subagent transcripts on the Rust side, so
 * every hook consumer (TopCapsule, MessageList, ...) must share ONE poll per
 * parent file instead of each running its own timer.
 *
 * Polling continues while any consumer reports the parent turn as active
 * (working / external) OR while the latest list still has a running subagent
 * (subagents routinely outlive the parent turn). Otherwise the timer stops; no
 * idle timers remain.
 */

import type { SubagentSummary } from "../../../lib/contracts";
import { subagentList } from "../../../lib/ipc";

export const DISK_POLL_MS = 3000;

type Listener = (list: SubagentSummary[]) => void;

interface Entry {
	listeners: Map<Listener, boolean>; // listener → parent turn active
	last: SubagentSummary[] | null;
	timer: number | undefined;
	inflight: boolean;
	dirty: boolean;
	dead: boolean;
}

const entries = new Map<string, Entry>();

function shouldPoll(e: Entry): boolean {
	if ([...e.listeners.values()].some(Boolean)) return true;
	return e.last?.some((s) => s.status === "running") ?? false;
}

function fetchNow(file: string, e: Entry): void {
	clearTimeout(e.timer);
	e.timer = undefined;
	e.inflight = true;
	e.dirty = false;
	subagentList(file)
		.then((list) => {
			if (e.dead) return;
			e.last = list;
			for (const l of [...e.listeners.keys()]) l(list);
		})
		.catch(() => {})
		.finally(() => {
			e.inflight = false;
			if (e.dead) return;
			if (e.dirty) fetchNow(file, e);
			else if (shouldPoll(e)) e.timer = window.setTimeout(() => fetchNow(file, e), DISK_POLL_MS);
		});
}

/** Ask for a fresh list now (coalesced with an in-flight fetch). */
function request(file: string, e: Entry): void {
	if (e.inflight) e.dirty = true;
	else fetchNow(file, e);
}

export interface DiskSubscription {
	/** Report whether the parent turn is active; a change triggers one refresh. */
	setParentActive(active: boolean): void;
	unsubscribe(): void;
}

export function subscribeDiskSubagents(
	file: string,
	listener: Listener,
	parentActive: boolean,
): DiskSubscription {
	let e = entries.get(file);
	const isNew = !e;
	if (!e) {
		e = {
			listeners: new Map(),
			last: null,
			timer: undefined,
			inflight: false,
			dirty: false,
			dead: false,
		};
		entries.set(file, e);
	}
	const entry = e;
	entry.listeners.set(listener, parentActive);
	if (isNew) {
		fetchNow(file, entry);
	} else if (entry.last) {
		listener(entry.last);
		// A newly active consumer on an idle entry restarts polling.
		if (parentActive && !entry.timer && !entry.inflight) fetchNow(file, entry);
	}
	return {
		setParentActive(active) {
			if (entry.dead || entry.listeners.get(listener) === active) return;
			entry.listeners.set(listener, active);
			request(file, entry);
		},
		unsubscribe() {
			entry.listeners.delete(listener);
			if (entry.listeners.size > 0 || entry.dead) return;
			entry.dead = true;
			clearTimeout(entry.timer);
			if (entries.get(file) === entry) entries.delete(file);
		},
	};
}
