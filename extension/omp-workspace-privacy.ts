// omp-workspace privacy placeholders (installed + loaded by the OMP Workspace app).
// Upstream only ever sees `⟦LABEL_xxxx⟧`; real values are restored right before tool execution.
// Mapping: ~/.omp-workspace/privacy/secrets.json (written by the app, re-read on mtime change).
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type FileEntry = {
	placeholders: string[];
	current: string;
	value: string;
	track: boolean;
	wholeWord: boolean;
	/** sessionId -> epoch ms; messages older than this are left untouched for this entry. */
	cutoffs: Record<string, number>;
};
type SecretsFile = { nativeHash: string; entries: FileEntry[] };
type HookEvent = Record<string, unknown>;
type Ctx = { sessionManager?: { getSessionId?: () => string } };
type Pi = { on(event: string, handler: (event: HookEvent, ctx: Ctx) => Promise<unknown>): void };

const SECRETS_PATH =
	process.env.OMPWS_PRIVACY_FILE || join(homedir(), ".omp-workspace", "privacy", "secrets.json");
const SKIP_KEYS: Record<string, true> = {
	signature: true,
	thinkingSignature: true,
	encrypted_content: true,
	redacted: true,
};
const WORD = /[A-Za-z0-9_]/;

let cache: { mtimeMs: number; size: number; data: SecretsFile | null } | null = null;

function isEntry(v: unknown): v is FileEntry {
	if (!v || typeof v !== "object") return false;
	const e = v as Record<string, unknown>;
	return (
		Array.isArray(e.placeholders) &&
		e.placeholders.every((p) => typeof p === "string" && p.length > 0) &&
		typeof e.current === "string" &&
		typeof e.value === "string" &&
		e.value.length > 0 &&
		typeof e.track === "boolean" &&
		typeof e.wholeWord === "boolean"
	);
}

function parseCutoffs(v: unknown): Record<string, number> {
	const out: Record<string, number> = {};
	if (v && typeof v === "object" && !Array.isArray(v)) {
		for (const [k, x] of Object.entries(v)) if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
	}
	return out;
}

/** Epoch ms of an AgentMessage (`timestamp` is a number; ISO strings tolerated); null when unknown. */
function messageTime(m: unknown): number | null {
	if (!m || typeof m !== "object") return null;
	const t = (m as Record<string, unknown>).timestamp;
	if (typeof t === "number" && Number.isFinite(t)) return t;
	if (typeof t === "string") {
		const ms = Date.parse(t);
		if (Number.isFinite(ms)) return ms;
	}
	return null;
}

function sessionIdOf(ctx: Ctx | undefined): string {
	try {
		return ctx?.sessionManager?.getSessionId?.() ?? "";
	} catch {
		return "";
	}
 }

function load(): SecretsFile | null {
	let st;
	try {
		st = statSync(SECRETS_PATH);
	} catch {
		cache = null;
		return null;
	}
	if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.data;
	let data: SecretsFile | null = null;
	try {
		const raw: unknown = JSON.parse(readFileSync(SECRETS_PATH, "utf8"));
		if (raw && typeof raw === "object") {
			const o = raw as Record<string, unknown>;
			const entries: FileEntry[] = [];
			if (typeof o.nativeHash !== "string" || !Array.isArray(o.entries) || !o.entries.every(isEntry)) {
				throw new Error("Invalid privacy snapshot");
			}
			for (const e of o.entries) {
				const cutoffs = "cutoffs" in e ? parseCutoffs(e.cutoffs) : {};
				entries.push({ ...e, cutoffs });
			}
			data = { nativeHash: o.nativeHash, entries };
		}
	} catch {
		data = null;
	}
	cache = { mtimeMs: st.mtimeMs, size: st.size, data };
	return data;
}

function walk(v: unknown, f: (s: string) => string): unknown {
	if (typeof v === "string") return f(v);
	if (Array.isArray(v)) {
		let changed = false;
		const out = v.map((x) => {
			const y = walk(x, f);
			if (y !== x) changed = true;
			return y;
		});
		return changed ? out : v;
	}
	if (v && typeof v === "object") {
		const obj = v as Record<string, unknown>;
		const redactedThinking = obj.type === "redacted_thinking" || obj.redacted === true;
		let changed = false;
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(obj)) {
			if (SKIP_KEYS[k] || (redactedThinking && k === "data")) {
				out[k] = x;
				continue;
			}
			const y = walk(x, f);
			if (y !== x) changed = true;
			out[k] = y;
		}
		return changed ? out : v;
	}
	return v;
}

