import { OmpError, OmpSettingsGroup, type OmpSheetProps } from "../OmpSettings";
import { SettingsSheet } from "../rows";

export function SessionsSheet({ open, onClose, omp, ompError, onOmp }: OmpSheetProps) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="会话设置">
			<OmpError omp={omp} ompError={ompError} />
			<OmpSettingsGroup title="上下文压缩" keys={["compaction.enabled", "compaction.autoContinue"]} omp={omp} onValue={onOmp} />
			<OmpSettingsGroup title="排队与打断" keys={["steeringMode", "followUpMode", "interruptMode"]} omp={omp} onValue={onOmp} />
		</SettingsSheet>
	);
}
