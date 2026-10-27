import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet } from "../../../ui/BottomSheet";
import { filterModels, groupModels } from "../../../ui/ModelPicker";
import { toast } from "../../../ui/Toast";
import {
	contextSetBody,
	findOverride,
	formatTokens,
	parseContextWindow,
	type CatalogModel,
	type ContextOverride,
	type RolesResponse,
} from "./logic";
import { Badge, Btn, ConfirmDiffSheet, SectionTitle, SettingsPageFrame, SheetFooter, useLoader } from "./shared";

const PRESETS = [32_000, 64_000, 128_000, 200_000, 1_000_000, 2_000_000];
const FALLBACK_WINDOW = 128_000;

interface Loaded {
	models: CatalogModel[];
	overrides: ContextOverride[];
}

interface Edit {
	model: CatalogModel;
	text: string;
	reset: boolean;
	step: "input" | "confirm";
}

const tokens = (n: number): string => `${n.toLocaleString("en-US")} tokens`;

export function SettingsContextPage() {
	const { data, error, loading, reload } = useLoader<Loaded>(async () => {
		const [cw, roles] = await Promise.all([
			api<{ overrides?: ContextOverride[] }>("GET", "/left/context-windows"),
			api<RolesResponse>("GET", "/left/roles"),
		]);
		return { overrides: cw.overrides ?? [], models: roles.models ?? [] };
	});
	const [query, setQuery] = useState("");
	const [edit, setEdit] = useState<Edit | null>(null);
	const [busy, setBusy] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const groups = useMemo(() => groupModels(filterModels(data?.models ?? [], query)), [data, query]);
	const overrides = data?.overrides ?? [];

	const effective = (m: CatalogModel): { value: number; custom: boolean } => {
		const ov = findOverride(overrides, m.provider, m.id);
		if (ov?.contextWindow) return { value: ov.contextWindow, custom: true };
		return { value: m.contextWindow || FALLBACK_WINDOW, custom: false };
	};

	const parsed = edit ? (edit.reset ? null : parseContextWindow(edit.text)) : null;
	const inputError = edit && !edit.reset && edit.text.trim() && parsed && !parsed.ok ? parsed.error : null;
	const nextValue = edit?.reset ? null : parsed && parsed.ok ? parsed.value : undefined;
	const canNext = edit != null && (edit.reset || (parsed != null && parsed.ok));

	const close = () => {
		setEdit(null);
		setSaveError(null);
	};

	const rows = edit
		? [
				{
					label: `${edit.model.provider}/${edit.model.id}`,
					before: `${tokens(effective(edit.model).value)}${effective(edit.model).custom ? "（自定义覆盖）" : "（默认）"}`,
					after:
						nextValue === null
							? `${tokens(edit.model.contextWindow || FALLBACK_WINDOW)}（恢复模型默认）`
							: nextValue !== undefined
								? `${tokens(nextValue)}（自定义覆盖）`
								: "",
				},
			]
		: [];

	const save = async () => {
		if (!edit || nextValue === undefined) return;
		setBusy(true);
		setSaveError(null);
		try {
			await api("POST", "/left/context-windows/set", contextSetBody(edit.model.provider, edit.model.id, nextValue));
			toast("上下文窗口已更新", { kind: "success" });
			close();
			reload();
		} catch (e) {
			setSaveError(errorMessage(e, "保存失败"));
		} finally {
			setBusy(false);
		}
	};

	const open = (m: CatalogModel) => {
		const eff = effective(m);
		setSaveError(null);
		setEdit({ model: m, text: String(eff.value), reset: false, step: "input" });
	};

	return (
		<SettingsPageFrame
			title="上下文窗口大小"
			subtitle={data ? `${data.models.length} 个模型` : undefined}
			loading={loading && !data}
			error={error}
			onRetry={reload}
		>
			<div className="px-4 pt-3">
				<label className="flex min-h-11 items-center gap-2 rounded-m-md border border-m-border bg-m-surface px-3">
					<Search size={16} className="shrink-0 text-m-text-3" aria-hidden />
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="搜索模型或供应商"
						aria-label="搜索模型"
						className="min-w-0 flex-1 bg-transparent text-m-md text-m-text outline-none"
					/>
				</label>
			</div>
			{data && groups.length === 0 && <div className="p-6 text-center text-m-sm text-m-text-3">没有匹配的模型</div>}
			{groups.map((g) => (
				<section key={g.provider}>
					<SectionTitle title={g.provider} hint={`${g.models.length} 个模型`} />
					{g.models.map((m) => {
						const eff = effective(m);
						return (
							<button
								key={m.id}
								type="button"
								onClick={() => open(m)}
								className="flex min-h-14 w-full items-center gap-3 border-b border-m-border px-4 py-2 text-left"
							>
								<span className="min-w-0 flex-1">
									<span className="block break-words text-m-md text-m-text">{m.name || m.id}</span>
									<span className="block break-all font-m-mono text-m-xs text-m-text-3">
										{tokens(eff.value)}
										{eff.custom ? "（自定义覆盖）" : "（默认）"}
									</span>
								</span>
								<Badge tone={eff.custom ? "accent" : "neutral"}>{eff.custom ? "已覆盖" : "默认"}</Badge>
							</button>
						);
					})}
				</section>
			))}

			<BottomSheet
				open={edit?.step === "input"}
				onClose={close}
				title={edit ? `调整上下文窗口 · ${edit.model.name || edit.model.id}` : undefined}
				footer={
					<SheetFooter
						onCancel={close}
						onSave={() => edit && setEdit({ ...edit, step: "confirm" })}
						saveText="下一步"
						saveDisabled={!canNext}
					/>
				}
			>
				{edit && (
					<div className="flex flex-col gap-3 px-4 pb-3">
						<div className="flex flex-wrap gap-2">
							{PRESETS.map((p) => (
								<button
									key={p}
									type="button"
									aria-pressed={!edit.reset && parsed?.ok === true && parsed.value === p}
									onClick={() => setEdit({ ...edit, text: String(p), reset: false })}
									className={`min-h-11 whitespace-nowrap rounded-m-pill border px-4 text-m-sm ${
										!edit.reset && parsed?.ok === true && parsed.value === p
											? "border-m-accent bg-m-accent text-m-accent-text"
											: "border-m-border bg-m-surface text-m-text-2"
									}`}
								>
									{formatTokens(p)}
								</button>
							))}
						</div>
						<label className="flex flex-col gap-1">
							<span className="text-m-xs text-m-text-2">自定义大小（tokens，可写 128k、1m）</span>
							<input
								value={edit.reset ? "" : edit.text}
								disabled={edit.reset}
								inputMode="decimal"
								onChange={(e) => setEdit({ ...edit, text: e.target.value, reset: false })}
								className="min-h-11 rounded-m-md border border-m-border bg-m-surface px-3 font-m-mono text-m-md text-m-text disabled:opacity-50"
							/>
							{inputError && <span className="select-text text-m-xs text-m-danger">{inputError}</span>}
						</label>
						{findOverride(overrides, edit.model.provider, edit.model.id) && (
							<div>
								<Btn
									kind="danger"
									onClick={() => setEdit({ ...edit, reset: !edit.reset })}
								>
									{edit.reset ? "取消重置" : "重置为模型默认值"}
								</Btn>
							</div>
						)}
					</div>
				)}
			</BottomSheet>

			<ConfirmDiffSheet
				open={edit?.step === "confirm"}
				title="确认修改上下文窗口"
				rows={rows}
				busy={busy}
				error={saveError}
				onCancel={close}
				onBack={() => edit && setEdit({ ...edit, step: "input" })}
				onConfirm={save}
			/>
		</SettingsPageFrame>
	);
}
