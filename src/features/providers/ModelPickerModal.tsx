import { Activity, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { SearchInput } from "../../components/SearchInput";
import { Segmented } from "../../components/Segmented";
import type { DiscoveredModel } from "../../lib/contracts";
import { useT } from "../../stores/language";
import { useModelCatalog } from "../../stores/modelCatalog";
import { catalogKeys, classifyModel, isProbeFailed, type ModelCategory } from "./modelClass";
import { useProviders } from "./store";

interface Props {
	models: DiscoveredModel[];
	existingModelIds: Set<string>;
	/** Saved provider id; availability probing needs a persisted provider (null while adding). */
	providerId?: string | null;
	/** Tab shown first. */
	initialCategory?: ModelCategory;
	onClose: () => void;
	onAppend: (selectedIds: string[]) => void;
	onReplace: (selectedIds: string[]) => void;
}

const inputCls =
	"w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all";

const PROBE_CONCURRENCY = 4;

export function ModelPickerModal({
	models,
	existingModelIds,
	providerId = null,
	initialCategory = "chat",
	onClose,
	onAppend,
	onReplace,
}: Props) {
	const { t } = useT();
	const modelTests = useProviders((s) => s.modelTests);
	const runModelTest = useProviders((s) => s.runModelTest);
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState<ModelCategory>(initialCategory);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [probing, setProbing] = useState(false);

	const testOf = (id: string) => (providerId ? modelTests[`${providerId}::${id}`] : undefined);

	const catalog = useModelCatalog((s) => s.models);
	const categoryOf = useMemo(() => {
		const keys = catalogKeys(catalog);
		return (m: DiscoveredModel): ModelCategory =>
			classifyModel({ id: m.id, kind: m.kind, inCatalog: providerId ? keys.has(`${providerId}::${m.id}`) : false });
	}, [catalog, providerId]);

	const counts = useMemo(() => {
		const other = models.filter((m) => categoryOf(m) === "other").length;
		return { chat: models.length - other, other };
	}, [models, categoryOf]);

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		const inTab = models.filter((m) => categoryOf(m) === category);
		const matched = term
			? inTab.filter(
					(m) =>
						m.id.toLowerCase().includes(term) ||
						(m.name && m.name.toLowerCase().includes(term)),
				)
			: inTab;
		// Failed probes sink to the bottom (stable: Array.sort keeps relative order).
		const failedKey = (id: string) => (providerId && isProbeFailed(modelTests[`${providerId}::${id}`]) ? 1 : 0);
		return [...matched].sort((a, b) => failedKey(a.id) - failedKey(b.id));
	}, [models, search, category, modelTests, providerId, categoryOf]);

	const handleToggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const handleSelectAll = () => {
		setSelected((prev) => {
			const next = new Set(prev);
			for (const m of filtered) if (!isProbeFailed(testOf(m.id))) next.add(m.id);
			return next;
		});
	};

	const handleDeselectAll = () => {
		setSelected(new Set());
	};

	const handleAppend = () => {
		const toAppend = Array.from(selected).filter((id) => !existingModelIds.has(id));
		onAppend(toAppend);
	};

	const handleReplace = () => {
		onReplace(Array.from(selected));
	};

	/** Probe every model in the current tab; failures are kept, unchecked and sorted to the bottom. */
	const handleProbeAll = async () => {
		if (!providerId || probing) return;
		setProbing(true);
		const ids = filtered.map((m) => m.id);
		let cursor = 0;
		const worker = async () => {
			while (cursor < ids.length) {
				const id = ids[cursor++];
				await runModelTest(providerId, id);
				if (isProbeFailed(useProviders.getState().modelTests[`${providerId}::${id}`])) {
					setSelected((prev) => {
						if (!prev.has(id)) return prev;
						const next = new Set(prev);
						next.delete(id);
						return next;
					});
				}
			}
		};
		try {
			await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, ids.length) }, worker));
		} finally {
			setProbing(false);
		}
	};

	return (
		<Modal
			onClose={onClose}
			title={t("providers.pickerTitle", { count: models.length })}
		>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<div className="space-y-3 border-b border-[var(--border-divider)] p-4">
					<SearchInput
						value={search}
						onChange={setSearch}
						autoFocus
						placeholder={t("providers.pickerSearchPlaceholder")}
						inputClassName={`${inputCls} pl-8 pr-7`}
					/>
					<div className="flex items-center justify-between gap-2">
						<Segmented
							size="sm"
							value={category}
							onChange={setCategory}
							aria-label={t("providers.pickerTypeAria")}
							options={[
								{ value: "chat", label: t("providers.pickerTabChat", { count: counts.chat }) },
								{ value: "other", label: t("providers.pickerTabOther", { count: counts.other }), title: t("providers.pickerTabOtherTitle") },
							]}
						/>
						<button
							type="button"
							onClick={() => void handleProbeAll()}
							disabled={!providerId || probing || filtered.length === 0}
							title={providerId ? t("providers.probeAllTitle") : t("providers.probeNeedSaved")}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95 disabled:opacity-40"
						>
							{probing ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
							<span>{t("providers.probeAllBtn")}</span>
						</button>
					</div>

						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={handleSelectAll}
									className="rounded px-2 py-1 text-xs text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] active:scale-95 transition-all"
								>
									{t("providers.pickerSelectAll")}
								</button>
								<button
									type="button"
									onClick={handleDeselectAll}
									className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
								>
									{t("providers.pickerDeselectAll")}
								</button>
							</div>
							<div className="text-xs font-medium text-neutral-400">
								{t("providers.pickerSelectedCount", { selected: selected.size, total: filtered.length })}
							</div>
						</div>
					</div>

					<div className="flex-1 overflow-y-auto p-4">
						{filtered.length === 0 ? (
							<div className="flex h-full items-center justify-center text-xs text-neutral-500">
								{search.trim() ? t("providers.pickerNoMatching") : t("providers.pickerNoModels")}
							</div>
						) : (
							<div className="space-y-1">
								{filtered.map((model) => {
									const isSelected = selected.has(model.id);
									const isExisting = existingModelIds.has(model.id);
									const test = testOf(model.id);
									const failed = isProbeFailed(test);
									return (
										<button
											key={model.id}
											type="button"
											onClick={() => handleToggle(model.id)}
											className="w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--bg-hover)] active:scale-[0.99] transition-all"
										>
											<div
												className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-all ${
													isSelected
														? "border-[var(--accent)] bg-[var(--accent)]"
														: "hairline bg-[var(--well-bg)]"
												}`}
											>
												{isSelected && (
													<svg
														className="h-2.5 w-2.5 text-white"
														viewBox="0 0 12 12"
														fill="none"
													>
														<path
															d="M10 3L4.5 8.5L2 6"
															stroke="currentColor"
															strokeWidth="1.5"
															strokeLinecap="round"
															strokeLinejoin="round"
														/>
													</svg>
												)}
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="font-mono text-xs font-medium text-neutral-200 break-all">
														{model.id}
													</span>
													{isExisting && (
														<span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-950/40 text-emerald-300 border border-emerald-800/40">
															{t("providers.pickerAdded")}
														</span>
													)}
													{failed && (
														<span
															className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-rose-950/40 text-rose-300 border border-rose-800/40"
															title={test?.state === "done" ? test.result.detail : undefined}
														>
															{t("providers.unavailableBadge")}
														</span>
													)}
													{test?.state === "testing" && <Loader2 size={11} className="animate-spin text-neutral-400" />}
												</div>
												{model.name && model.name !== model.id && (
													<div className="mt-0.5 text-[11px] text-neutral-400 break-all">
														{model.name}
													</div>
												)}
												{failed && test?.state === "done" && (
													<div className="mt-0.5 break-words text-[11px] text-rose-400" title={test.result.detail}>
														{test.result.detail}
													</div>
												)}
											</div>
										</button>
									);
								})}
							</div>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
					>
						{t("common.cancel")}
					</button>
					<button
						type="button"
						disabled={selected.size === 0}
						onClick={handleAppend}
						className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95 disabled:opacity-40 transition-all"
					>
						{t("providers.pickerAppend")}
					</button>
					<button
						type="button"
						disabled={selected.size === 0}
						onClick={handleReplace}
						className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
					>
						{t("providers.pickerReplace")}
					</button>
				</div>
		</Modal>
	);
}
