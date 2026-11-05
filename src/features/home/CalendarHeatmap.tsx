import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useSessions } from "../../stores/sessions";
import { activityUsage } from "../../lib/ipc";
import clsx from "clsx";
import { useT } from "../../stores/language";
import { useIsDark } from "../../lib/theme";
import type { ActivityUsage } from "../../lib/contracts";

interface DayData {
	date: Date;
	dateKey: string;
	weekIndex: number;
	dayIndex: number; // 0 (Mon) - 6 (Sun)
	tokens: number | null;
	missingRequests: number;
	sessionCount: number;
	topModel: string | null;
	level: 0 | 1 | 2 | 3 | 4;
}

const MONTH_NAMES_ZH = [
	"1月", "2月", "3月", "4月", "5月", "6月",
	"7月", "8月", "9月", "10月", "11月", "12月"
];

const MONTH_NAMES_EN = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const WEEKDAY_NAMES_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WEEKDAY_NAMES_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DARK_LEVEL_COLORS = [
	"rgba(255, 255, 255, 0.04)", // 0: 零消耗底色（深色微透）
	"#0e4429",                     // 1: 轻度活跃
	"#006d32",                     // 2: 中度活跃
	"#26a641",                     // 3: 较高活跃
	"#39d353",                     // 4: 极度活跃
];

const LIGHT_LEVEL_COLORS = [
	"rgba(0, 0, 0, 0.06)",        // 0: 零消耗底色（浅色清晰淡灰，不再隐形）
	"#9be9a8",                     // 1: 清爽浅绿
	"#40c463",                     // 2: 明朗中绿
	"#30a14e",                     // 3: 稳健葱绿
	"#216e39",                     // 4: 深沉翡翠绿
];


function formatTokenCount(num: number): string {
	if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
	if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
	return String(num);
}

function formatTurnsCount(num: number): string {
	if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
	return String(num);
}

class HeatmapErrorBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { hasError: boolean }> {
	state = { hasError: false };
	static getDerivedStateFromError() {
		return { hasError: true };
	}
	componentDidCatch(err: unknown) {
		console.error("CalendarHeatmap rendering failed:", err);
	}
	render() {
		return this.state.hasError ? this.props.fallback : this.props.children;
	}
}

