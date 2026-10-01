/** [B] Slash-input dispatch: `/name args` → registry command or omp prompt. */

import { isResumeCancelled } from "../../../lib/ensureLive";
import { errMsg } from "../../../lib/dialogs";
import { toast } from "../../../lib/toast";
import { rpcSend } from "../../../lib/ipc";
import { useComposer } from "../../../stores/composer";
import { useLive } from "../../../stores/live";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import { openSettingsTarget } from "../../settings/settingsTargets";
import { sendPrompt } from "../send";
import { findSlashCommand } from "./registry";
import { SlashAbort, type SlashContext } from "./types";

/** UI hooks the registry needs but must not wire itself. */
export interface SlashDeps {
	openModelPicker(): void;
	openThinkingPicker(): void;
	insertText(text: string): void;
}

/** Send a `/name args` line to omp as a prompt, tagging the following
 * `command_output` frames with the command name. */
export async function sendSlashPrompt(
	sessionId: string,
	text: string,
): Promise<void> {
	const name = text.trim().match(/^\/([^\s/]+)/)?.[1];
	if (name) useLive.getState().noteCommandSent(sessionId, name);
	await sendPrompt(sessionId, text);
}

export function buildSlashContext(
	sessionId: string,
	rawText: string,
	args: string,
	deps: SlashDeps,
): SlashContext {
	return {
		sessionId,
		live: useLive.getState().sessions[sessionId],
		session: useSessions.getState().sessions[sessionId],
		rawText,
		args,
		rpcSend: (command) =>
			rpcSend(sessionId, command) as Promise<Record<string, unknown>>,
		sendPromptText: (text) => sendSlashPrompt(sessionId, text),
		pushOutput: (command, text) =>
			useLive.getState().addCommandOutput(sessionId, command, text),
		insertText: deps.insertText,
		openModelPicker: deps.openModelPicker,
		openThinkingPicker: deps.openThinkingPicker,
		openSettingsTarget,
		openSettings: () => useUi.getState().openSettings(),
	};
}

/**
 * Run `/name args` input against the registry.
 * - "handled": the command ran (success or surfaced error) — caller clears.
 * - "keep": usage-hint abort or cancelled dialog — keep the draft.
 * - null: not a registry command — the caller sends it to omp as a prompt.
 */
export async function runSlashInput(
	sessionId: string,
	input: string,
	deps: SlashDeps,
): Promise<"handled" | "keep" | null> {
	const trimmed = input.trim();
	const m = /^\/([^\s/]+)(?:\s+(.*))?$/s.exec(trimmed);
	if (!m) return null;
	const def = findSlashCommand(m[1]);
	if (!def) return null;

	const ctx = buildSlashContext(sessionId, trimmed, m[2] ?? "", deps);
	try {
		await def.run(ctx);
	} catch (err) {
		// SlashAbort = "usage hint shown, keep the draft"; a cancelled resume
		// dialog also leaves the composer untouched.
		if (err instanceof SlashAbort || isResumeCancelled(err)) return "keep";
		toast.error(`/${def.name} 失败: ${errMsg(err)}`);
		return "keep";
	}
	useComposer.getState().pushHistory(trimmed);
	return "handled";
}
