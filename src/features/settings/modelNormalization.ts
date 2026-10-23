/**
 * Cross-provider model name normalization, keyword matching and context input parsing.
 */

// ── Cleaning ─────────────────────────────────────────────────────────

const DATE_SUFFIX =
	/(?:[-_@](?:\d{8}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d{4})|[-_](?:latest)|:(?:free|beta|extended|nitro|thinking|online))$/;

/** Lowercase, drop channel/vendor prefixes (`openai/`, `azure/`…) and date/variant suffixes. */
export function cleanModelId(raw: string): string {
	let s = raw.trim().toLowerCase();
	const slash = s.lastIndexOf("/");
	if (slash >= 0) s = s.slice(slash + 1);
	for (let prev = ""; prev !== s; ) {
		prev = s;
		s = s.replace(DATE_SUFFIX, "");
	}
	return s;
}

/** Fallback cluster key: cleaned id with delimiters collapsed to `-`. */
export function fallbackKey(raw: string): string {
	return cleanModelId(raw)
		.replace(/[\s_.:]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

// ── Tokenization & cluster keys ───────────────────────────────────────

/** Vendor tokens that only decorate display names. */
const VENDOR_DISPLAY: Record<string, string> = {
	claude: "Claude",
	gpt: "GPT",
	gemini: "Gemini",
	deepseek: "DeepSeek",
	qwen: "Qwen",
	o: "o",
};

/** Vendor tokens dropped from cluster keys because the model line is named by later tokens. */
const KEY_DROPPED_VENDORS = new Set(["claude", "anthropic"]);

const isNumeric = (t: string) => /^\d+$/.test(t);

/** Split a model id into lowercase tokens; consecutive numeric tokens merge into a version (`5`,`5` → `5.5`). */
export function tokenizeModelId(raw: string): string[] {
	const parts = cleanModelId(raw)
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	const out: string[] = [];
	let prevNumeric = false;
	for (const t of parts) {
		const numeric = isNumeric(t);
		if (numeric && prevNumeric) out[out.length - 1] += `.${t}`;
		else out.push(t);
		prevNumeric = numeric;
	}
	return out;
}

const isVersion = (t: string) => /^\d+(?:\.\d+)*$/.test(t);

function displayToken(t: string): string {
	if (VENDOR_DISPLAY[t]) return VENDOR_DISPLAY[t];
	if (isVersion(t) || /^\d/.test(t)) return t;
	return t[0].toUpperCase() + t.slice(1);
}

/** Cluster key and display name for a raw model id, e.g. `claude-opus-5-5` → `opus-5.5` / `Opus 5.5`. */
export function matchKey(raw: string): { key: string; name: string } {
	const all = tokenizeModelId(raw);
	if (all.length === 0) {
		const fb = fallbackKey(raw) || raw.trim();
		return { key: fb, name: fb };
	}
	const kept = all.filter((t) => !KEY_DROPPED_VENDORS.has(t));
	const tokens = kept.length > 0 ? kept : all;
	let name = "";
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		const d = displayToken(t);
		if (i === 0) name = d;
		// Hyphen-join a vendor token with a following version (GPT-5.2, Gemini-3.5).
		else name += VENDOR_DISPLAY[tokens[i - 1]] && /^\d/.test(t) ? `-${d}` : ` ${d}`;
	}
	return { key: tokens.join("-"), name };
}

// ── Rule matching ────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[b.length];
}

/**
 * Typo tolerance for words of length ≥ 4: one edit, or two substitutions when the
 * words share length and first/last letters (`oops` ↔ `opus`).
 */
function fuzzyEqual(token: string, kw: string): boolean {
	if (token.length < 4 || kw.length < 4) return false;
	const d = levenshtein(token, kw);
	if (d <= 1) return true;
	return d === 2 && token.length === kw.length && token[0] === kw[0] && token[token.length - 1] === kw[kw.length - 1];
}

/** Single-keyword predicate: substring of the cleaned id, joined token run, token substring, or near-miss token. */
function keywordHits(kw: string, cleaned: string, tokens: string[], joined: string): boolean {
	if (cleaned.includes(kw)) return true;
	const kwJoined = tokenizeModelId(kw).join("-");
	if (kwJoined && joined.includes(kwJoined)) return true;
	return tokens.some((t) => t.includes(kw) || fuzzyEqual(t, kw));
}

/** True when every `keywords` entry hits the model id (empty keywords never match). */
export function ruleMatches(rule: { keywords: readonly string[] }, rawModelId: string): boolean {
	const keywords = rule.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
	if (keywords.length === 0) return false;
	const cleaned = cleanModelId(rawModelId);
	const tokens = tokenizeModelId(rawModelId);
	const joined = tokens.join("-");
	return keywords.every((kw) => keywordHits(kw, cleaned, tokens, joined));
}

// ── Context input parsing ────────────────────────────────────────────

/**
 * Parse `300k`, `30万`, `1M`, `1.5m`, `250,000` into a token count; null when invalid.
 * A bare number below 1000 (e.g. `200`) is read as k tokens; ≥ 1000 is raw tokens.
 */
export function parseContextInput(input: string): number | null {
	const m = input
		.trim()
		.replace(/[,，_\s]/g, "")
		.match(/^(\d+(?:\.\d+)?)(k|m|万|w)?$/i);
	if (!m) return null;
	const value = Number(m[1]);
	const unit = (m[2] ?? "").toLowerCase();
	const mult = unit ? ({ k: 1e3, m: 1e6, 万: 1e4, w: 1e4 } as Record<string, number>)[unit] : value < 1000 ? 1e3 : 1;
	const n = Math.round(value * mult);
	return Number.isFinite(n) && n > 0 ? n : null;
}
