import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet, Button, Chip, Field, ListGroup, ListRow, TextField, toast } from "../../../ui";
import { filterModels, groupModels } from "../../../ui/ModelPicker";
import {
	contextSetBody,
	findOverride,
	formatTokens,
	parseContextWindow,
	type CatalogModel,
	type ContextOverride,
	type RolesResponse,
} from "./logic";
import { ConfirmDiffSheet, SettingsPageFrame, SheetFooter, useLoader } from "./shared";

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
			<div className="relative px-4 pt-3">
				<Search size={20} strokeWidth={1.75} className="pointer-events-none absolute top-[26px] left-8 text-m-text-3" aria-hidden />
				<TextField
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="搜索模型或供应商"
					aria-label="搜索模型"
					className="rounded-m-pill pl-12"
				/>
			</div>
			{data && groups.length === 0 && <div className="p-8 text-center text-m-sm text-m-text-3">没有匹配的模型</div>}
			{groups.map((g) => (
				<ListGroup key={g.provider} title={`${g.provider} · ${g.models.length} 个模型`}>
					{g.models.map((m) => {
						const eff = effective(m);
						return (
							<ListRow
								key={m.id}
								title={m.name || m.id}
								subtitle={
									m.name && m.name !== m.id ? <span className="break-all font-m-mono">{m.id}</span> : undefined
								}
								right={
									<>
										{eff.custom && <Chip tone="accent">已覆盖</Chip>}
										<span className={eff.custom ? "text-m-text" : ""}>{formatTokens(eff.value)}</span>
									</>
								}
								chevron
								onClick={() => open(m)}
							/>
						);
					})}
				</ListGroup>
			))}

			<BottomSheet
				open={edit?.step === "input"}
				onClose={close}
				title="调整上下文窗口"
				subtitle={edit ? <span className="break-all">{`${edit.model.provider}/${edit.model.id}`}</span> : undefined}
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
					<div className="flex flex-col gap-5 px-5 pt-2 pb-3">
						<div className="text-m-sm text-m-text-2">
							当前 {tokens(effective(edit.model).value)}
							{effective(edit.model).custom ? "（自定义覆盖）" : "（模型默认）"}
						</div>
						<div className="flex flex-wrap gap-2" role="group" aria-label="常用大小">
							{PRESETS.map((p) => {
								const on = !edit.reset && parsed?.ok === true && parsed.value === p;
								return (
									<button
										key={p}
										type="button"
										aria-pressed={on}
										onClick={() => setEdit({ ...edit, text: String(p), reset: false })}
										className={`min-h-11 min-w-16 whitespace-nowrap rounded-m-pill px-4 text-m-sm font-medium ${
											on ? "bg-m-text text-m-bg" : "bg-m-surface text-m-text-2 active:bg-m-surface-2"
										}`}
									>
										{formatTokens(p)}
									</button>
								);
							})}
						</div>
						<Field label="自定义大小（tokens，可写 128k、1m）" error={inputError ?? undefined}>
							<TextField
								value={edit.reset ? "" : edit.text}
								disabled={edit.reset}
								inputMode="decimal"
								onChange={(e) => setEdit({ ...edit, text: e.target.value, reset: false })}
								className="font-m-mono"
							/>
						</Field>
						{findOverride(overrides, edit.model.provider, edit.model.id) && (
							<div>
								<Button variant="danger" onClick={() => setEdit({ ...edit, reset: !edit.reset })}>
									{edit.reset ? "取消重置" : "重置为模型默认值"}
								</Button>
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
