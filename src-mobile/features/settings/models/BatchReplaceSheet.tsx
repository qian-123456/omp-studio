import { useState, useMemo } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { ModelPicker, type PickerModel } from "../../../ui/ModelPicker";
import { api, errorMessage } from "../../../core/api";
import { toast } from "../../../ui/Toast";
import {
	parseRoleValue,
	roleSetBody,
	ROLE_KEYS,
	type CatalogModel,
} from "./logic";
import { SheetFooter } from "./shared";

export interface BatchReplaceSheetProps {
	open: boolean;
	onClose: () => void;
	cwd: string | null;
	roles: Record<string, string | undefined>;
	models: CatalogModel[];
	onSuccess: () => void;
}

export function BatchReplaceSheet({
	open,
	onClose,
	cwd,
	roles,
	models,
	onSuccess,
}: {
	open: boolean;
	onClose: () => void;
	cwd: string | null;
	roles: Record<string, string | undefined>;
	models: CatalogModel[];
	onSuccess: () => void;
}) {
	// Discover which models are currently used by roles
	const usedModelKeys = useMemo(() => {
		const keys = new Set<string>();
		for (const rk of ROLE_KEYS) {
			const raw = roles[rk.id];
			const parsed = parseRoleValue(raw, models);
			if (parsed.kind === "model") {
				const key = `${parsed.provider}/${parsed.modelId}`;
				keys.add(key);
			}
		}
		return Array.from(keys);
	}, [roles, models]);

	const [selectedSource, setSelectedSource] = useState<string | null>(null);
	const sourceKey = selectedSource && usedModelKeys.includes(selectedSource) ? selectedSource : (usedModelKeys[0] ?? "");
	const [targetModel, setTargetModel] = useState<PickerModel | null>(null);
	const [thinking, setThinking] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Affected roles
	const affectedRoles = useMemo(() => {
		if (!sourceKey) return [];
		const [srcProvider, srcModelId] = sourceKey.split("/");
		return ROLE_KEYS.filter((rk) => {
			const raw = roles[rk.id];
			const parsed = parseRoleValue(raw, models);
			return parsed.kind === "model" && parsed.provider === srcProvider && parsed.modelId === srcModelId;
		});
	}, [sourceKey, roles, models]);

	const handleExecute = async () => {
		if (!targetModel || affectedRoles.length === 0) return;
		setBusy(true);
		setError(null);
		try {
			for (const role of affectedRoles) {
				const body = roleSetBody(cwd, role.id, {
					provider: targetModel.provider,
					modelId: targetModel.id,
					thinking,
				});
				await api("POST", "/left/roles/set", body);
			}
			toast(`已成功批量替换 ${affectedRoles.length} 个角色`, { kind: "success" });
			onClose();
			onSuccess();
		} catch (e) {
			setError(errorMessage(e, "批量替换失败"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			fullHeight
			title="批量替换模型角色"
			footer={
				<SheetFooter
					onCancel={onClose}
					onSave={() => void handleExecute()}
					saveText={`确认替换 (${affectedRoles.length})`}
					saveDisabled={busy || !targetModel || affectedRoles.length === 0}
				/>
			}
		>
			<div className="space-y-4 px-4 pb-6">
				{error && (
					<p className="rounded-m-md bg-m-danger/10 p-3 text-m-xs text-m-danger">{error}</p>
				)}

				{/* Step 1: Source model selection */}
				<div className="space-y-1.5">
					<label className="text-m-xs font-medium text-m-text-3">1. 选择要被替换的原模型</label>
					{usedModelKeys.length === 0 ? (
						<p className="text-m-xs text-m-text-3">当前没有配置具体模型的角色</p>
					) : (
						<select
							aria-label="选择要被替换的原模型"
							value={sourceKey}
							onChange={(e) => setSelectedSource(e.target.value)}
							className="min-h-11 w-full rounded-m-md border border-m-border bg-m-surface px-3 text-m-sm text-m-text"
						>
							{usedModelKeys.map((k) => (
								<option key={k} value={k}>
									{k}
								</option>
							))}
						</select>
					)}
				</div>

				{/* Affected roles preview */}
				<div className="rounded-m-md border border-m-border bg-m-surface/40 p-3">
					<div className="text-m-xs font-medium text-m-text-3">
						将影响以下 {affectedRoles.length} 个角色：
					</div>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						{affectedRoles.map((r) => (
							<span
								key={r.id}
								className="rounded-m-sm bg-m-surface-2 px-2 py-0.5 text-m-xs text-m-text"
							>
								{r.label} ({r.id})
							</span>
						))}
					</div>
				</div>

				{/* Step 2: Target model selection */}
				<div className="space-y-1.5">
					<label className="text-m-xs font-medium text-m-text-3">2. 选择替换后的新模型</label>
					<div className="h-[280px] rounded-m-md border border-m-border bg-m-bg-elev p-2">
						<ModelPicker
							className="h-full"
							models={models}
							value={targetModel ? { provider: targetModel.provider, modelId: targetModel.id } : null}
							onChange={(m) => {
								setTargetModel(m);
							}}
							thinking={{
								value: thinking,
								onChange: setThinking,
							}}
						/>
					</div>
				</div>
			</div>
		</BottomSheet>
	);
}
