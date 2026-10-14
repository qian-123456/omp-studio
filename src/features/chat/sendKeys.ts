/** [B] Composer send-key and follow-up decisions. Pure: no React, no stores. */

/** `enter`: Enter sends, Shift+Enter newline. `mod-enter`: ⌘/Ctrl+Enter sends, Enter newline. */
export type SendShortcut = "enter" | "mod-enter";
/** What a send does while a turn is running. */
export type FollowUpBehavior = "steer" | "queue" | "interrupt";
/** Effective action for one send. `send` = plain prompt (no turn running). */
export type FollowUpAction = "send" | "steer" | "queue" | "interrupt";
/** Result of a keydown: `newline`/`ignore` leave the event to the textarea. */
export type EnterDecision = "newline" | "send" | "send-alternate" | "ignore";

export const DEFAULT_SEND_SHORTCUT: SendShortcut = "enter";
export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = "steer";

export interface EnterKeyEvent {
	key: string;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	isComposing: boolean;
}

export function normalizeSendShortcut(value: unknown): SendShortcut {
	return value === "mod-enter" ? "mod-enter" : DEFAULT_SEND_SHORTCUT;
}

export function normalizeFollowUpBehavior(value: unknown): FollowUpBehavior {
	return value === "queue" || value === "interrupt" || value === "steer"
		? value
		: DEFAULT_FOLLOW_UP_BEHAVIOR;
}

/** Map an Enter keydown to the send decision for the given shortcut mode.
 * Alt (⌥) selects the alternate follow-up; IME composition never sends. */
export function decideEnterKey(ev: EnterKeyEvent, shortcut: SendShortcut): EnterDecision {
	if (ev.key !== "Enter" || ev.isComposing) return "ignore";
	const mod = ev.metaKey || ev.ctrlKey;
	if (shortcut === "mod-enter") {
		if (!mod) return "newline";
		return ev.altKey ? "send-alternate" : "send";
	}
	// enter mode: Shift+Enter is a newline unless ⌘/Ctrl is held.
	if (!mod && ev.shiftKey) return "newline";
	return ev.altKey ? "send-alternate" : "send";
}

/** Effective follow-up action. Without a running turn every send is a plain
 * send; `alternate` swaps steer↔queue and maps interrupt→queue. */
export function resolveFollowUpAction(
	behavior: FollowUpBehavior,
	alternate: boolean,
	streaming: boolean,
): FollowUpAction {
	if (!streaming) return "send";
	if (alternate) return behavior === "queue" ? "steer" : "queue";
	return behavior;
}

/** Chinese UI label for what a follow-up action does. */
export const FOLLOW_UP_LABEL: Record<FollowUpAction, string> = {
	send: "发送消息",
	steer: "引导当前回合",
	queue: "本回合结束后发送",
	interrupt: "打断并发送",
};

/** Shortcut that triggers the alternate follow-up, for hint text. */
export function alternateShortcutHint(shortcut: SendShortcut): string {
	return shortcut === "mod-enter" ? "⌥⌘Enter" : "⌥Enter";
}
