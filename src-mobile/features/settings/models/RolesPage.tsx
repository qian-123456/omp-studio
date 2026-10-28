import { Compass, GitCommitHorizontal, ListChecks, PenLine, ScanSearch, Sparkles, SquareTerminal, Bot } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import type { PageProps } from "../../../core/nav";
import { BottomSheet, Button, Chip, ListGroup, ListRow, toast } from "../../../ui";
import { ModelPicker } from "../../../ui/ModelPicker";
import type { PickerModel } from "../../../ui/ModelPicker";
import {
	describeRoleValue,
	parseRoleValue,
	reconcileThinking,
	roleSetBody,
	ROLE_KEYS,
	type CatalogModel,
	type DiffRow,
	type RolesResponse,
} from "./logic";
import { ConfirmDiffSheet, SettingsPageFrame, SheetFooter, useLoader } from "./shared";
import { BatchReplaceSheet } from "./BatchReplaceSheet";

const ICON = { size: 22, strokeWidth: 1.75 } as const;
const ROLE_ICONS: Record<string, ReactNode> = {
	default: <Sparkles {...ICON} />,
	reviewer: <ScanSearch {...ICON} />,
	editor: <PenLine {...ICON} />,
	bash: <SquareTerminal {...ICON} />,
	commit: <GitCommitHorizontal {...ICON} />,
	task: <ListChecks {...ICON} />,
	scout: <Compass {...ICON} />,
};
interface Draft {
	roleId: string;
	label: string;
	provider: string;
	modelId: string;
	thinking: string | null;
}

type Edit =
	| { kind: "pick"; draft: Draft }
	| { kind: "confirm"; draft: Draft }
	| { kind: "inherit"; roleId: string; label: string };

const baseName = (p: string): string => p.split("/").filter(Boolean).pop() ?? p;

