/** Settings ▸ 外观 (`appearance`): theme, chat font size, UI density, zoom, request stats, thinking preview. */
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Segmented } from "../../../components/Segmented";
import { ThemePicker } from "../../../components/ThemePicker";
import { SUPPORTED_LOCALES, type Locale } from "../../../lib/i18n";
import { useT } from "../../../stores/language";
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
	const { locale, setLocale, t } = useT();
	const fontSize = useFontSize();
	const uiScale = useUiScale();
	const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom();
	const anyChanged = fontSize !== DEFAULT_FONT_SIZE || uiScale !== DEFAULT_UI_SCALE || zoom !== DEFAULT_ZOOM;
	const zoomKeys = (["zoom.in", "zoom.out", "zoom.reset"] as const).map((id) => formatAccelerator(acceleratorOf(id)));
	const zoomHint = t("shortcuts.zoomHint", {
		inKey: zoomKeys[0],
		outKey: zoomKeys[1],
		resetKey: zoomKeys[2],
	});
	return (
		<div className="space-y-6">
			<SectionHeader
				title={t("settings.appearance.title")}
				description={t("settings.appearance.description")}
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
			<SettingsCard jump="主题" title={t("settings.appearance.theme")}>
				<SettingRow
					fieldId="theme"
					stacked
					label="配色主题"
					description="选择浅色或深色主题、跟随系统，或使用图片背景与自选强调色"
					control={<ThemePicker />}
				/>
			</SettingsCard>
			<SettingsCard jump="文字与布局" title={t("settings.appearance.typographyAndLayout")} footer={t("settings.appearance.footerLocalOnly")}>
				<SettingRow
					fieldId="language"
					label={t("settings.language")}
					description={t("settings.languageDesc")}
					control={
						<Segmented
							aria-label={t("settings.language")}
							value={locale}
							onChange={(val) => setLocale(val as Locale)}
							options={SUPPORTED_LOCALES.map((l) => ({ value: l.value, label: l.nativeLabel }))}
						/>
					}
				/>
				<SettingRow
					fieldId="fontSize"
					label={t("settings.appearance.fontSize")}
					description={t("settings.appearance.fontSizeDesc")}
					control={
						<div className="flex items-center gap-1.5">
							<ResetButton
								label={t("settings.appearance.fontSize")}
								visible={fontSize !== DEFAULT_FONT_SIZE}
								onClick={() => setFontSize(DEFAULT_FONT_SIZE)}
							/>
							<Segmented
								aria-label={t("settings.appearance.fontSize")}
								value={fontSize}
								onChange={setFontSize}
								options={FONT_SIZES.map((fs) => ({ value: fs.id, label: fs.name }))}
							/>
						</div>
					}
				/>
				<SettingRow
					fieldId="uiDensity"
					label={t("settings.appearance.uiScale")}
					description={t("settings.appearance.uiScaleDesc")}
					control={
						<div className="flex items-center gap-1.5">
							<ResetButton
								label={t("settings.appearance.uiScale")}
								visible={uiScale !== DEFAULT_UI_SCALE}
								onClick={() => setUiScale(DEFAULT_UI_SCALE)}
							/>
							<Segmented
								aria-label={t("settings.appearance.uiScale")}
								value={uiScale}
								onChange={setUiScale}
								options={UI_SCALES.map((s) => ({ value: s.id, label: s.name }))}
							/>
						</div>
					}
				/>
				<SettingRow
					fieldId="uiScale"
					label={t("settings.appearance.zoom")}
					description={`整个窗口的放大比例（${minZoom}%–${maxZoom}%）`}
					hint={`快捷键：${zoomHint}（可在「快捷键」页查看）`}
					control={
						<div className="flex items-center gap-1.5">
							<ResetButton label={t("settings.appearance.zoom")} visible={zoom !== DEFAULT_ZOOM} onClick={resetZoom} />
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
