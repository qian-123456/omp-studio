/** Desktop `capsuleVisible` setting (via `GET /left/settings/desktop`), cached so every chat open reuses it. */
import { useEffect, useState } from "react";
import { api } from "../../core/api";

const TTL_MS = 60_000;
let cached: { value: boolean; at: number } | null = null;
let inflight: Promise<boolean> | null = null;

/** Resolves to the setting; a failed read defaults to visible and is not cached. */
export function loadCapsuleVisible(now: number = Date.now()): Promise<boolean> {
	if (cached && now - cached.at < TTL_MS) return Promise.resolve(cached.value);
	inflight ??= api<{ capsuleVisible?: boolean }>("GET", "/left/settings/desktop")
		.then((r) => {
			const value = r?.capsuleVisible !== false;
			cached = { value, at: Date.now() };
			return value;
		})
		.catch(() => true)
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

export function resetCapsuleVisibleCache(): void {
	cached = null;
	inflight = null;
}

export function useCapsuleVisible(): boolean {
	const [visible, setVisible] = useState<boolean | null>(cached?.value ?? null);
	useEffect(() => {
		let alive = true;
		void loadCapsuleVisible().then((v) => alive && setVisible(v));
		return () => {
			alive = false;
		};
	}, []);
	return visible === true;
}
