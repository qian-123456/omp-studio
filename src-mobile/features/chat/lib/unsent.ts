/** Unsent composer text per session id, persisted in localStorage so a refresh/switch never loses it. */

export const UNSENT_KEY = "ompm.chat.unsent";
const MAX_ENTRIES = 50;
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
export const UNSENT_DEBOUNCE_MS = 400;

type Book = Record<string, { t: string; at: number }>;

function read(storage: Storage): Book {
	try {
		const raw = storage.getItem(UNSENT_KEY);
		const v = raw ? (JSON.parse(raw) as unknown) : null;
		return v && typeof v === "object" ? (v as Book) : {};
	} catch {
		return {};
	}
}

function write(storage: Storage, book: Book, now: number): void {
	const entries = Object.entries(book).filter(([, v]) => v && typeof v.t === "string" && now - v.at < MAX_AGE_MS);
	entries.sort((a, b) => b[1].at - a[1].at);
	try {
		if (!entries.length) storage.removeItem(UNSENT_KEY);
		else storage.setItem(UNSENT_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_ENTRIES))));
	} catch {
		/* quota / private mode: unsent text is best-effort */
	}
}

const store = (): Storage | null => {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
};

export function loadUnsent(id: string, storage: Storage | null = store()): string {
	if (!storage) return "";
	return read(storage)[id]?.t ?? "";
}

/** Empty text removes the entry. */
export function saveUnsent(id: string, text: string, storage: Storage | null = store(), now = Date.now()): void {
	if (!storage) return;
	const book = read(storage);
	if (text.trim() === "") delete book[id];
	else book[id] = { t: text, at: now };
	write(storage, book, now);
}

export const clearUnsent = (id: string, storage: Storage | null = store()): void => saveUnsent(id, "", storage);
