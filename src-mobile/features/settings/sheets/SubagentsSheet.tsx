import { Bot } from "lucide-react";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

/** Desktop-managed until the mobile API exposes the real configuration. */
export function SubagentsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="子代理管理" subtitle="子代理定义由电脑端统一管理。">
			<ListGroup note="会话中的子代理面板展示任务运行记录，不是子代理定义列表。">
				<ListRow
					icon={<Bot size={22} strokeWidth={1.75} />}
					title="由电脑管理"
					subtitle="手机端尚无子代理定义读取接口，无法展示当前配置。请在电脑端的子代理设置中查看和编辑。"
					chevron={false}
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
