import { useState } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { Row, Stepper, Switch } from "../controls";
import { api, errorMessage } from "../../../core/api";
import { toast } from "../../../ui/Toast";

export function InboxSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [autoTriage, setAutoTriage] = useState(true);
	const [notifyUnread, setNotifyUnread] = useState(true);
	const [archiveDays, setArchiveDays] = useState(7);
	const [busy, setBusy] = useState(false);

	const handleSave = async (key: string, val: unknown) => {
		setBusy(true);
		try {
			await api("POST", "/left/settings/set", { key, value: val });
			toast("收件箱设置已保存", { kind: "success" });
		} catch (e) {
			toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="收件箱设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<Row name="收件箱智能整理" hint="自动聚合同类后台任务并生成要点总结">
						<Switch
							label="收件箱智能整理"
							checked={autoTriage}
							disabled={busy}
							onChange={(v) => {
								setAutoTriage(v);
								void handleSave("inbox.autoTriage", v);
							}}
						/>
					</Row>

					<Row name="未读待办提醒" hint="有新的后台会话结果或等待处理的提醒事项时显示角标">
						<Switch
							label="未读待办提醒"
							checked={notifyUnread}
							disabled={busy}
							onChange={(v) => {
								setNotifyUnread(v);
								void handleSave("inbox.notifyUnread", v);
							}}
						/>
					</Row>

					<Row name="自动归档时限" hint="超过指定天数未活动的已完结会话自动移入已归档">
						<Stepper
							label="自动归档时限"
							value={archiveDays}
							min={1}
							max={90}
							step={1}
							unit="天"
							disabled={busy}
							onCommit={(v) => {
								setArchiveDays(v);
								void handleSave("inbox.archiveDays", v);
							}}
						/>
					</Row>
				</div>
			</div>
		</BottomSheet>
	);
}
