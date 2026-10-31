import { Brain } from "lucide-react";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

/** Desktop-managed until the mobile API exposes the real configuration. */
export function MemorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="记忆管理" subtitle="跨会话记忆由电脑端统一管理。">
			<ListGroup note="技能请返回设置中的 Skills 查看。技能目录不代表当前会话已加载的技能。">
				<ListRow
					icon={<Brain size={22} strokeWidth={1.75} />}
					title="由电脑管理"
					subtitle="手机端尚无记忆文件读取接口，无法展示当前笔记。请在电脑端的记忆设置中查看和编辑。"
					chevron={false}
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
