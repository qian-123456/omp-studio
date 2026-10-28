import { Check } from "lucide-react";
import { useState, useMemo } from "react";
import { Chip, ListGroup, ListRow, toast } from "../../../ui";
import { ModelPicker, type PickerModel } from "../../../ui/ModelPicker";
import { api, errorMessage } from "../../../core/api";
import { GroupBlock, SettingsSheet } from "../rows";
import {
	parseRoleValue,
	roleSetBody,
	ROLE_KEYS,
	type CatalogModel,
} from "./logic";
import { ErrorBox, SheetFooter } from "./shared";

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
}: BatchReplaceSheetProps) {
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
		<SettingsSheet
			open={open}
			onClose={onClose}
			title="批量替换模型角色"
			subtitle="把使用同一个模型的角色一次换成新模型"
			footer={
				<SheetFooter
					onCancel={onClose}
					onSave={() => void handleExecute()}
					saveText={`替换 ${affectedRoles.length} 个角色`}
					busy={busy}
					saveDisabled={!targetModel || affectedRoles.length === 0}
				/>
			}
		>
			{error && (
				<div className="px-4">
					<ErrorBox title="批量替换失败" message={error} />
				</div>
			)}

			<ListGroup title="1. 选择要被替换的原模型">
				{usedModelKeys.length === 0 ? (
					<ListRow title="当前没有配置具体模型的角色" />
				) : (
					usedModelKeys.map((k) => (
						<ListRow
							key={k}
							title={<span className="break-all font-m-mono text-m-sm">{k}</span>}
							right={k === sourceKey ? <Check size={20} strokeWidth={2} className="text-m-accent" aria-label="已选" /> : undefined}
							chevron={false}
							onClick={() => setSelectedSource(k)}
						/>
					))
				)}
			</ListGroup>

			<ListGroup title={`将影响以下 ${affectedRoles.length} 个角色`}>
				<GroupBlock>
					{affectedRoles.length === 0 ? (
						<span className="text-m-sm text-m-text-3">没有受影响的角色</span>
					) : (
						<span className="flex flex-wrap gap-2">
							{affectedRoles.map((r) => (
								<Chip key={r.id}>{r.label}</Chip>
							))}
						</span>
					)}
				</GroupBlock>
			</ListGroup>

			<section className="px-4">
				<h3 className="px-4 pt-5 pb-2 text-m-xs font-medium whitespace-nowrap text-m-text-3">2. 选择替换后的新模型</h3>
				<div className="h-[min(420px,calc(var(--m-vh,100dvh)*0.55))]">
					<ModelPicker
						className="h-full"
						models={models}
						value={targetModel ? { provider: targetModel.provider, modelId: targetModel.id } : null}
						onChange={setTargetModel}
						thinking={{ value: thinking, onChange: setThinking }}
					/>
				</div>
			</section>
		</SettingsSheet>
	);
}
