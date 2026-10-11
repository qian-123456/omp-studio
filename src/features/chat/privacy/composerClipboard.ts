/**
 * Clipboard actions for the composer textarea. Edits go through native input
 * events so React's controlled `onChange` and the browser undo stack stay in sync.
 */

import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { copyText } from "../../../lib/dialogs";

export type ClipAction = "cut" | "copy" | "paste" | "selectAll";

/** Replace the current selection with `value` as a user edit (fires `input`). */
export function replaceSelection(ta: HTMLTextAreaElement, value: string): void {
	ta.focus();
	let done = false;
	try {
		done = document.execCommand(value === "" ? "delete" : "insertText", false, value === "" ? undefined : value);
	} catch {
		done = false;
	}
	if (done) return;
	// execCommand unavailable: mutate then notify React/listeners manually.
	ta.setRangeText(value, ta.selectionStart, ta.selectionEnd, "end");
	ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: value === "" ? "deleteByCut" : "insertFromPaste" }));
}

async function readClipboard(): Promise<string> {
	try {
		return await navigator.clipboard.readText();
	} catch {
		return await readText();
	}
}

export async function runClipboardAction(ta: HTMLTextAreaElement, action: ClipAction): Promise<void> {
	const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
	try {
		switch (action) {
			case "selectAll":
				ta.focus();
				ta.select();
				return;
			case "copy":
				if (selected) await copyText(selected);
				return;
			case "cut":
				if (!selected) return;
				await copyText(selected);
				replaceSelection(ta, "");
				return;
			case "paste": {
				const clip = await readClipboard();
				if (clip) replaceSelection(ta, clip);
				return;
			}
		}
	} catch {
		// Clipboard denied/unavailable: leave the draft untouched.
	}
}
