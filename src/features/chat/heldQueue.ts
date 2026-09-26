/** [B] Held queue: messages typed while a turn streams, persisted to
 * localStorage per session. Sent (merged or one-by-one) after the turn ends. */

import { create } from "zustand";

export interface HeldItem {
	id: string;
	text: string;
}

let nextHeldId = 1;
export function generateHeldId(): string {
	return `held-${Date.now()}-${nextHeldId++}-${Math.random().toString(36).slice(2, 7)}`;
}

const KEY = (sid: string) => `ompws-held:${sid}`;

const storage = {
	load(sid: string): HeldItem[] {
		try {
			if (typeof localStorage === "undefined") return [];
			const raw = localStorage.getItem(KEY(sid));
			const arr = raw ? (JSON.parse(raw) as unknown) : [];
			if (!Array.isArray(arr)) return [];
			return arr
				.filter(
					(item): item is string | HeldItem =>
						typeof item === "string" ||
						(typeof item === "object" &&
							item !== null &&
							typeof (item as HeldItem).text === "string"),
				)
				.map((item) =>
					typeof item === "string"
						? { id: generateHeldId(), text: item }
						: {
								id:
									typeof item.id === "string" && item.id
										? item.id
										: generateHeldId(),
								text: item.text,
							},
				);
		} catch {
			return [];
		}
	},
	save(sid: string, items: HeldItem[]): void {
		try {
			if (typeof localStorage === "undefined") return;
			if (items.length === 0) localStorage.removeItem(KEY(sid));
			else localStorage.setItem(KEY(sid), JSON.stringify(items));
		} catch {
			/* storage full / unavailable — non-fatal */
		}
	},
};

export interface HeldQueueState {
	/** Queued items by sessionId. */
	queues: Record<string, HeldItem[]>;
	/** Sessions whose post-turn prompt bar is dismissed ("继续暂存"). */
	dismissed: Record<string, boolean>;
	push(sid: string, text: string): void;
	update(sid: string, index: number, text: string): void;
	remove(sid: string, index: number): void;
	move(sid: string, index: number, dir: -1 | 1): void;
	clear(sid: string): void;
	/** Take all items out (returns them). */
	drain(sid: string): string[];
	setDismissed(sid: string, dismissed: boolean): void;
}

export const useHeldQueue = create<HeldQueueState>((set, get) => {
	const write = (sid: string, items: HeldItem[]) =>
		set((s) => {
			storage.save(sid, items);
			return {
				queues: { ...s.queues, [sid]: items },
				dismissed: { ...s.dismissed, [sid]: false },
			};
		});
	const items = (sid: string): HeldItem[] =>
		get().queues[sid] ?? storage.load(sid);
	return {
		queues: {},
		dismissed: {},
		push: (sid, text) => {
			const t = text.trim();
			if (t) write(sid, [...items(sid), { id: generateHeldId(), text: t }]);
		},
		update: (sid, index, text) => {
			const arr = items(sid).slice();
			if (index >= 0 && index < arr.length) {
				arr[index] = { ...arr[index], text };
				write(sid, arr);
			}
		},
		remove: (sid, index) =>
			write(sid, items(sid).filter((_, i) => i !== index)),
		move: (sid, index, dir) => {
			const arr = items(sid).slice();
			const j = index + dir;
			if (index < 0 || j < 0 || index >= arr.length || j >= arr.length) return;
			[arr[index], arr[j]] = [arr[j], arr[index]];
			write(sid, arr);
		},
		clear: (sid) => write(sid, []),
		drain: (sid) => {
			const arr = items(sid);
			write(sid, []);
			return arr.map((item) => item.text);
		},
		setDismissed: (sid, dismissed) =>
			set((s) => ({ dismissed: { ...s.dismissed, [sid]: dismissed } })),
	};
});

/** Read the queue for a session (hydrates from localStorage on first touch). */
export function heldItems(sid: string): string[] {
	const list = useHeldQueue.getState().queues[sid] ?? storage.load(sid);
	return list.map((i) => i.text);
}

/** Read the queue items with stable IDs. */
export function heldQueueItems(sid: string): HeldItem[] {
	return useHeldQueue.getState().queues[sid] ?? storage.load(sid);
}
