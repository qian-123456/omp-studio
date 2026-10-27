import { useState } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { Row, Stepper, Switch } from "../controls";
import { api, errorMessage } from "../../../core/api";
import { toast } from "../../../ui/Toast";

export function ToolsSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [askEnabled, setAskEnabled] = useState(true);
	const [askNotify, setAskNotify] = useState(true);
	const [askTimeout, setAskTimeout] = useState(60);
	const [autoBackground, setAutoBackground] = useState(true);
	const [maxTimeout, setMaxTimeout] = useState(600);
	const [busy, setBusy] = useState(false);

	const handleSave = async (key: string, val: unknown) => {
		setBusy(true);
		try {
			await api("POST", "/left/settings/set", { key, value: val });
			toast("工具参数已保存", { kind: "success" });
		} catch (e) {
			toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="工具设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="text-m-xs font-semibold text-m-text">提问与审批互动</div>

					<Row name="允许智能体向我提问" hint="关闭后智能体遇到不确定问题时不会弹出确认框，而是自主决策">
						<Switch
							label="允许智能体向我提问"
							checked={askEnabled}
							disabled={busy}
							onChange={(v) => {
								setAskEnabled(v);
								void handleSave("ask.enabled", v);
							}}
						/>
					</Row>

					<Row name="等待回答时提醒" hint="智能体等待你选择选项时发出通知提醒">
						<Switch
							label="等待回答时提醒"
							checked={askNotify}
							disabled={busy}
							onChange={(v) => {
								setAskNotify(v);
								void handleSave("ask.notify", v ? "on" : "off");
							}}
						/>
					</Row>

					<Row name="提问自动选择等待" hint="超时后自动选择推荐项；0 表示永久等待">
						<Stepper
							label="提问自动选择等待"
							value={askTimeout}
							min={0}
							max={3600}
							step={10}
							unit="秒"
							disabled={busy}
							onCommit={(v) => {
								setAskTimeout(v);
								void handleSave("ask.timeout", v);
							}}
						/>
					</Row>
				</div>

				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="text-m-xs font-semibold text-m-text">执行策略与超时</div>

					<Row name="长命令自动转后台" hint="耗时很长的编译或构建命令自动放到后台运行">
						<Switch
							label="长命令自动转后台"
							checked={autoBackground}
							disabled={busy}
							onChange={(v) => {
								setAutoBackground(v);
								void handleSave("bash.autoBackground.enabled", v);
							}}
						/>
					</Row>

					<Row name="工具最长超时" hint="单个工具调用的最长允许执行耗时；0 表示不限">
						<Stepper
							label="工具最长超时"
							value={maxTimeout}
							min={0}
							max={86400}
							step={60}
							unit="秒"
							disabled={busy}
							onCommit={(v) => {
								setMaxTimeout(v);
								void handleSave("tools.maxTimeout", v);
							}}
						/>
					</Row>
				</div>
			</div>
		</BottomSheet>
	);
}
