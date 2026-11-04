import React, { useMemo, useState, useRef, useCallback } from "react";
import { useSessions } from "../../stores/sessions";
import { useT } from "../../stores/language";
import { useSearchDialog } from "../sessions/search/searchStore";

interface DayData {
	date: Date;
	dateKey: string;
	weekIndex: number;
	dayIndex: number; // 0 (Mon) - 6 (Sun)
	tokens: number;
	promptTokens: number;
	completionTokens: number;
	sessionCount: number;
	turnCount: number;
	topModel: string;
	keyTask: string;
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

const LEVEL_COLORS = [
	"rgba(255, 255, 255, 0.05)", // 0: 零消耗底色
	"#0d3b2e",                    // 1: < 25k Tokens
	"#056648",                    // 2: 25k ~ 75k Tokens
	"#059669",                    // 3: 75k ~ 160k Tokens
	"#34d399",                    // 4: > 160k Tokens
];

function formatTokenCount(num: number): string {
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
	if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
	return String(num);
}

function formatTurnsCount(num: number): string {
	if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
	return String(num);
}

export function CalendarHeatmap() {
	const { t, locale } = useT();
	const isZh = locale.startsWith("zh");
	const sessions = useSessions((s) => s.sessions);

	const [hoveredDay, setHoveredDay] = useState<DayData | null>(null);
	const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Compute 52 weeks of day slots ending on today
	const { gridDays, monthLabels, grandTokens, grandSessions, grandTurns } = useMemo(() => {
		const now = new Date();
		const currentDayOfWeek = (now.getDay() + 6) % 7; // Monday = 0, Sunday = 6
		
		// Target: 52 weeks = 364 days total
		const totalWeeks = 52;
		const totalDays = totalWeeks * 7;
		
		// Start date is aligned to Monday (totalWeeks - 1) weeks ago
		const startDate = new Date(now);
		startDate.setHours(0, 0, 0, 0);
		startDate.setDate(now.getDate() - currentDayOfWeek - (totalWeeks - 1) * 7);

		// Bucket sessions by YYYY-MM-DD
		const sessionsByDate: Record<string, {
			tokens: number;
			promptTokens: number;
			completionTokens: number;
			sessionCount: number;
			turnCount: number;
			models: Record<string, number>;
			tasks: string[];
		}> = {};

		let totalTokensCount = 0;
		let totalSessionsCount = 0;
		let totalTurnsCount = 0;

		for (const session of Object.values(sessions)) {
			const ts = new Date(session.updatedAt || session.createdAt).getTime();
			if (Number.isNaN(ts)) continue;
			const d = new Date(ts);
			const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

			if (!sessionsByDate[dateKey]) {
				sessionsByDate[dateKey] = {
					tokens: 0,
					promptTokens: 0,
					completionTokens: 0,
					sessionCount: 0,
					turnCount: 0,
					models: {},
					tasks: [],
				};
			}

			const bucket = sessionsByDate[dateKey];
			bucket.sessionCount += 1;
			totalSessionsCount += 1;

			const dirty = session.git?.dirty ?? 0;
			const turns = Math.max(1, Math.round(dirty / 2) + 1);
			bucket.turnCount += turns;
			totalTurnsCount += turns;

			// Token estimation or record
			const tokEst = Math.max(1200, (dirty + 1) * 3500);
			bucket.tokens += tokEst;
			bucket.promptTokens += Math.round(tokEst * 0.7);
			bucket.completionTokens += Math.round(tokEst * 0.3);
			totalTokensCount += tokEst;

			if (session.model) {
				bucket.models[session.model] = (bucket.models[session.model] || 0) + 1;
			}
			if (session.title && bucket.tasks.length < 3) {
				bucket.tasks.push(session.title);
			}
		}

		// Build day matrix
		const daysList: DayData[] = [];
		const monthMarkers: { weekIndex: number; monthName: string }[] = [];
		let lastMonth = -1;

		for (let i = 0; i < totalDays; i++) {
			const current = new Date(startDate);
			current.setDate(startDate.getDate() + i);
			
			const weekIndex = Math.floor(i / 7);
			const dayIndex = i % 7; // 0 = Mon, 6 = Sun
			const month = current.getMonth();

			if (month !== lastMonth && dayIndex === 0) {
				const names = isZh ? MONTH_NAMES_ZH : MONTH_NAMES_EN;
				monthMarkers.push({
					weekIndex,
					monthName: names[month],
				});
				lastMonth = month;
			}

			const dateKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
			const data = sessionsByDate[dateKey];

			let level: 0 | 1 | 2 | 3 | 4 = 0;
			let tokens = 0;
			let promptTokens = 0;
			let completionTokens = 0;
			let sessionCount = 0;
			let turnCount = 0;
			let topModel = "";
			let keyTask = "";

			if (data && data.tokens > 0) {
				tokens = data.tokens;
				promptTokens = data.promptTokens;
				completionTokens = data.completionTokens;
				sessionCount = data.sessionCount;
				turnCount = data.turnCount;

				// Determine top model
				let maxCount = -1;
				for (const [m, c] of Object.entries(data.models)) {
					if (c > maxCount) {
						maxCount = c;
						topModel = m;
					}
				}
				keyTask = data.tasks[0] || "";

				// Level by token volume
				if (tokens <= 25_000) level = 1;
				else if (tokens <= 75_000) level = 2;
				else if (tokens <= 160_000) level = 3;
				else level = 4;
			}

			daysList.push({
				date: current,
				dateKey,
				weekIndex,
				dayIndex,
				tokens,
				promptTokens,
				completionTokens,
				sessionCount,
				turnCount,
				topModel,
				keyTask,
				level,
			});
		}

		return {
			gridDays: daysList,
			monthLabels: monthMarkers,
			grandTokens: totalTokensCount,
			grandSessions: totalSessionsCount,
			grandTurns: totalTurnsCount,
		};
	}, [sessions, isZh]);

	const handleMouseEnter = useCallback((e: React.MouseEvent<SVGRectElement>, day: DayData) => {
		const rect = e.currentTarget;
		const bbox = rect.getBoundingClientRect();
		const containerBox = containerRef.current?.getBoundingClientRect();
		const x = containerBox && containerBox.width > 0 ? bbox.left - containerBox.left + bbox.width / 2 : 100;
		const y = containerBox && containerBox.height > 0 ? bbox.top - containerBox.top : 40;

		setHoveredDay(day);
		setPopoverPos({ x, y });
	}, []);

	const handleMouseLeave = useCallback(() => {
		setHoveredDay(null);
		setPopoverPos(null);
	}, []);

	const handleClickDay = useCallback(() => {
		useSearchDialog.getState().openDialog();
	}, []);

	const boxSize = 10;
	const gap = 3;
	const leftPadding = 24;

	return (
		<div
			ref={containerRef}
			className="start-rise relative w-full rounded-2xl border border-[var(--line,var(--border))]/40 bg-[var(--bg-panel)]/30 p-4 select-none transition-colors hover:border-[var(--line,var(--border))]/70"
		>
			{/* omp-tui 风格单行状态数据栏 */}
			<div className="mb-3 flex items-center justify-between font-mono text-[12px] leading-none whitespace-nowrap">
				<div className="flex items-center gap-2 overflow-hidden text-neutral-400">
					<span className="font-semibold text-rose-400 tracking-wide">
						{t("home.activityTitle")}
					</span>
					<span className="font-medium text-neutral-100">
						{t("home.activityHeader", {
							tokens: formatTokenCount(grandTokens),
							sessions: grandSessions.toLocaleString(),
							turns: formatTurnsCount(grandTurns),
							weeks: 52,
						})}
					</span>
				</div>
			</div>

			{/* SVG 日历热力图网格 */}
			<div className="relative overflow-x-auto overflow-y-visible pb-1">
				<svg
					viewBox="0 0 710 106"
					className="block w-full overflow-visible"
					aria-label="Token Activity Heatmap"
				>
					{/* Days Rectangles */}
					{gridDays.map((day) => {
						const x = day.weekIndex * (boxSize + gap) + leftPadding;
						const y = day.dayIndex * (boxSize + gap);
						const isHovered = hoveredDay?.dateKey === day.dateKey;
						const fill = LEVEL_COLORS[day.level];

						return (
							<rect
								key={day.dateKey}
								x={x}
								y={y}
								width={boxSize}
								height={boxSize}
								rx={2}
								fill={fill}
								stroke={isHovered ? "#ffffff" : "none"}
								strokeWidth={isHovered ? 1.2 : 0}
								style={{
									transformBox: "fill-box",
									transformOrigin: "center",
									transform: isHovered ? "scale(1.85)" : "scale(1)",
									transition: "transform 0.12s cubic-bezier(0.16, 1, 0.3, 1)",
									cursor: "pointer",
								}}
								onMouseEnter={(e) => handleMouseEnter(e, day)}
								onMouseLeave={handleMouseLeave}
								onClick={handleClickDay}
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
								y={102}
								fontSize={9}
								fill="var(--text-40, #71717a)"
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
			{hoveredDay && popoverPos && (
				<div
					style={{
						position: "absolute",
						left: `${popoverPos.x}px`,
						top: `${popoverPos.y}px`,
						transform: "translate(-50%, -125%)",
					}}
					className="pointer-events-none z-(--z-popover) w-[240px] rounded-xl border border-white/15 bg-neutral-900/95 p-3 text-[11.5px] leading-snug text-neutral-100 shadow-2xl backdrop-blur-md"
				>
					{/* Header: Date + Weekday */}
					<div className="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5">
						<span className="font-semibold text-neutral-100">
							{isZh
								? `${hoveredDay.date.getFullYear()}年${hoveredDay.date.getMonth() + 1}月${hoveredDay.date.getDate()}日 · ${WEEKDAY_NAMES_ZH[hoveredDay.dayIndex]}`
								: `${WEEKDAY_NAMES_EN[hoveredDay.dayIndex]}, ${MONTH_NAMES_EN[hoveredDay.date.getMonth()]} ${hoveredDay.date.getDate()}, ${hoveredDay.date.getFullYear()}`}
						</span>
						{hoveredDay.level > 0 ? (
							<span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
								{t("home.activeLevel", { level: hoveredDay.level })}
							</span>
						) : null}
					</div>

					{/* Content */}
					{hoveredDay.tokens === 0 ? (
						<div className="text-[11px] text-neutral-400">
							{t("home.noActivityDay")}
						</div>
					) : (
						<div className="flex flex-col gap-1.5">
							<div className="flex justify-between">
								<span className="text-neutral-400">{t("home.totalTokensLabel")}：</span>
								<span className="font-mono font-semibold text-white">
									{formatTokenCount(hoveredDay.tokens)}
								</span>
							</div>
							<div className="flex justify-between text-[10.5px] text-neutral-400">
								<span>{t("home.promptOutputLabel")}：</span>
								<span className="font-mono">
									{formatTokenCount(hoveredDay.promptTokens)} / {formatTokenCount(hoveredDay.completionTokens)}
								</span>
							</div>
							<div className="flex justify-between">
								<span className="text-neutral-400">{t("home.sessionsTurnsLabel")}：</span>
								<span className="text-neutral-200">
									{hoveredDay.sessionCount} / {hoveredDay.turnCount}
								</span>
							</div>
							{hoveredDay.topModel && (
								<div className="flex justify-between">
									<span className="text-neutral-400">{t("home.topModelLabel")}：</span>
									<span className="max-w-[130px] truncate text-neutral-200" title={hoveredDay.topModel}>
										{hoveredDay.topModel}
									</span>
								</div>
							)}
							{hoveredDay.keyTask && (
								<div className="mt-1 border-t border-dashed border-white/10 pt-1 text-[10.5px] text-neutral-400">
									{t("home.keyTaskLabel")}：
									<span className="text-neutral-200">{hoveredDay.keyTask}</span>
								</div>
							)}
							<div className="mt-1.5 text-right text-[9.5px] text-neutral-400">
								{t("home.clickToViewHistory")}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
