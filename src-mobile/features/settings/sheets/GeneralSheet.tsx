import { useState } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { Row, Segmented } from "../controls";
import { APPROVAL_MODES, type ApprovalMode } from "../settingsMap";
import { api, errorMessage } from "../../../core/api";
import { toast } from "../../../ui/Toast";

export function GeneralSheet({
	open,
	onClose,
	mode,
	defaultModel,
	defaultModelSource,
	onModeChange,
}: {
	open: boolean;
	onClose: () => void;
	mode: ApprovalMode | null;
	defaultModel?: string | null;
	defaultModelSource?: string | null;
	onModeChange: (m: ApprovalMode) => void;
}) {
	const [busy, setBusy] = useState(false);
	const currentMode = mode ?? "write";

	const handleModeChange = async (next: ApprovalMode) => {
		if (busy) return;
		setBusy(true);
		try {
			await api("POST", "/left/settings/set", { key: "tools.approvalMode", value: next });
			onModeChange(next);
			toast("审批模式已更新", { kind: "success" });
		} catch (e) {
			toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="通用设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<Row
						name="审批权限模式"
						hint="控制智能体在执行工具、改动文件或运行命令前是否需要征求同意。"
						stacked
					>
						<Segmented
							label="审批权限模式"
							value={currentMode}
							disabled={busy}
							options={APPROVAL_MODES.map((m) => ({ value: m.value, label: m.label }))}
							onChange={(v) => void handleModeChange(v as ApprovalMode)}
						/>
					</Row>

					<p className="rounded-m-md bg-m-surface p-2.5 text-m-xs text-m-text-3 leading-relaxed">
						{APPROVAL_MODES.find((m) => m.value === currentMode)?.effect}
					</p>
				</div>

				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
					<div className="text-m-xs font-medium text-m-text-3">默认模型</div>
					<div className="flex items-center justify-between text-m-sm">
						<span className="font-m-mono text-m-text">{defaultModel || "OMP 内置推荐"}</span>
						{defaultModelSource && (
							<span className="text-m-xs text-m-text-3">来源：{defaultModelSource}</span>
						)}
					</div>
					<p className="text-[11px] text-m-text-3">
						可在「模型 → 模型角色」中直接修改主力模型角色与各阶段派发模型。
					</p>
				</div>
			</div>
		</BottomSheet>
	);
}
