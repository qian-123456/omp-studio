import { ArrowDownToLine, Hand, Layers, Menu, MessageSquareQuote, Plus, Slash, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

const ICON = { size: 22, strokeWidth: 1.75 } as const;

const TIPS: ReadonlyArray<{ icon: ReactNode; title: string; hint: string }> = [
	{ icon: <Menu {...ICON} />, title: "打开导航", hint: "点左上角的菜单按钮，或从屏幕左边缘向右滑，查看所有项目和会话。" },
	{ icon: <Plus {...ICON} />, title: "加号菜单", hint: "输入框左边的加号可以添加文件、草图，或切换到规划模式。" },
	{ icon: <Hand {...ICON} />, title: "长按消息", hint: "长按一条消息可以复制、重新生成，或选中一段文字发起批注。" },
	{ icon: <Slash {...ICON} />, title: "斜杠命令", hint: "在输入框里输入 / 可以调出技能和自定义命令。" },
	{ icon: <Wrench {...ICON} />, title: "工具", hint: "会话右上角的工具按钮里有文件、Git、终端、辅助对话和服务。" },
	{ icon: <ArrowDownToLine {...ICON} />, title: "下拉刷新", hint: "在设置、配额等页面向下拉可以重新读取最新数据。" },
];

export function GuideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="使用教程">
			<ListGroup title="常用操作">
				{TIPS.map((t) => (
					<ListRow key={t.title} icon={t.icon} title={t.title} subtitle={t.hint} />
				))}
			</ListGroup>
			<ListGroup title="多个智能体一起干活">
				<ListRow
					icon={<Layers {...ICON} />}
					title="子代理"
					subtitle="主会话会把大任务拆开交给子代理（比如 scout 负责查资料，reviewer 负责审代码），对话顶部的小胶囊显示它们的进度。"
				/>
				<ListRow
					icon={<MessageSquareQuote {...ICON} />}
					title="辅助对话"
					subtitle="想岔开问点别的又不想打扰主会话，就开一个辅助对话，聊完可以把结论带回主会话。"
				/>
			</ListGroup>
			<ListGroup title="常见问题">
				<ListRow title="配额多久更新一次？" subtitle="打开「订阅与配额」时自动读取，也可以点右上角的刷新按钮。" />
				<ListRow title="手机上的操作在哪里执行？" subtitle="所有读写文件、运行命令都在你的电脑上执行，手机只是远程查看和操作。" />
			</ListGroup>
		</SettingsSheet>
	);
}
