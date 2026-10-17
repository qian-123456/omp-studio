import { create } from "zustand";

/** Fields of the per-request stats line, in display order. */
export const REQUEST_STAT_FIELD_IDS = [
	"time",
	"input",
	"output",
	"cache",
	"ttft",
	"tps",
	"duration",
	"cost",
] as const;
export type RequestStatField = (typeof REQUEST_STAT_FIELD_IDS)[number];
export type RequestStatFieldPrefs = Record<RequestStatField, boolean>;

/** Same defaults as the omp TUI: the six TUI fields on, duration/cost off. */
export const DEFAULT_REQUEST_STAT_FIELDS: RequestStatFieldPrefs = {
	time: true,
	input: true,
	output: true,
	cache: true,
	ttft: true,
	tps: true,
	duration: false,
	cost: false,
};

const KEYS = {
	requestStats: "ompws:request-stats",
	requestStatFields: "ompws:request-stat-fields",
	thinkingPreview: "ompws:thinking-preview",
} as const;

function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* storage unavailable */
	}
}

function readBool(key: string, fallback: boolean): boolean {
	const raw = readStorage(key);
	if (raw === "1") return true;
	if (raw === "0") return false;
	return fallback;
}

function readFields(): RequestStatFieldPrefs {
	const out = { ...DEFAULT_REQUEST_STAT_FIELDS };
	const raw = readStorage(KEYS.requestStatFields);
	if (!raw) return out;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			for (const id of REQUEST_STAT_FIELD_IDS) {
				const v = (parsed as Record<string, unknown>)[id];
				if (typeof v === "boolean") out[id] = v;
			}
		}
	} catch {
		/* malformed value: keep defaults */
	}
	return out;
}

export interface DisplayPrefsState {
	/** Show the per-request stats line (「请求统计」). */
	requestStats: boolean;
	/** Which fields the stats line shows. */
	requestStatFields: RequestStatFieldPrefs;
	/** Show the 2-line thinking preview under 「思考了 N 秒」. */
	thinkingPreview: boolean;
	setRequestStats(on: boolean): void;
	setRequestStatField(field: RequestStatField, on: boolean): void;
	setThinkingPreview(on: boolean): void;
}

/** Local display preferences, persisted per machine in localStorage (like font size). */
export const useDisplayPrefs = create<DisplayPrefsState>((set, get) => ({
	requestStats: readBool(KEYS.requestStats, true),
	requestStatFields: readFields(),
	thinkingPreview: readBool(KEYS.thinkingPreview, true),
	setRequestStats: (on) => {
		writeStorage(KEYS.requestStats, on ? "1" : "0");
		set({ requestStats: on });
	},
	setRequestStatField: (field, on) => {
		const next = { ...get().requestStatFields, [field]: on };
		writeStorage(KEYS.requestStatFields, JSON.stringify(next));
		set({ requestStatFields: next });
	},
	setThinkingPreview: (on) => {
		writeStorage(KEYS.thinkingPreview, on ? "1" : "0");
		set({ thinkingPreview: on });
	},
}));
