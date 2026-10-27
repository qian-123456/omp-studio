/** Pure terminal helpers: key sequences, SSE chunk decoding, reconnect policy, input batching. */

export interface KeySpec {
	id: string;
	label: string;
	seq: string;
}

/** On-screen key bar (Ctrl is a sticky modifier handled separately). */
export const TERMINAL_KEYS: readonly KeySpec[] = [
	{ id: "esc", label: "Esc", seq: "\x1b" },
	{ id: "tab", label: "Tab", seq: "\t" },
	{ id: "up", label: "↑", seq: "\x1b[A" },
	{ id: "down", label: "↓", seq: "\x1b[B" },
	{ id: "left", label: "←", seq: "\x1b[D" },
	{ id: "right", label: "→", seq: "\x1b[C" },
	{ id: "ctrl-c", label: "Ctrl+C", seq: "\x03" },
	{ id: "ctrl-d", label: "Ctrl+D", seq: "\x04" },
	{ id: "enter", label: "Enter", seq: "\r" },
];

/** Control-code for `Ctrl+<ch>`; null when the character has no control mapping. */
export function ctrlSequence(ch: string): string | null {
	if (ch.length !== 1) return null;
	const c = ch.charCodeAt(0);
	if (c >= 0x61 && c <= 0x7a) return String.fromCharCode(c - 0x60); // a-z
	if (c >= 0x41 && c <= 0x5a) return String.fromCharCode(c - 0x40); // A-Z
	if (c >= 0x5b && c <= 0x5f) return String.fromCharCode(c - 0x40); // [ \ ] ^ _
	if (ch === " " || ch === "@") return "\x00";
	if (ch === "?") return "\x7f";
	return null;
}

/**
 * Apply the sticky Ctrl modifier to typed data. Only a single typed character is
 * transformed (IME/paste strings pass through untouched).
 */
export function applyCtrl(data: string, ctrl: boolean): { data: string; consumed: boolean } {
	if (!ctrl) return { data, consumed: false };
	const seq = ctrlSequence(data);
	return seq === null ? { data, consumed: false } : { data: seq, consumed: true };
}

/** Decode one base64 `data` SSE payload into bytes. Throws on malformed input. */
export function decodeChunk(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

/** Parse the `exit` SSE payload; `null` = process ended without a code. */
export function parseExit(raw: string): number | null {
	try {
		const code = (JSON.parse(raw) as { code?: unknown }).code;
		return typeof code === "number" ? code : null;
	} catch {
		return null;
	}
}

export const MAX_RETRIES = 5;

/** Delay before reconnect attempt `attempt` (1-based); null once retries are exhausted. */
export function reconnectDelay(attempt: number): number | null {
	return attempt > MAX_RETRIES ? null : 1500 * attempt;
}

/** Terminal-limit error text from the server (429 "最多同时…"). */
export function isTerminalLimit(message: string): boolean {
	return /最多同时/.test(message);
}

/** The PTY is gone (reaped after the detach grace period or closed). */
export function isTerminalGone(status: number): boolean {
	return status === 404 || status === 410;
}

/**
 * Serialises input to the server: data pushed while a request is in flight is
 * concatenated and sent in the next request, preserving order.
 */
export class InputQueue {
	private pending = "";
	private busy = false;
	constructor(
		private readonly send: (data: string) => Promise<unknown>,
		private readonly onError: (e: unknown) => void,
	) {}
	push(data: string): void {
		this.pending += data;
		if (!this.busy) void this.drain();
	}
	clear(): void {
		this.pending = "";
	}
	private async drain(): Promise<void> {
		this.busy = true;
		try {
			while (this.pending) {
				const data = this.pending;
				this.pending = "";
				try {
					await this.send(data);
				} catch (e) {
					this.onError(e);
				}
			}
		} finally {
			this.busy = false;
		}
	}
}
