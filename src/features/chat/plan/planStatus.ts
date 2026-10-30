/** [B] Plan-mode state published by the bundled plan extension
 * (`extension/omp-workspace-plan.ts`) as `extension_ui_request` setStatus
 * frames under `PLAN_STATUS_KEY`, plus the `/plan-action` commands the review
 * panel sends back. */

/** setStatus key the plan extension publishes its JSON state under. */
export const PLAN_STATUS_KEY = "ompws-plan";

/** One execution model choice: an omp model role and the spec it resolves to. */
export interface PlanTier {
	role: string;
	/** `provider/model[:thinking]`. */
	spec: string;
}

export interface PlanStatus {
	enabled: boolean;
	/** "planning" until a plan file exists, then "review". */
	phase: "planning" | "review";
	/** Absolute path of the plan file. */
	planFile: string | null;
	/** Same file as the model sees it (`local://<slug>-plan.md`). */
	planUrl: string | null;
	title: string | null;
	content: string | null;
	/** Body of the previous version, when the plan was revised. */
	prevContent: string | null;
	version: number;
	/** Spec of the `plan` role used while planning. */
	planModel: string | null;
	tiers: PlanTier[];
	defaultRole: string;
	contextPercent: number | null;
	/** Context is too full to keep it while executing. */
	keepDisabled: boolean;
	/** Plan the user approved; plan mode itself is off by then (`enabled: false`). */
	approved?: ApprovedPlan | null;
}

/** handoff: runs in a fresh session; executing → completed | failed in this one. */
export type ApprovedStatus = "handoff" | "executing" | "completed" | "failed";

/** Read-only snapshot of an approved plan, persisted by the extension. */
export interface ApprovedPlan {
	planFile: string | null;
	planUrl: string | null;
	title: string | null;
	content: string;
	prevContent: string | null;
	version: number;
	status: ApprovedStatus;
	/** Stop reason when `failed` ("aborted" | "error"). */
	error: string | null;
}

export const PLAN_OFF: PlanStatus = {
	enabled: false,
	phase: "planning",
	planFile: null,
	planUrl: null,
	title: null,
	content: null,
	prevContent: null,
	version: 0,
	planModel: null,
	tiers: [],
	defaultRole: "default",
	contextPercent: null,
	keepDisabled: false,
};

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function parseTiers(v: unknown): PlanTier[] {
	if (!Array.isArray(v)) return [];
	const out: PlanTier[] = [];
	for (const t of v) {
		if (!t || typeof t !== "object") continue;
		const { role, spec } = t as Record<string, unknown>;
		if (typeof role === "string" && typeof spec === "string") out.push({ role, spec });
	}
	return out;
}

const APPROVED_STATUSES: readonly ApprovedStatus[] = ["handoff", "executing", "completed", "failed"];

/** The approved plan an off status still carries, or null. */
function parseApproved(v: unknown): ApprovedPlan | null {
	if (!v || typeof v !== "object") return null;
	const o = v as Record<string, unknown>;
	const content = strOrNull(o.content);
	const status = APPROVED_STATUSES.find((s) => s === o.status);
	if (!content || !status) return null;
	return {
		planFile: strOrNull(o.planFile),
		planUrl: strOrNull(o.planUrl),
		title: strOrNull(o.title),
		content,
		prevContent: strOrNull(o.prevContent),
		version: typeof o.version === "number" ? o.version : 1,
		status,
		error: strOrNull(o.error),
	};
}
/** Parse the extension's status text; null when it is not a plan status. */
export function parsePlanStatus(text: unknown): PlanStatus | null {
	if (typeof text !== "string") return null;
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (o.v !== 1) return null;
	if (o.enabled !== true) {
		const approved = parseApproved(o.approved);
		return approved ? { ...PLAN_OFF, approved } : PLAN_OFF;
	}
	return {
		enabled: true,
		phase: o.phase === "review" ? "review" : "planning",
		planFile: strOrNull(o.planFile),
		planUrl: strOrNull(o.planUrl),
		title: strOrNull(o.title),
		content: strOrNull(o.content),
		prevContent: strOrNull(o.prevContent),
		version: typeof o.version === "number" ? o.version : 0,
		planModel: strOrNull(o.planModel),
		tiers: parseTiers(o.tiers),
		defaultRole: strOrNull(o.defaultRole) ?? "default",
		contextPercent: typeof o.contextPercent === "number" ? o.contextPercent : null,
		keepDisabled: o.keepDisabled === true,
	};
}

/** How an approved plan runs: fresh session, compacted history, or as-is. */
export type PlanExecMode = "execute" | "compact" | "keep";

/** "keep" is refused once context is nearly full; fall back to compaction. */
export function effectiveExecMode(mode: PlanExecMode, status: Pick<PlanStatus, "keepDisabled">): PlanExecMode {
	return mode === "keep" && status.keepDisabled ? "compact" : mode;
}

/** `## ` section titles of a plan body (code fences skipped), in order. */
export function planSections(md: string): string[] {
	const out: string[] = [];
	let fenced = false;
	for (const line of md.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		else if (!fenced) {
			const m = line.match(/^##\s+(.+?)\s*#*\s*$/);
			if (m) out.push(m[1]);
		}
	}
	return out;
}

/** Plan body without its leading `# title` line (the panel header shows it). */
export function planBody(md: string): string {
	return md.replace(/^\s*#\s+[^\n]*\n?/, "");
}

export interface DiffLine {
	kind: "same" | "add" | "del";
	text: string;
}

/** Line diff (LCS) from the previous plan version to the current one. */
export function diffPlanLines(before: string, after: string): DiffLine[] {
	const a = before.split("\n");
	const b = after.split("\n");
	const n = a.length;
	const m = b.length;
	const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			out.push({ kind: "same", text: a[i] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: a[i++] });
		else out.push({ kind: "add", text: b[j++] });
	}
	while (i < n) out.push({ kind: "del", text: a[i++] });
	while (j < m) out.push({ kind: "add", text: b[j++] });
	return out;
}
