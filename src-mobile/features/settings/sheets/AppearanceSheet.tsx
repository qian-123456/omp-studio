import { usePrefs } from "../../../core/stores/prefs";
import { ListGroup, Segmented, Switch } from "../../../ui";
import { SettingRow, SettingsSheet } from "../rows";
import { FOLD_OPEN_KEY, MSG_SIZE_KEY, MSG_SIZES, msgSizeFromPref, msgSizePx, SCHEMES } from "../settingsMap";

export function AppearanceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const scheme = usePrefs((s) => s.scheme);
	const size = usePrefs((s) => msgSizeFromPref(s.extra[MSG_SIZE_KEY]));
	const foldOpen = usePrefs((s) => s.extra[FOLD_OPEN_KEY] === true);
	const set = usePrefs((s) => s.set);
	const setExtra = usePrefs((s) => s.setExtra);
	const previewSize = { fontSize: `${msgSizePx(size)}px` };

	return (
		<SettingsSheet open={open} onClose={onClose} title="外观设置">
			<ListGroup note="外观只影响这台手机，不会改动电脑上的设置。">
				<SettingRow name="色彩模式" hint="跟随系统，或固定为浅色、深色" stacked>
					<Segmented label="色彩模式" value={scheme} options={SCHEMES} onChange={(v) => set({ scheme: v })} />
				</SettingRow>
				<SettingRow name="对话字号" hint="对话正文的文字大小" stacked>
					<Segmented label="对话字号" value={size} options={MSG_SIZES} onChange={(v) => setExtra(MSG_SIZE_KEY, v)} />
				</SettingRow>
				<SettingRow name="默认展开步骤" hint="对话里的思考和工具步骤默认展开显示">
					<Switch label="默认展开步骤" checked={foldOpen} onChange={(v) => setExtra(FOLD_OPEN_KEY, v)} />
				</SettingRow>
			</ListGroup>
			<ListGroup title="预览">
				<div aria-label="当前外观预览" className="flex flex-col gap-3 px-5 py-4">
					<div
						className="self-end rounded-m-lg bg-m-bubble-user-bg px-4 py-2 text-m-text"
						style={previewSize}
					>
						帮我看看这个报错
					</div>
					<div className="text-m-text" style={previewSize}>
						好的，我先看一下日志，再告诉你问题出在哪里。
					</div>
				</div>
			</ListGroup>
		</SettingsSheet>
	);
}
