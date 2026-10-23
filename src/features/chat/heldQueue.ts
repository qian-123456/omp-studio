/** [B] Held queue: messages typed while a turn streams, persisted to
 * localStorage per session. Sent (merged or one-by-one) after the turn ends. */

import { useEffect } from "react";
import { create } from "zustand";
import type { ImageAttachment } from "../../lib/contracts";

export interface HeldItem {
	id: string;
	text: string;
	/** Real image attachments for this turn (markers stay in `text`). */
	images?: ImageAttachment[];
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
								...(Array.isArray(item.images) && item.images.length > 0
									? { images: item.images }
									: {}),
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
	push(sid: string, text: string, images?: ImageAttachment[]): void;
	update(sid: string, index: number, text: string): void;
	remove(sid: string, index: number): void;
	move(sid: string, index: number, dir: -1 | 1): void;
	clear(sid: string): void;
	/** Take all items out (returns them). */
	drain(sid: string): string[];
	/** Take and remove the first item (auto-send drain). */
	shift(sid: string): HeldItem | undefined;
	/** Put an item back at the head (e.g. after a failed auto-send). */
	unshift(sid: string, item: HeldItem): void;
	setDismissed(sid: string, dismissed: boolean): void;
	/** Session deleted: drop its queue (memory + localStorage) and dismissed flag. */
	pruneSessions(ids: readonly string[]): void;
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
		push: (sid, text, images) => {
			const t = text.trim();
			if (!t) return;
			const item: HeldItem = { id: generateHeldId(), text: t };
			if (images && images.length > 0) item.images = images;
			write(sid, [...items(sid), item]);
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
		shift: (sid) => {
			const arr = items(sid);
			if (arr.length === 0) return undefined;
			write(sid, arr.slice(1));
			return arr[0];
		},
		unshift: (sid, item) => write(sid, [item, ...items(sid)]),
		setDismissed: (sid, dismissed) =>
			set((s) => ({ dismissed: { ...s.dismissed, [sid]: dismissed } })),
		pruneSessions: (ids) => {
			for (const sid of ids) {
				try {
					globalThis.localStorage?.removeItem(KEY(sid));
				} catch {
					/* storage unavailable */
				}
			}
			set((s) => {
				const queues = { ...s.queues };
				const dismissed = { ...s.dismissed };
				for (const sid of ids) {
					delete queues[sid];
					delete dismissed[sid];
				}
				return { queues, dismissed };
			});
		},
	};
});

/** Read the queue for a session (hydrates from localStorage on first touch). */
export function heldItems(sid: string): string[] {
	const list = useHeldQueue.getState().queues[sid] ?? storage.load(sid);
	return list.map((i) => i.text);
}

/** Read the queue items with stable IDs. */
export function heldQueueItems(sid: string): HeldItem[] {
	return useHeldQueue.getState().queues[sid] ?? hydrate(sid);
}

const EMPTY_ITEMS: HeldItem[] = [];

/** Load `sid`'s persisted queue into the store on first access (no-op if loaded). */
export function hydrate(sid: string): HeldItem[] {
	const cur = useHeldQueue.getState().queues[sid];
	if (cur) return cur;
	const loaded = storage.load(sid);
	if (loaded.length > 0) useHeldQueue.setState((s) => ({ queues: { ...s.queues, [sid]: s.queues[sid] ?? loaded } }));
	return loaded;
}

/** Reactive queue for a session; hydrates persisted items on first use. */
export function useHeldItems(sid: string): HeldItem[] {
	useEffect(() => {
		hydrate(sid);
	}, [sid]);
	return useHeldQueue((s) => s.queues[sid]) ?? EMPTY_ITEMS;
}

/** Merge held items into one prompt. Each item numbers its images from #1,
 * so later items' markers and attachments are renumbered to stay unique. */
export function mergeHeldItems(list: HeldItem[]): {
	text: string;
	images: ImageAttachment[];
} {
	const texts: string[] = [];
	const images: ImageAttachment[] = [];
	for (const item of list) {
		const t = item.text.trim();
		if (!t) continue;
		const offset = images.length;
		texts.push(
			offset === 0
				? t
				: t.replace(/\[Image #(\d+)/g, (_m, n: string) => `[Image #${Number(n) + offset}`),
		);
		for (const img of item.images ?? []) {
			const m = /^\[Image #(\d+)\]$/.exec(img.marker ?? "");
			images.push(
				offset === 0 || !m
					? img
					: { ...img, marker: `[Image #${Number(m[1]) + offset}]` },
			);
		}
	}
	return { text: texts.join("\n\n---\n\n"), images };
}
