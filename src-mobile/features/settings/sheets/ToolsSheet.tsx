import { OmpError, OmpSettingsGroup, type OmpSheetProps } from "../OmpSettings";
import { SettingsSheet } from "../rows";

export function ToolsSheet({ open, onClose, omp, ompError, onOmp }: OmpSheetProps) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="工具设置">
			<OmpError omp={omp} ompError={ompError} />
			<OmpSettingsGroup title="提问与审批" keys={["ask.enabled", "ask.notify", "ask.timeout"]} omp={omp} onValue={onOmp} />
			<OmpSettingsGroup title="执行与超时" keys={["bash.autoBackground.enabled", "tools.maxTimeout"]} omp={omp} onValue={onOmp} />
		</SettingsSheet>
	);
}
