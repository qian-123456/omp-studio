import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import type { PageProps } from "../../../core/nav";
import { BottomSheet } from "../../../ui/BottomSheet";
import { ModelPicker, type PickerModel } from "../../../ui/ModelPicker";
import { toast } from "../../../ui/Toast";
import {
	chainHas,
	fallbackSetBody,
	moveItem,
	normalizeChains,
	removeAt,
	withChain,
	type CatalogModel,
	type DiffRow,
	type FallbackChains,
	type RolesResponse,
} from "./logic";
import { Btn, ConfirmDiffSheet, SectionTitle, SettingsPageFrame, SheetFooter, useLoader } from "./shared";

interface Loaded {
	global: FallbackChains;
	project: FallbackChains | null;
	models: CatalogModel[];
}

const iconBtn =
	"flex min-h-11 min-w-11 items-center justify-center rounded-m-md border border-m-border bg-m-surface-2 text-m-text disabled:opacity-40";

const listText = (chain: string[]): string => (chain.length ? chain.map((e, i) => `${i + 1}. ${e}`).join("\n") : "（空）");

export function SettingsFallbacksPage({ route }: PageProps) {
	const cwd = route.query.cwd || null;
	const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
	const { data, error, loading, reload } = useLoader<Loaded>(async () => {
		const [fb, roles] = await Promise.all([
			api<{ global?: unknown; project?: unknown }>("GET", `/left/fallbacks${q}`),
			api<RolesResponse>("GET", `/left/roles${q}`),
		]);
		return {
			global: normalizeChains(fb.global),
			project: fb.project ? normalizeChains(fb.project) : null,
			models: roles.models ?? [],
		};
	});

	const [draft, setDraft] = useState<FallbackChains | null>(null);
	const [adding, setAdding] = useState<string | null>(null);
	const [pick, setPick] = useState<PickerModel | null>(null);
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const saved = data?.global;
	const chains = draft ?? saved ?? {};
	const roles = useMemo(() => {
		const keys = new Set<string>(["default", ...Object.keys(saved ?? {}), ...Object.keys(chains)]);
		return [...keys];
	}, [saved, chains]);

	const rows: DiffRow[] = useMemo(() => {
		if (!draft || !saved) return [];
		const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
		return [...keys]
			.map((k) => ({ label: `${k} 回退链`, before: listText(saved[k] ?? []), after: listText(draft[k] ?? []) }))
			.filter((r) => r.before !== r.after);
	}, [draft, saved]);

	const edit = (role: string, next: string[]) => setDraft(withChain(chains, role, next));

	const save = async () => {
		if (!draft) return;
		setBusy(true);
		setSaveError(null);
		try {
			await api("POST", "/left/fallbacks/set", fallbackSetBody(draft));
			toast("回退链已更新", { kind: "success" });
			setConfirming(false);
			setDraft(null);
			reload();
		} catch (e) {
			setSaveError(errorMessage(e, "保存失败"));
		} finally {
			setBusy(false);
		}
	};

	const closeAdd = () => {
		setAdding(null);
		setPick(null);
	};

	return (
		<SettingsPageFrame title="模型故障回退链" loading={loading && !data} error={error} onRetry={reload}>
			{data?.project && (
				<div className="m-3 rounded-m-md border border-m-warn bg-m-surface p-3 text-m-sm text-m-text-2">
					<div className="font-semibold text-m-warn">当前项目有专属回退链（只读）</div>
					<div className="mt-1 select-text whitespace-pre-wrap break-all font-m-mono text-m-xs">
						{Object.entries(data.project)
							.map(([k, v]) => `${k}:\n${listText(v)}`)
							.join("\n")}
					</div>
					<div className="mt-1 text-m-xs text-m-text-3">手机端只能修改全局回退链；下方为全局配置。</div>
				</div>
			)}
			{roles.map((role) => {
				const chain = chains[role] ?? [];
				return (
					<section key={role}>
						<SectionTitle
							title={role === "default" ? "主力模型（default）故障降级顺位" : `${role} 故障降级顺位`}
							hint={`${chain.length} 个备选`}
						/>
						{chain.length === 0 && (
							<div className="px-4 pb-2 text-m-sm text-m-text-3">当前尚未配置备选模型（失败后直接报错）</div>
						)}
						{chain.map((entry, idx) => (
							<div key={`${idx}:${entry}`} className="flex items-center gap-2 border-b border-m-border px-4 py-2">
								<div className="min-w-0 flex-1">
									<div className="text-m-xs text-m-text-3">第 {idx + 1} 顺位备选</div>
									<div className="select-text break-all font-m-mono text-m-sm text-m-text">{entry}</div>
								</div>
								<button
									type="button"
									aria-label="上移"
									disabled={idx === 0}
									onClick={() => edit(role, moveItem(chain, idx, -1))}
									className={iconBtn}
								>
									<ArrowUp size={18} />
								</button>
								<button
									type="button"
									aria-label="下移"
									disabled={idx === chain.length - 1}
									onClick={() => edit(role, moveItem(chain, idx, 1))}
									className={iconBtn}
								>
									<ArrowDown size={18} />
								</button>
								<button
									type="button"
									aria-label="移除"
									onClick={() => edit(role, removeAt(chain, idx))}
									className={`${iconBtn} text-m-danger`}
								>
									<X size={18} />
								</button>
							</div>
						))}
						<div className="px-4 py-3">
							<Btn onClick={() => setAdding(role)}>
								<Plus size={16} className="mr-1" aria-hidden />
								添加备用模型
							</Btn>
						</div>
					</section>
				);
			})}

			{draft && (
				<div
					className="sticky bottom-0 flex items-center gap-2 border-t border-m-border bg-m-bg-elev px-4 py-2"
					role="region"
					aria-label="未保存的更改"
				>
					<span className="min-w-0 flex-1 text-m-sm text-m-text-2">有未保存的更改</span>
					<Btn onClick={() => setDraft(null)}>还原</Btn>
					<Btn
						kind="primary"
						disabled={rows.length === 0}
						onClick={() => {
							setSaveError(null);
							setConfirming(true);
						}}
					>
						保存
					</Btn>
				</div>
			)}

			<BottomSheet
				open={adding != null}
				onClose={closeAdd}
				fullHeight
				title="添加备选模型"
				footer={
					<SheetFooter
						onCancel={closeAdd}
						saveText="添加"
						saveDisabled={
							!pick || (adding != null && chainHas(chains[adding] ?? [], pick.provider, pick.id))
						}
						onSave={() => {
							if (adding && pick) edit(adding, [...(chains[adding] ?? []), `${pick.provider}/${pick.id}`]);
							closeAdd();
						}}
					/>
				}
			>
				<div className="h-[calc(var(--m-vh,100dvh)*0.6)] px-4">
					<ModelPicker
						className="h-full"
						models={data?.models ?? []}
						value={pick ? { provider: pick.provider, modelId: pick.id } : null}
						onChange={setPick}
					/>
					{pick && adding && chainHas(chains[adding] ?? [], pick.provider, pick.id) && (
						<div className="pt-2 text-m-xs text-m-warn">该模型已在此回退链中</div>
					)}
				</div>
			</BottomSheet>

			<ConfirmDiffSheet
				open={confirming}
				title="确认修改回退链"
				rows={rows}
				busy={busy}
				error={saveError}
				onCancel={() => setConfirming(false)}
				onConfirm={save}
			/>
		</SettingsPageFrame>
	);
}
