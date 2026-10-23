/**
 * [D] Settings ▸ 回退链与切换: rules keyed by a specific model, a provider
 * wildcard (`provider/*`) or a prefixed wildcard (`openrouter/google/*`). They
 * live in the same `retry.fallbackChains` record as role chains; role-chain
 * writes preserve them and this section preserves everything else.
 */
import { ChevronDown, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ModelSelect } from "../../components/ModelSelect";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { ompConfigSet } from "../../lib/ipc";
import type { ModelOption } from "../../lib/models";
import { toast } from "../../lib/toast";
import { FallbackChainEditor, PICKER_BUTTON_CLASS } from "./FallbackChainEditor";
import { buildWildcard, classifyChainKey, parseChain, ruleKeys, validateChainKey, withChain } from "./modelRoles";
import { Button, Chip, SettingsCard, type ChipTone } from "./ui";

const KEY_CHIP: Record<string, { label: string; tone: ChipTone }> = {
	model: { label: "模型", tone: "neutral" },
	provider: { label: "供应商", tone: "accent" },
	prefix: { label: "前缀通配符", tone: "warning" },
	invalid: { label: "格式有误", tone: "danger" },
};

/** Whether a rule key matches a search needle (key text or its Chinese kind label). */
export function ruleMatchesQuery(key: string, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return key.toLowerCase().includes(needle) || KEY_CHIP[classifyChainKey(key)].label.includes(needle);
}

