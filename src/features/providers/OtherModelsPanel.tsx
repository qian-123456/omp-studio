import { ChevronDown, FileText, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { SearchInput } from "../../components/SearchInput";
import type { ModelKindEntry, ProviderRow } from "../../lib/contracts";
import { useT } from "../../stores/language";
import { isNonLLMModelKind, useModelKindCatalog } from "../../stores/modelKinds";
import { RawFilesDialog } from "../settings/sections/RawFilesDialog";
import { Button } from "../settings/ui";
import { ProviderDialog, type ProviderDialogTarget } from "./ProviderDialog";
import { useProviders } from "./store";
import { serviceCapability } from "./serviceCapabilities";
import { ServiceConfigDialog } from "./ServiceConfigDialog";
import { OauthLoginDialog } from "./OauthLoginDialog";
import { supplierStatus } from "./supplierStatus";
import { isExplicitServiceModel } from "./presets";

const KIND_LABELS: Record<string, string> = { search: "providers.kindSearch", judge: "providers.kindJudge", image: "providers.kindImage", tts: "providers.kindTts", stt: "providers.kindStt", embedding: "providers.kindEmbedding", rerank: "providers.kindRerank", video: "providers.kindVideo" };

/** Registry entries prove registration, never connectivity or credential validity. */
export function OtherModelsPanel() {
	const { t } = useT();
	const { entries, loading, error, load: loadCatalog } = useModelKindCatalog();
	const { rows: providers, loaded, error: providerError, load: loadProviders } = useProviders();
	const [query, setQuery] = useState("");
	const [addQuery, setAddQuery] = useState("");
	const [expanded, setExpanded] = useState<string | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	const [visited, setVisited] = useState<Set<string>>(() => new Set());
	const [dialog, setDialog] = useState<ProviderDialogTarget | null>(null);
	const [rawOpen, setRawOpen] = useState(false);
	const [service, setService] = useState<ModelKindEntry | null>(null);
	const [login, setLogin] = useState<string | null>(null);
	useEffect(() => { void loadCatalog(); void loadProviders(); }, [loadCatalog, loadProviders]);
	const groups = useMemo(() => {
		const result = new Map<string, ModelKindEntry[]>();
		for (const entry of entries ?? []) {
			if (!isNonLLMModelKind(entry.kind)) continue;
			const id = serviceCapability(entry).supplier;
			const group = result.get(id) ?? [];
			if (!group.some((model) => model.selector === entry.selector && model.kind === entry.kind)) group.push(entry);
			result.set(id, group);
		}
		return result;
	}, [entries]);
	const rowsById = new Map(providers.map((row) => [row.id, row]));
	const relevantRows = providers.filter((row) =>
		groups.has(row.id) ||
		// Credentials, an empty connection, or an unavailable catalog do not prove non-chat capability.
		// Explicit service models remain manageable even before runtime registration succeeds.
		row.models.some((model) => typeof model !== "string" && isExplicitServiceModel(model)),
	);
	const ids = [...new Set([...relevantRows.map((row) => row.id), ...groups.keys()])].sort((a, b) => a.localeCompare(b));
	const added = (id: string) => {
		const row = rowsById.get(id);
		return Boolean(row && (row.origin !== "builtin" || !row.enabled || !["missing"].includes(row.key.kind))) ||
			(groups.get(id) ?? []).some((entry) => ["keyless", "local", "settings"].includes(serviceCapability(entry).method));
	};
	const kindTitle = (kind: string) => KIND_LABELS[kind] ? t(KIND_LABELS[kind]) : t("providers.kindUnknown", { kind });
	const matches = (id: string, search: string) => [id, rowsById.get(id)?.displayName, rowsById.get(id)?.baseUrl, ...(groups.get(id) ?? []).flatMap((entry) => [entry.name, entry.selector, entry.kind, kindTitle(entry.kind)])].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase());
	const edit = (id: string) => {
		setAddOpen(false);
		const row = rowsById.get(id);
		const models = groups.get(id) ?? [];
		const entry = models.find((model) => ["settings", "local"].includes(serviceCapability(model).method)) ?? models[0];
		if (entry && ["settings", "local"].includes(serviceCapability(entry).method)) setService(entry);
		else if (row?.key.kind === "oauth" || (entry && supplierStatus(serviceCapability(entry), row, loaded, providerError).action === "account")) setLogin(id);
		else if (row) setDialog({ mode: "edit", row });
		else if (entry) {
			const status = supplierStatus(serviceCapability(entry), undefined, loaded, providerError);
			if (status.action === "account") setLogin(id);
			else if (status.action === "advanced") setRawOpen(true);
			else if (status.action) setService(entry);
		}
	};
	const renderSupplier = (id: string) => {
		const row = rowsById.get(id);
		const models = groups.get(id) ?? [];
		const capability = models[0] ? serviceCapability(models[0]) : { supplier: id, method: "advanced" as const };
		const status = supplierStatus(capability, row, loaded, providerError);
		const open = expanded === id;
		return <section key={id} className="min-w-0 border-b border-[var(--border-divider)] last:border-b-0">
			<div className="flex items-center gap-3 px-4 py-3">
				<button type="button" aria-label={t("providers.otherModelsSelectSupplier", { provider: id })} aria-expanded={open} onClick={() => { setVisited((previous) => new Set(previous).add(id)); setExpanded(open ? null : id); }} className="flex min-w-0 flex-1 items-center gap-3 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
					<ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
					<div className="min-w-0 flex-1"><div className="break-words [overflow-wrap:anywhere] text-sm font-medium">{row?.displayName || id}</div>{row?.displayName && row.displayName !== id && <div className="break-all text-xs text-[var(--text-dim)]">{id}</div>}<div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--text-dim)]"><span>{t("providers.modelsListHeader", { count: models.length })}</span>{[...new Set(models.map((entry) => entry.kind))].map((kind) => <span key={kind} className="break-words [overflow-wrap:anywhere]">{kindTitle(kind)}</span>)}</div></div>
				</button>
				<span className={`shrink-0 text-xs ${status.warning ? "text-[var(--status-warning)]" : "text-[var(--text-dim)]"}`}>{t(`providers.${status.label}`)}</span>
				{(row || status.action) && <Button icon={Pencil} aria-label={t("providers.supplierActionFor", { action: t("common.edit"), provider: id })} onClick={() => edit(id)}>{t("common.edit")}</Button>}
			</div>
			{visited.has(id) && <div hidden={!open}><SupplierModels key={id} models={models} kindTitle={kindTitle} row={row} onConfigure={setService} /></div>}
		</section>;
	};
	const visibleIds = ids.filter((id) => added(id) && matches(id, query));
	return <div className="space-y-4">
		<p className="text-xs leading-5 text-[var(--text-dim)]">{t("providers.otherModelsDesc")}</p>
		<div className="flex flex-wrap items-center gap-2"><SearchInput className="min-w-[180px] flex-1" value={query} onChange={setQuery} placeholder={t("providers.otherModelsSearch")} ariaLabel={t("providers.otherModelsSearch")} /><Button icon={Plus} onClick={() => setAddOpen(true)}>{t("providers.addService")}</Button><Button icon={RefreshCw} disabled={loading} onClick={() => { void loadCatalog(true); void loadProviders(); }}>{t("common.refresh")}</Button></div>
		{error && <div role="alert" className="flex items-start gap-2 text-xs text-rose-400"><p className="min-w-0 flex-1 break-words">{t("providers.otherModelsLoadError", { error })}</p><Button disabled={loading} onClick={() => void loadCatalog(true)}>{t("common.retry")}</Button></div>}
		{providerError && <div role="alert" className="flex items-start gap-2 text-xs text-rose-400"><p className="min-w-0 flex-1 break-words">{t("providers.connectionLoadError", { error: providerError })}</p><Button onClick={() => void loadProviders()}>{t("common.retry")}</Button></div>}
		{loading && <p role="status" className="flex items-center gap-2 text-xs"><Loader2 size={14} className="animate-spin" />{t("providers.otherModelsLoading")}</p>}
		<div aria-label={t("providers.otherModelsSuppliers")} className="min-w-0 overflow-hidden rounded-xl hairline bg-[var(--well-bg)]/40">{visibleIds.map((id) => renderSupplier(id))}{visibleIds.length === 0 && !loading && !error && entries !== null && <p className="p-6 text-center text-xs text-[var(--text-dim)]">{t(query.trim() ? "providers.otherModelsNoMatch" : "providers.otherModelsEmpty")}</p>}</div>
		<p className="text-xs leading-5 text-[var(--text-dim)]">{t("providers.otherModelsRegistrationHint")}</p>
		{addOpen && <Modal title={t("providers.addService")} size="lg" onClose={() => setAddOpen(false)}>
			<div className="flex max-h-[70vh] flex-col gap-3 p-4">
				<div className="flex flex-wrap gap-2">
					<Button icon={Plus} onClick={() => { setAddOpen(false); setDialog({ mode: "add" }); }}>{t("providers.addProviderBtn")}</Button>
					<Button icon={FileText} onClick={() => { setAddOpen(false); setRawOpen(true); }}>{t("settingsSections.providers.editRawConfig")}</Button>
				</div>
				<p className="text-xs text-[var(--text-dim)]">{t("providers.serviceGlobalHint")}</p>
				<SearchInput value={addQuery} onChange={setAddQuery} placeholder={t("providers.otherModelsSearch")} ariaLabel={t("providers.otherModelsSearch")} />
				<div className="min-h-0 overflow-y-auto rounded-xl hairline">{ids.filter((id) => !added(id) && matches(id, addQuery)).map(renderSupplier)}</div>
			</div>
		</Modal>}
		{dialog && <ProviderDialog target={dialog} pickerCategory="other" onClose={() => setDialog(null)} />}
		{service && <ServiceConfigDialog capability={serviceCapability(service)} selector={service.selector} onClose={() => setService(null)} onAdvanced={() => { setService(null); setRawOpen(true); }} onLogin={() => { setLogin(serviceCapability(service).supplier); setService(null); }} />}
		{login !== null && <OauthLoginDialog initialProviderQuery={login} onClose={() => setLogin(null)} />}
		{rawOpen && <RawFilesDialog onClose={() => setRawOpen(false)} />}
	</div>;
}

