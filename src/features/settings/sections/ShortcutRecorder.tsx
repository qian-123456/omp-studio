/**
 * Global-shortcut recorder: click → press a key combo → onCommit(accelerator).
 * Produces Tauri global-shortcut accelerator strings (e.g. "CommandOrControl+Shift+Space"),
 * the format `settings::validate` parses via `Shortcut::from_str`. Esc cancels; "" = disabled.
 */
import clsx from "clsx";
import { Keyboard, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../ui";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

const MODIFIER_CODES: Record<string, true> = {
	ShiftLeft: true,
	ShiftRight: true,
	ControlLeft: true,
	ControlRight: true,
	AltLeft: true,
	AltRight: true,
	MetaLeft: true,
	MetaRight: true,
	CapsLock: true,
	Fn: true,
};

/** Non-alphanumeric codes whose `KeyboardEvent.code` name global-hotkey parses as-is. */
const NAMED_KEY_CODES: Record<string, true> = Object.fromEntries(
	[
		"Space",
		"Enter",
		"Tab",
		"Backspace",
		"Delete",
		"Insert",
		"Home",
		"End",
		"PageUp",
		"PageDown",
		"ArrowUp",
		"ArrowDown",
		"ArrowLeft",
		"ArrowRight",
		"Backquote",
		"Backslash",
		"BracketLeft",
		"BracketRight",
		"Comma",
		"Equal",
		"Minus",
		"Period",
		"Quote",
		"Semicolon",
		"Slash",
	].map((k) => [k, true]),
);

/** KeyboardEvent.code → accelerator key token (global-hotkey `parse_key` names). */
export function codeToKey(code: string): string | null {
	if (!code || MODIFIER_CODES[code]) return null;
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit[0-9]$/.test(code)) return code.slice(5);
	if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
	if (NAMED_KEY_CODES[code] || /^Numpad[0-9]$/.test(code)) return code;
	return null;
}

/** Build an accelerator from a keydown, or null if the combo isn't usable. */
export function eventToAccelerator(e: {
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}, mac = IS_MAC): string | null {
	const key = codeToKey(e.code);
	if (!key) return null;
	const mods: string[] = [];
	if (mac) {
		if (e.metaKey) mods.push("CommandOrControl");
		if (e.ctrlKey) mods.push("Control");
	} else {
		if (e.ctrlKey) mods.push("CommandOrControl");
		if (e.metaKey) mods.push("Super");
	}
	if (e.altKey) mods.push("Alt");
	if (e.shiftKey) mods.push("Shift");
	// A bare letter would hijack normal typing system-wide; only F-keys may stand alone.
	if (mods.length === 0 && !/^F\d+$/.test(key)) return null;
	return [...mods, key].join("+");
}

const KEY_GLYPHS: Record<string, string> = {
	SPACE: "Space",
	ENTER: "↩",
	RETURN: "↩",
	TAB: "⇥",
	BACKSPACE: "⌫",
	DELETE: "⌦",
	ESCAPE: "⎋",
	ARROWUP: "↑",
	UP: "↑",
	ARROWDOWN: "↓",
	DOWN: "↓",
	ARROWLEFT: "←",
	LEFT: "←",
	ARROWRIGHT: "→",
	RIGHT: "→",
	BACKQUOTE: "`",
	BACKSLASH: "\\",
	BRACKETLEFT: "[",
	BRACKETRIGHT: "]",
	COMMA: ",",
	EQUAL: "=",
	MINUS: "-",
	PERIOD: ".",
	QUOTE: "'",
	SEMICOLON: ";",
	SLASH: "/",
};

