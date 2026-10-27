import { BottomSheet } from "../../../ui/BottomSheet";
import { Row, Segmented, Switch } from "../controls";
import { usePrefs } from "../../../core/stores/prefs";
import {
	FOLD_OPEN_KEY,
	MSG_SIZE_KEY,
	MSG_SIZES,
	SCHEMES,
	SKINS,
	msgSizeFromPref,
	type MsgSize,
} from "../settingsMap";

export function AppearanceSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const skin = usePrefs((s) => s.skin);
	const scheme = usePrefs((s) => s.scheme);
	const size = usePrefs((s) => msgSizeFromPref(s.extra[MSG_SIZE_KEY]));
	const foldOpen = usePrefs((s) => s.extra[FOLD_OPEN_KEY] === true);
	const set = usePrefs((s) => s.set);
	const setExtra = usePrefs((s) => s.setExtra);

	return (
		<BottomSheet open={open} onClose={onClose} title="外观设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<Row name="主题风格" hint="界面的色彩与字体基调风格">
						<Segmented
							label="主题风格"
							value={skin}
							options={SKINS.map((s) => ({ value: s.value, label: s.label }))}
							onChange={(v) => set({ skin: v })}
						/>
					</Row>

					<Row name="色彩模式" hint="跟随系统或强制浅色 / 深色">
						<Segmented
							label="色彩模式"
							value={scheme}
							options={SCHEMES.map((s) => ({ value: s.value, label: s.label }))}
							onChange={(v) => set({ scheme: v })}
						/>
					</Row>

					<Row name="对话字号" hint="正文与代码消息的基准显示大小">
						<Segmented
							label="对话字号"
							value={size}
							options={MSG_SIZES.map((s) => ({ value: s.value, label: s.label }))}
							onChange={(v) => setExtra(MSG_SIZE_KEY, v as MsgSize)}
						/>
					</Row>

					<Row name="默认展开思考过程" hint="智能体生成的思考块默认处于展开阅读状态">
						<Switch
							label="默认展开思考过程"
							checked={foldOpen}
							onChange={(v) => setExtra(FOLD_OPEN_KEY, v)}
						/>
					</Row>
				</div>
				<p className="px-2 text-m-xs text-m-text-3">
					外观只影响这台手机的显示，不会改动电脑端桌面客户端的配置。
				</p>
			</div>
		</BottomSheet>
	);
}