export function SettingsRolesPage({ route }: PageProps) {
	const cwd = route.query.cwd || null;
	const { data, error, loading, reload } = useLoader<RolesResponse>(() =>
		api<RolesResponse>("GET", `/left/roles${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
	);
	const models = useMemo<CatalogModel[]>(() => data?.models ?? [], [data]);
	const gRoles = data?.snapshot?.global?.modelRoles ?? {};
	const pRoles = data?.snapshot?.project?.modelRoles ?? {};
	const [edit, setEdit] = useState<Edit | null>(null);
	const [busy, setBusy] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [batchReplaceOpen, setBatchReplaceOpen] = useState(false);
	const current = (roleId: string): { raw: string | undefined; isProject: boolean } => {
		if (cwd && roleId in pRoles) return { raw: pRoles[roleId], isProject: true };
		return { raw: gRoles[roleId], isProject: false };
	};

	const closeEdit = () => {
		setEdit(null);
		setSaveError(null);
	};

	const startEdit = (roleId: string, label: string) => {
		const v = parseRoleValue(current(roleId).raw, models);
		const first = models[0];
		const draft: Draft =
			v.kind === "model" && v.provider
				? { roleId, label, provider: v.provider, modelId: v.modelId, thinking: v.thinking }
				: { roleId, label, provider: first?.provider ?? "", modelId: first?.id ?? "", thinking: null };
		setSaveError(null);
		setEdit({ kind: "pick", draft });
	};

	const rowsFor = (e: Edit): DiffRow[] => {
		if (e.kind === "inherit") {
			const g = describeRoleValue(parseRoleValue(gRoles[e.roleId], models));
			return [
				{
					label: e.label,
					before: `项目专属：${describeRoleValue(parseRoleValue(pRoles[e.roleId], models))}`,
					after: `继承全局：${g}`,
				},
			];
		}
		const before = describeRoleValue(parseRoleValue(current(e.draft.roleId).raw, models));
		const model = models.find((m) => m.provider === e.draft.provider && m.id === e.draft.modelId);
		const after = describeRoleValue({
			kind: "model",
			provider: e.draft.provider,
			modelId: e.draft.modelId,
			thinking: e.draft.thinking,
			raw: "",
			model,
		});
		return [{ label: e.draft.label, before, after }];
	};

	const save = async () => {
		if (!edit || edit.kind === "pick") return;
		setBusy(true);
		setSaveError(null);
		try {
			const body =
				edit.kind === "inherit"
					? roleSetBody(cwd, edit.roleId, null)
					: roleSetBody(cwd, edit.draft.roleId, {
							provider: edit.draft.provider,
							modelId: edit.draft.modelId,
							thinking: edit.draft.thinking,
						});
			await api("POST", "/left/roles/set", body);
			toast("角色已更新", { kind: "success" });
			closeEdit();
			reload();
		} catch (e) {
			setSaveError(errorMessage(e, "保存失败"));
		} finally {
			setBusy(false);
		}
	};

	const pickDraft = edit?.kind === "pick" ? edit.draft : null;
	const setModel = (m: PickerModel) => {
		if (!pickDraft) return;
		const full = models.find((x) => x.provider === m.provider && x.id === m.id);
		setEdit({
			kind: "pick",
			draft: {
				...pickDraft,
				provider: m.provider,
				modelId: m.id,
				thinking: reconcileThinking(full, pickDraft.thinking),
			},
		});
	};

	return (
		<SettingsPageFrame
			title={cwd ? `项目角色 · ${baseName(cwd)}` : "模型角色与思考深度"}
			right={
				<Button size="sm" variant="tonal" onClick={() => setBatchReplaceOpen(true)} disabled={!data}>
					批量替换
				</Button>
			}
			loading={loading && !data}
			error={error}
			onRetry={reload}
		>
			<ListGroup
				title={cwd ? `项目配置 · ${baseName(cwd)}` : "全局配置"}
				note={cwd ? "项目专属配置优先于全局配置。" : "全局配置对所有项目生效。点按角色可更换模型和思考深度。"}
			>
				{ROLE_KEYS.map((rk) => {
					const { raw, isProject } = current(rk.id);
					const v = parseRoleValue(raw, models);
					return (
						<ListRow
							key={rk.id}
							icon={ROLE_ICONS[rk.id] ?? <Bot {...ICON} />}
							title={rk.label}
							subtitle={
								<span className="mt-1 flex flex-col items-start gap-1.5">
									<span className="break-all font-m-mono text-m-text-2">
										{v.kind === "none"
											? "未配置"
											: v.kind === "alias"
												? v.raw
												: `${v.provider ? `${v.provider}/` : ""}${v.modelId}`}
									</span>
									{(v.kind === "model" || cwd) && (
										<span className="flex flex-wrap gap-1.5">
											{v.kind === "model" && <Chip>思考 {v.thinking ?? "自动"}</Chip>}
											{cwd && <Chip tone={isProject ? "accent" : "neutral"}>{isProject ? "项目专属" : "继承全局"}</Chip>}
										</span>
									)}
								</span>
							}
							chevron
							onClick={() => startEdit(rk.id, rk.label)}
						/>
					);
				})}
			</ListGroup>

			<BottomSheet
				open={pickDraft != null}
				onClose={closeEdit}
				fullHeight
				title={pickDraft ? `选择模型 · ${pickDraft.label}` : undefined}
				headerRight={
					cwd && pickDraft && current(pickDraft.roleId).isProject ? (
						<Button
							size="sm"
							variant="danger"
							onClick={() => setEdit({ kind: "inherit", roleId: pickDraft.roleId, label: pickDraft.label })}
						>
							恢复继承
						</Button>
					) : undefined
				}
				footer={
					<SheetFooter
						onCancel={closeEdit}
						onSave={() => pickDraft && setEdit({ kind: "confirm", draft: pickDraft })}
						saveText="下一步"
						saveDisabled={!pickDraft?.modelId}
					/>
				}
			>
				{pickDraft && (
					<div className="h-[calc(var(--m-vh,100dvh)*0.6)] px-4">
						<ModelPicker
							className="h-full"
							models={models}
							value={pickDraft.modelId ? { provider: pickDraft.provider, modelId: pickDraft.modelId } : null}
							onChange={setModel}
							thinking={{
								value: pickDraft.thinking,
								onChange: (thinking) => setEdit({ kind: "pick", draft: { ...pickDraft, thinking } }),
							}}
						/>
					</div>
				)}
			</BottomSheet>

			<ConfirmDiffSheet
				open={edit?.kind === "confirm" || edit?.kind === "inherit"}
				title={edit?.kind === "inherit" ? "恢复继承全局配置" : "确认修改"}
				rows={edit && edit.kind !== "pick" ? rowsFor(edit) : []}
				busy={busy}
				error={saveError}
				onCancel={closeEdit}
				onBack={edit?.kind === "confirm" ? () => setEdit({ kind: "pick", draft: edit.draft }) : undefined}
				onConfirm={save}
			/>
			<BatchReplaceSheet
				open={batchReplaceOpen}
				onClose={() => setBatchReplaceOpen(false)}
				cwd={cwd}
				roles={cwd ? { ...gRoles, ...pRoles } : gRoles}
				models={models}
				onSuccess={reload}
			/>
		</SettingsPageFrame>
	);
}
