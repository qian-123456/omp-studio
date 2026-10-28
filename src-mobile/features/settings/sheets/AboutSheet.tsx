import { AppMark, ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

export function AboutSheet({ open, onClose, appVersion }: { open: boolean; onClose: () => void; appVersion?: string | null }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="版本与更新">
			<div className="flex flex-col items-center gap-3 px-6 pt-2 pb-4 text-center">
				<AppMark size={48} />
				<div>
					<div className="text-m-lg font-medium">OMP Workspace</div>
					<div className="mt-1 text-m-sm text-m-text-3">手机端连接到你电脑上的 OMP 工作台</div>
				</div>
			</div>
			<ListGroup note="版本升级在电脑上进行，手机端只展示当前版本。电脑端更新后，刷新本页面即可用上新版本。">
				<ListRow title="电脑端版本" right={<span className="m-selectable font-m-mono">{appVersion || "未知"}</span>} />
			</ListGroup>
		</SettingsSheet>
	);
}
