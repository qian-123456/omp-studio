/** Match a keydown against an accelerator string (grammar: see registry.ts). */
import { codeToKey } from "../settings/sections/ShortcutRecorder";

const IS_MAC =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

interface Parsed {
	meta: boolean;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	key: string;
}

/** Parse into the exact modifier set a keydown must carry; null for unusable strings. */
export function parseAccelerator(acc: string, mac = IS_MAC): Parsed | null {
	const out: Parsed = { meta: false, ctrl: false, alt: false, shift: false, key: "" };
	for (const raw of acc.split("+")) {
		const p = raw.trim();
		if (!p) continue;
		switch (p.toUpperCase()) {
			case "COMMANDORCONTROL":
			case "CMDORCTRL":
				if (mac) out.meta = true;
				else out.ctrl = true;
				break;
			case "CMD":
			case "COMMAND":
			case "SUPER":
			case "META":
				out.meta = true;
				break;
			case "CTRL":
			case "CONTROL":
				out.ctrl = true;
				break;
			case "ALT":
			case "OPTION":
				out.alt = true;
				break;
			case "SHIFT":
				out.shift = true;
				break;
			default:
				if (out.key) return null;
				out.key = p.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=[0-9]$)/, "").toUpperCase();
		}
	}
	return out.key ? out : null;
}

type KeyLike = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** True when `e` is exactly the chord `acc` (modifiers must match exactly). */
export function eventMatchesAccelerator(e: KeyLike, acc: string, mac = IS_MAC): boolean {
	if (!acc) return false;
	const p = parseAccelerator(acc, mac);
	if (!p) return false;
	const key = codeToKey(e.code);
	if (!key || key.toUpperCase() !== p.key) return false;
	return e.metaKey === p.meta && e.ctrlKey === p.ctrl && e.altKey === p.alt && e.shiftKey === p.shift;
}

/** Canonical form used to compare two accelerators for equality ("" when unusable). */
export function canonicalAccelerator(acc: string, mac = IS_MAC): string {
	const p = parseAccelerator(acc, mac);
	if (!p) return "";
	return [p.ctrl && "C", p.alt && "A", p.shift && "S", p.meta && "M", p.key].filter(Boolean).join("-");
}
