/**
 * Settings ▸ 上下文窗口 (`context-window`): auto-compaction card, a flat
 * provider × model window table (family rail, model-type sections, filters,
 * bulk apply with undo, inline edit), keyword rules and the remaining
 * `compaction.*` options. Workbench models write `providers.json`
 * (per-model only, never `defaultContextWindow`); OMP-managed models write
 * `~/.omp/agent/models.yml` modelOverrides.
 */
import clsx from "clsx";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Pencil, Search, Trash2, X } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../../components/FloatingLayer";
import { HoverScrollText } from "../../../components/HoverScrollText";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { ompModelsContextWindowOverrides, ompModelsSetContextWindows } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { useModelCatalog } from "../../../stores/modelCatalog";
import { formatTokens } from "../../providers/modelEntry";
import { useProviders } from "../../providers/store";
import { AutoCompactionCard } from "../AutoCompactionCard";
import { DEFAULT_RESERVE_TOKENS, readThreshold, resolveMode } from "../autoCompactionLogic";
import {
	type ContextWindowRule,
	type CwRow,
	FAMILIES,
	type Family,
	type StatusFilter,
	compactionTriggerPoint,
	exceedsUpstream,
	keywordsOf,
	loadRules,
	matchRule,
	modelFamily,
	planRule,
	rowKey,
	ruleKeywordsForBrand,
	selectionState,
	saveRules,
	takenOverCount,
} from "../contextWindow/core";
import { applyContextUpdates, matchKey, parseContextInput, ruleMatches } from "../modelNormalization";
import { OmpSections, OmpSettingRow } from "../OmpSettingsList";
import { useOmpConfigStore } from "../ompConfigStore";
import { Button, Chip, INPUT_CLASS, IconButton, Notice, SectionHeader, SettingsCard } from "../ui";
import { useCatalogModels } from "../useAppSettings";

/** `to` is the value written (null deletes); `shown` is the window to display afterwards when it differs (catalog undo). */
type Edit = { row: CwRow; to: number | null; shown?: number | null };
type Section = { key: string; name: string; rows: CwRow[] };
type FlatItem = { kind: "head"; section: Section } | { kind: "row"; row: CwRow };

const fmt = (n: number) => formatTokens(n).toUpperCase();

const GROW_WARNING =
	"新值大于该模型的上游原始窗口：超过模型真实上限会导致自动压缩来不及触发、请求报错（提示上下文过长）。若出现此类错误，请回到本页调小。";

/** Rows shown while the table is collapsed and no model has been modified yet. */
const PREVIEW_ROWS = 6;

const CARD_KEYS = new Set(["compaction.enabled", "compaction.thresholdTokens", "compaction.thresholdPercent"]);

function GrowWarning() {
	return <Notice tone="warning">{GROW_WARNING}</Notice>;
}

/** Writes edits to both targets; workbench via providers.json, catalog via models.yml. */
async function writeEdits(edits: Edit[]): Promise<void> {
	const wb = edits.filter((e) => e.row.kind === "workbench");
	const cat = edits.filter((e) => e.row.kind === "catalog");
	if (wb.length > 0) {
		const store = useProviders.getState();
		const changed = applyContextUpdates(
			store.providers,
			wb.map((e) => ({ providerId: e.row.providerId, modelId: e.row.modelId, contextWindow: e.to })),
		);
		for (const p of changed) await store.save(p);
	}
	if (cat.length > 0) {
		await ompModelsSetContextWindows(
			cat.map((e) => ({ providerId: e.row.providerId, modelId: e.row.modelId, contextWindow: e.to })),
		);
	}
	// The composer's context popover reads windows from the shared catalog: re-read models.yml now.
	await useModelCatalog.getState().refresh();
}

