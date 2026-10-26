import { tNow } from "../../stores/language";

/** Validate a new branch name without coupling validation to the pill components. */
export function validateBranchName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	if (trimmed.endsWith("/")) return tNow("chat.pill.branchSlashEnd");
	if (trimmed.startsWith("/")) return tNow("chat.pill.branchSlashStart");
	if (/\s/.test(trimmed)) return tNow("chat.pill.branchSpace");
	if (/[\^~:?*\[\\]/.test(trimmed)) return tNow("chat.pill.branchInvalidChar");
	if (trimmed.includes("..")) return tNow("chat.pill.branchDoubleDot");
	return null;
}
