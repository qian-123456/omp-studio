/** Background image GC after app start (backend throttles to once per 24h). */
import { useEffect } from "react";
import { storageImageGcAuto } from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { collectDraftTexts } from "./storageLogic";

const START_DELAY_MS = 60_000;

export function useStartupImageGc(): void {
	useEffect(() => {
		const timer = window.setTimeout(() => {
			const drafts = collectDraftTexts(useComposer.getState(), window.localStorage);
			// Older backends lack the command; the GC is best-effort, so failures stay silent.
			void storageImageGcAuto(drafts).catch(() => {});
		}, START_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, []);
}