/** Human display for an accelerator string, e.g. "CommandOrControl+Shift+Space" → "⌘⇧Space". */
export function formatAccelerator(acc: string, mac = IS_MAC): string {
	const parts = acc
		.split("+")
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return "";
	let cmd = false;
	let ctrl = false;
	let alt = false;
	let shift = false;
	let sup = false;
	const keys: string[] = [];
	for (const p of parts) {
		const u = p.toUpperCase();
		if (["COMMANDORCONTROL", "CMDORCTRL", "COMMANDORCTRL", "CMDORCONTROL"].includes(u)) {
			if (mac) cmd = true;
			else ctrl = true;
		} else if (["CMD", "COMMAND", "SUPER", "META"].includes(u)) {
			if (mac) cmd = true;
			else sup = true;
		} else if (["CTRL", "CONTROL"].includes(u)) ctrl = true;
		else if (["ALT", "OPTION"].includes(u)) alt = true;
		else if (u === "SHIFT") shift = true;
		else {
			const stripped = u.replace(/^KEY(?=[A-Z]$)/, "").replace(/^DIGIT(?=[0-9]$)/, "");
			keys.push(KEY_GLYPHS[stripped] ?? (stripped.length === 1 ? stripped : p));
		}
	}
	if (mac) {
		return `${ctrl ? "⌃" : ""}${alt ? "⌥" : ""}${shift ? "⇧" : ""}${cmd ? "⌘" : ""}${keys.join("")}`;
	}
	return [ctrl && "Ctrl", sup && "Win", alt && "Alt", shift && "Shift", ...keys].filter(Boolean).join("+");
}

export function ShortcutRecorder({
	value,
	defaultValue,
	onCommit,
}: {
	value: string;
	defaultValue: string;
	onCommit: (next: string) => void;
}) {
	const [recording, setRecording] = useState(false);
	const [hint, setHint] = useState<string | null>(null);

	useEffect(() => {
		if (!recording) return;
		const onKey = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			if (e.code === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
				setRecording(false);
				setHint(null);
				return;
			}
			if (MODIFIER_CODES[e.code]) {
				// Echo held modifiers so the user sees the combo forming.
				const held = IS_MAC
					? `${e.ctrlKey ? "⌃" : ""}${e.altKey ? "⌥" : ""}${e.shiftKey ? "⇧" : ""}${e.metaKey ? "⌘" : ""}`
					: [e.ctrlKey && "Ctrl", e.metaKey && "Win", e.altKey && "Alt", e.shiftKey && "Shift"]
							.filter(Boolean)
							.join("+");
				setHint(held ? `${held} + 再按一个键` : null);
				return;
			}
			const acc = eventToAccelerator(e);
			if (!acc) {
				setHint("需要配合 ⌘ / ⌃ / ⌥ / ⇧ 等修饰键");
				return;
			}
			setRecording(false);
			setHint(null);
			if (acc !== value) onCommit(acc);
		};
		const onBlur = () => setRecording(false);
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("blur", onBlur);
		};
	}, [recording, value, onCommit]);

	const display = value ? formatAccelerator(value) : "";
	return (
		<div className="flex items-center gap-2">
			<button
				type="button"
				aria-label="录制全局快捷键"
				data-shortcut-recording={recording ? "" : undefined}
				title={value ? `当前：${value}` : undefined}
				onClick={() => {
					setHint(null);
					setRecording((r) => !r);
				}}
				className={clsx(
					"inline-flex h-7 min-w-[140px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs transition-all",
					recording
						? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] font-medium"
						: "hairline bg-[var(--well-bg)] text-[var(--text)] hover:bg-[var(--bg-hover)]",
				)}
			>
				<Keyboard className="h-3.5 w-3.5 opacity-70" />
				{recording ? (
					<span>{hint ?? "请按下组合键，Esc 取消"}</span>
				) : display ? (
					<span className="font-mono tracking-wide">{display}</span>
				) : (
					<span className="text-[var(--text-dim)]">未设置，点击录制</span>
				)}
			</button>
			{value && !recording && <IconButton icon={X} label="清除快捷键" title="清除快捷键（停用）" onClick={() => onCommit("")} />}
			{value !== defaultValue && !recording && (
				<IconButton
					icon={RotateCcw}
					label="恢复默认快捷键"
					title={`恢复默认快捷键（${formatAccelerator(defaultValue)}）`}
					onClick={() => onCommit(defaultValue)}
				/>
			)}
		</div>
	);
}
