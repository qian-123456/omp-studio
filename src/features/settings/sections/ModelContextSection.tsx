/**
 * Settings ▸ 统一模型上下文 (`model-context`):
 * Three-Tier context hierarchy (同品牌 / 同档位 / 同模型).
 * Primary-first model filtering keeps secondary relay models out of the way
 * while allowing them to automatically inherit brand & tier context limits.
 * Strictly per-model updates: provider defaultContextWindow is NEVER touched.
 */
import { useEffect, useMemo, useState } from "react";
import {
	ChevronDown,
	ChevronRight,
	Eye,
	Layers,
	RotateCcw,
	Search,
	Sparkles,
	Tags,
} from "lucide-react";
import { errMsg } from "../../../lib/dialogs";
import { toast } from "../../../lib/toast";
import { useSessions } from "../../../stores/sessions";
import { formatTokens } from "../../providers/modelEntry";
import { useProviders } from "../../providers/store";
import type {
	CanonicalModelGroup,
	ContextUpdate,
	ModelFamily,
	ResolvedContext,
	ThreeTierConfig,
} from "../modelContextTypes";
import {
	PRESET_BRANDS,
	PRESET_TIERS,
	applyContextUpdates,
	computeThreeTierUpdates,
	groupModels,
	isPrimaryModel,
	loadThreeTierConfig,
	parseContextInput,
	resolveGroupContext,
	saveThreeTierConfig,
} from "../modelNormalization";
import { useOmpConfigStore } from "../ompConfigStore";
import { INPUT_CLASS, SETTINGS_BUTTON_CLASS, SectionHeader, SettingsCard } from "../ui";

const PRESETS: [string, number][] = [
	["128K", 128_000],
	["200K", 200_000],
	["256K", 256_000],
	["272K", 272_000],
	["300K", 300_000],
	["500K", 500_000],
	["1M", 1_000_000],
	["2M", 2_000_000],
];

const FAMILIES: ModelFamily[] = ["Claude", "GPT", "Gemini", "DeepSeek", "Qwen", "其他"];

const srcKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;
const fmt = (n: number | null | undefined) => (n == null ? "未设置" : formatTokens(n).toUpperCase());
const CONTEXT_PLACEHOLDER = "例如 200 或 200k";

/** Live preview of what a context input will save, e.g. `200k (200,000 tokens)`. */
function ContextInputPreview({ input, saved }: { input: string; saved: number | undefined }) {
	if (!input.trim()) {
		return (
			<span className="min-w-[140px] text-[11px] text-neutral-500">
				{saved != null ? `${formatTokens(saved)} (${saved.toLocaleString("en-US")} tokens)` : "未设置（沿用供应商配置）"}
			</span>
		);
	}
	const parsed = parseContextInput(input);
	return parsed == null ? (
		<span className="min-w-[140px] text-[11px] text-amber-400">无法识别</span>
	) : (
		<span className="min-w-[140px] text-[11px] text-neutral-300">
			{formatTokens(parsed)} ({parsed.toLocaleString("en-US")} tokens)
		</span>
	);
}

