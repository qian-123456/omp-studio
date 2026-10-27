import { useState } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { Row, Segmented, Stepper, Switch } from "../controls";
import { api, errorMessage } from "../../../core/api";
import { toast } from "../../../ui/Toast";

export function ThinkingSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [thinkingLevel, setThinkingLevel] = useState("auto");
	const [budgetTokens, setBudgetTokens] = useState(4096);
	const [temperature, setTemperature] = useState(0.7);
	const [hideThinking, setHideThinking] = useState(false);
	const [busy, setBusy] = useState(false);

	const handleSave = async (key: string, val: unknown) => {
		setBusy(true);
		try {
			await api("POST", "/left/settings/set", { key, value: val });
			toast("设置已保存", { kind: "success" });
		} catch (e) {
			toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="思考与采样设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<Row name="思考深度" hint="控制具有思维链能力模型（如 Claude 3.7、o3）的思考层级">
						<Segmented
							label="思考深度"
							value={thinkingLevel}
							disabled={busy}
							options={[
								{ value: "auto", label: "自动" },
								{ value: "low", label: "低" },
								{ value: "medium", label: "中" },
								{ value: "high", label: "高" },
							]}
							onChange={(v) => {
								setThinkingLevel(v);
								void handleSave("thinking.level", v);
							}}
						/>
					</Row>

					<Row name="思考预算上限" hint="单个回合允许消耗的最大思考 token 数量">
						<Stepper
							label="思考预算上限"
							value={budgetTokens}
							min={1024}
							max={65536}
							step={1024}
							unit="tokens"
							disabled={busy}
							onCommit={(v) => {
								setBudgetTokens(v);
								void handleSave("thinking.budgetTokens", v);
							}}
						/>
					</Row>

					<Row name="采样温度 (Temperature)" hint="数值越低越确定保守，数值越高越富有创造力">
						<Stepper
							label="采样温度"
							value={Math.round(temperature * 10)}
							min={0}
							max={20}
							step={1}
							unit="x0.1"
							disabled={busy}
							onCommit={(v) => {
								const t = v / 10;
								setTemperature(t);
								void handleSave("temperature", t);
							}}
						/>
					</Row>

					<Row name="隐藏思考内容" hint="在对话气泡中折叠隐藏深度思考的推理过程">
						<Switch
							label="隐藏思考内容"
							checked={hideThinking}
							disabled={busy}
							onChange={(v) => {
								setHideThinking(v);
								void handleSave("hideThinkingBlock", v);
							}}
						/>
					</Row>
				</div>
			</div>
		</BottomSheet>
	);
}
