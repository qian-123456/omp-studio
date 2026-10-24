import { ChevronDown, ClipboardCopy, FileInput, Loader2, Lock, LogIn, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { SearchInput } from "../../components/SearchInput";
import type { ProviderRow } from "../../lib/contracts";
import { copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";
import { SectionHeader } from "../settings/ui";
import { useSettingsNav } from "../settings/settingsNav";
import { openSettingsTarget } from "../settings/settingsTargets";
import { VAULT_PATH, MODELS_YML_PATH } from "./keyState";
import { modelEntryId } from "./modelEntry";
import { OauthLoginDialog } from "./OauthLoginDialog";
import { ProviderDialog, type ProviderDialogTarget } from "./ProviderDialog";
import { ProviderGroup } from "./ProviderGroup";
import {
	GROUP_DEFAULT_OPEN,
	GROUP_PAGE_SIZE,
	groupProviders,
	PROVIDER_GROUP_ORDER,
	type ProviderGroupId,
} from "./providerGroups";
import { ProviderRowView, ROW_GRID } from "./ProviderRowView";
import { SetKeyDialog } from "./SetKeyDialog";
import { useProviders } from "./store";

function matchesQuery(row: ProviderRow, q: string): boolean {
	const haystack = [row.id, row.displayName, row.baseUrl, row.api, ...row.models.map(modelEntryId)]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return haystack.includes(q);
}

export function ProviderPanel() {
	const { t } = useT();
	const rows = useProviders((s) => s.rows);
	const loaded = useProviders((s) => s.loaded);
	const error = useProviders((s) => s.error);
	const load = useProviders((s) => s.load);
	const encryptAll = useProviders((s) => s.encryptAll);
	const exportEnvText = useProviders((s) => s.exportEnvText);

	const [dialog, setDialog] = useState<ProviderDialogTarget | null>(null);
	const [keyDialogId, setKeyDialogId] = useState<string | null>(null);
	const [oauthDialog, setOauthDialog] = useState(false);
	const [query, setQuery] = useState("");
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [groupOpen, setGroupOpen] = useState<Partial<Record<ProviderGroupId, boolean>>>({});
	const [groupLimit, setGroupLimit] = useState<Partial<Record<ProviderGroupId, number>>>({});
	const [menuOpen, setMenuOpen] = useState(false);
	const [encryptingAll, setEncryptingAll] = useState(false);
	const menuBtnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		void load();
	}, [load]);

	// Deep link from the quota sheet: expand the targeted provider row.
	const { focusKey, focusRequest } = useSettingsNav();
	// biome-ignore lint/correctness/useExhaustiveDependencies: focusRequest re-fires the jump for a repeated key
	useEffect(() => {
		if (focusKey?.startsWith("provider:")) {
			setExpandedId(focusKey.slice("provider:".length));
			// A deep link must land on a visible row: drop manual fold choices.
			setGroupOpen({});
		}
	}, [focusKey, focusRequest]);

	const sorted = useMemo(
		() => [...rows].sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id)),
		[rows],
	);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? sorted.filter((r) => matchesQuery(r, q)) : sorted;
	}, [sorted, query]);

	const grouped = useMemo(() => groupProviders(filtered), [filtered]);
	const encryptedCount = rows.filter((r) => r.key.kind === "encrypted").length;
	const plaintextCount = rows.filter((r) => r.key.kind === "plaintext").length;
	const keyDialogRow = keyDialogId ? rows.find((r) => r.id === keyDialogId) : undefined;

	const handleEncryptAll = async () => {
		setMenuOpen(false);
		setEncryptingAll(true);
		try {
			const results = await encryptAll();
			const failed = results.filter((r) => !r.ok);
			const done = results.length - failed.length;
			if (failed.length === 0) toast.success(t("providers.encryptAllDoneToast", { count: done }));
			else
				toast.error(
					t("providers.encryptAllPartialToast", {
						done,
						failed: failed.length,
						id: failed[0].id,
						error: failed[0].error ?? t("providers.unknownError"),
					}),
				);
		} catch (err) {
			toast.error(t("providers.encryptFailedToast", { error: errMsg(err) }));
		} finally {
			setEncryptingAll(false);
		}
	};

	const handleExport = async () => {
		setMenuOpen(false);
		try {
			const text = (await exportEnvText()).trim();
			if (!text) {
				toast.info(t("providers.noExportableKeysToast"));
				return;
			}
			await copyText(text);
			toast.success(t("providers.exportSuccessToast"));
		} catch (err) {
			toast.error(t("providers.exportFailedToast", { error: errMsg(err) }));
		}
	};

	const isLoading = !loaded && !error;
	const menuItemCls =
		"flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-neutral-200 hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:hover:bg-transparent";

	return (
		<div className="space-y-4">
			<div className="space-y-3">
				<SectionHeader
					title={t("providers.headerTitle")}
					description={t("providers.headerDesc", { total: rows.length, encrypted: encryptedCount })}
				/>
				<button
					type="button"
					onClick={() => openSettingsTarget("modelContext")}
					className="flex w-full items-center gap-2 rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] px-3 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-[var(--bg-hover)]"
				>
					<SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
					<span className="flex-1">{t("providers.contextWindowBanner")}</span>
					<span className="font-medium text-[var(--accent)]">{t("providers.contextWindowLink")}</span>
				</button>
				<div className="flex flex-col items-stretch justify-between gap-2.5 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] p-2 shadow-2xs sm:flex-row sm:items-center">
					<SearchInput
						className="min-w-[200px] max-w-sm flex-1"
						value={query}
						onChange={setQuery}
						placeholder={t("providers.searchPlaceholder")}
						ariaLabel={t("providers.searchAria")}
					/>
					<div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:flex-nowrap">
						<button
							ref={menuBtnRef}
							type="button"
							onClick={() => setMenuOpen((v) => !v)}
							className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95"
						>
							{encryptingAll && <Loader2 className="h-3 w-3 animate-spin" />}
							<span>{t("providers.batchKeyManage")}</span>
							<ChevronDown className={`h-3 w-3 text-neutral-400 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
						</button>
						{menuOpen && (
							<FloatingLayer
								anchor={menuBtnRef.current}
								placement="bottom-end"
								offset={4}
								layer="popover"
								onDismiss={() => setMenuOpen(false)}
								ignoreRefs={[menuBtnRef]}
								className="w-60 space-y-0.5 rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-1 text-xs shadow-xl"
							>
								<button
									type="button"
									onClick={() => void handleEncryptAll()}
									disabled={plaintextCount === 0 || encryptingAll}
									className={menuItemCls}
								>
									<Lock className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
									<span className="flex-1 whitespace-nowrap font-medium">
										{plaintextCount === 0 ? t("providers.allEncrypted") : t("providers.encryptAllPlaintext", { count: plaintextCount })}
									</span>
								</button>
								<button
									type="button"
									onClick={() => {
										setMenuOpen(false);
										setDialog({ mode: "import" });
									}}
									className={menuItemCls}
								>
									<FileInput className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
									<span className="flex-1 whitespace-nowrap font-medium">{t("providers.importEnvMenu")}</span>
								</button>
								<button type="button" onClick={() => void handleExport()} className={menuItemCls}>
									<ClipboardCopy className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
									<span className="flex-1">
										<span className="block whitespace-nowrap font-medium">{t("providers.exportAllMenu")}</span>
										<span className="block text-[10px] text-neutral-400">{t("providers.exportAllMenuHint")}</span>
									</span>
								</button>
							</FloatingLayer>
						)}
						<button
							type="button"
							onClick={() => setOauthDialog(true)}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95"
						>
							<LogIn className="h-3.5 w-3.5 text-neutral-400" />
							<span>{t("providers.oauthLoginBtn")}</span>
						</button>
						<button
							type="button"
							onClick={() => setDialog({ mode: "add" })}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] shadow-xs transition-all hover:opacity-90 active:scale-95"
						>
							<Plus className="h-3.5 w-3.5" />
							<span>{t("providers.addProviderBtn")}</span>
						</button>
						<button
							type="button"
							onClick={() => void load()}
							title={t("common.refresh")}
							aria-label={t("common.refresh")}
							className="rounded-lg p-1.5 text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
						>
							<RefreshCw className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</div>

			{error && (
				<div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-800/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
					<span className="min-w-0 flex-1 break-words">{error}</span>
					<button type="button" onClick={() => void load()} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-rose-900/60 px-2.5 py-1 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-800/80">
						<RefreshCw className="h-3 w-3" />
						<span>{t("common.retry")}</span>
					</button>
				</div>
			)}

			{isLoading && (
				<div className="flex items-center justify-center py-6 text-neutral-500">
					<Loader2 aria-label={t("providers.loadingProvidersAria")} size={16} className="animate-spin" />
				</div>
			)}

			{!isLoading && !error && filtered.length === 0 && (
				<div className="rounded-xl hairline bg-[var(--well-bg)]/40 px-4 py-8 text-center text-xs text-neutral-400">
					{rows.length === 0 ? (
						<div className="space-y-3">
							<p className="text-sm text-neutral-200">{t("providers.emptyProvidersTitle")}</p>
							<p>{t("providers.emptyProvidersDesc")}</p>
							<button
								type="button"
								onClick={() => setDialog({ mode: "add" })}
								className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95"
							>
								<Plus className="h-3.5 w-3.5" />
								<span>{t("providers.addProviderBtn")}</span>
							</button>
						</div>
					) : (
						<div className="space-y-2">
							<p>{t("providers.noMatchingProviders", { query: query.trim() })}</p>
							<button type="button" onClick={() => setQuery("")} className="rounded-md border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors hover:bg-[var(--bg-hover)] text-[var(--accent)]">
								{t("providers.clearFilterBtn")}
							</button>
						</div>
					)}
				</div>
			)}

			{!isLoading && !error && filtered.length > 0 && (
				<div className="space-y-2">
					<div className={`${ROW_GRID} px-2.5 text-[11px] text-neutral-500`}>
						<span>{t("providers.colProviderName")}</span>
						<span className="whitespace-nowrap">{t("providers.colKeyAction")}</span>
						<span className="text-right">{t("providers.colEnable")}</span>
					</div>
					{PROVIDER_GROUP_ORDER.map((gid) => {
						const groupRows = grouped[gid];
						if (groupRows.length === 0) return null;
						const searching = query.trim() !== "";
						const hasExpanded = expandedId !== null && groupRows.some((r) => r.id === expandedId);
						return (
							<ProviderGroup
								key={gid}
								id={gid}
								rows={groupRows}
								open={searching || (groupOpen[gid] ?? (GROUP_DEFAULT_OPEN[gid] || hasExpanded))}
								onToggle={() =>
									setGroupOpen((cur) => ({
										...cur,
										[gid]: !(searching || (cur[gid] ?? (GROUP_DEFAULT_OPEN[gid] || hasExpanded))),
									}))
								}
								limit={groupLimit[gid] ?? GROUP_PAGE_SIZE}
								onSetLimit={(n) => setGroupLimit((cur) => ({ ...cur, [gid]: n }))}
								pinnedId={expandedId}
								showAll={searching}
								renderRow={(row) => (
									<ProviderRowView
										row={row}
										expanded={expandedId === row.id}
										onToggleExpand={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
										onEdit={() => setDialog({ mode: "edit", row })}
										onSetKey={() => setKeyDialogId(row.id)}
										onOauth={() => setOauthDialog(true)}
									/>
								)}
							/>
						);
					})}
				</div>
			)}

			<div className="text-[11px] leading-relaxed text-neutral-600">
				{t("providers.footerNote", { vaultPath: VAULT_PATH, modelsYmlPath: MODELS_YML_PATH })}
			</div>
			{dialog && <ProviderDialog target={dialog} onClose={() => setDialog(null)} />}
			{keyDialogRow && <SetKeyDialog row={keyDialogRow} onClose={() => setKeyDialogId(null)} />}
			{oauthDialog && <OauthLoginDialog onClose={() => setOauthDialog(false)} />}
		</div>
	);
}
