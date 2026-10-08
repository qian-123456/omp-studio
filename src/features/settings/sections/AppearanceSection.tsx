/** Settings ▸ 外观 (`appearance`): theme, chat font size, UI density, zoom. */
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
import { SectionHeader, SettingRow, SettingsCard } from "../ui";

const DEFAULT_FONT_SIZE: FontSize = "md";
const DEFAULT_UI_SCALE: UiScale = "standard";

const STEP_BTN =
	"inline-flex h-7 w-7 items-center justify-center rounded-lg hairline bg-[var(--well-bg)] text-neutral-300 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-40 disabled:active:scale-100";

/** Small "恢复默认" link; hidden while the value already equals the default. */
function ResetButton({ visible, onClick, label }: { visible: boolean; onClick: () => void; label: string }) {
	if (!visible) return null;
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={`${label}恢复默认`}
			className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
		>
			<RotateCcw className="h-3 w-3" />
			恢复默认
		</button>
	);
}

export function AppearanceSection() {
	const fontSize = useFontSize();
	const uiScale = useUiScale();
	const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom();
	const anyChanged = fontSize !== DEFAULT_FONT_SIZE || uiScale !== DEFAULT_UI_SCALE || zoom !== DEFAULT_ZOOM;

	return (
		<div className="space-y-6">
			<SectionHeader
				title="外观"
				description="主题配色、文字大小与界面缩放；修改立即生效，只影响本机"
				actions={
					anyChanged ? (
						<button
							type="button"
							onClick={() => {
								setFontSize(DEFAULT_FONT_SIZE);
								setUiScale(DEFAULT_UI_SCALE);
								resetZoom();
							}}
							className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 text-xs text-neutral-300 hover:bg-[var(--bg-hover)]"
							title="字号、密度、缩放全部恢复默认（不影响主题）"
						>
							<RotateCcw className="h-3.5 w-3.5" />
							全部恢复默认
						</button>
					) : undefined
				}
			/>
			<SettingsCard title="主题">
				<SettingRow
					fieldId="theme"
					stacked
					label="配色主题"
					description="支持深色、浅色、跟随系统，或使用图片背景与自选强调色"
					control={<ThemePicker />}
				/>
			</SettingsCard>
			<SettingsCard title="文字与布局" footer="以上设置保存在本机，立即生效，不需要重启。">
				<SettingRow
					fieldId="fontSize"
					label="聊天字号"
					description={`会话消息正文的文字大小（当前：${FONT_SIZES.find((f) => f.id === fontSize)?.name ?? fontSize}，默认：标准）`}
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
					description={`列表、按钮之间的间距疏密（当前：${UI_SCALES.find((s) => s.id === uiScale)?.name ?? uiScale}，默认：标准）`}
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
					description={`整个窗口的放大比例（${minZoom}%–${maxZoom}%，默认 ${DEFAULT_ZOOM}%）`}
					hint="快捷键：⌘ + 放大，⌘ − 缩小，⌘ 0 恢复 100%"
					control={
						<div className="flex items-center gap-1.5">
							<ResetButton label="界面缩放" visible={zoom !== DEFAULT_ZOOM} onClick={resetZoom} />
							<button
								type="button"
								onClick={zoomOut}
								disabled={zoom <= minZoom}
								className={STEP_BTN}
								aria-label="缩小"
								title="缩小"
							>
								<Minus className="h-3.5 w-3.5" />
							</button>
							<span
								className="min-w-14 text-center font-mono text-xs font-medium tabular-nums text-neutral-200"
								aria-live="polite"
							>
								{zoom}%
							</span>
							<button
								type="button"
								onClick={zoomIn}
								disabled={zoom >= maxZoom}
								className={STEP_BTN}
								aria-label="放大"
								title="放大"
							>
								<Plus className="h-3.5 w-3.5" />
							</button>
						</div>
					}
				/>
			</SettingsCard>
		</div>
	);
}
