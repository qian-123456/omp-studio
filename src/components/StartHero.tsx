import { useState } from "react";
import { greetingFor } from "../lib/greeting";

/** Soft accent glow pinned to the top of a new-task screen (theme-aware). */
export function StartGlow() {
	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_70%_100%_at_top,color-mix(in_srgb,var(--accent)_14%,transparent),transparent)]"
		/>
	);
}

/** Time-of-day greeting headline; picked once on mount so it never flips mid-use. */
export function StartHero() {
	const [greeting] = useState(() => greetingFor(new Date().getHours()));
	return (
		<h1 className="start-rise w-full px-6 pt-6 pb-6 text-center text-[26px] font-semibold tracking-[-0.02em] text-[var(--text)]">
			{greeting}
		</h1>
	);
}
