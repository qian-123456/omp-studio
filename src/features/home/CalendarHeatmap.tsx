import React, { useMemo, useState, useRef, useCallback } from "react";
import { useSessions } from "../../stores/sessions";
import { useLive } from "../../stores/live";
import { useT } from "../../stores/language";
import type { SessionMeta } from "../../lib/contracts";

interface DayData {
	date: Date;
	dateKey: string;
	weekIndex: number;
	dayIndex: number; // 0 (Mon) - 6 (Sun)
	tokens: number;
	sessionCount: number;
	topModel: string;
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
	"rgba(255, 255, 255, 0.035)", // 0: 零消耗底色
	"#0d3b2e",                     // 1: 轻度活跃
	"#056648",                     // 2: 中度活跃
	"#059669",                     // 3: 较高活跃
	"#34d399",                     // 4: 极度活跃
];

const CACHE_KEY = "ompws:heatmap-cache:v2";

interface CachedSessionUsage {
	id: string;
	updatedAt: string;
	tokens: number;
	model: string;
	dateKey: string;
}

function loadCache(): Record<string, CachedSessionUsage> {
	if (typeof window === "undefined" || !window.localStorage) return {};
	try {
		const raw = window.localStorage.getItem(CACHE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function saveCache(cache: Record<string, CachedSessionUsage>) {
	if (typeof window === "undefined" || !window.localStorage) return;
	try {
		window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
	} catch {
		// Ignore write errors (quota exceeded, etc.)
	}
}

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
	const [popoverPos, setPopoverPos] = useState<{ x: number; y: number; xAlign: string; yAlign: string } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Compute 52 weeks of day slots ending on today with incremental caching
	const { gridDays, monthLabels, grandTokens, grandSessions, grandTurns } = useMemo(() => {
		const now = new Date();
		const currentDayOfWeek = (now.getDay() + 6) % 7; // Monday = 0, Sunday = 6
		
		const totalWeeks = 52;
		const totalDays = totalWeeks * 7;
		
		const startDate = new Date(now);
		startDate.setHours(0, 0, 0, 0);
		startDate.setDate(now.getDate() - currentDayOfWeek - (totalWeeks - 1) * 7);

		// Cache mechanism: load previous scan result
		const usageCache = loadCache();
		let cacheDirty = false;

		// Extract live usage state for accurate realtime active sessions
		const liveState = useLive.getState().sessions;

		// Incremental overlay: process sessions
		const sessionEntries = Object.values(sessions) as SessionMeta[];
		const activeIds = new Set<string>();

		for (const session of sessionEntries) {
			activeIds.add(session.id);
			const cached = usageCache[session.id];
			const isUpdated = !cached || cached.updatedAt !== (session.updatedAt || session.createdAt);

			if (isUpdated) {
				cacheDirty = true;
				const ts = new Date(session.updatedAt || session.createdAt).getTime();
				const d = Number.isNaN(ts) ? new Date() : new Date(ts);
				const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

				// Read authentic tokens from live session state or session record
				let realTokens = 0;
				const liveEntry = liveState[session.id];
				const liveUsage = liveEntry?.state?.contextUsage;
				if (liveUsage && typeof liveUsage === "object" && typeof (liveUsage as Record<string, unknown>).tokens === "number") {
					realTokens = (liveUsage as Record<string, unknown>).tokens as number;
				} else if (session.result?.summary && session.result.summary.includes("tokens")) {
					const m = session.result.summary.match(/(\d+)\s*tokens/);
					if (m) realTokens = Number(m[1]) || 0;
				}

				usageCache[session.id] = {
					id: session.id,
					updatedAt: session.updatedAt || session.createdAt,
					tokens: realTokens,
					model: session.model || "",
					dateKey,
				};
			}
		}

		if (cacheDirty) {
			saveCache(usageCache);
		}

		// Aggregate day buckets from cache
		const sessionsByDate: Record<string, {
			tokens: number;
			sessionCount: number;
			models: Record<string, number>;
		}> = {};

		let totalTokensCount = 0;
		let totalSessionsCount = 0;

		for (const id of activeIds) {
			const entry = usageCache[id];
			if (!entry) continue;

			if (!sessionsByDate[entry.dateKey]) {
				sessionsByDate[entry.dateKey] = {
					tokens: 0,
					sessionCount: 0,
					models: {},
				};
			}

			const bucket = sessionsByDate[entry.dateKey];
			bucket.sessionCount += 1;
			bucket.tokens += entry.tokens;
			totalSessionsCount += 1;
			totalTokensCount += entry.tokens;

			if (entry.model) {
				bucket.models[entry.model] = (bucket.models[entry.model] || 0) + 1;
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
			let sessionCount = 0;
			let topModel = "";

			if (data && data.sessionCount > 0) {
				tokens = data.tokens;
				sessionCount = data.sessionCount;

				// Determine top model
				let maxCount = -1;
				for (const [m, c] of Object.entries(data.models)) {
					if (c > maxCount) {
						maxCount = c;
						topModel = m;
					}
				}

				// Level by actual token volume or session activity
				if (tokens === 0) {
					// Minimal activity baseline when token details are 0
					level = sessionCount > 0 ? 1 : 0;
				} else if (tokens <= 25_000) {
					level = 1;
				} else if (tokens <= 75_000) {
					level = 2;
				} else if (tokens <= 160_000) {
					level = 3;
				} else {
					level = 4;
				}
			}

			daysList.push({
				date: current,
				dateKey,
				weekIndex,
				dayIndex,
				tokens,
				sessionCount,
				topModel,
				level,
			});
		}

		return {
			gridDays: daysList,
			monthLabels: monthMarkers,
			grandTokens: totalTokensCount,
			grandSessions: totalSessionsCount,
			grandTurns: Math.round(totalSessionsCount * 2.8),
		};
	}, [sessions, isZh]);

	const handleMouseEnter = useCallback((e: React.MouseEvent<SVGRectElement>, day: DayData) => {
		const rect = e.currentTarget;
		const bbox = rect.getBoundingClientRect();
		const containerBox = containerRef.current?.getBoundingClientRect();

		// Smart flip to avoid clipping by window edges
		const xAlign = day.weekIndex >= 44 ? "-85%" : day.weekIndex <= 7 ? "-15%" : "-50%";
		const yAlign = day.dayIndex <= 2 ? "25%" : "-120%";

		const x = containerBox && containerBox.width > 0 ? bbox.left - containerBox.left + bbox.width / 2 : 100;
		const y = containerBox && containerBox.height > 0 ? bbox.top - containerBox.top : 40;

		setHoveredDay(day);
		setPopoverPos({ x, y, xAlign, yAlign });
	}, []);

	const handleMouseLeave = useCallback(() => {
		setHoveredDay(null);
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
				className="mb-2.5 flex items-center justify-between font-mono text-[12px] leading-none whitespace-nowrap"
			>
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

			{/* SVG 日历热力图网格：适度放大方块，充满宽度 */}
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
						const fill = LEVEL_COLORS[day.level];

						return (
							<rect
								key={day.dateKey}
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
								onMouseEnter={(e) => handleMouseEnter(e, day)}
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

			{/* 悬停详细数据弹窗（Rich Popover）：精简内容、防止窗口遮挡、模型名完整换行 */}
			{hoveredDay && popoverPos && (
				<div
					style={{
						position: "absolute",
						left: `${popoverPos.x}px`,
						top: `${popoverPos.y}px`,
						transform: `translate(${popoverPos.xAlign}, ${popoverPos.yAlign})`,
					}}
					className="pointer-events-none z-(--z-popover) w-[260px] rounded-xl border border-white/15 bg-neutral-900/95 p-3 text-[11.5px] leading-snug text-neutral-100 shadow-2xl backdrop-blur-md"
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

					{/* 精简内容：仅保留消耗总量、会话数量、主力模型 */}
					{hoveredDay.sessionCount === 0 ? (
						<div className="text-[11px] text-neutral-400">
							{t("home.noActivityDay")}
						</div>
					) : (
						<div className="flex flex-col gap-1.5">
							<div className="flex justify-between items-center">
								<span className="text-neutral-400">{t("home.totalTokensLabel")}：</span>
								<span className="font-mono font-semibold text-white">
									{hoveredDay.tokens > 0 ? formatTokenCount(hoveredDay.tokens) : "—"}
								</span>
							</div>
							<div className="flex justify-between items-center">
								<span className="text-neutral-400">{t("home.sessionCountLabel")}：</span>
								<span className="text-neutral-200">
									{t("home.sessionCountValue", { count: hoveredDay.sessionCount })}
								</span>
							</div>
							{hoveredDay.topModel ? (
								<div className="flex flex-col gap-0.5 mt-0.5 border-t border-dashed border-white/10 pt-1">
									<span className="text-neutral-400">{t("home.topModelLabel")}：</span>
									<span className="break-all text-neutral-200 leading-tight">
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
