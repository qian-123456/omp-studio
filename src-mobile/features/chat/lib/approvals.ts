/**
 * Batch approve: mirrors the server's `batch_response` (chat.rs) so the button only appears when
 * `POST /ui-respond-all` would actually answer at least two requests.
 */
import { pendingForm } from "../../../core/pendingUi";
import type { PendingEntry } from "../../../core/types";

const ALLOW_RE = /allow|approve/i;

/** Tool-approval select (exact omp labels) or confirm dialog — never an ask-user question. */
export function isBatchApprovable(entry: PendingEntry): boolean {
	const f = pendingForm(entry);
	if (f.method === "confirm") return true;
	if (f.method !== "select") return false;
	if (!(ALLOW_RE.test(f.title) || f.title.includes("权限") || f.title.includes("允许"))) return false;
	const raws = f.options.map((o) => o.raw);
	return (raws.includes("Approve Once") || raws.includes("Approve")) && raws.includes("Deny");
}

export function countBatchApprovable(entries: readonly PendingEntry[]): number {
	let n = 0;
	for (const e of entries) if (isBatchApprovable(e)) n++;
	return n;
}

/** The 「全部允许」 button needs at least two approvable requests. */
export const showApproveAll = (entries: readonly PendingEntry[]): boolean => countBatchApprovable(entries) >= 2;
