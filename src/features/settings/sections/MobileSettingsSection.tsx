/** Settings ▸ 手机访问 (`mobile`): header around MobilePanel. */
import { MobilePanel } from "../../mobile/MobilePanel";
import { SectionHeader } from "../ui";

export function MobileSettingsSection() {
	return (
		<div className="space-y-6">
			<SectionHeader
				title="手机访问"
				description="用手机浏览器查看会话进展、处理审批和提问。三步：启动服务 → 生成二维码 → 手机扫码。"
			/>
			<MobilePanel />
		</div>
	);
}
