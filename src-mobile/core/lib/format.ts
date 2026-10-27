/** Small pure formatting + clipboard helpers shared by every slice. */

/** Relative time in Chinese: 刚刚 / N 分钟前 / N 小时前 / N 天前 / YYYY-MM-DD. `now` is injectable for tests. */
export function relTime(iso: string | null | undefined, now: number = Date.now()): string {
	const t = Date.parse(iso || "");
	if (!t) return "";
	const s = Math.max(0, (now - t) / 1000);
	if (s < 45) return "刚刚";
	if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
	if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
	if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
	const d = new Date(t);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Elapsed milliseconds as "3s" / "2m 05s" / "1h 02m". */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	if (total < 60) return `${total}s`;
	const m = Math.floor(total / 60);
	if (total < 3600) return `${m}m ${String(total % 60).padStart(2, "0")}s`;
	return `${Math.floor(total / 3600)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Compact token / byte style counts: 950 → "950", 12_300 → "12.3k". */
export function compactNumber(n: number): string {
	if (!Number.isFinite(n)) return "";
	const abs = Math.abs(n);
	if (abs < 1000) return String(Math.round(n));
	if (abs < 1_000_000) return `${(n / 1000).toFixed(abs < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Last path segment of a directory, for compact labels. */
export function baseName(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, "");
	const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return i >= 0 ? trimmed.slice(i + 1) || trimmed : trimmed;
}

/** Display name of a session: custom title → label → "未命名". */
export function sessionName(s: { title?: string; label?: string } | null | undefined): string {
	return s ? (s.title || s.label || "未命名").trim() : "";
}

/** Copy text to the clipboard; falls back to execCommand on insecure (http LAN) origins. */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* fall through to the legacy path */
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
		document.body.appendChild(ta);
		ta.select();
		ta.setSelectionRange(0, text.length);
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}
