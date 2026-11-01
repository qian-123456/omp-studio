import { FileText, Loader2, Pencil, Plus, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { SearchInput } from "../../components/SearchInput";
import { useT } from "../../stores/language";
import { isNonLLMModelKind, useModelKindCatalog } from "../../stores/modelKinds";
import { RawFilesDialog } from "../settings/sections/RawFilesDialog";
import { Button } from "../settings/ui";
import { describeKey } from "./keyState";
import { ProviderDialog, type ProviderDialogTarget } from "./ProviderDialog";
import { useProviders } from "./store";

const KIND_LABELS: Record<string, string> = {
	search: "providers.kindSearch",
	judge: "providers.kindJudge",
	image: "providers.kindImage",
	tts: "providers.kindTts",
	stt: "providers.kindStt",
	embedding: "providers.kindEmbedding",
	rerank: "providers.kindRerank",
	video: "providers.kindVideo",
};

/** Only the all-kind OMP registry establishes a model's type; connection rows supply configuration, not capability. */
export function OtherModelsPanel() {
	const { t } = useT();
	const entries = useModelKindCatalog((s) => s.entries);
	const loading = useModelKindCatalog((s) => s.loading);
	const error = useModelKindCatalog((s) => s.error);
	const loadCatalog = useModelKindCatalog((s) => s.load);
	const providers = useProviders((s) => s.rows);
	const providersLoaded = useProviders((s) => s.loaded);
	const providerError = useProviders((s) => s.error);
	const loadProviders = useProviders((s) => s.load);
	const [query, setQuery] = useState("");
	const [selectedKind, setSelectedKind] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [connectionQuery, setConnectionQuery] = useState("");
	const [connectionsOpen, setConnectionsOpen] = useState(false);
	const [dialog, setDialog] = useState<ProviderDialogTarget | null>(null);
	const [rawOpen, setRawOpen] = useState(false);

	useEffect(() => {
		void loadCatalog();
		void loadProviders();
	}, [loadCatalog, loadProviders]);

	const providerById = useMemo(() => new Map(providers.map((row) => [row.id, row])), [providers]);
	const otherModels = useMemo(() => (entries ?? []).filter((entry) => isNonLLMModelKind(entry.kind)), [entries]);
	const kindTitle = (kind: string) => KIND_LABELS[kind] ? t(KIND_LABELS[kind]) : t("providers.kindUnknown", { kind });
	const normalizedQuery = query.trim().toLowerCase();
	const matching = otherModels.filter((entry) => {
		const provider = providerById.get(entry.provider);
		return [entry.selector, entry.name, entry.kind, kindTitle(entry.kind), entry.provider, provider?.displayName, ...(provider?.sources ?? [])]
			.filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery);
	});
	const kinds = [...new Set(otherModels.map((entry) => entry.kind))].sort();
	const activeKind = selectedKind !== null && kinds.includes(selectedKind) ? selectedKind : null;
	useEffect(() => {
		if (selectedKind !== null && !otherModels.some((entry) => entry.kind === selectedKind)) {
			setSelectedKind(null);
			setPage(1);
			setExpanded(null);
		}
	}, [otherModels, selectedKind]);
	const filtered = matching.filter((entry) => activeKind === null || entry.kind === activeKind)
		.sort((a, b) => a.selector.localeCompare(b.selector));
	const pageSize = 8;
	const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
	const currentPage = Math.min(page, pageCount);
	const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
	useEffect(() => {
		setPage((previous) => Math.min(previous, pageCount));
		setExpanded(null);
	}, [pageCount, entries]);
	const changePage = (next: number) => {
		setPage(next);
		setExpanded(null);
	};
	const changeQuery = (next: string) => {
		setQuery(next);
		setPage(1);
		setExpanded(null);
	};
	const connectionRows = [...providers]
		.filter((row) => [row.id, row.displayName, row.baseUrl, row.api].filter(Boolean).join(" ").toLowerCase().includes(connectionQuery.trim().toLowerCase()))
		.sort((a, b) => a.id.localeCompare(b.id));
	const refresh = () => {
		void loadCatalog(true);
		void loadProviders();
	};
	const waiting = entries === null && !error;

	return (
		<div className="space-y-4">
			<p className="text-xs text-[var(--text-dim)]">{t("providers.otherModelsDesc")}</p>
			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] p-2">
				<SearchInput className="min-w-[180px] flex-1" value={query} onChange={changeQuery} placeholder={t("providers.otherModelsSearch")} ariaLabel={t("providers.otherModelsSearch")} />
				<Button icon={Settings2} onClick={() => setConnectionsOpen(true)}>{t("providers.manageConnections")}</Button>
				<Button icon={RefreshCw} onClick={refresh} disabled={loading}>{t("common.refresh")}</Button>
			</div>
			{error && (
				<div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-800/40 bg-rose-950/20 p-3 text-xs text-rose-300">
					<span className="min-w-0 flex-1 break-words">{t("providers.otherModelsLoadError", { error })}</span>
					<Button onClick={() => void loadCatalog(true)} disabled={loading}>{t("common.retry")}</Button>
				</div>
			)}
			{providerError && <p role="alert" className="break-words text-xs text-amber-400">{t("providers.connectionLoadError", { error: providerError })}</p>}
			{(waiting || loading) && <div role="status" className="flex items-center gap-2 py-3 text-xs text-[var(--text-dim)]"><Loader2 size={14} className="animate-spin" />{t("providers.otherModelsLoading")}</div>}
			{entries !== null && (
				<>
					<div role="group" aria-label={t("providers.otherModelsTypes")} className="flex flex-wrap gap-1.5">
						{[null, ...kinds].map((kind) => (
							<button key={kind === null ? "all" : `kind:${kind}`} type="button" aria-pressed={activeKind === kind} onClick={() => { setSelectedKind(kind); setPage(1); setExpanded(null); }} className={`whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${activeKind === kind ? "border-[var(--accent)] bg-[var(--bg-hover)] font-semibold text-[var(--text)]" : "border-[var(--border-divider)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"}`}>
								{kind === null ? t("providers.otherModelsAllTypes") : kindTitle(kind)} ({kind === null ? matching.length : matching.filter((entry) => entry.kind === kind).length})
							</button>
						))}
					</div>
					<p className="text-xs text-[var(--text-dim)]">{t("providers.otherModelsCount", { shown: filtered.length, total: otherModels.length })}</p>
					{filtered.length === 0 && !loading && (
						<div className="space-y-3 rounded-xl hairline bg-[var(--well-bg)]/40 px-4 py-8 text-center text-xs text-[var(--text-dim)]">
							<p>{normalizedQuery ? t("providers.otherModelsNoMatch") : t("providers.otherModelsEmpty")}</p>
							{normalizedQuery ? <Button onClick={() => changeQuery("")}>{t("providers.clearFilterBtn")}</Button> : <Button icon={Settings2} onClick={() => setConnectionsOpen(true)}>{t("providers.manageConnections")}</Button>}
						</div>
					)}
					{filtered.length > 0 && (
						<div className="overflow-hidden rounded-xl hairline bg-[var(--well-bg)]/40">
							<nav aria-label={t("providers.otherModelsPagination")} className="flex flex-wrap items-center gap-2 border-b border-[var(--border-divider)] px-3 py-2">
								<p role="status" className="flex-1 text-xs text-[var(--text-dim)]">{t("providers.otherModelsRange", { from: (currentPage - 1) * pageSize + 1, to: Math.min(currentPage * pageSize, filtered.length), total: filtered.length, page: currentPage, pages: pageCount })}</p>
								<div className="flex flex-wrap items-center gap-2">
									<Button onClick={() => changePage(currentPage - 1)} disabled={currentPage === 1}>{t("providers.otherModelsPrevious")}</Button>
									<select aria-label={t("providers.otherModelsJumpPage")} value={currentPage} onChange={(event) => changePage(Number(event.target.value))} className="rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] px-2 py-1.5 text-xs text-[var(--text)]">
										{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{t("providers.otherModelsPage", { page: index + 1 })}</option>)}
									</select>
									<Button onClick={() => changePage(currentPage + 1)} disabled={currentPage === pageCount}>{t("providers.otherModelsNext")}</Button>
								</div>
							</nav>
							<section key={JSON.stringify([activeKind, normalizedQuery, currentPage])} aria-label={t("providers.otherModelsList")} className="max-h-[420px] overflow-y-auto">
								<ul className="divide-y divide-[var(--border-divider)]">
									{visible.map((entry) => {
										const provider = providerById.get(entry.provider);
										const name = entry.name || entry.selector;
										const open = expanded === entry.selector;
										return (
											<li key={entry.selector} className="px-3 py-2.5">
												<div className="flex flex-wrap items-start gap-x-3 gap-y-2">
													<div className="min-w-0 flex-1 basis-48">
														<div className="break-words [overflow-wrap:anywhere] text-sm font-medium text-[var(--text)]">{name}</div>
														<p className="break-words text-[11px] text-[var(--text-dim)]">{provider?.displayName ?? entry.provider} · {kindTitle(entry.kind)}</p>
													</div>
													<div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
														<button type="button" aria-label={t("providers.otherModelsDetailsLabel", { name })} aria-expanded={open} onClick={() => setExpanded(open ? null : entry.selector)} className="rounded border border-[var(--border-divider)] px-2 py-1.5 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{t(open ? "providers.otherModelsHideDetails" : "providers.otherModelsDetails")}</button>
														<Button icon={provider ? Pencil : FileText} onClick={() => provider ? setDialog({ mode: "edit", row: provider }) : setRawOpen(true)}>{provider ? t("providers.editConnection") : t("providers.configureRunner")}</Button>
													</div>
												</div>
												{open && <div className="mt-2 space-y-1 rounded-lg bg-[var(--well-bg)] p-2 text-[11px] text-[var(--text-dim)]">
													<div className="select-text break-all font-mono"><span>{entry.selector}</span> · {entry.kind}</div>
													<p className="break-words">{t("providers.otherModelSource", { provider: provider?.displayName ?? entry.provider, source: provider?.sources.join(", ") || t("providers.ompCatalogSource") })}</p>
													<p className="break-words">{provider ? `${provider.enabled ? t("providers.connectionEnabled") : t("providers.connectionDisabled")} · ${describeKey(provider).label}` : providerError ? t("providers.connectionStatusUnknown") : !providersLoaded ? t("providers.loadingProvidersAria") : t("providers.ompManagedRunner")}</p>
													<p>{t("providers.registeredNotTested")}</p>
												</div>}
											</li>
										);
									})}
								</ul>
							</section>
						</div>
					)}
				</>
			)}
			<p className="text-xs leading-5 text-[var(--text-dim)]">{t("providers.otherModelsRegistrationHint")}</p>
			{connectionsOpen && (
				<Modal title={t("providers.manageConnections")} size="lg" onClose={() => setConnectionsOpen(false)}>
					<div className="space-y-3 overflow-y-auto p-4">
						<p className="text-xs leading-5 text-[var(--text-dim)]">{t("providers.connectionsSharedHint")}</p>
						<SearchInput value={connectionQuery} onChange={setConnectionQuery} placeholder={t("providers.searchPlaceholder")} ariaLabel={t("providers.searchAria")} />
						{!providersLoaded && !providerError && <p role="status" className="text-xs">{t("providers.loadingProvidersAria")}</p>}
						{providerError && <div role="alert" className="space-y-2 break-words text-xs text-rose-300"><p>{t("providers.connectionLoadError", { error: providerError })}</p><Button onClick={() => void loadProviders()}>{t("common.retry")}</Button></div>}
						{providersLoaded && !providerError && connectionRows.length === 0 && <p className="text-xs text-[var(--text-dim)]">{connectionQuery.trim() ? t("providers.noMatchingProviders", { query: connectionQuery.trim() }) : t("providers.emptyProvidersTitle")}</p>}
						{connectionRows.map((row) => (
							<button key={row.id} type="button" onClick={() => { setConnectionsOpen(false); setDialog({ mode: "edit", row }); }} className="flex w-full items-center gap-3 rounded-lg hairline px-3 py-2 text-left hover:bg-[var(--bg-hover)]">
								<div className="min-w-0 flex-1"><div className="break-words text-sm">{row.displayName ?? row.id}</div><div className="break-all text-[11px] text-[var(--text-dim)]">{row.id} · {row.api ?? t("providers.unknownApi")} · {describeKey(row).label}</div></div><Pencil size={14} className="shrink-0" />
							</button>
						))}
						<Button icon={Plus} onClick={() => { setConnectionsOpen(false); setDialog({ mode: "add" }); }}>{t("providers.addProviderBtn")}</Button>
						<Button icon={FileText} onClick={() => { setConnectionsOpen(false); setRawOpen(true); }}>{t("settingsSections.providers.editRawConfig")}</Button>
					</div>
				</Modal>
			)}
			{dialog && <ProviderDialog target={dialog} pickerCategory="other" onClose={() => setDialog(null)} />}
			{rawOpen && <RawFilesDialog onClose={() => setRawOpen(false)} />}
		</div>
	);
}
