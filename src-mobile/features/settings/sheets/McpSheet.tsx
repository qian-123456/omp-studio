import { Server } from "lucide-react";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

/** Desktop-managed until the mobile API exposes the real configuration. */
export function McpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="MCP 服务器" subtitle="外部工具和数据连接由电脑端统一管理。">
			<ListGroup>
				<ListRow
					icon={<Server size={22} strokeWidth={1.75} />}
					title="由电脑管理"
					subtitle="手机端尚无 MCP 配置读取接口，无法展示当前服务器。请在电脑端的 MCP 设置中查看、添加或修改服务器。"
					chevron={false}
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
