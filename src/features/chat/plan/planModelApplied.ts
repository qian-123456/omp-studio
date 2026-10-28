/**
 * Sessions whose process already took the shared `plan` role model during their
 * current plan-mode visit. Module-level on purpose: the composer remounts or is
 * re-targeted when the user switches sessions, and a session that was already
 * planning must not take a role value that was edited from another session.
 */
const applied = new Set<string>();

export const markPlanModelApplied = (sessionId: string): void => {
	applied.add(sessionId);
};
export const hasPlanModelApplied = (sessionId: string): boolean => applied.has(sessionId);
/** The plan-mode visit of this session ended. */
export const clearPlanModelApplied = (sessionId: string): void => {
	applied.delete(sessionId);
};
export const clearAllPlanModelApplied = (): void => applied.clear();
