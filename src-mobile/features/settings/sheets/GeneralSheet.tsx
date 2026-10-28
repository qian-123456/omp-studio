import { Cpu } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { ListGroup, ListRow, Segmented, toast } from "../../../ui";
import { SettingRow, SettingsSheet } from "../rows";
import { APPROVAL_MODES, approvalEffect, type ApprovalMode } from "../settingsMap";

const SOURCE_LABEL: Record<string, string> = {
	"modelRoles.default": "来自模型角色「全局默认」",
	newSessionModel: "来自新会话默认模型",
};

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

	const choose = async (next: ApprovalMode) => {
		if (busy) return;
		setBusy(true);
		try {
			const r = await api<{ defaultApprovalMode?: ApprovalMode }>("POST", "/left/settings/approval-mode", { mode: next });
			onModeChange(r.defaultApprovalMode ?? next);
			toast("审批模式已更新，对之后新开的会话生效", { kind: "success" });
		} catch (e) {
			toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<SettingsSheet open={open} onClose={onClose} title="通用设置">
			<ListGroup title="审批" note="已经在运行的会话保持原来的模式，新开的会话使用这里的选择。">
				<SettingRow name="审批权限模式" hint={mode ? approvalEffect(mode) : "正在读取当前模式"} stacked>
					<Segmented
						label="审批权限模式"
						value={mode}
						disabled={busy || mode == null}
						options={APPROVAL_MODES}
						onChange={(v) => void choose(v)}
					/>
				</SettingRow>
			</ListGroup>
			<ListGroup title="新会话" note="要换默认模型，去「模型角色」里修改「全局默认」。">
				<ListRow
					icon={<Cpu size={22} strokeWidth={1.75} />}
					title="默认模型"
					subtitle={
						<>
							<span className="m-selectable block font-m-mono break-all text-m-text-2">{defaultModel || "使用 OMP 内置推荐"}</span>
							{defaultModelSource && <span className="block">{SOURCE_LABEL[defaultModelSource] ?? `来源：${defaultModelSource}`}</span>}
						</>
					}
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