export function ModelContextSection() {
	const providers = useProviders((s) => s.providers);
	const loaded = useProviders((s) => s.loaded);
	const load = useProviders((s) => s.load);
	const sessions = useSessions((s) => s.sessions);
	const ompEntries = useOmpConfigStore((s) => s.entries);

	useEffect(() => {
		if (!loaded) void load();
	}, [loaded, load]);

	const groups = useMemo(() => groupModels(providers), [providers]);

	// Extract models used in active sessions or role assignments
	const activeSessionModels = useMemo(() => {
		const set = new Set<string>();
		for (const sess of Object.values(sessions)) {
			if (sess?.model) set.add(sess.model);
		}
		return set;
	}, [sessions]);

	const roleModels = useMemo(() => {
		const set = new Set<string>();
		const rolesEntry = ompEntries.find((e) => e.key === "modelRoles");
		if (rolesEntry?.value && typeof rolesEntry.value === "object") {
			for (const val of Object.values(rolesEntry.value as Record<string, unknown>)) {
				if (typeof val === "string") set.add(val);
			}
		}
		return set;
	}, [ompEntries]);

	const [config, setConfig] = useState<ThreeTierConfig>(loadThreeTierConfig);
	const [excluded, setExcluded] = useState<Record<string, true>>({});
	const [saving, setSaving] = useState(false);

	// Filter state
	const [viewMode, setViewMode] = useState<"primary" | "all">("primary");
	const [selectedFamily, setSelectedFamily] = useState<ModelFamily | "all">("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [ruleScopeTab, setRuleScopeTab] = useState<"tier" | "brand">("tier");

	const updateConfig = (next: ThreeTierConfig) => {
		setConfig(next);
		saveThreeTierConfig(next);
	};

	// Compute pending updates
	const pendingUpdates: ContextUpdate[] = useMemo(() => {
		return computeThreeTierUpdates(providers, groups, config, excluded);
	}, [providers, groups, config, excluded]);

	const draftCount = pendingUpdates.length;

	// Distinguish primary vs secondary models
	const primaryGroupKeys = useMemo(() => {
		const set = new Set<string>();
		for (const g of groups) {
			const hasCustom = config.models[g.key] != null;
			if (isPrimaryModel(g, { activeSessionModels, roleModels, hasCustomConfig: hasCustom })) {
				set.add(g.key);
			}
		}
		return set;
	}, [groups, config.models, activeSessionModels, roleModels]);

	// Filtered groups
	const filteredGroups = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		return groups.filter((g) => {
			if (viewMode === "primary" && !primaryGroupKeys.has(g.key)) {
				// If user explicitly searched, don't filter out by primary
				if (!q) return false;
			}
			if (selectedFamily !== "all" && g.family !== selectedFamily) return false;
			if (!q) return true;
			if (g.name.toLowerCase().includes(q)) return true;
			if (g.tierName.toLowerCase().includes(q)) return true;
			if (g.family.toLowerCase().includes(q)) return true;
			return g.sources.some((s) => s.providerName.toLowerCase().includes(q) || s.modelId.toLowerCase().includes(q));
		});
	}, [groups, viewMode, primaryGroupKeys, selectedFamily, searchQuery]);

	const secondaryCount = groups.length - primaryGroupKeys.size;

	// Save all resolved updates into ProviderConfig.models
	const saveAll = async () => {
		if (pendingUpdates.length === 0) {
			toast.info("当前没有需要更新的模型上下文");
			return;
		}
		setSaving(true);
		try {
			const changed = applyContextUpdates(providers, pendingUpdates);
			const save = useProviders.getState().save;
			for (const p of changed) {
				await save(p);
			}
			toast.success(`已为 ${changed.length} 个供应商统一更新了 ${pendingUpdates.length} 个模型的上下文大小`);
		} catch (e) {
			toast.error(`保存失败：${errMsg(e)}`);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-6">
			<SectionHeader
				title="统一模型上下文"
				description="跨中转站统一设置同款模型的上下文上限。按「同品牌」、「同档位」、「同模型」三级层次设置；次要模型自动继承品牌与档位设定，无需逐个配置。"
				actions={
					<button
						type="button"
						className={SETTINGS_BUTTON_CLASS}
						disabled={saving || draftCount === 0}
						onClick={() => void saveAll()}
					>
						{saving ? "保存中…" : `全部保存并生效${draftCount ? `（${draftCount} 项变动）` : ""}`}
					</button>
				}
			/>

			{/* ── Card 1: 品牌与档位规则设置 (同品牌 / 同档位) ────────────────── */}
			<SettingsCard
				title="基准与档位统配（同档位 / 同品牌）"
				fieldId="modelContextTiers"
				footer="为档位或品牌设置的上下文上限会自动向下继承。当某个模型未单独定制时，优先继承「同档位」设定，其次继承「同品牌」设定。"
			>
				{/* Scope switcher */}
				<div className="flex items-center gap-1 border-b border-[var(--border-divider)] px-4 py-2 text-xs">
					<button
						type="button"
						className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors ${
							ruleScopeTab === "tier"
								? "bg-neutral-800 text-neutral-100 shadow-xs"
								: "text-neutral-400 hover:text-neutral-200"
						}`}
						onClick={() => setRuleScopeTab("tier")}
					>
						<Layers className="h-3.5 w-3.5" /> 按「同档位」快速统配（推荐）
					</button>
					<button
						type="button"
						className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors ${
							ruleScopeTab === "brand"
								? "bg-neutral-800 text-neutral-100 shadow-xs"
								: "text-neutral-400 hover:text-neutral-200"
						}`}
						onClick={() => setRuleScopeTab("brand")}
					>
						<Tags className="h-3.5 w-3.5" /> 按「同品牌」默认兜底
					</button>
				</div>

				{/* Tier view */}
				{ruleScopeTab === "tier" && (
					<div className="divide-y divide-[var(--border-divider)] text-xs">
						{PRESET_TIERS.map((tier) => {
							const currentVal = config.tiers[tier.id];
							return (
								<TierConfigRow
									key={tier.id}
									tier={tier}
									value={currentVal}
									onChange={(v) => {
										const next = { ...config, tiers: { ...config.tiers, [tier.id]: v } };
										if (v == null) delete next.tiers[tier.id];
										updateConfig(next);
									}}
								/>
							);
						})}
					</div>
				)}

				{/* Brand view */}
				{ruleScopeTab === "brand" && (
					<div className="divide-y divide-[var(--border-divider)] text-xs">
						{PRESET_BRANDS.map((brand) => {
							const currentVal = config.brands[brand.family];
							return (
								<BrandConfigRow
									key={brand.family}
									brand={brand}
									value={currentVal}
									onChange={(v) => {
										const next = { ...config, brands: { ...config.brands, [brand.family]: v } };
										if (v == null) delete next.brands[brand.family];
										updateConfig(next);
									}}
								/>
							);
						})}
					</div>
				)}
			</SettingsCard>

			{/* ── Card 2: 模型列表与精准微调 (同模型) ────────────────────────── */}
			<SettingsCard
				title={`模型列表与独立设置（${filteredGroups.length}/${groups.length}）`}
				fieldId="modelContextGroups"
			>
				{/* Filter & Search Bar */}
				<div className="space-y-2 border-b border-[var(--border-divider)] px-4 py-3 text-xs">
					<div className="flex flex-wrap items-center justify-between gap-2">
						{/* Primary vs All Mode */}
						<div className="inline-flex rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] p-0.5">
							<button
								type="button"
								className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
									viewMode === "primary"
										? "bg-neutral-800 text-neutral-100 shadow-xs"
										: "text-neutral-400 hover:text-neutral-200"
								}`}
								onClick={() => setViewMode("primary")}
							>
								<Sparkles className="h-3.5 w-3.5 text-amber-400" />
								常用与主流 ({primaryGroupKeys.size})
							</button>
							<button
								type="button"
								className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
									viewMode === "all"
										? "bg-neutral-800 text-neutral-100 shadow-xs"
										: "text-neutral-400 hover:text-neutral-200"
								}`}
								onClick={() => setViewMode("all")}
							>
								全部模型 ({groups.length})
							</button>
						</div>

						{/* Search Input */}
						<div className="relative min-w-[200px] flex-1 max-w-xs">
							<Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-neutral-500" />
							<input
								className={`${INPUT_CLASS} w-full pl-8`}
								placeholder="搜索模型、中转站、原始 ID…"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
							/>
						</div>
					</div>

					{/* Family quick filter pills */}
					<div className="flex flex-wrap items-center gap-1 pt-1">
						<span className="mr-1 text-neutral-500">品牌：</span>
						<button
							type="button"
							className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
								selectedFamily === "all"
									? "bg-neutral-700 text-neutral-100 font-medium"
									: "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
							}`}
							onClick={() => setSelectedFamily("all")}
						>
							全部
						</button>
						{FAMILIES.map((fam) => (
							<button
								key={fam}
								type="button"
								className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
									selectedFamily === fam
										? "bg-neutral-700 text-neutral-100 font-medium"
										: "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
								}`}
								onClick={() => setSelectedFamily(fam)}
							>
								{fam}
							</button>
						))}
					</div>
				</div>

				{/* Model Groups List */}
				{filteredGroups.length === 0 ? (
					<div className="px-4 py-8 text-center text-xs text-neutral-500">
						未找到匹配的模型。
						{viewMode === "primary" && secondaryCount > 0 && (
							<button
								type="button"
								className="ml-2 text-[var(--accent)] underline hover:text-neutral-200"
								onClick={() => setViewMode("all")}
							>
								查看包含次要模型的全部列表 ({groups.length} 个)
							</button>
						)}
					</div>
				) : (
					<div className="divide-y divide-[var(--border-divider)]">
						{filteredGroups.map((g) => {
							const resolved = resolveGroupContext(g, config);
							const hasCustom = config.models[g.key] != null;
							return (
								<ModelGroupRow
									key={g.key}
									group={g}
									resolved={resolved}
									hasCustom={hasCustom}
									excluded={excluded}
									onToggleSource={(k) =>
										setExcluded((prev) => {
											const next = { ...prev };
											if (next[k]) delete next[k];
											else next[k] = true;
											return next;
										})
									}
									onSetCustom={(val) => {
										const next = {
											...config,
											models: { ...config.models, [g.key]: val },
										};
										updateConfig(next);
									}}
									onClearCustom={() => {
										const next = { ...config, models: { ...config.models } };
										delete next.models[g.key];
										updateConfig(next);
									}}
								/>
							);
						})}
					</div>
				)}

				{/* Secondary Collapsible Hint Footer */}
				{viewMode === "primary" && secondaryCount > 0 && !searchQuery && (
					<div className="border-t border-[var(--border-divider)] bg-neutral-950/40 px-4 py-3 text-xs text-neutral-400 flex items-center justify-between">
						<span className="flex items-center gap-1.5">
							<Eye className="h-3.5 w-3.5 text-neutral-500" />
							已自动隐藏 {secondaryCount} 个冷门/次要模型（它们已按上方品牌/档位规则继承上下文上限）。
						</span>
						<button
							type="button"
							className="text-[var(--accent)] hover:underline font-medium"
							onClick={() => setViewMode("all")}
						>
							展开全部模型
						</button>
					</div>
				)}
			</SettingsCard>
		</div>
	);
}

