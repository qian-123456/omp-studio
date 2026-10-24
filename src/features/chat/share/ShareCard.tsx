import { forwardRef } from "react";
import { Markdown } from "../../../components/Markdown";
import { useT } from "../../../stores/language";
import type { ShareEntry } from "./shareEntries";

/** Fixed export width in CSS px; the PNG is rendered at 2x this. */
export const SHARE_CARD_WIDTH = 760;

/**
 * Static, non-interactive card that gets rasterised into the shared image.
 * Rendered off-screen by `ShareImageDialog`; it uses theme variables on a solid
 * panel background so the PNG looks like the current theme.
 */
export const ShareCard = forwardRef<
	HTMLDivElement,
	{ title: string; dateLabel: string; entries: ShareEntry[] }
>(function ShareCard({ title, dateLabel, entries }, ref) {
	const { t } = useT();
	return (
		<div
			ref={ref}
			style={{ width: SHARE_CARD_WIDTH }}
			className="flex flex-col bg-[var(--bg-panel)] px-10 pb-6 pt-9 text-[var(--text)]"
		>
			<div className="mb-6 border-b border-[var(--line)] pb-4">
				<div className="text-[18px] font-semibold leading-7 tracking-tight">{title}</div>
				<div className="mt-1 text-[12px] text-[var(--text-40)]">{dateLabel}</div>
			</div>
			<div className="flex flex-col gap-5">
				{entries.map((entry) =>
					entry.role === "user" ? (
						<div key={entry.id} className="flex flex-col items-end gap-1">
							<div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[22px] bg-[var(--chat-user-bg)] px-4 py-2.5 text-[length:var(--chat-user-font-size)] leading-6">
								{entry.text}
							</div>
							{entry.imageCount > 0 && (
								<div className="text-[11px] text-[var(--text-40)]">
									{t("share.imageCount", { count: entry.imageCount })}
								</div>
							)}
						</div>
					) : (
						<div
							key={entry.id}
							className="max-w-full text-[length:var(--chat-font-size)] text-[var(--text)]"
						>
							<Markdown text={entry.text} exportMode />
						</div>
					),
				)}
			</div>
			<div className="mt-8 text-center text-[11px] text-[var(--text-30)]">{t("share.watermark")}</div>
		</div>
	);
});
