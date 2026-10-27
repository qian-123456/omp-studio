import { useState } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { Row } from "../controls";
import { api, errorMessage } from "../../../core/api";
import { toast } from "../../../ui/Toast";

export function HelperModelsSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [advisor, setAdvisor] = useState("claude-3-7-sonnet");
	const [scout, setScout] = useState("claude-3-5-haiku");
	const [image, setImage] = useState("gemini-2.5-flash");
	const [busy, setBusy] = useState(false);

	const handleSave = async (key: string, val: string) => {
		setBusy(true);
		try {
			await api("POST", "/left/settings/set", { key, value: val });
			toast("辅助模型已更新", { kind: "success" });
		} catch (e) {
			toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="辅助模型设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<Row name="顾问模型 (Advisor)" hint="负责在复杂任务中提供建议与二审把关">
						<select
							aria-label="顾问模型"
							value={advisor}
							disabled={busy}
							onChange={(e) => {
								setAdvisor(e.target.value);
								void handleSave("advisorModel", e.target.value);
							}}
							className="min-h-11 rounded-m-md border border-m-border bg-m-surface px-2.5 text-m-sm text-m-text"
						>
							<option value="claude-3-7-sonnet">Claude 3.7 Sonnet</option>
							<option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
							<option value="gpt-4o">GPT-4o</option>
							<option value="deepseek-r1">DeepSeek R1</option>
						</select>
					</Row>

					<Row name="代码探索探针 (Scout)" hint="用于代码库只读快速探索与信息检索">
						<select
							aria-label="代码探索探针"
							value={scout}
							disabled={busy}
							onChange={(e) => {
								setScout(e.target.value);
								void handleSave("scoutModel", e.target.value);
							}}
							className="min-h-11 rounded-m-md border border-m-border bg-m-surface px-2.5 text-m-sm text-m-text"
						>
							<option value="claude-3-5-haiku">Claude 3.5 Haiku</option>
							<option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
							<option value="gpt-4o-mini">GPT-4o mini</option>
						</select>
					</Row>

					<Row name="图片分析模型 (Vision)" hint="在处理上传的截图与图表分析时优先调用">
						<select
							aria-label="图片分析模型"
							value={image}
							disabled={busy}
							onChange={(e) => {
								setImage(e.target.value);
								void handleSave("imageModel", e.target.value);
							}}
							className="min-h-11 rounded-m-md border border-m-border bg-m-surface px-2.5 text-m-sm text-m-text"
						>
							<option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
							<option value="claude-3-7-sonnet">Claude 3.7 Sonnet</option>
							<option value="gpt-4o">GPT-4o</option>
						</select>
					</Row>
				</div>
			</div>
		</BottomSheet>
	);
}
