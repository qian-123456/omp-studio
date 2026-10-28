import { Users } from "lucide-react";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

export function HelperModelsSheet({ open, onClose, onOpenRoles }: { open: boolean; onClose: () => void; onOpenRoles: () => void }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="辅助模型">
			<ListGroup note="代码审查、文件编辑、提交说明、子代理等辅助工作各自用哪个模型，都在模型角色里按角色指定。顾问模型和图片分析模型只能在电脑上修改。">
				<ListRow
					icon={<Users size={22} strokeWidth={1.75} />}
					title="在模型角色中设置"
					subtitle="审查、编辑、终端分析、提交、任务代理、快速侦察"
					chevron
					onClick={() => {
						onClose();
						onOpenRoles();
					}}
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