function HeatmapContent() {
	const { t, locale } = useT();
	const isZh = locale?.startsWith("zh") ?? true;
	const isDark = useIsDark();
	const levelColors = isDark ? DARK_LEVEL_COLORS : LIGHT_LEVEL_COLORS;
	const sessions = useSessions((s) => s.sessions);

	const [hoveredDate, setHoveredDate] = useState<string | null>(null);
	const [popoverPos, setPopoverPos] = useState<{ x: number; y: number; xAlign: string; yAlign: string } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [usage, setUsage] = useState<ActivityUsage | null>(null);
	const [error, setError] = useState<string | null>(null);
	const refreshRef = useRef<() => void>(() => {});

	useEffect(() => {
		let mounted = true;
		let inFlight = false;
		let pending = false;
		const refresh = () => {
			if (inFlight) {
				pending = true;
				return;
			}
			inFlight = true;
			void activityUsage().then((result) => {
				if (mounted) {
					setUsage(result);
					setError(null);
				}
			}).catch((err: unknown) => {
				if (mounted) setError(String(err));
			}).finally(() => {
				inFlight = false;
				if (mounted && pending) {
					pending = false;
					refresh();
				}
			});
		};
		refreshRef.current = refresh;
		const timer = window.setInterval(refresh, 30_000);
		return () => {
			mounted = false;
			refreshRef.current = () => {};
			window.clearInterval(timer);
		};
	}, []);

	useEffect(() => {
		refreshRef.current();
	}, [sessions]);

	const { gridDays, monthLabels, grandTokens, grandMissingRequests, grandSessions, grandTurns } = useMemo(() => {
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		const currentDayOfWeek = (now.getDay() + 6) % 7;
		const startDate = new Date(now);
		startDate.setDate(now.getDate() - currentDayOfWeek - 51 * 7);
		const byDate = new Map((usage?.days ?? []).map((day) => [day.date, day]));
		const startKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
		const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
		let peakTokens = 0;
		for (const day of byDate.values()) {
			if (day.date >= startKey && day.date <= todayKey && day.tokens !== null) {
				peakTokens = Math.max(peakTokens, day.tokens);
			}
		}
		const daysList: DayData[] = [];
		const monthMarkers: { weekIndex: number; monthName: string }[] = [];
		let lastMonth = -1;
		let totalTokens: number | null = 0;
		let knownDays = 0;
		let missingRequests = 0;
		let totalSessions = 0;
		let totalTurns = 0;

		for (let i = 0; i < 52 * 7; i++) {
			const current = new Date(startDate);
			current.setDate(startDate.getDate() + i);
			const weekIndex = Math.floor(i / 7);
			const dayIndex = i % 7;
			const month = current.getMonth();
			if (month !== lastMonth && dayIndex === 0) {
				monthMarkers.push({ weekIndex, monthName: (isZh ? MONTH_NAMES_ZH : MONTH_NAMES_EN)[month] });
				lastMonth = month;
			}
			const dateKey = `${current.getFullYear()}-${String(month + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
			const data = current <= now ? byDate.get(dateKey) : undefined;
			if (data) {
				if (data.tokens !== null) { totalTokens = (totalTokens ?? 0) + data.tokens; knownDays += 1; }
				missingRequests += data.missingRequests;
				totalSessions += data.sessions;
				totalTurns += data.turns;
			}
			const tokens = data ? data.tokens : 0;
			const sessionCount = data?.sessions ?? 0;
			// Match Token Tracker's quarter-of-peak scale within the displayed period.
			const ratio = tokens !== null && peakTokens > 0 ? tokens / peakTokens : 0;
			const level: DayData["level"] = !data || tokens === 0 ? 0
				: tokens === null || ratio <= 0.25 ? 1
				: ratio <= 0.5 ? 2
				: ratio <= 0.75 ? 3 : 4;
			daysList.push({ date: current, dateKey, weekIndex, dayIndex, tokens, missingRequests: data?.missingRequests ?? 0, sessionCount, topModel: data?.topModel ?? null, level });
		}
		return { gridDays: daysList, monthLabels: monthMarkers, grandTokens: knownDays === 0 && missingRequests > 0 ? null : totalTokens, grandMissingRequests: missingRequests, grandSessions: totalSessions, grandTurns: totalTurns };
	}, [usage, isZh]);
	const hoveredDay = gridDays.find((day) => day.dateKey === hoveredDate);

	const handleMouseEnter = useCallback((e: React.MouseEvent<SVGRectElement>, day: DayData) => {
		const rect = e.currentTarget;
		const bbox = rect.getBoundingClientRect();
		const containerBox = containerRef.current?.getBoundingClientRect();

		// Smart flip to avoid clipping by window edges
		const xAlign = day.weekIndex >= 44 ? "-85%" : day.weekIndex <= 7 ? "-15%" : "-50%";
		const yAlign = day.dayIndex <= 2 ? "25%" : "-120%";

		const x = containerBox && containerBox.width > 0 ? bbox.left - containerBox.left + bbox.width / 2 : 100;
		const y = containerBox && containerBox.height > 0 ? bbox.top - containerBox.top : 40;

		setHoveredDate(day.dateKey);
		setPopoverPos({ x, y, xAlign, yAlign });
	}, []);

	const handleMouseLeave = useCallback(() => {
		setHoveredDate(null);
		setPopoverPos(null);
	}, []);

	const boxSize = 10;
	const gap = 3;
	const leftPadding = 12;

	return (
		<div
			ref={containerRef}
			className="start-rise relative w-full rounded-2xl border border-[var(--line,var(--border))]/40 bg-[var(--bg-panel)]/30 px-3.5 py-3 select-none transition-colors hover:border-[var(--line,var(--border))]/70"
		>
			{/* omp-tui 风格单行状态数据栏：左对齐与第 1 列日历方块对准 */}
			<div
				style={{ paddingLeft: `${leftPadding}px` }}
				className="mb-2.5 flex items-center justify-between font-mono text-[12px] leading-snug"
			>
				<div className="flex min-w-0 items-start gap-2 text-[var(--text-muted)]">
					<span className="shrink-0 whitespace-nowrap font-semibold text-rose-400 tracking-wide">
						{t("home.activityTitle")}
					</span>
					<span className="min-w-0 break-words font-medium text-[var(--text)]" role={error ? "alert" : "status"}>
						{error ? t("home.activityError", { error }) : !usage ? t("home.activityLoading") : t("home.activityHeader", {
							tokens: grandTokens === null ? t("home.activityUnknown") : `${grandMissingRequests > 0 ? "≥" : ""}${formatTokenCount(grandTokens)}`,
							sessions: grandSessions.toLocaleString(),
							turns: formatTurnsCount(grandTurns),
							weeks: 52,
						})}
					</span>
				</div>
			</div>

			{/* SVG 日历热力图网格 */}
			<div className="relative overflow-x-auto overflow-y-visible pb-0.5">
				<svg
					viewBox="0 0 706 112"
					className="block w-full overflow-visible"
					aria-label="Token Activity Heatmap"
				>
					{/* Days Rectangles */}
					{gridDays.map((day) => {
						const x = day.weekIndex * (boxSize + gap) + leftPadding;
						const y = day.dayIndex * (boxSize + gap);
						const isHovered = hoveredDay?.dateKey === day.dateKey;
						const fill = levelColors[day.level];

						return (
							<rect
								key={day.dateKey}
								data-date={day.dateKey}
								x={x}
								y={y}
								width={boxSize}
								height={boxSize}
								rx={2.6}
								fill={fill}
								stroke="none"
								strokeWidth={0}
								style={{
									transformBox: "fill-box",
									transformOrigin: "center",
									transform: isHovered ? "scale(1.18)" : "scale(1)",
									transition: "transform 0.1s cubic-bezier(0.16, 1, 0.3, 1)",
									cursor: "default",
								}}
								onMouseEnter={(e) => { if (usage && !error) handleMouseEnter(e, day); }}
								onMouseLeave={handleMouseLeave}
							/>
						);
					})}

					{/* Month labels */}
					{monthLabels.map((m) => {
						const x = m.weekIndex * (boxSize + gap) + leftPadding;
						return (
							<text
								key={`${m.monthName}-${m.weekIndex}`}
								x={x}
								y={105}
								fontSize={9}
								fill="var(--text-40, var(--text-dim))"
								textAnchor="start"
								className="font-mono"
							>
								{m.monthName}
							</text>
						);
					})}
				</svg>
			</div>

			{/* 悬停详细数据弹窗（Rich Popover） */}
			{hoveredDay && popoverPos && usage && !error && (
				<div
					style={{
						position: "absolute",
						left: `${popoverPos.x}px`,
						top: `${popoverPos.y}px`,
						transform: `translate(${popoverPos.xAlign}, ${popoverPos.yAlign})`,
					}}
					className="pointer-events-none z-(--z-popover) w-[260px] rounded-xl border border-[var(--border)] bg-[var(--bg-panel)]/95 p-3 text-[11.5px] leading-snug text-[var(--text)] shadow-apple-card backdrop-blur-md"
				>
					{/* Header: Date + Weekday */}
					<div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-divider)] pb-1.5">
						<span className="shrink-0 whitespace-nowrap font-semibold text-[var(--text)]">
							{isZh
								? `${hoveredDay.date.getFullYear()}年${hoveredDay.date.getMonth() + 1}月${hoveredDay.date.getDate()}日 · ${WEEKDAY_NAMES_ZH[hoveredDay.dayIndex]}`
								: `${WEEKDAY_NAMES_EN[hoveredDay.dayIndex]}, ${MONTH_NAMES_EN[hoveredDay.date.getMonth()]} ${hoveredDay.date.getDate()}, ${hoveredDay.date.getFullYear()}`}
						</span>
						{hoveredDay.level > 0 ? (
							<span
								className={clsx(
									"shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold",
									isDark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-600/10 text-emerald-700",
								)}
							>
								{t("home.activeLevel", { level: hoveredDay.level })}
							</span>
						) : null}
					</div>

					{/* Content */}
					{hoveredDay.sessionCount === 0 ? (
						<div className="text-[11px] text-[var(--text-muted)]">
							{t("home.noActivityDay")}
						</div>
					) : (
						<div className="flex flex-col gap-1.5">
							<div className="flex justify-between items-center">
								<span className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t("home.totalTokensLabel")}：</span>
								<span className="whitespace-nowrap font-mono font-semibold text-[var(--text)]">
									{hoveredDay.tokens === null ? t("home.activityUnknown") : `${hoveredDay.missingRequests > 0 ? "≥" : ""}${formatTokenCount(hoveredDay.tokens)} tokens`}
								</span>
							</div>
							<div className="flex justify-between items-center">
								<span className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t("home.sessionCountLabel")}：</span>
								<span className="whitespace-nowrap text-[var(--text)] font-medium">
									{t("home.sessionCountValue", { count: hoveredDay.sessionCount })}
								</span>
							</div>
							{hoveredDay.topModel ? (
								<div className="flex flex-col gap-0.5 mt-0.5 border-t border-dashed border-[var(--border-divider)] pt-1">
									<span className="text-[var(--text-muted)]">{t("home.topModelLabel")}：</span>
									<span className="break-all text-[var(--text)] leading-tight font-mono text-[11px]">
										{hoveredDay.topModel}
									</span>
								</div>
							) : null}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function CalendarHeatmap() {
	const { t } = useT();
	return (
		<HeatmapErrorBoundary fallback={<div role="alert">{t("home.activityRenderError")}</div>}>
			<HeatmapContent />
		</HeatmapErrorBoundary>
	);
}
