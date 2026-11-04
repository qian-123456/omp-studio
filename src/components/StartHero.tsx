import { useState } from "react";
import { greetingKeyFor } from "../lib/greeting";
import { useT } from "../stores/language";

/** Flat clean background; soft gradient glow removed per user design preference. */
export function StartGlow() {
	return null;
}

/** Time-of-day greeting headline; picked once on mount so it never flips mid-use. */
export function StartHero() {
	const { t } = useT();
	const [greetingKey] = useState(() => greetingKeyFor(new Date().getHours()));
	const greeting = t(greetingKey);
	return (
		<h1 className="start-rise w-full px-6 pt-6 pb-6 text-center text-[26px] font-semibold tracking-[-0.02em] text-[var(--text)]">
			{greeting}
		</h1>
	);
}