export function ContextWindowSection() {
	const providers = useProviders((s) => s.providers);
	const ompProviders = useProviders((s) => s.ompProviders);
	const entries = useOmpConfigStore((s) => s.entries);
	const { models: catalog } = useCatalogModels();

	// Existing models.yml overrides: distinguishes catalog built-ins from overrides so undo can delete.
	const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
	// Rows overridden at load time: their catalog value is not the upstream original (null = not loaded yet).
	const [loadedOverrideKeys, setLoadedOverrideKeys] = useState<Set<string> | null>(null);
	useEffect(() => {
		void useProviders.getState().load();
		void useProviders.getState().loadOmp();
		void useOmpConfigStore.getState().load();
		ompModelsContextWindowOverrides()
			.then((list) => {
				const map = new Map(list.flatMap((o) => (o.contextWindow == null ? [] : [[rowKey(o), o.contextWindow] as const])));
				setOverrides(map);
				setLoadedOverrideKeys(new Set(map.keys()));
			})
			.catch((e) => toast.error(`读取模型窗口覆盖失败：${errMsg(e)}`));
	}, []);

	// models.yml writes are reflected locally; the catalog cache only refreshes on remount.
	const [catalogOverlay, setCatalogOverlay] = useState<Map<string, number | null>>(new Map());
	const [rules, setRulesState] = useState<ContextWindowRule[]>(loadRules);
	const setRules = (next: ContextWindowRule[]) => {
		saveRules(next);
		setRulesState(next);
	};

	const rows = useMemo<CwRow[]>(() => {
		const out: CwRow[] = providers.flatMap((p) =>
			p.models.map((e) => ({
				providerId: p.id,
				providerName: p.name,
				modelId: typeof e === "string" ? e : e.id,
				contextWindow: typeof e === "string" ? null : (e.contextWindow ?? null),
				kind: "workbench" as const,
				upstreamWindow: null,
			})),
		);
		// Workbench providers are bridged into OMP as `ompws-<slug>`; skip those aliases.
		const aliases = new Set(providers.flatMap((p) => [p.id, p.slug, `ompws-${p.slug}`, `ompws-${p.id}`]));
		const managed = new Set(
			ompProviders
				.filter((p) => p.hasApiKey || p.credentialTypes.length > 0 || p.accounts.length > 0 || p.modelIds.length > 0)
				.map((p) => p.id)
				.filter((id) => !aliases.has(id)),
		);
		for (const m of catalog) {
			if (!managed.has(m.provider)) continue;
			const key = rowKey({ providerId: m.provider, modelId: m.id });
			out.push({
				providerId: m.provider,
				providerName: m.provider,
				modelId: m.id,
				contextWindow: catalogOverlay.has(key) ? (catalogOverlay.get(key) ?? null) : (m.contextWindow ?? null),
				kind: "catalog",
				upstreamWindow: loadedOverrideKeys == null || loadedOverrideKeys.has(key) ? null : (m.contextWindow ?? null),
			});
		}
		return out;
	}, [providers, ompProviders, catalog, catalogOverlay, loadedOverrideKeys]);

	// ── Compaction threshold → trigger point column ──
	const valueOf = (key: string) => entries.find((e) => e.key === key)?.value;
	const compactionOn = valueOf("compaction.enabled") !== false;
	const threshold = readThreshold(valueOf("compaction.thresholdTokens"), valueOf("compaction.thresholdPercent"));
	const thresholdMode = resolveMode(threshold);
	const triggerOf = (window: number) =>
		thresholdMode === "percent"
			? compactionTriggerPoint(window, { mode: "percent", value: threshold.percent })
			: thresholdMode === "tokens"
				? compactionTriggerPoint(window, { mode: "tokens", value: threshold.tokens })
				: { tokens: Math.max(0, window - DEFAULT_RESERVE_TOKENS), unreachable: window <= DEFAULT_RESERVE_TOKENS };

	// ── Filters ──
	const [family, setFamily] = useState<Family | "all">(FAMILIES[0] ?? "all");
	const [query, setQuery] = useState("");
	const [providerFilter, setProviderFilter] = useState("all");
	const [status, setStatus] = useState<StatusFilter>("all");
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [showAll, setShowAll] = useState(false);

	const deferredQuery = useDeferredValue(query);
	const keywords = keywordsOf(deferredQuery);
	const familyCounts = useMemo(() => {
		const m = new Map<Family, number>();
		for (const r of rows) m.set(modelFamily(r.modelId), (m.get(modelFamily(r.modelId)) ?? 0) + 1);
		return m;
	}, [rows]);
	const providerOptions = useMemo(
		() => [...new Map(rows.map((r) => [r.providerId, r.providerName])).entries()],
		[rows],
	);

	// Distinct known windows per model type, across all rows (drives 不一致).
	const windowsByType = useMemo(() => {
		const m = new Map<string, Set<number>>();
		for (const r of rows) {
			if (r.contextWindow == null) continue;
			const k = matchKey(r.modelId).key;
			if (!m.has(k)) m.set(k, new Set());
			m.get(k)?.add(r.contextWindow);
		}
		return m;
	}, [rows]);

	// Collapsed (default) view: only models overridden in models.yml, or the first few when none are.
	const focusOnly = !showAll && keywords.length === 0 && providerFilter === "all" && status === "all";
	const { sections, matchedTotal, preview } = useMemo(() => {
		let matched: CwRow[] = [];
		for (const r of rows) {
			if (family !== "all" && modelFamily(r.modelId) !== family) continue;
			if (providerFilter !== "all" && r.providerId !== providerFilter) continue;
			if (keywords.length > 0 && !ruleMatches({ keywords }, r.modelId)) continue;
			const mixed = (windowsByType.get(matchKey(r.modelId).key)?.size ?? 0) > 1;
			if (status === "unset" && r.contextWindow != null) continue;
			if (status === "set" && r.contextWindow == null) continue;
			if (status === "mixed" && !mixed) continue;
			matched.push(r);
		}
		const total = matched.length;
		let preview = false;
		if (focusOnly) {
			const changed = matched.filter((r) => r.kind === "catalog" && overrides.has(rowKey(r)));
			preview = changed.length === 0;
			matched = preview ? matched.slice(0, PREVIEW_ROWS) : changed;
		}
		const map = new Map<string, { key: string; name: string; rows: CwRow[] }>();
		for (const r of matched) {
			const { key, name } = matchKey(r.modelId);
			let s = map.get(key);
			if (!s) map.set(key, (s = { key, name, rows: [] }));
			s.rows.push(r);
		}
		return {
			sections: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)),
			matchedTotal: total,
			preview,
		};
	}, [rows, family, providerFilter, keywords.join(" "), status, windowsByType, focusOnly, overrides]);

	const rowsByKey = useMemo(() => new Map(rows.map((r) => [rowKey(r), r])), [rows]);

	// Flattened (section header + visible rows) list feeding the virtualizer.
	const flatItems = useMemo<FlatItem[]>(
		() =>
			sections.flatMap((s): FlatItem[] => [
				{ kind: "head", section: s },
				...(collapsed.has(s.key) ? [] : s.rows.map((row): FlatItem => ({ kind: "row", row }))),
			]),
		[sections, collapsed],
	);
	const listRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: flatItems.length,
		getScrollElement: () => listRef.current,
		estimateSize: (i) => (flatItems[i]?.kind === "head" ? 42 : 33),
		overscan: 12,
		getItemKey: (i) => {
			const it = flatItems[i];
			return it ? (it.kind === "head" ? `h:${it.section.key}` : `r:${rowKey(it.row)}`) : i;
		},
	});
	const selectedRows = [...selected].map((k) => rowsByKey.get(k)).filter((r): r is CwRow => r != null);
	const filteredKeys = useMemo(() => sections.flatMap((s) => s.rows.map(rowKey)), [sections]);
	const filterState = selectionState(filteredKeys, selected);

	// ── Writing with undo ──
	const [undo, setUndo] = useState<{ label: string; edits: Edit[] } | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!undo) return;
		const t = setTimeout(() => setUndo(null), 10_000);
		return () => clearTimeout(t);
	}, [undo]);

	const commit = async (edits: Edit[]) => {
		await writeEdits(edits);
		const cat = edits.filter((e) => e.row.kind === "catalog");
		if (cat.length > 0) {
			setCatalogOverlay((prev) => {
				const next = new Map(prev);
				for (const e of cat) next.set(rowKey(e.row), e.shown !== undefined ? e.shown : e.to);
				return next;
			});
			setOverrides((prev) => {
				const next = new Map(prev);
				for (const e of cat) {
					if (e.to == null) next.delete(rowKey(e.row));
					else next.set(rowKey(e.row), e.to);
				}
				return next;
			});
		}
	};

	/** Apply edits immediately and offer undo back to each row's prior value (incl. absent). */
	const applyWithUndo = async (edits: Edit[], label: string) => {
		const real = edits.filter((e) => e.row.contextWindow !== e.to);
		if (real.length === 0) {
			toast.info("没有需要修改的模型");
			return;
		}
		setBusy(true);
		try {
			await commit(real);
			setUndo({
				label,
				edits: real.map((e) =>
					e.row.kind === "catalog"
						? { row: { ...e.row, contextWindow: e.to }, to: overrides.get(rowKey(e.row)) ?? null, shown: e.row.contextWindow }
						: { row: { ...e.row, contextWindow: e.to }, to: e.row.contextWindow },
				),
			});
		} catch (e) {
			toast.error(`写入失败：${errMsg(e)}`);
		} finally {
			setBusy(false);
		}
	};

	const runUndo = async () => {
		if (!undo) return;
		const { edits } = undo;
		setUndo(null);
		setBusy(true);
		try {
			await commit(edits);
			toast.success(`已撤销 ${edits.length} 个模型的修改`);
		} catch (e) {
			toast.error(`撤销失败：${errMsg(e)}`);
		} finally {
			setBusy(false);
		}
	};

	/** D8(a)/D9/D12: apply a rule to every row it wins; confirm before overwriting differing values. */
	const applyRule = async (rule: ContextWindowRule, allRules: ContextWindowRule[], skip: Set<string>, prior: Edit[]) => {
		const plan = planRule(rule, allRules, rows.filter((r) => !skip.has(rowKey(r))));
		const conflicts = plan.changes.filter((c) => c.from != null);
		let changes = plan.changes;
		if (conflicts.length > 0 || plan.takenOver.length > 0) {
			const lines = conflicts.map((c) => `模型 ${c.row.modelId}（${c.row.providerName}）：${fmt(c.from ?? 0)} → ${fmt(c.to)}`);
			const grows = changes.some((c) => exceedsUpstream(c.row, c.to));
			const takeovers = [...new Map(plan.takenOver.map((t) => [t.winner.id, t.winner])).values()].map((w) => {
				const names = plan.takenOver.filter((t) => t.winner.id === w.id).map((t) => t.row.modelId);
				return `以下模型同时命中「${rule.keywords.join(" ")}」和「${w.keywords.join(" ")}」，将按更具体的「${w.keywords.join(" ")}」= ${fmt(w.contextWindow)}：${names.join("、")}`;
			});
			const message = [
				conflicts.length > 0 ? `规则将覆盖 ${conflicts.length} 个已有值：\n${lines.join("\n")}` : "",
				grows ? `\n注意：${GROW_WARNING}` : "",
				takeovers.length > 0 ? `\n${takeovers.join("\n")}` : "",
			]
				.filter(Boolean)
				.join("\n");
			const overwrite =
				conflicts.length === 0
					? (await confirmDialog(message, { title: "规则接管提示", okLabel: "知道了", cancelLabel: "取消" })) || null
					: await confirmDialog(message, { title: "确认覆盖", okLabel: "全部覆盖", cancelLabel: "保留原值" });
			if (overwrite === null) return false;
			if (!overwrite) changes = changes.filter((c) => c.from == null);
		}
		await applyWithUndo([...prior, ...changes.map((c) => ({ row: c.row, to: c.to }))], `规则「${rule.keywords.join(" ")}」`);
		return true;
	};

	// ── Bottom bar ──
	const [bulkInput, setBulkInput] = useState("");
	const [remember, setRemember] = useState(false);
	const bulkValue = parseContextInput(bulkInput);
	const bulkGrows = bulkValue != null && selectedRows.some((r) => exceedsUpstream(r, bulkValue));
	const familyKeys = family === "all" ? [] : rows.filter((r) => modelFamily(r.modelId) === family).map(rowKey);
	const wholeBrand = familyKeys.length > 0 && familyKeys.every((k) => selected.has(k));
	const ruleKeywords = ruleKeywordsForBrand(family, wholeBrand, selectedRows.map((r) => r.modelId));

	const applySelected = async () => {
		if (bulkValue == null) return;
		const edits = selectedRows.map((row) => ({ row, to: bulkValue }));
		if (remember && ruleKeywords.length > 0) {
			const rule: ContextWindowRule = {
				id: crypto.randomUUID(),
				keywords: ruleKeywords,
				contextWindow: bulkValue,
				createdAt: Date.now(),
			};
			const all = [...rules, rule];
			setRules(all);
			await applyRule(rule, all, new Set(selected), edits);
		} else {
			await applyWithUndo(edits, `已选 ${edits.length} 个模型`);
		}
		setSelected(new Set());
		setBulkInput("");
		setRemember(false);
	};

	// ── Rule editing ──
	const [editingRule, setEditingRule] = useState<{ id: string; keywords: string; value: string } | null>(null);
	const saveRuleEdit = async () => {
		if (!editingRule) return;
		const kws = keywordsOf(editingRule.keywords);
		const value = parseContextInput(editingRule.value);
		if (kws.length === 0 || value == null) {
			toast.error("请填写关键词和有效的窗口值（如 200k、1m）");
			return;
		}
		const all = rules.map((r) => (r.id === editingRule.id ? { ...r, keywords: kws, contextWindow: value } : r));
		const rule = all.find((r) => r.id === editingRule.id);
		setRules(all);
		setEditingRule(null);
		if (rule) await applyRule(rule, all, new Set(), []);
	};

	const toggle = (keys: string[], on: boolean) =>
		setSelected((prev) => {
			const next = new Set(prev);
			for (const k of keys) on ? next.add(k) : next.delete(k);
			return next;
		});

	const moreKeys = entries.filter((e) => e.key.startsWith("compaction.") && !CARD_KEYS.has(e.key));
	const promotionEntries = entries.filter((e) => e.key.startsWith("contextPromotion."));
	const extendedEntry = entries.find((e) => e.key === "extendedContext");
	const reloadConfig = () => void useOmpConfigStore.getState().load(true);

	return (
		<div className="space-y-6">
			<SectionHeader title="上下文窗口" description="每个模型的上下文大小，以及什么时候自动压缩对话" />

			<Notice tone="warning">窗口设得比模型真实上限大，会导致自动压缩来不及触发、请求报错。</Notice>

			<SettingsCard title="自动压缩" fieldId="compaction">
				<AutoCompactionCard />
				{extendedEntry && (
					<div data-field-id="extendedContext">
						<OmpSettingRow entry={extendedEntry} onChanged={reloadConfig} />
					</div>
				)}
				{promotionEntries.map((e) => (
					<OmpSettingRow key={e.key} entry={e} onChanged={reloadConfig} />
				))}
			</SettingsCard>

			<SettingsCard
				title="每个模型的上下文大小"
				description={
					focusOnly
						? preview
							? `尚未修改任何模型，先显示前 ${PREVIEW_ROWS} 个，共 ${rows.length} 个模型`
							: `仅显示已修改的模型，共 ${rows.length} 个模型`
						: `当前显示 ${matchedTotal} 个，共 ${rows.length} 个模型`
				}
				aside={
					(showAll || focusOnly) && (
						<Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
							{showAll ? "收起" : `展开全部 ${rows.length} 个模型`}
						</Button>
					)
				}
				footer="订阅与 OMP 托管模型的窗口写入 OMP 模型配置，新开会话生效。工作台供应商的模型写入各自的模型配置，不修改供应商默认窗口。"
			>
				<div className="flex min-h-[320px]">
					{/* Family rail */}
					<div className="w-40 shrink-0 space-y-0.5 self-start p-2">
						{(["all", ...FAMILIES.filter((f) => f === family || (familyCounts.get(f) ?? 0) > 0)] as const).map((f) => {
							const count = f === "all" ? rows.length : (familyCounts.get(f) ?? 0);
							return (
								<button
									key={f}
									type="button"
									onClick={() => setFamily(f)}
									className={clsx(
										"flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px]",
										family === f
											? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text)]"
											: "text-[var(--text-muted)] hover:bg-[var(--bg-active-fill)]",
									)}
								>
									<span className="min-w-0 flex-1 truncate">{f === "all" ? "全部" : f}</span>
									<Chip tone={family === f ? "accent" : "neutral"}>{count}</Chip>
								</button>
							);
						})}
					</div>

					<div className="flex min-w-0 flex-1 flex-col gap-2 border-l border-[var(--border-divider)] p-3">
						<div className="flex flex-wrap items-center gap-2">
							<div className={clsx(INPUT_CLASS, "flex min-w-[160px] flex-1 items-center gap-1.5 py-1")}>
								<Search className="h-3 w-3 shrink-0 text-[var(--text-dim)]" />
								<input
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="搜索模型 ID，空格分隔多个关键词"
									aria-label="搜索模型"
									className="w-full bg-transparent outline-none"
								/>
								{query && (
									<button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>
										<X className="h-3 w-3 text-[var(--text-dim)]" />
									</button>
								)}
							</div>
							<FilterMenu
								label="供应商筛选"
								value={providerFilter}
								onChange={setProviderFilter}
								options={[
									{ value: "all", label: "全部供应商" },
									...providerOptions.map(([id, name]) => ({ value: id, label: name })),
								]}
							/>
							<FilterMenu
								label="状态筛选"
								value={status}
								onChange={setStatus}
								options={[
									{ value: "all", label: "全部状态" },
									{ value: "unset", label: "未知" },
									{ value: "mixed", label: "不一致" },
									{ value: "set", label: "已设置" },
								]}
							/>
						</div>

						{sections.length > 0 && (
							<div className="flex items-center gap-2 bg-[var(--bg-panel)] px-2 py-1 text-[10px] text-[var(--text-dim)]">
								<input
									type="checkbox"
									aria-label="全选当前筛选"
									ref={(el) => {
										if (el) el.indeterminate = filterState === "some";
									}}
									checked={filterState === "all"}
									onChange={(e) => toggle(filteredKeys, e.target.checked)}
								/>
								<button
									type="button"
									className="shrink-0 text-[var(--accent)]"
									onClick={() => toggle(filteredKeys, filterState !== "all")}
								>
									{filterState === "all" ? "取消全选" : "全选"} {filteredKeys.length}
								</button>
								<span className="min-w-0 flex-1 whitespace-nowrap" title="模型的原始 ID（供应商接口里的名字）">
									模型 ID
								</span>
								<span className="w-28 shrink-0 whitespace-nowrap" title="提供该模型的供应商；「订阅」表示 OMP 托管的订阅模型">
									供应商
								</span>
								<span className="w-20 shrink-0 whitespace-nowrap text-right" title="窗口 = 模型一次能读入的最大长度（tokens）">
									上下文窗口
								</span>
								<span className="w-24 shrink-0 whitespace-nowrap text-right" title="触发点 = 对话达到多长时自动压缩">
									压缩触发点
								</span>
							</div>
						)}

						{sections.length === 0 && (
							<div className="py-10 text-center text-[11px] text-[var(--text-dim)]">没有符合条件的模型</div>
						)}
						{/* Settings dialog is min(80vh, 820px) tall; reserve room for the card's title, search row, column header and selection footer so the whole card fits one view.
						    Rows are virtualized: the unfiltered list is ~1800 models. */}
						<div ref={listRef} className="max-h-[calc(min(80vh,820px)-290px)] overflow-y-auto">
							<div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
								{virtualizer.getVirtualItems().map((v) => {
									const item = flatItems[v.index];
									if (!item) return null;
									const pos = { transform: `translateY(${v.start}px)` };
									if (item.kind === "head") {
										const s = item.section;
										const keys = s.rows.map(rowKey);
										const allOn = keys.every((k) => selected.has(k));
										const windows = windowsByType.get(s.key)?.size ?? 0;
										const isCollapsed = collapsed.has(s.key);
										return (
											<div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className="absolute left-0 top-0 w-full pt-2" style={pos}>
												<div className="flex items-center gap-2 rounded-t-lg bg-[var(--well-bg)] px-2 py-1.5 text-[11px] hairline">
													<input
														type="checkbox"
														aria-label={`选择 ${s.name} 全部`}
														checked={allOn}
														onChange={(e) => toggle(keys, e.target.checked)}
													/>
													<button
														type="button"
														className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium text-[var(--text)]"
														onClick={() =>
															setCollapsed((prev) => {
																const next = new Set(prev);
																isCollapsed ? next.delete(s.key) : next.add(s.key);
																return next;
															})
														}
													>
														{isCollapsed ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
														<HoverScrollText text={s.name} className="min-w-0 flex-1" title={s.name} />
													</button>
													<span className="shrink-0 text-[var(--text-dim)]">{new Set(s.rows.map((r) => r.providerId)).size} 个供应商</span>
													{windows > 1 && (
														<span className="shrink-0" title={`${new Set(s.rows.map((r) => r.providerId)).size} 个供应商给出了不同的上下文窗口`}>
															<Chip tone="warning" icon={AlertTriangle}>
																窗口不一致
															</Chip>
														</span>
													)}
												</div>
											</div>
										);
									}
									const r = item.row;
									return (
										<div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className="absolute left-0 top-0 w-full" style={pos}>
											<ModelRowView
												row={r}
												checked={selected.has(rowKey(r))}
												onCheck={(on) => toggle([rowKey(r)], on)}
												trigger={compactionOn && r.contextWindow != null ? triggerOf(r.contextWindow) : null}
												compactionOn={compactionOn}
												modified={r.kind === "catalog" && overrides.has(rowKey(r))}
												onEdit={(to) => applyWithUndo([{ row: r, to }], r.modelId)}
											/>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				</div>

				{selectedRows.length > 0 && (
					<div className="space-y-2 border-t border-[var(--border-divider)] bg-[var(--bg-panel)] px-3 py-2">
						<div className="flex flex-wrap items-center gap-2 text-[11px]">
							<span className="font-medium text-[var(--text)]">已选 {selectedRows.length} 个</span>
							<input
								value={bulkInput}
								onChange={(e) => setBulkInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") void applySelected();
								}}
								placeholder="窗口，如 200k、1m"
								aria-label="批量窗口值"
								className={clsx(INPUT_CLASS, "w-36 py-1 font-mono")}
							/>
							{bulkInput.trim() && (
								<span className={bulkValue == null ? "text-[var(--status-warning)]" : "text-[var(--text-muted)]"}>
									{bulkValue == null ? "无法识别" : `${bulkValue.toLocaleString("en-US")} Token`}
								</span>
							)}
							<Button size="sm" disabled={bulkValue == null || busy} onClick={() => void applySelected()}>
								应用
							</Button>
							<label
								className={clsx("flex items-center gap-1", ruleKeywords.length === 0 && "opacity-50")}
								title={ruleKeywords.length === 0 ? "所选模型没有共同名称，无法记为规则" : undefined}
							>
								<input
									type="checkbox"
									disabled={ruleKeywords.length === 0}
									checked={remember && ruleKeywords.length > 0}
									onChange={(e) => setRemember(e.target.checked)}
								/>
								记住为规则
								{ruleKeywords.length > 0
									? `（${wholeBrand ? `整个 ${family} 品牌：` : ""}${ruleKeywords.join(" ")}）`
									: "：所选模型没有共同名称，无法记为规则"}
							</label>
							<Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
								取消选择
							</Button>
						</div>
						{bulkGrows && <GrowWarning />}
					</div>
				)}
			</SettingsCard>

			<SettingsCard
				title="规则"
				footer="规则 = 关键词 + 窗口值。新建或修改规则会立即应用到所有匹配模型；供应商保存时只对新增模型生效。多条规则命中时，关键词更多者优先，相同则后建者优先。"
			>
				{rules.length === 0 && (
					<div className="px-4 py-3 text-[11px] text-[var(--text-dim)]">
						暂无规则。勾选模型后，勾选「记住为规则」即可按所选模型的共同名称创建。
					</div>
				)}
				{rules.map((r) => {
					const matched = rows.filter((row) => matchRule(r, row.modelId)).length;
					const taken = takenOverCount(r, rules, rows);
					const editing = editingRule?.id === r.id ? editingRule : null;
					return (
						<div key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[11px]">
							{editing ? (
								<>
									<input
										value={editing.keywords}
										onChange={(e) => setEditingRule({ ...editing, keywords: e.target.value })}
										aria-label="规则关键词"
										className={clsx(INPUT_CLASS, "w-48 py-1")}
									/>
									<input
										value={editing.value}
										onChange={(e) => setEditingRule({ ...editing, value: e.target.value })}
										aria-label="规则窗口值"
										className={clsx(INPUT_CLASS, "w-24 py-1 font-mono")}
									/>
									<Button size="sm" disabled={busy} onClick={() => void saveRuleEdit()}>
										保存
									</Button>
									<Button variant="ghost" size="sm" onClick={() => setEditingRule(null)}>
										取消
									</Button>
									{(() => {
										const v = parseContextInput(editing.value);
										const kws = keywordsOf(editing.keywords);
										return (
											v != null &&
											kws.length > 0 &&
											rows.some((row) => matchRule({ keywords: kws }, row.modelId) && exceedsUpstream(row, v)) && <GrowWarning />
										);
									})()}
								</>
							) : (
								<>
									<span className="flex flex-wrap gap-1">
										{r.keywords.map((k) => (
											<Chip key={k}>
												<span className="font-mono">{k}</span>
											</Chip>
										))}
									</span>
									<span className="font-mono text-[var(--text)]">= {fmt(r.contextWindow)}</span>
									<span className="text-[var(--text-dim)]">命中 {matched} 个</span>
									{taken > 0 && <Chip tone="warning">有 {taken} 个模型被更具体的规则接管</Chip>}
									<span className="ml-auto flex gap-1">
										<IconButton
											icon={Pencil}
											label="编辑规则"
											size="sm"
											onClick={() => setEditingRule({ id: r.id, keywords: r.keywords.join(" "), value: fmt(r.contextWindow) })}
										/>
										<IconButton
											icon={Trash2}
											label="删除规则"
											size="sm"
											onClick={() => setRules(rules.filter((x) => x.id !== r.id))}
										/>
									</span>
								</>
							)}
						</div>
					);
				})}
			</SettingsCard>

			{moreKeys.length > 0 && (
				<details className="group">
					<summary className="cursor-pointer px-1 text-[11px] font-semibold text-[var(--text-muted)]">
						更多压缩选项（{moreKeys.length}）
					</summary>
					<div className="mt-1.5 divide-y divide-[var(--border-divider)] rounded-xl hairline bg-[var(--bg-panel)]">
						{moreKeys.map((e) => (
							<OmpSettingRow key={e.key} entry={e} onChanged={reloadConfig} />
						))}
					</div>
				</details>
			)}

			{undo && (
				<div className="fixed bottom-6 left-1/2 z-(--z-toast) flex -translate-x-1/2 items-center gap-3 rounded-xl hairline bg-[var(--bg-panel)] px-4 py-2 text-xs text-[var(--text)] shadow-apple-card">
					<span>
						已更新 {undo.edits.length} 个模型的窗口（{undo.label}）
					</span>
					<Button variant="ghost" size="sm" onClick={() => void runUndo()}>
						撤销
					</Button>
					<IconButton icon={X} label="关闭" size="sm" onClick={() => setUndo(null)} />
				</div>
			)}

			<OmpSections page="context-window" />
		</div>
	);
}

function ModelRowView({
	row,
	checked,
	onCheck,
	trigger,
	compactionOn,
	modified,
	onEdit,
}: {
	row: CwRow;
	checked: boolean;
	onCheck: (on: boolean) => void;
	trigger: { tokens: number; unreachable: boolean } | null;
	compactionOn: boolean;
	modified: boolean;
	onEdit: (to: number) => Promise<void>;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const parsed = draft == null ? null : parseContextInput(draft);
	const commit = async () => {
		if (parsed == null) return;
		setDraft(null);
		await onEdit(parsed);
	};
	return (
		<div
			data-field-id={`cw-model:${rowKey(row)}`}
			className="border-t border-[var(--border-divider)] px-2 py-1 text-[11px]"
		>
			<div className="flex items-center gap-2">
				<input type="checkbox" aria-label={`选择 ${row.modelId}`} checked={checked} onChange={(e) => onCheck(e.target.checked)} />
				<span className="min-w-0 flex-1 break-all font-mono" title={row.modelId}>
					{row.modelId}
					{modified && (
						<span className="ml-1.5 align-middle font-sans">
							<Chip tone="accent">已修改</Chip>
						</span>
					)}
				</span>
				<span className="flex w-28 shrink-0 items-center gap-1 text-[var(--text-dim)]" title={row.providerName}>
					<span className="min-w-0 break-words">{row.providerName}</span>
					{row.kind === "catalog" && <Chip tone="accent">订阅</Chip>}
				</span>
				<span className="w-20 shrink-0 text-right">
					{draft != null ? (
						<input
							// biome-ignore lint/a11y/noAutofocus: inline cell editor opened by click
							autoFocus
							value={draft}
							aria-label={`${row.modelId} 窗口`}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") void commit();
								if (e.key === "Escape") {
									e.stopPropagation();
									setDraft(null);
								}
							}}
							onBlur={() => setDraft(null)}
							className={clsx(INPUT_CLASS, "w-full px-1.5 py-0.5 text-right font-mono", draft && parsed == null && "text-[var(--status-warning)]")}
						/>
					) : (
						<button
							type="button"
							title="点击编辑"
							onClick={() => setDraft(row.contextWindow != null ? fmt(row.contextWindow) : "")}
							className={clsx("font-mono hover:underline", row.contextWindow == null ? "text-[var(--status-error)]" : "text-[var(--text)]")}
						>
							{row.contextWindow != null ? fmt(row.contextWindow) : "未知"}
						</button>
					)}
				</span>
				<span
					className={clsx("w-24 shrink-0 whitespace-nowrap text-right font-mono", trigger?.unreachable ? "text-[var(--status-error)]" : "text-[var(--text-dim)]")}
					title="压缩触发点"
				>
					{!compactionOn ? "压缩已关闭" : trigger == null ? "—" : trigger.unreachable ? "永远触发不到" : fmt(trigger.tokens)}
				</span>
			</div>
			{draft != null && parsed != null && exceedsUpstream(row, parsed) && (
				<div className="mt-1">
					<GrowWarning />
				</div>
			)}
		</div>
	);
}

/** Compact dropdown filter built on the shared FloatingLayer popover. */
function FilterMenu<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
}) {
	const [open, setOpen] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);
	const current = options.find((o) => o.value === value) ?? options[0];
	return (
		<>
			<button
				ref={btnRef}
				type="button"
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className={clsx(INPUT_CLASS, "flex items-center gap-1.5 py-1 text-left")}
			>
				<span className="max-w-[10rem] truncate">{current?.label}</span>
				<ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-dim)]" />
			</button>
			<FloatingLayer
				anchor={open ? btnRef.current : null}
				placement="bottom-start"
				layer="popover"
				ignoreRefs={[btnRef]}
				onDismiss={() => setOpen(false)}
				role="listbox"
				aria-label={label}
				className="max-h-72 min-w-[10rem] overflow-y-auto rounded-lg p-1 text-[11px] shadow-apple-card hairline"
			>
				{options.map((o) => (
					<button
						key={o.value}
						type="button"
						role="option"
						aria-selected={o.value === value}
						onClick={() => {
							onChange(o.value);
							setOpen(false);
						}}
						className={clsx(
							"flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)]",
							o.value === value ? "text-[var(--text)]" : "text-[var(--text-muted)]",
						)}
					>
						<span className="min-w-0 flex-1 truncate">{o.label}</span>
						{o.value === value && <Check className="h-3 w-3 shrink-0 text-[var(--accent)]" />}
					</button>
				))}
			</FloatingLayer>
		</>
	);
}
