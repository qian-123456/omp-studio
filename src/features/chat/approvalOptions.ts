/**
 * Maps the approval buttons onto omp's exact select labels. omp decides purely
 * by the selected string: [grant labels..., "Always Approve…" labels,
 * "Approve Once" | "Approve", "Approve <subject> for this session"?, "Deny"].
 */

export interface ApprovalChoices {
	once?: string;
	session?: string;
	always?: string;
	deny?: string;
}

export function resolveApprovalChoices(options: string[]): ApprovalChoices {
	const once =
		options.find((o) => o === "Approve Once") ??
		options.find((o) => o === "Approve");
	const session = options.find((o) => /^Approve .+ for this session$/.test(o));
	// Prefer the narrowest "always" scope; a directory grant is the broadest.
	const always =
		options.find((o) => o === "Always Approve File") ??
		options.find((o) => o === "Always Approve") ??
		options.find((o) => o.startsWith("Always Approve Directory: "));
	const deny = options.find((o) => o === "Deny");
	return { once, session, always, deny };
}

/** True when the element accepts typed text (so single-key shortcuts must not fire). */
export function isEditableTarget(el: EventTarget | Element | null): boolean {
	if (!(el instanceof HTMLElement)) return false;
	if (el.isContentEditable) return true;
	const tag = el.tagName;
	return tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
}