// ── Tier row editor ──────────────────────────────────────────────────

function TierConfigRow({
	tier,
	value,
	onChange,
}: {
	tier: (typeof PRESET_TIERS)[number];
	value: number | undefined;
	onChange(val: number | undefined): void;
}) {
	const [input, setInput] = useState(value != null ? formatTokens(value) : "");

	useEffect(() => {
		setInput(value != null ? formatTokens(value) : "");
	}, [value]);

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="font-medium text-neutral-200">{tier.name}</span>
					<span className="rounded bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-400">
						{tier.family}
					</span>
					{value != null && (
						<span className="rounded bg-emerald-950/70 border border-emerald-800/60 px-1.5 py-0.2 text-[10px] text-emerald-300">
							已统配
						</span>
					)}
				</div>
				<div className="mt-0.5 text-[11px] text-neutral-400">{tier.description}</div>
			</div>

			<div className="flex items-center gap-2">
				<input
					className={`${INPUT_CLASS} w-28 text-right`}
					placeholder={CONTEXT_PLACEHOLDER}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onBlur={() => {
						if (!input.trim()) {
							onChange(undefined);
							return;
						}
						const parsed = parseContextInput(input);
						if (parsed != null) {
							onChange(parsed);
							setInput(formatTokens(parsed));
						} else {
							setInput(value != null ? formatTokens(value) : "");
						}
					}}
				/>
				<span className="text-[11px] text-neutral-500">(k tokens)</span>
				<ContextInputPreview input={input} saved={value} />
				{value != null && (
					<button
						type="button"
						title="清除设置（沿用供应商配置）"
						className="p-1 text-neutral-400 hover:text-neutral-200"
						onClick={() => onChange(undefined)}
					>
						<RotateCcw className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}

// ── Brand row editor ─────────────────────────────────────────────────

function BrandConfigRow({
	brand,
	value,
	onChange,
}: {
	brand: (typeof PRESET_BRANDS)[number];
	value: number | undefined;
	onChange(val: number | undefined): void;
}) {
	const [input, setInput] = useState(value != null ? formatTokens(value) : "");

	useEffect(() => {
		setInput(value != null ? formatTokens(value) : "");
	}, [value]);

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="font-medium text-neutral-200">{brand.name}</span>
					{value != null && (
						<span className="rounded bg-emerald-950/70 border border-emerald-800/60 px-1.5 py-0.2 text-[10px] text-emerald-300">
							已设品牌默认
						</span>
					)}
				</div>
				<div className="mt-0.5 text-[11px] text-neutral-400">
					该品牌下所有未设档位/独立模型的通用兜底上限
				</div>
			</div>

			<div className="flex items-center gap-2">
				<input
					className={`${INPUT_CLASS} w-28 text-right`}
					placeholder={CONTEXT_PLACEHOLDER}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onBlur={() => {
						if (!input.trim()) {
							onChange(undefined);
							return;
						}
						const parsed = parseContextInput(input);
						if (parsed != null) {
							onChange(parsed);
							setInput(formatTokens(parsed));
						} else {
							setInput(value != null ? formatTokens(value) : "");
						}
					}}
				/>
				<span className="text-[11px] text-neutral-500">(k tokens)</span>
				<ContextInputPreview input={input} saved={value} />
				{value != null && (
					<button
						type="button"
						title="清除设置（沿用供应商配置）"
						className="p-1 text-neutral-400 hover:text-neutral-200"
						onClick={() => onChange(undefined)}
					>
						<RotateCcw className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}

// ── Model Group Row (同模型) ──────────────────────────────────────────

function ModelGroupRow({
	group,
	resolved,
	hasCustom,
	excluded,
	onToggleSource,
	onSetCustom,
	onClearCustom,
}: {
	group: CanonicalModelGroup;
	resolved: ResolvedContext;
	hasCustom: boolean;
	excluded: Record<string, true>;
	onToggleSource(key: string): void;
	onSetCustom(value: number): void;
	onClearCustom(): void;
}) {
	const [open, setOpen] = useState(false);
	const [input, setInput] = useState(hasCustom && resolved.value ? formatTokens(resolved.value) : "");
	const parsed = parseContextInput(input);

	useEffect(() => {
		if (hasCustom && resolved.value) setInput(formatTokens(resolved.value));
	}, [hasCustom, resolved.value]);

	// Visual pill for resolution source
	const sourceBadge = () => {
		switch (resolved.source) {
			case "model":
				return <span className="rounded bg-emerald-950/80 border border-emerald-800/80 px-1.5 py-0.5 text-[10px] text-emerald-300 font-medium">独立设置</span>;
			case "tier":
				return <span className="rounded bg-sky-950/80 border border-sky-800/80 px-1.5 py-0.5 text-[10px] text-sky-300">继承档位</span>;
			case "brand":
				return <span className="rounded bg-purple-950/80 border border-purple-800/80 px-1.5 py-0.5 text-[10px] text-purple-300">继承品牌</span>;
			case "provider":
				return <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">中转站既有</span>;
			default:
				return <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-500">未设置</span>;
		}
	};

	return (
		<div className="px-4 py-3 text-xs">
			<button
				type="button"
				className="flex w-full items-center gap-2 text-left hover:text-neutral-200 transition-colors"
				onClick={() => setOpen(!open)}
			>
				{open ? <ChevronDown className="h-3.5 w-3.5 text-neutral-400" /> : <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />}
				<span className="font-medium text-neutral-100">{group.name}</span>
				<span className="rounded bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-300 font-mono">
					{group.family}
				</span>
				<span className="text-neutral-500 hidden sm:inline">{group.tierName}</span>
				<span className="text-neutral-500">· {group.sources.length} 个来源</span>

				<div className="ml-auto flex items-center gap-2">
					{sourceBadge()}
					<span className="font-mono text-neutral-200">{fmt(resolved.value)}</span>
					<span
						className={
							group.unified
								? "rounded px-1.5 py-0.5 text-[10px] text-emerald-400"
								: "rounded px-1.5 py-0.5 text-[10px] text-amber-400"
						}
					>
						{group.unified ? "已统一" : "有差异"}
					</span>
				</div>
			</button>

			{open && (
				<div className="mt-3 space-y-3 pl-5 border-l-2 border-neutral-800 ml-1.5">
					<div className="text-[11px] text-neutral-400">
						生效规则：{resolved.sourceLabel}
						{hasCustom && (
							<button
								type="button"
								className="ml-2 text-amber-400 hover:underline"
								onClick={onClearCustom}
							>
								清除独立配置（恢复继承）
							</button>
						)}
					</div>

					{/* Provider sources list */}
					<ul className="space-y-1.5">
						{group.sources.map((s) => {
							const k = srcKey(s.providerId, s.modelId);
							const willChange = resolved.value != null && s.contextWindow !== resolved.value;
							return (
								<li key={k} className="flex items-center gap-2 rounded bg-neutral-900/60 px-2 py-1">
									<input
										type="checkbox"
										title="是否在此组中统一管理此来源"
										checked={!excluded[k]}
										onChange={() => onToggleSource(k)}
									/>
									<span className="w-32 truncate text-neutral-300 font-medium">{s.providerName}</span>
									<code className="flex-1 truncate text-neutral-400 font-mono text-[11px]">{s.modelId}</code>
									<span className="text-neutral-400 font-mono">
										当前：{fmt(s.contextWindow)}
										{!excluded[k] && willChange && (
											<span className="text-[var(--accent)] font-semibold"> → {fmt(resolved.value)}</span>
										)}
									</span>
								</li>
							);
						})}
					</ul>

					{/* Custom model override */}
					<div className="flex flex-wrap items-center gap-2 pt-1">
						<span className="text-neutral-400">为此模型单独指定：</span>
						<input
							className={`${INPUT_CLASS} w-32`}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={CONTEXT_PLACEHOLDER}
							aria-label="独立上下文窗口"
						/>
						<span className="text-[11px] text-neutral-500">(k tokens)</span>
						<ContextInputPreview input={input} saved={undefined} />
						{PRESETS.map(([label, n]) => (
							<button
								key={label}
								type="button"
								className="rounded hairline px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-[var(--bg-hover)]"
								onClick={() => setInput(label.toLowerCase())}
							>
								{label}
								<span className="sr-only">{n}</span>
							</button>
						))}
						<button
							type="button"
							className={SETTINGS_BUTTON_CLASS}
							disabled={parsed == null}
							onClick={() => parsed != null && onSetCustom(parsed)}
						>
							设为此模型独立配置
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
