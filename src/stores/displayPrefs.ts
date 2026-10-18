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
	sideChatHandback: "ompws:side-chat-handback",
} as const;

/** 「回传给父会话」: 整理成结论 (summary) or 手动选择 (select) from the side-chat selection bubble. */
export type SideChatHandbackMode = "summary" | "select";
export const DEFAULT_SIDE_CHAT_HANDBACK: SideChatHandbackMode = "summary";

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

function readHandback(): SideChatHandbackMode {
	const raw = readStorage(KEYS.sideChatHandback);
	return raw === "select" || raw === "summary" ? raw : DEFAULT_SIDE_CHAT_HANDBACK;
}

export interface DisplayPrefsState {
	/** Show the per-request stats line (「请求统计」). */
	requestStats: boolean;
	/** Which fields the stats line shows. */
	requestStatFields: RequestStatFieldPrefs;
	/** Roll the newest two lines of reasoning under 「正在思考」 while it streams. */
	thinkingPreview: boolean;
	setRequestStats(on: boolean): void;
	setRequestStatField(field: RequestStatField, on: boolean): void;
	setThinkingPreview(on: boolean): void;
	/** How a side chat hands its result back to the parent session. */
	sideChatHandback: SideChatHandbackMode;
	setSideChatHandback(mode: SideChatHandbackMode): void;
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
	sideChatHandback: readHandback(),
	setSideChatHandback: (mode) => {
		writeStorage(KEYS.sideChatHandback, mode);
		set({ sideChatHandback: mode });
	},
}));
