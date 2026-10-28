import { Globe } from "lucide-react";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

export function WebSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="联网搜索">
			<ListGroup note="搜索服务商、接口地址和密钥只能在电脑上的「设置 ▸ 联网搜索」里修改，改完后手机上的会话直接使用。">
				<ListRow
					icon={<Globe size={22} strokeWidth={1.75} />}
					title="联网搜索"
					subtitle="智能体用 web_search 搜索网页、用 fetch 读取网页内容，支持 SearXNG、Perplexity、Tavily 等服务商。"
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