function SupplierModels({ models, kindTitle, row, onConfigure }: { models: ModelKindEntry[]; kindTitle: (kind: string) => string; row?: ProviderRow; onConfigure: (entry: ModelKindEntry) => void }) {
	const { t } = useT();
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState("");
	const [page, setPage] = useState(1);
	const large = models.length > 6;
	const filtered = models.filter((entry) => (!kind || kind === entry.kind) && [entry.name, entry.selector, entry.kind, kindTitle(entry.kind)].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
	const pages = Math.max(1, Math.ceil(filtered.length / 8));
	const currentPage = Math.min(page, pages);
	const visible = large ? filtered.slice((currentPage - 1) * 8, currentPage * 8) : models;
	return <div className="min-w-0 space-y-3 border-t border-[var(--border-divider)] bg-[var(--well-bg)]/40 px-4 py-3">
		{large && <><SearchInput value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("providers.otherModelsSearch")} ariaLabel={t("providers.otherModelsSearch")} /><div role="group" aria-label={t("providers.otherModelsTypes")} className="flex flex-wrap gap-2">{["", ...new Set(models.map((entry) => entry.kind))].map((value) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setPage(1); }} className={`rounded-lg border px-2 py-1 text-xs ${kind === value ? "border-[var(--accent)]" : "border-[var(--border-divider)]"}`}>{value ? kindTitle(value) : t("providers.otherModelsAllTypes")}</button>)}</div></>}
		<ul aria-label={t("providers.otherModelsList")} className="space-y-3">{visible.map((entry) => <li key={`${entry.selector}:${entry.kind}`} className="min-w-0"><div className="break-words [overflow-wrap:anywhere] text-sm">{entry.name || entry.selector}</div><p className="select-text break-words [overflow-wrap:anywhere] font-mono text-[11px] text-[var(--text-dim)]">{entry.selector}</p><p className="break-words text-xs text-[var(--text-dim)]">{kindTitle(entry.kind)}</p><details className="mt-1 text-xs text-[var(--text-dim)]"><summary aria-label={t("providers.otherModelsDetailsLabel", { name: entry.name || entry.selector })} className="cursor-pointer">{t("providers.otherModelsDetails")}</summary><p className="py-2">{t("providers.registeredNotTested")}</p>{["local", "settings"].includes(serviceCapability(entry).method) && <Button onClick={() => onConfigure(entry)}>{t("common.edit")}</Button>}</details></li>)}</ul>
		{visible.length === 0 && <p className="text-xs text-[var(--text-dim)]">{t("providers.otherModelsNoMatch")}</p>}
		{large && <nav aria-label={t("providers.otherModelsPagination")} className="flex flex-wrap items-center gap-2"><p role="status" className="min-w-0 flex-1 text-xs text-[var(--text-dim)]">{t("providers.otherModelsRange", { from: filtered.length ? (currentPage - 1) * 8 + 1 : 0, to: Math.min(currentPage * 8, filtered.length), total: filtered.length, page: currentPage, pages })}</p><Button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{t("providers.otherModelsPrevious")}</Button><select aria-label={t("providers.otherModelsJumpPage")} value={currentPage} onChange={(event) => setPage(Number(event.target.value))} className="rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] px-2 py-1 text-xs">{Array.from({ length: pages }, (_, index) => <option key={index + 1} value={index + 1}>{t("providers.otherModelsPage", { page: index + 1 })}</option>)}</select><Button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>{t("providers.otherModelsNext")}</Button></nav>}
		<p className="text-xs leading-5 text-[var(--text-dim)]">{t(row?.key.kind === "oauth" ? "providers.supplierReuseAccount" : row && ["plaintext", "loginStored"].includes(row.key.kind) ? "providers.supplierReuseKey" : "providers.registeredNotTested")}</p>
	</div>;
}
