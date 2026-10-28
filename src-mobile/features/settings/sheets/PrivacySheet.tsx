import { ShieldCheck } from "lucide-react";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

export function PrivacySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="隐私设置">
			<ListGroup note="隐私库的内容是敏感信息，只能在电脑上的「设置 ▸ 隐私」里查看、添加和删除。">
				<ListRow
					icon={<ShieldCheck size={22} strokeWidth={1.75} />}
					title="隐私库"
					subtitle="登记过的密钥、密码等内容，在发给模型前会换成占位符。"
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
