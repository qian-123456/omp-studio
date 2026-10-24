import { useSyncExternalStore } from "react";

function subscribe(cb: () => void): () => void {
	document.addEventListener("visibilitychange", cb);
	return () => document.removeEventListener("visibilitychange", cb);
}

const getSnapshot = () => document.visibilityState !== "hidden";
const getServerSnapshot = () => true;

/** False while the app window is hidden/minimised; flips back on un-hide. */
export function useDocumentVisible(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
