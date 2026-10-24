/**
 * Slash-command registry types. [B]
 * Commands either run natively in the app (new session, pickers, RPC calls)
 * or are forwarded to omp as `/{name} {args}` prompts (`sendAsPrompt`), whose
 * textual replies arrive as `command_output` frames.
 */

import type { ComponentType } from "react";
import type { SettingsTarget } from "../../settings/settingsTargets";
import type { SessionLive } from "../../../stores/live";
import type { SessionMeta } from "../../../lib/contracts";

/** Stable menu-group id; the label is translated at render (`slash.group.<id>`). */
export type SlashGroup =
	| "session"
	| "model"
	| "status"
	| "integration"
	| "settings"
	| "skill"
	| "custom"
	| "extension"
	| "omp"
	| "subcommand"
	| "mcp"
	| "plugin";

/** Commands the user typed as `/name args`. Executors may throw `SlashAbort`
 * to keep the composer text (usage hints) — any other error is toasted and
 * the draft cleared. */
export class SlashAbort extends Error {}

export interface SlashContext {
	sessionId: string;
	/** Latest live state (may be undefined for offline sessions). */
	live: SessionLive | undefined;
	session: SessionMeta | undefined;
	/** Full trimmed input, `/name args` form. */
	rawText: string;
	/** Argument text after the command name. */
	args: string;
	rpcSend(command: Record<string, unknown>): Promise<Record<string, unknown>>;
	/** Send `text` as a user prompt, tagging the following command_output. */
	sendPromptText(text: string): Promise<void>;
	/** Push an app-local result block into the thread. */
	pushOutput(command: string, text: string): void;
	/** Run async work in the background as one transcript status row
	 * (running → result text / error). Returns immediately so the composer
	 * clears on Enter; validation/usage hints must happen before calling. */
	track(command: string, runningText: string, work: () => Promise<string>): void;
	/** Insert text into the composer draft (append at cursor end). */
	insertText(text: string): void;
	/** Open the composer model picker. */
	openModelPicker(): void;
	/** Open the composer thinking-level picker. */
	openThinkingPicker(): void;
	/** Open the composer context-usage popover. */
	openContextPopover(): void;
	openSettingsTarget(target: SettingsTarget): void;
	/** Open Settings without a specific target. */
	openSettings(): void;
}

/** A subcommand of a slash command (`/mcp enable <name>`). */
export interface SlashSubcommand {
	name: string;
	description?: string;
	/** Argument usage after the subcommand, e.g. "<name> [--scope project|user]". */
	usage?: string;
}

export interface SlashCommandDef {
	name: string;
	aliases?: string[];
	/** Short label shown next to `/name`. */
	readonly title: string;
	/** One-line description. */
	readonly description: string;
	icon: ComponentType<{ size?: number | string; className?: string }>;
	readonly group: SlashGroup;
	/** Placeholder for the argument, e.g. "<名称>". Its presence means the
	 * command takes args: selecting it fills `/name ` instead of running. */
	readonly argHint?: string;
	/** Codex semantics: hidden unless the composer is empty apart from the
	 * slash token (or the command is being typed alone). */
	requiresEmptyComposer?: boolean;
	/** When set, the menu shows a 去设置 gear that deep-links into Settings. */
	settingsTarget?: SettingsTarget;
	/** App feature flag gating this entry (currently only "visualize"); when
	 * that feature is off the item is hidden from the menu. */
	feature?: "visualize";
	run(ctx: SlashContext): void | Promise<void>;
}
