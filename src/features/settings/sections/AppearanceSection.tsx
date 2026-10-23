/** Settings ▸ 外观 (`appearance`): theme, chat font size, UI density, zoom, request stats, thinking preview. */
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Segmented } from "../../../components/Segmented";
import { ThemePicker } from "../../../components/ThemePicker";
import {
	FONT_SIZES,
	UI_SCALES,
	setFontSize,
	setUiScale,
	useFontSize,
	useUiScale,
	type FontSize,
	type UiScale,
} from "../../../lib/theme";
import { DEFAULT_ZOOM, useZoom } from "../../../lib/zoom";
import { acceleratorOf } from "../../shortcuts/bindingsStore";
import { SectionJumpBar } from "../SectionJumpBar";
import { Button, IconButton, SectionHeader, SettingRow, SettingsCard } from "../ui";
import { formatAccelerator } from "./ShortcutRecorder";
import { ConversationDisplayCard, RequestStatsCard } from "./RequestStatsCards";

const DEFAULT_FONT_SIZE: FontSize = "md";
const DEFAULT_UI_SCALE: UiScale = "standard";

/** Small "恢复默认" button; hidden while the value already equals the default. */
function ResetButton({ visible, onClick, label }: { visible: boolean; onClick: () => void; label: string }) {
	if (!visible) return null;
	return (
		<Button size="sm" variant="ghost" icon={RotateCcw} onClick={onClick} aria-label={`${label}恢复默认`}>
			恢复默认
		</Button>
	);
}

export function AppearanceSection() {
	const fontSize = useFontSize();
	const uiScale = useUiScale();
	const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom();
	const anyChanged = fontSize !== DEFAULT_FONT_SIZE || uiScale !== DEFAULT_UI_SCALE || zoom !== DEFAULT_ZOOM;
	const zoomKeys = (["zoom.in", "zoom.out", "zoom.reset"] as const).map((id) => formatAccelerator(acceleratorOf(id)));
	const zoomHint = `${zoomKeys[0]} 放大，${zoomKeys[1]} 缩小，${zoomKeys[2]} 恢复 100%`;
	return (
		<div className="space-y-6">
			<SectionHeader
				title="外观"
				description="主题、字号、界面密度和对话里显示哪些信息"
				actions={
					anyChanged ? (
						<Button
							icon={RotateCcw}
							onClick={() => {
								setFontSize(DEFAULT_FONT_SIZE);
								setUiScale(DEFAULT_UI_SCALE);
								resetZoom();
							}}
							title="字号、密度、缩放全部恢复默认（不影响主题）"
						>
							全部恢复默认
						</Button>
					) : undefined
				}
			/>
			<SectionJumpBar />
			<SettingsCard jump="主题" title="主题">
				<SettingRow
					fieldId="theme"
					stacked
					label="配色主题"
					description="选择浅色或深色主题、跟随系统，或使用图片背景与自选强调色"
					control={<ThemePicker />}
				/>
			</SettingsCard>
			<SettingsCard jump="文字与布局" title="文字与布局" footer="以上设置只保存在本机，立即生效，不需要重启。">
				<SettingRow
					fieldId="fontSize"
					label="聊天字号"
					description="会话消息正文的文字大小"
					control={
						<div className="flex items-center gap-1.5">
							<ResetButton
								label="聊天字号"
								visible={fontSize !== DEFAULT_FONT_SIZE}
								onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
							/>
							<Segmented
								aria-label="聊天字号"
								value={fontSize}
								onChange={setFontSize}
								options={FONT_SIZES.map((fs) => ({ value: fs.id, label: fs.name }))}
							/>
						</div>
					}
				/>
				<SettingRow
					fieldId="uiDensity"
					label="界面密度"
					description="列表、按钮之间的间距疏密"
					control={
						<div className="flex items-center gap-1.5">
							<ResetButton
								label="界面密度"
								visible={uiScale !== DEFAULT_UI_SCALE}
								onClick={() => setUiScale(DEFAULT_UI_SCALE)}
							/>
							<Segmented
								aria-label="界面密度"
								value={uiScale}
								onChange={setUiScale}
								options={UI_SCALES.map((s) => ({ value: s.id, label: s.name }))}
							/>
						</div>
					}
				/>
				<SettingRow
					fieldId="uiScale"
					label="界面缩放"
					description={`整个窗口的放大比例（${minZoom}%–${maxZoom}%）`}
					hint={`快捷键：${zoomHint}（可在「快捷键」页查看）`}
					control={
						<div className="flex items-center gap-1.5">
							<ResetButton label="界面缩放" visible={zoom !== DEFAULT_ZOOM} onClick={resetZoom} />
							<IconButton icon={Minus} label="缩小" onClick={zoomOut} disabled={zoom <= minZoom} />
							<span
								className="min-w-14 text-center font-mono text-xs font-medium tabular-nums text-[var(--text)]"
								aria-live="polite"
							>
								{zoom}%
							</span>
							<IconButton icon={Plus} label="放大" onClick={zoomIn} disabled={zoom >= maxZoom} />
						</div>
					}
				/>
			</SettingsCard>
			<div data-jump="请求统计" className="scroll-mt-4">
				<RequestStatsCard />
			</div>
			<div data-jump="对话显示" className="scroll-mt-4">
				<ConversationDisplayCard />
			</div>
		</div>
	);
}
