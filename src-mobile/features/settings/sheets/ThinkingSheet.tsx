import { Brain } from "lucide-react";
import { ListGroup, ListRow } from "../../../ui";
import { OmpError, OmpSettingsGroup, type OmpSheetProps } from "../OmpSettings";
import { SettingsSheet } from "../rows";

export function ThinkingSheet({ open, onClose, omp, ompError, onOmp }: OmpSheetProps) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="思考与采样">
			<OmpError omp={omp} ompError={ompError} />
			<OmpSettingsGroup title="显示" keys={["hideThinkingBlock"]} omp={omp} onValue={onOmp} />
			<ListGroup title="思考深度" note="思考预算和采样温度只能在电脑上修改。">
				<ListRow
					icon={<Brain size={22} strokeWidth={1.75} />}
					title="在对话里切换"
					subtitle="点对话顶部的模型名称，就能为当前会话选择思考深度；可选的档位取决于模型。"
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
