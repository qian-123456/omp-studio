import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import type { PageProps } from "../../../core/nav";
import { BottomSheet, Button, IconButton, ListGroup, ListRow, toast } from "../../../ui";
import { ModelPicker, type PickerModel } from "../../../ui/ModelPicker";
import { GroupBlock } from "../rows";
import { OmpSettingsGroup, type Omp } from "../OmpSettings";
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
import { ConfirmDiffSheet, SettingsPageFrame, SheetFooter, useLoader } from "./shared";

interface Loaded {
	global: FallbackChains;
	project: FallbackChains | null;
	models: CatalogModel[];
}

const SMALL = { size: 18, strokeWidth: 1.75 } as const;
const RETRY_KEYS = ["retry.enabled", "retry.maxRetries", "retry.maxDelayMs", "retry.waitForUsageReset"] as const;

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
	// Retry settings come from a separate endpoint; a failure only hides that group.
	const [omp, setOmp] = useState<Omp | undefined>(undefined);
	useEffect(() => {
		const ctl = new AbortController();
		api<{ omp?: Omp }>("GET", "/left/settings")
			.then((r) => {
				if (!ctl.signal.aborted) setOmp(r.omp);
			})
			.catch(() => {});
		return () => ctl.abort();
	}, []);

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
			.map((k) => ({ label: `${k} 备用链`, before: listText(saved[k] ?? []), after: listText(draft[k] ?? []) }))
			.filter((r) => r.before !== r.after);
	}, [draft, saved]);

	const edit = (role: string, next: string[]) => setDraft(withChain(chains, role, next));

	const save = async () => {
		if (!draft) return;
		setBusy(true);
		setSaveError(null);
		try {
			await api("POST", "/left/fallbacks/set", fallbackSetBody(draft));
			toast("备用链已更新", { kind: "success" });
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
		<SettingsPageFrame title="备用模型与重试" loading={loading && !data} error={error} onRetry={reload}>
			{data?.project && (
				<ListGroup title="当前项目的专属备用链（只读）" note="手机端只能修改全局备用链；下方为全局配置。">
					<GroupBlock>
						<div className="m-selectable whitespace-pre-wrap break-all font-m-mono text-m-sm text-m-text-2">
							{Object.entries(data.project)
								.map(([k, v]) => `${k}:\n${listText(v)}`)
								.join("\n")}
						</div>
					</GroupBlock>
				</ListGroup>
			)}
			{data &&
				roles.map((role) => {
					const chain = chains[role] ?? [];
					return (
						<ListGroup
							key={role}
							title={role === "default" ? "主力模型（default）出错时依次尝试" : `${role} 出错时依次尝试`}
						>
							{chain.length === 0 && <ListRow title="尚未配置备用模型" subtitle="主力模型失败后直接报错" />}
							{chain.map((entry, idx) => (
								<ListRow
									key={`${idx}:${entry}`}
									title={<span className="m-selectable break-all font-m-mono text-m-sm">{entry}</span>}
									subtitle={`第 ${idx + 1} 顺位`}
									right={
										<span className="-mr-2 flex items-center">
											<IconButton
												size="sm"
												variant="filled"
												label="上移"
												icon={<ArrowUp {...SMALL} />}
												disabled={idx === 0}
												onClick={() => edit(role, moveItem(chain, idx, -1))}
											/>
											<IconButton
												size="sm"
												variant="filled"
												label="下移"
												icon={<ArrowDown {...SMALL} />}
												disabled={idx === chain.length - 1}
												onClick={() => edit(role, moveItem(chain, idx, 1))}
											/>
											<IconButton
												size="sm"
												variant="filled"
												label="移除"
												icon={<X {...SMALL} className="text-m-danger" />}
												onClick={() => edit(role, removeAt(chain, idx))}
											/>
										</span>
									}
								/>
							))}
							<ListRow
								icon={<Plus size={22} strokeWidth={1.75} className="text-m-accent" />}
								title={<span className="text-m-accent">添加备用模型</span>}
								chevron={false}
								onClick={() => setAdding(role)}
							/>
						</ListGroup>
					);
				})}

			{data && (
				<OmpSettingsGroup
					title="出错重试"
					keys={RETRY_KEYS}
					omp={omp}
					onValue={(k, v) => setOmp((o) => ({ ...o, [k]: v }))}
				/>
			)}

			{draft && (
				<div
					className="sticky bottom-3 mx-4 mt-4 flex items-center gap-2 rounded-m-pill bg-m-card py-2 pr-2 pl-5 shadow-m-pop"
					role="region"
					aria-label="未保存的更改"
				>
					<span className="min-w-0 flex-1 text-m-sm text-m-text-2">有未保存的更改</span>
					<Button size="sm" variant="tonal" onClick={() => setDraft(null)}>
						还原
					</Button>
					<Button
						size="sm"
						variant="primary"
						disabled={rows.length === 0}
						onClick={() => {
							setSaveError(null);
							setConfirming(true);
						}}
					>
						保存
					</Button>
				</div>
			)}

			<BottomSheet
				open={adding != null}
				onClose={closeAdd}
				fullHeight
				title="添加备用模型"
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
						<div className="pt-2 text-m-xs text-m-warn">该模型已在这条备用链中</div>
					)}
				</div>
			</BottomSheet>

			<ConfirmDiffSheet
				open={confirming}
				title="确认修改备用链"
				rows={rows}
				busy={busy}
				error={saveError}
				onCancel={() => setConfirming(false)}
				onConfirm={save}
			/>
		</SettingsPageFrame>
	);
}
