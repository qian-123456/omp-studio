/**
 * Inline warning banner in Composer when current session tokens exceed
 * the target model's declared context window.
 *
 * Offers one-click switch to a larger model, compacting, and (by default)
 * switching back to the current model.
 */
import clsx from "clsx";
import { AlertTriangle, ArchiveRestore, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { ModelMenuContent } from "../../components/ModelSelect";
import type { TranscriptItem } from "../../lib/contracts";
import { type ModelOption, toModelKey } from "../../lib/models";
import { useT } from "../../stores/language";
import {
	compactTokens,
	findCandidateCompactionModel,
	findPreviousSessionModel,
} from "./contextOverflow";

export interface ContextOverflowBannerProps {
	sessionId: string;
	currentTokens: number;
	contextWindow: number;
	currentModelOption?: ModelOption | null;
	currentModelKey: string;
	models: ModelOption[] | null;
	items?: TranscriptItem[] | null;
	compacting: boolean;
	onCompactWithModel: (candidate: ModelOption, switchBack: boolean) => Promise<void>;
	onCompactCurrent: () => Promise<void>;
	highlighted?: boolean;
}

export function ContextOverflowBanner({
	currentTokens,
	contextWindow,
	currentModelKey,
	models,
	items,
	compacting,
	onCompactWithModel,
	onCompactCurrent,
	highlighted,
}: ContextOverflowBannerProps) {
	const { t } = useT();
	const [switchBack, setSwitchBack] = useState(true);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const pickerBtnRef = useRef<HTMLButtonElement>(null);

	// Automatically detect previously used model in transcript
	const previousModelKey = useMemo(
		() => findPreviousSessionModel(items, currentModelKey),
		[items, currentModelKey],
	);

	// Recommended candidate model whose context window >= currentTokens
	const defaultCandidate = useMemo(
		() =>
			findCandidateCompactionModel({
				models,
				currentTokens,
				previousModelKey,
				currentModelKey,
			}),
		[models, currentTokens, previousModelKey, currentModelKey],
	);

	const [selectedCandidate, setSelectedCandidate] = useState<ModelOption | null>(defaultCandidate);

	// Keep candidate in sync when models or defaultCandidate updates
	useEffect(() => {
		if (defaultCandidate) {
			setSelectedCandidate((prev) => {
				if (
					prev &&
					typeof prev.contextWindow === "number" &&
					prev.contextWindow >= currentTokens
				) {
					return prev;
				}
				return defaultCandidate;
			});
		}
	}, [defaultCandidate, currentTokens]);

	const handleSwitchAndCompact = async () => {
		if (!selectedCandidate || busy || compacting) return;
		setBusy(true);
		try {
			await onCompactWithModel(selectedCandidate, switchBack);
		} finally {
			setBusy(false);
		}
	};

	const candidateLabel = selectedCandidate?.name || selectedCandidate?.id;
	const isActionDisabled = busy || compacting;

	return (
		<div
			className={clsx(
				"mx-3 my-2 flex flex-col gap-2 rounded-xl border px-3.5 py-2.5 text-xs transition-all",
				highlighted
					? "border-amber-500 bg-amber-500/15 shadow-sm ring-2 ring-amber-500/30"
					: "border-amber-500/35 bg-amber-500/10 text-[var(--text)]",
			)}
		>
			<div className="flex items-start gap-2">
				<AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
				<div className="min-w-0 flex-1 leading-snug">
					<span className="font-medium text-amber-700 dark:text-amber-400">
						{t("chat.overflow.banner", {
							current: compactTokens(currentTokens),
							window: compactTokens(contextWindow),
						})}
					</span>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2 pt-0.5">
				{selectedCandidate ? (
					<button
						type="button"
						disabled={isActionDisabled}
						onClick={() => void handleSwitchAndCompact()}
						className="flex items-center gap-1.5 rounded-lg border border-amber-600/40 bg-amber-600 px-3 py-1 font-medium text-white shadow-xs transition-colors hover:bg-amber-700 disabled:opacity-50"
					>
						{busy ? (
							<Loader2 size={12} className="animate-spin" />
						) : (
							<ArchiveRestore size={12} />
						)}
						<span>
							{busy
								? t("chat.overflow.switchingAndCompacting")
								: t("chat.overflow.switchToCompact", { model: candidateLabel ?? "" })}
						</span>
					</button>
				) : (
					<span className="text-[11px] text-[var(--text-60)]">
						{t("chat.overflow.compactWithLarger")}
					</span>
				)}

				<div className="relative">
					<button
						ref={pickerBtnRef}
						type="button"
						disabled={isActionDisabled}
						onClick={() => setPickerOpen((v) => !v)}
						className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] px-2 py-1 text-[11px] text-[var(--text-60)] transition-colors hover:border-[var(--text-30)] hover:text-[var(--text)] disabled:opacity-50"
					>
						<span>{t("chat.overflow.changeModel")}</span>
						<ChevronDown size={11} />
					</button>

					{pickerOpen && (
						<FloatingLayer
							anchor={pickerBtnRef.current}
							placement="top-start"
							offset={4}
							layer="popover"
							ignoreRefs={[pickerBtnRef]}
							onDismiss={() => setPickerOpen(false)}
							className="w-[360px] rounded-xl border border-[var(--line)] !bg-[var(--bg-panel)] py-1 shadow-lg"
						>
							<ModelMenuContent
								models={models}
								currentValue={
									selectedCandidate
										? toModelKey(selectedCandidate.provider, selectedCandidate.id)
										: undefined
								}
								contextTokens={currentTokens}
								onSelect={(key) => {
									const found = models?.find(
										(m) => toModelKey(m.provider, m.id) === key || m.id === key,
									);
									if (found) setSelectedCandidate(found);
									setPickerOpen(false);
								}}
							/>
						</FloatingLayer>
					)}
				</div>

				<button
					type="button"
					disabled={isActionDisabled}
					onClick={() => void onCompactCurrent()}
					className="rounded-lg border border-[var(--line)] bg-transparent px-2.5 py-1 text-[11px] text-[var(--text-60)] transition-colors hover:border-[var(--text-30)] hover:text-[var(--text)] disabled:opacity-50"
				>
					{t("chat.overflow.compactAnyway")}
				</button>

				<label className="ml-auto flex select-none items-center gap-1.5 text-[11px] text-[var(--text-60)] hover:text-[var(--text)]">
					<input
						type="checkbox"
						checked={switchBack}
						disabled={isActionDisabled}
						onChange={(e) => setSwitchBack(e.target.checked)}
						className="rounded border-[var(--line)] accent-amber-600"
					/>
					<span>{t("chat.overflow.switchBackAfter")}</span>
				</label>
			</div>
		</div>
	);
}
