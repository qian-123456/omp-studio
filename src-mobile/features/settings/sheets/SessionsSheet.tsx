import { useState } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { Row, Segmented, Switch } from "../controls";
import { api, errorMessage } from "../../../core/api";
import { toast } from "../../../ui/Toast";

const MODE_ALL = [
	{ value: "one-at-a-time", label: "逐条" },
	{ value: "all", label: "一次全部" },
];

export function SessionsSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [compactEnabled, setCompactEnabled] = useState(true);
	const [autoContinue, setAutoContinue] = useState(true);
	const [steeringMode, setSteeringMode] = useState("one-at-a-time");
	const [followUpMode, setFollowUpMode] = useState("one-at-a-time");
	const [interruptMode, setInterruptMode] = useState("wait");
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
		<BottomSheet open={open} onClose={onClose} title="会话策略设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="text-m-xs font-semibold text-m-text">上下文自动压缩</div>

					<Row name="自动压缩上下文" hint="上下文超过预设阈值时自动压缩，避免超出模型窗口">
						<Switch
							label="自动压缩上下文"
							checked={compactEnabled}
							disabled={busy}
							onChange={(v) => {
								setCompactEnabled(v);
								void handleSave("compaction.enabled", v);
							}}
						/>
					</Row>

					<Row name="压缩后自动继续" hint="压缩完成后智能体自动接着干活，无需手动再发消息">
						<Switch
							label="压缩后自动继续"
							checked={autoContinue}
							disabled={busy}
							onChange={(v) => {
								setAutoContinue(v);
								void handleSave("compaction.autoContinue", v);
							}}
						/>
					</Row>
				</div>

				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="text-m-xs font-semibold text-m-text">消息排队与打断</div>

					<Row name="运行中追加消息" hint="智能体正在工作时你发送的新消息如何送入">
						<Segmented
							label="运行中追加消息"
							value={steeringMode}
							disabled={busy}
							options={MODE_ALL}
							onChange={(v) => {
								setSteeringMode(v);
								void handleSave("steeringMode", v);
							}}
						/>
					</Row>

					<Row name="完成后追问排队" hint="一轮结束后排队的追问是一次全部还是逐条处理">
						<Segmented
							label="完成后追问排队"
							value={followUpMode}
							disabled={busy}
							options={MODE_ALL}
							onChange={(v) => {
								setFollowUpMode(v);
								void handleSave("followUpMode", v);
							}}
						/>
					</Row>

					<Row name="打断工具执行" hint="追加消息时是否立即中断正在运行的工具">
						<Segmented
							label="打断工具执行"
							value={interruptMode}
							disabled={busy}
							options={[
								{ value: "immediate", label: "立即打断" },
								{ value: "wait", label: "等待完成" },
							]}
							onChange={(v) => {
								setInterruptMode(v);
								void handleSave("interruptMode", v);
							}}
						/>
					</Row>
				</div>
			</div>
		</BottomSheet>
	);
}
