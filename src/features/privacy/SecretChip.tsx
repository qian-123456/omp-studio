/** [P] Privacy chip: a placeholder (or tracked real value) shown as a
 * click-to-toggle pill — 🔓 real value when revealed, 🔒 label when hidden. */
import React, { useEffect, useMemo, useState } from "react";
import type { SecretEntry } from "../../lib/contracts";
import { usePrivacy } from "../../stores/privacy";
import { useSettings } from "../settings/store";
import { resolveReveal, segmentPrivacyText } from "./render";
import { useT } from "../../stores/language";

let initialLoad: Promise<void> | null = null;

/** Chat surfaces may render before anything else touched the privacy store; load it once. */
function useEnsurePrivacyLoaded(): void {
	const loaded = usePrivacy((s) => s.loaded);
	useEffect(() => {
		if (loaded || initialLoad) return;
		initialLoad = usePrivacy
			.getState()
			.load()
			.catch((err: unknown) => {
				initialLoad = null;
				console.error("privacy load failed", err);
			});
	}, [loaded]);
}

export function SecretChip({ entry }: { entry: SecretEntry }) {
	const { t } = useT();
	const [override, setOverride] = useState<boolean | null>(null);
	const revealDefault = useSettings((s) => s.settings?.privacyRevealDefault);
	const revealed = resolveReveal(revealDefault, override);
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				setOverride(!revealed);
			}}
			title={revealed ? t("components.secretClickToHide", { placeholder: entry.placeholder }) : t("components.secretClickToShow")}
			className="mx-px inline rounded border border-[var(--line)] bg-[var(--well-bg)] px-1 align-baseline font-mono text-[0.92em] text-[var(--text-60)] transition-colors hover:text-[var(--text)]"
		>
			{revealed ? `🔓 ${entry.value}` : `🔒 ${entry.label ?? t("components.secretHidden")}`}
		</button>
	);
}

/**
 * Plain text with privacy chips. `matchValues` also chips tracked real
 * values (tool args/outputs, where restored values appear verbatim).
 */
export function PrivacyText({ text, matchValues = false }: { text: string; matchValues?: boolean }) {
	useEnsurePrivacyLoaded();
	const byPlaceholder = usePrivacy((s) => s.byPlaceholder);
	const entries = usePrivacy((s) => s.entries);
	const tracked = useMemo(() => (matchValues ? entries.filter((e) => e.track) : null), [entries, matchValues]);
	const segments = useMemo(() => segmentPrivacyText(text, byPlaceholder, tracked), [text, byPlaceholder, tracked]);
	return (
		<>
			{segments.map((s, i) =>
				s.kind === "text" ? (
					<React.Fragment key={i}>{s.text}</React.Fragment>
				) : (
					<SecretChip key={i} entry={s.entry} />
				),
			)}
		</>
	);
}

/** Markdown component for `<secret-chip>`; unknown placeholders render as plain text. */
export function MarkdownSecretChip({ children }: { children?: React.ReactNode }) {
	useEnsurePrivacyLoaded();
	const raw = typeof children === "string" ? children : React.Children.toArray(children).join("");
	const entry = usePrivacy((s) => s.byPlaceholder.get(raw));
	return entry ? <SecretChip entry={entry} /> : <>{raw}</>;
}