function RuleRow({
	ruleKey,
	isDraft,
	defaultOpen,
	chains,
	models,
	roleIds,
	busy,
	onSaved,
	onDelete,
}: {
	ruleKey: string;
	isDraft: boolean;
	defaultOpen: boolean;
	chains: Record<string, unknown>;
	models: ModelOption[];
	roleIds: string[];
	busy: boolean;
	onSaved: () => void;
	onDelete: () => void;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const chain = useMemo(() => parseChain(chains[ruleKey]), [chains, ruleKey]);
	const kind = KEY_CHIP[classifyChainKey(ruleKey)];
	const preview = isDraft
		? "尚未保存：选「自定义」添加备用模型并点应用"
		: chain.state === "list"
			? chain.items.join(" → ")
			: chain.state === "empty"
				? "失败即停，不回退"
				: "";

	return (
		<div>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				title={preview ? `${ruleKey}\n${preview}` : ruleKey}
				className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
			>
				<span className="min-w-0 flex-1">
					<span className="flex flex-wrap items-center gap-1.5">
						<Chip tone={kind.tone}>{kind.label}</Chip>
						<span className="min-w-0 break-all font-mono text-xs font-semibold text-[var(--text)]">{ruleKey}</span>
					</span>
					{preview && (
						<span className="mt-1 block break-all font-mono text-[11px] leading-[1.45] text-[var(--text-dim)]">{preview}</span>
					)}
				</span>
				<Chip tone={isDraft ? "neutral" : chain.state === "empty" ? "warning" : chain.state === "list" ? "success" : "neutral"}>
					{isDraft ? "未保存" : chain.state === "empty" ? "不回退" : `${chain.items.length} 项`}
				</Chip>
				<ChevronDown className={`mt-1 h-3 w-3 shrink-0 text-[var(--text-dim)] transition-transform ${open ? "rotate-180" : ""}`} />
			</button>
			{open && (
				<div className="space-y-2 px-4 pb-3">
					<FallbackChainEditor
						chainKey={ruleKey}
						chains={chains}
						models={models}
						roleIds={roleIds}
						onSaved={onSaved}
						onCollapse={() => setOpen(false)}
						unsetTitle="删除这条规则：不再单独处理这个对象"
						emptyTitle="显式空链 []：这个对象失败时不回退"
					/>
					<Button variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={onDelete}>
						删除这条规则
					</Button>
				</div>
			)}
		</div>
	);
}

/** Model / provider rules card: list, add flow, delete. */
export function ModelRulesSection({
	chains,
	models,
	roleIds,
	query,
	onSaved,
}: {
	chains: Record<string, unknown>;
	models: ModelOption[];
	roleIds: string[];
	query: string;
	onSaved: () => void;
}) {
	const [drafts, setDrafts] = useState<string[]>([]);
	const [justAdded, setJustAdded] = useState<string | null>(null);
	const [addMode, setAddMode] = useState<"model" | "provider">("model");
	const [provider, setProvider] = useState("");
	const [prefix, setPrefix] = useState("");
	const [busy, setBusy] = useState(false);

	const providers = useMemo(() => [...new Set(models.map((m) => m.provider))].sort(), [models]);
	const saved = ruleKeys(chains);
	const pending = drafts.filter((k) => !(k in chains));
	const visible = [...saved, ...pending].filter((k) => ruleMatchesQuery(k, query));
	const searching = query.trim() !== "";
	if (searching && visible.length === 0) return null;

	const addRule = (key: string) => {
		const problem = validateChainKey(key);
		if (problem) {
			toast.error(`规则对象「${key}」${problem}`);
			return;
		}
		if (!key.includes("/")) {
			toast.error("规则对象需要写成 供应商/模型");
			return;
		}
		if (key in chains || drafts.includes(key)) {
			toast.error(`已经有「${key}」这条规则，直接在列表里修改即可`);
			setJustAdded(key);
			return;
		}
		setDrafts([...drafts, key]);
		setJustAdded(key);
	};

	const removeRule = async (key: string) => {
		const ok = await confirmDialog(`删除「${key}」这条规则？这个对象之后按角色回退链处理。`, {
			title: "删除规则",
			danger: true,
			okLabel: "删除",
		});
		if (!ok) return;
		setDrafts(drafts.filter((k) => k !== key));
		if (!(key in chains)) return;
		setBusy(true);
		try {
			await ompConfigSet("retry.fallbackChains", JSON.stringify(withChain(chains, key, null)));
			onSaved();
		} catch (e) {
			toast.error(`删除规则失败：${errMsg(e)}`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<SettingsCard
			title="模型规则"
			jump="模型规则"
			aside={`${visible.length} 条`}
			description="按出错的模型单独设置备用模型，优先级高于角色回退链"
			clip
		>
			{visible.length === 0 ? (
				<p className="px-4 py-3 text-xs leading-5 text-[var(--text-dim)]">
					还没有规则。规则让某一个模型（或某个供应商）出错时走专属的备用名单，不管它当时扮演什么角色。
				</p>
			) : (
				visible.map((k) => (
					<RuleRow
						key={k}
						ruleKey={k}
						isDraft={!(k in chains)}
						defaultOpen={k === justAdded}
						chains={chains}
						models={models}
						roleIds={roleIds}
						busy={busy}
						onSaved={onSaved}
						onDelete={() => void removeRule(k)}
					/>
				))
			)}
			{!searching && (
				<div className="space-y-2 px-4 py-3">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-xs font-semibold text-[var(--text)]">新增规则</span>
						<Segmented
							size="sm"
							value={addMode}
							onChange={(m) => setAddMode(m === "provider" ? "provider" : "model")}
							options={[
								{ value: "model", label: "指定一个模型" },
								{ value: "provider", label: "指定整个供应商" },
							]}
						/>
					</div>
					{addMode === "model" ? (
						<ModelSelect
							closeOnSelect
							allowCustom
							direction="down"
							align="start"
							widthClass="w-[380px]"
							label="选择要设规则的模型"
							buttonClass={PICKER_BUTTON_CLASS}
							models={models}
							currentValue=""
							onSelect={(v) => {
								if (v) addRule(v);
							}}
						/>
					) : (
						<div className="flex flex-wrap items-center gap-1.5">
							<NativeSelect
								value={provider}
								disabled={providers.length === 0}
								containerClassName="w-40"
								onChange={(e) => setProvider(e.target.value)}
							>
								<option value="">选择供应商</option>
								{providers.map((p) => (
									<option key={p} value={p}>
										{p}
									</option>
								))}
							</NativeSelect>
							<input
								type="text"
								value={prefix}
								onChange={(e) => setPrefix(e.target.value)}
								spellCheck={false}
								placeholder="模型名前缀（可不填）"
								title="例如在 openrouter 下填 google，只管 openrouter/google/ 开头的模型"
								className="w-40 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all"
							/>
							<Button
								variant="primary"
								disabled={!provider}
								onClick={() => {
									addRule(buildWildcard(provider, prefix));
									setPrefix("");
								}}
							>
								添加规则
							</Button>
						</div>
					)}
				</div>
			)}
		</SettingsCard>
	);
}
