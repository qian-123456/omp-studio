import { Bug, Lightbulb } from "lucide-react";
import type { BacklogKind } from "../../lib/contracts";

/** Solid accent-filled pill action; `--accent` is the theme's primary fill. */
export const PILL_PRIMARY =
	"inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1 text-[11px] font-medium text-[var(--bg)] shadow-sm transition-all hover:bg-[var(--accent-hover)] active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-dim)] disabled:shadow-none disabled:active:scale-100";

/** Bordered secondary pill action. */
export const PILL_OUTLINE =
	"inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-divider)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40";

/** Destructive bordered pill. */
export const PILL_DANGER =
	"inline-flex shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--status-error)] transition-colors hover:bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)]";

/** Green solid pill (标记完成). */
export const PILL_SUCCESS =
	"inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--status-success)] px-3 py-1 text-[11px] font-medium text-[var(--bg)] shadow-sm transition-all hover:brightness-110 active:scale-95";

/** Round icon button used for row actions and header toggles. */
export const ROUND_ICON =
	"inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]";

/** Small non-interactive chip. */
export const CHIP =
	"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium";

export const TONE_ERROR = "bg-[color-mix(in_srgb,var(--status-error)_14%,transparent)] text-[var(--status-error)]";
export const TONE_WARNING = "bg-[color-mix(in_srgb,var(--status-warning)_14%,transparent)] text-[var(--status-warning)]";
export const TONE_SUCCESS = "bg-[color-mix(in_srgb,var(--status-success)_14%,transparent)] text-[var(--status-success)]";
export const TONE_NEUTRAL = "bg-[var(--bg-hover)] text-[var(--text-muted)]";

export const KIND_META: Record<BacklogKind, { labelKey: string; icon: typeof Lightbulb; tone: string }> = {
	bug: { labelKey: "backlog.kindBug", icon: Bug, tone: TONE_ERROR },
	idea: { labelKey: "backlog.kindIdea", icon: Lightbulb, tone: TONE_WARNING },
};

export const KINDS: BacklogKind[] = ["bug", "idea"];