function restorer(entries: FileEntry[]): (s: string) => string {
	const pairs: Array<[string, string]> = [];
	for (const e of entries) for (const p of e.placeholders) pairs.push([p, e.value]);
	return (s) => {
		if (!s.includes("⟦")) return s;
		let out = s;
		for (const [p, value] of pairs) if (out.includes(p)) out = out.split(p).join(value);
		return out;
	};
}

function replaceWholeWord(s: string, value: string, repl: string): string {
	let out = "";
	let from = 0;
	let i = s.indexOf(value, 0);
	while (i >= 0) {
		const before = i > 0 ? s[i - 1] : "";
		const after = s[i + value.length] ?? "";
		if (!WORD.test(before) && !WORD.test(after)) {
			out += s.slice(from, i) + repl;
			from = i + value.length;
			i = s.indexOf(value, from);
		} else {
			i = s.indexOf(value, i + 1);
		}
	}
	return from === 0 ? s : out + s.slice(from);
}

function masker(entries: FileEntry[]): (s: string) => string {
	const tracked = entries.filter((e) => e.track).sort((a, b) => b.value.length - a.value.length);
	return (s) => {
		let out = s;
		for (const e of tracked) {
			if (!out.includes(e.value)) continue;
			out = e.wholeWord ? replaceWholeWord(out, e.value, e.current) : out.split(e.value).join(e.current);
		}
		return out;
	};
}

export default function (pi: Pi) {
	// Immutable startup coverage, not the latest requested secrets snapshot.
	const spawnNativeHash = process.env.OMPWS_PRIVACY_NATIVE_HASH ?? "";
	pi.on("tool_call", async (event) => {
		const data = load();
		if (!data || data.entries.length === 0) return undefined;
		const input = walk(event.input, restorer(data.entries));
		return input !== event.input ? { input } : undefined;
	});

	pi.on("context", async (event, ctx) => {
		const data = load();
		if (!data || !data.entries.some((e) => e.track)) return undefined;
		const sid = sessionIdOf(ctx);
		const cut = data.entries.filter((e) => e.track && sid !== "" && e.cutoffs[sid] !== undefined);
		if (cut.length === 0 || !Array.isArray(event.messages)) {
			const messages = walk(event.messages, masker(data.entries));
			return messages !== event.messages ? { messages } : undefined;
		}
		// Entries with a cutoff in this session mask only messages at/after it. A message with an
		// unknown timestamp is masked (fail closed: leaking is worse than a cache miss).
		const maskers = new Map<string, (s: string) => string>();
		let changed = false;
		const out = (event.messages as unknown[]).map((m) => {
			const t = messageTime(m);
			let key = "";
			const active: FileEntry[] = [];
			for (const e of data.entries) {
				const c = e.cutoffs[sid];
				const on = c === undefined || t === null || t >= c;
				key += on ? "1" : "0";
				if (on) active.push(e);
			}
			if (active.length === 0) return m;
			let f = maskers.get(key);
			if (!f) maskers.set(key, (f = masker(active)));
			const y = walk(m, f);
			if (y !== m) changed = true;
			return y;
		});
		return changed ? { messages: out } : undefined;
	});

	// Compaction summaries bypass `context` and are covered only by OMP's native secrets layer,
	// which is global (cannot honor per-session cutoffs, so cutoff entries are excluded from it)
	// and read at process start. Cancel when the native snapshot is stale, or when any tracked
	// entry carries a cutoff: such sessions do not auto-compact.
	pi.on("session_before_compact", async () => {
		const data = load();
		if (!data) return { cancel: true };
		if (data.entries.some((e) => e.track && Object.keys(e.cutoffs).length > 0)) return { cancel: true };
		if (data.nativeHash.startsWith("unprotected:") || spawnNativeHash.startsWith("unprotected:")) {
			return { cancel: true };
		}
		return data.nativeHash !== spawnNativeHash ? { cancel: true } : undefined;
	});
}
