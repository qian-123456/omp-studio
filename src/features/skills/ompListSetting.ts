import { ompConfigList, ompConfigSet } from "../../lib/ipc";

let configWriteChain: Promise<unknown> = Promise.resolve();

export class OmpListRollbackError extends Error {
	constructor(error: unknown, rollbackError: unknown) {
		super(`${String(error)}; config rollback failed: ${String(rollbackError)}`);
		this.name = "OmpListRollbackError";
	}
}

/**
 * Shared by skills and plugin settings so their list writes cannot race.
 * A failed config read never authorizes a write. An optional follow-up (such
 * as enabling a file) runs in the same queue; failure restores the read value
 * before another list mutation can start.
 */
export function updateOmpListSetting(
	key: string,
	mutate: (current: string[]) => string[],
	afterWrite?: () => Promise<void>,
): Promise<void> {
	const run = async () => {
		const list = await ompConfigList();
		if (!list.found) {
			throw new Error(list.error || "Unable to read OMP configuration");
		}
		const entry = list.entries.find((e) => e.key === key);
		const current =
			entry && Array.isArray(entry.value)
				? entry.value.filter((v): v is string => typeof v === "string")
				: [];
		const next = mutate(current);
		const changed = next !== current;
		if (changed) await ompConfigSet(key, JSON.stringify(next));
		try {
			await afterWrite?.();
		} catch (error) {
			if (changed) {
				try {
					await ompConfigSet(key, JSON.stringify(current));
				} catch (rollbackError) {
					throw new OmpListRollbackError(error, rollbackError);
				}
			}
			throw error;
		}
	};
	const result = configWriteChain.then(run, run);
	configWriteChain = result.catch(() => undefined);
	return result;
}
