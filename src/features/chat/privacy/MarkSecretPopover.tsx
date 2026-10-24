/** [P] "标记为隐私" popover: optional label, risk warning, reject reason. */

import { useEffect, useRef, useState } from "react";
import { type Anchor, FloatingLayer } from "../../../components/FloatingLayer";
import type { PrivacyMarkScope, SecretClassification, SecretEntry } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { isComposing } from "../../../lib/hooks";
import { privacyClassify, privacyMark } from "../../../lib/ipc";
import { defaultMarkScope, needsScopeChoice } from "./composerPrivacy";
import { claimEscape } from "../../../lib/escapeClaim";
import { useT } from "../../../stores/language";

export function MarkSecretPopover({
	sessionId,
	value,
	anchor,
	onMarked,
	onClose,
}: {
	sessionId: string;
	value: string;
	anchor: Anchor;
	onMarked: (entry: SecretEntry, scope: PrivacyMarkScope) => void;
	onClose: () => void;
}) {
	const { t } = useT();
	const reasonText = (code: string | null | undefined): string | undefined => {
		switch (code) {
			case "TOO_SHORT":
				return t("chatPrivacy.reasonTooShort");
			case "INVALID_VALUE":
				return t("chatPrivacy.reasonInvalidValue");
			case "SHORT":
				return t("chatPrivacy.reasonShort");
			case "COMMON":
				return t("chatPrivacy.reasonCommon");
			case "LABEL_CONTAINS_VALUE":
				return t("chatPrivacy.reasonLabelContainsValue");
			default:
				return undefined;
		}
	};
	const [cls, setCls] = useState<SecretClassification | null>(null);
	const [label, setLabel] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [track, setTrack] = useState(true);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let cancelled = false;
		privacyClassify(sessionId, value)
			.then((c) => {
				if (!cancelled) setCls(c);
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(errMsg(err));
			});
		return () => {
			cancelled = true;
		};
	}, [sessionId, value]);

	useEffect(() => {
		if (cls && cls.level !== "reject") inputRef.current?.focus();
	}, [cls]);

	const confirm = async (scope: PrivacyMarkScope) => {
		if (saving || !cls || cls.level === "reject") return;
		setSaving(true);
		setError(null);
		try {
			const trimmed = label.trim();
			const entry = await privacyMark(sessionId, value, trimmed ? trimmed : null, track, scope);
			onMarked(entry, scope);
		} catch (err) {
			const msg = errMsg(err);
			setError(reasonText(msg) ?? msg);
		} finally {
			setSaving(false);
		}
	};

	const sent = cls !== null && needsScopeChoice(cls.sessionOccurrences);
	const shown = value.length > 24 ? `${value.slice(0, 24)}…` : value;
	const btn =
		"rounded-md px-2.5 py-1 text-[12px] transition-colors disabled:opacity-50 hover:bg-[var(--ghost-hover,var(--bg-hover))]";

	return (
		<FloatingLayer
			anchor={anchor}
			placement="top-start"
			offset={6}
			onDismiss={onClose}
			className="w-[300px] rounded-xl border border-[var(--line,var(--border))] bg-[var(--bg-panel)] p-3 text-[12px] text-[var(--text)] shadow-lg"
		>
			<div className="mb-2 font-medium">{t("chatPrivacy.markSecretTitle")}</div>
			{!cls && !error && <div className="text-[var(--text-40,var(--text-dim))]">{t("chatPrivacy.checking")}</div>}
			{cls?.level === "reject" && (
				<>
					<div className="mb-2 text-red-500">
						{reasonText(cls.reason) ?? t("chatPrivacy.reasonDefaultReject")}
					</div>
					<div className="flex justify-end">
						<button type="button" className={btn} onClick={onClose}>
							{t("chatPrivacy.close")}
						</button>
					</div>
				</>
			)}
			{cls && cls.level !== "reject" && (
				<>
					<input
						ref={inputRef}
						value={label}
						placeholder={t("chatPrivacy.labelPlaceholder")}
						onChange={(e) => setLabel(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter") {
								e.preventDefault();
								void confirm(defaultMarkScope(cls.sessionOccurrences));
							} else if (e.key === "Escape") {
								claimEscape(e);
								onClose();
							}
						}}
						className="w-full rounded-md border border-[var(--line,var(--border))] bg-transparent px-2 py-1 outline-none"
					/>
					<div className="mt-1 text-[11px] text-[var(--text-40,var(--text-dim))]">
						{t("chatPrivacy.labelHint")}
					</div>
					{cls.level === "risky" && (
						<>
							<div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-600">
								{t("chatPrivacy.riskyWarning", {
									shown,
									reason: reasonText(cls.reason) ?? t("chatPrivacy.reasonShortOrCommon"),
								})}
							</div>
							<label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-40,var(--text-dim))]">
								<input type="checkbox" checked={!track} onChange={(e) => setTrack(!e.target.checked)} />
								{t("chatPrivacy.dontTrack")}
							</label>
						</>
					)}
					{sent && (
						<div className="mt-2 rounded-md bg-red-500/10 px-2 py-1.5 leading-relaxed text-red-500">
							{t("chatPrivacy.alreadySentWarning", { shown, count: cls.sessionOccurrences })}
							{t("chatPrivacy.alreadySentDetail")}
						</div>
					)}
					{error && <div className="mt-2 text-red-500">{error}</div>}
					<div className="mt-2 flex flex-wrap justify-end gap-1">
						<button type="button" className={btn} onClick={onClose}>
							{t("chatPrivacy.cancel")}
						</button>
						{sent && (
							<button type="button" className={btn} disabled={saving} onClick={() => void confirm("all")}>
								{t("chatPrivacy.replaceHistory")}
							</button>
						)}
						<button
							type="button"
							disabled={saving}
							onClick={() => void confirm(sent ? "future" : "all")}
							className="rounded-md bg-[var(--text)] px-2.5 py-1 text-[12px] text-[var(--bg-panel)] disabled:opacity-50"
						>
							{sent ? t("chatPrivacy.protectFutureOnly") : cls.level === "risky" ? t("chatPrivacy.markAnyway") : t("chatPrivacy.mark")}
						</button>
					</div>
				</>
			)}
			{!cls && error && <div className="text-red-500">{error}</div>}
		</FloatingLayer>
	);
}
