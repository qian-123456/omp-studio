/** [B] Chat trace gutter — ported from ZCode desktop's TurnNavigator:
 * one dash per real user query, vertically centered on the left edge of the
 * stream. The rail always renders as short stub dashes; it never expands
 * and never grows a glass capsule. Hovering or keyboard-focusing a dash
 * darkens it and grows it longer (ChatGPT-style, extending rightwards
 * inside the rail's fixed width) and opens a preview popover (user query +
 * its turn's assistant reply) immediately; click jumps to the query via
 * live store scrollToItem. The idle highlight follows the query closest
 * to the viewport top. */

import clsx from "clsx";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import type { TranscriptItem } from "../../lib/contracts";
import { useLive } from "../../stores/live";
import { collectChatTraceEntries, type ChatTraceEntry } from "./messageTrace";

const EMPTY_ITEMS: TranscriptItem[] = [];
const EMPTY_ECHOES: TranscriptItem[] = [];
const ROW_PITCH_PX = 10;
const BAR_MIN_PX = 6;
const BAR_MAX_PX = 26;
// ChatGPT-style dock falloff: hovered bar is full length, neighbours ease off.
const NEIGHBOR_PROGRESS = [1, 0.7, 0.4, 0.2];
const TOOLTIP_CLOSE_DELAY_MS = 80;

export function ChatTrace({
	sessionId,
	scrollRef,
}: {
	sessionId: string;
	scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
	const items = useLive((s) => s.sessions[sessionId]?.items ?? EMPTY_ITEMS);
	const pendingEchoes = useLive(
		(s) => s.sessions[sessionId]?.pendingUserEchoes ?? EMPTY_ECHOES,
	);
	const isStreaming = useLive(
		(s) => Boolean(s.sessions[sessionId]?.streaming),
	);

	const entries = useMemo(
		() =>
			collectChatTraceEntries(
				items,
				pendingEchoes,
				isStreaming ? "正在思考 / 回复…" : null,
			),
		[items, pendingEchoes, isStreaming],
	);
	const dashIds = useMemo(
		() => new Set(entries.map((e) => e.id)),
		[entries],
	);

	const [activeId, setActiveId] = useState<string | null>(null);
	const [focusIndex, setFocusIndex] = useState<number | null>(null);
	const [openIndex, setOpenIndex] = useState<number | null>(null);
	const [overflowing, setOverflowing] = useState(false);
	const rafRef = useRef(0);
	const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const stripRef = useRef<HTMLDivElement>(null);
	const railRef = useRef<HTMLDivElement>(null);
	const closeTimer = useRef(0);

	// Idle highlight: among rendered user-query rows intersecting the viewport,
	// the one whose start sits closest to the viewport top (NHt in the
	// original); rows rendered but hidden-toggled don't carry a dash and are
	// skipped exactly like the original skips non-query rows.
	const computeActive = useCallback(() => {
		const el = scrollRef.current;
		if (!el || entries.length === 0) return;
		const rect = el.getBoundingClientRect();
		const viewportH = rect.height;
		let best: { id: string; dist: number } | null = null;
		let lastAbove: string | null = null;
		let firstBelow: string | null = null;
		for (const node of el.querySelectorAll<HTMLElement>("[data-index]")) {
			const id = node.id.startsWith("msg-") ? node.id.slice(4) : "";
			if (!dashIds.has(id)) continue;
			const box = node.getBoundingClientRect();
			const start = box.top - rect.top;
			const end = start + box.height;
			if (end >= 0 && start <= viewportH) {
				const dist = Math.abs(start);
				if (!best || dist < best.dist) best = { id, dist };
			} else if (end < 0) {
				lastAbove = id;
			} else if (firstBelow === null) {
				firstBelow = id;
			}
		}
		const active = best?.id ?? lastAbove ?? firstBelow;
		if (active) setActiveId(active);
	}, [entries, scrollRef]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onScroll = () => {
			if (rafRef.current) return;
			rafRef.current = requestAnimationFrame(() => {
				rafRef.current = 0;
				computeActive();
			});
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		computeActive();
		return () => {
			el.removeEventListener("scroll", onScroll);
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = 0;
			}
		};
	}, [computeActive, scrollRef]);
	const [scrollable, setScrollable] = useState(false);

	// Codex's thread navigation rail (`r.length < 4`) only appears from the
	// 4th user message; a one- or two-turn chat doesn't need a minimap.
	const MIN_ENTRIES = 4;

	// It also stays hidden while everything fits on one screen. Passive
	// effect on purpose: this component renders before the scroll container,
	// so a mount-time layout effect would still see a null ref.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const update = () => {
			setScrollable(el.scrollHeight > el.clientHeight + 8);
		};
		const ro = new ResizeObserver(update);
		ro.observe(el);
		update();
		return () => ro.disconnect();
	}, [scrollRef]);

	// …and re-check whenever the conversation grows while the container size
	// stays the same.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el) setScrollable(el.scrollHeight > el.clientHeight + 8);
	}, [scrollRef, entries.length]);


	// Keep the active dash visible when the strip itself overflows (the
	// original scrolls its strip virtualizer with align:"auto").
	useEffect(() => {
		if (!activeId || entries.length < 2) return;
		const idx = entries.findIndex((e) => e.id === activeId);
		const strip = stripRef.current;
		if (idx < 0 || !strip) return;
		strip.scrollTop = Math.max(
			0,
			idx * ROW_PITCH_PX + ROW_PITCH_PX / 2 - strip.clientHeight / 2,
		);
	}, [activeId, entries.length]);

	useLayoutEffect(() => {
		const strip = stripRef.current;
		if (!strip) return;
		setOverflowing(strip.scrollHeight > strip.clientHeight + 1);
	}, [entries.length]);

	useEffect(() => () => window.clearTimeout(closeTimer.current), []);

	const clearHover = useCallback(() => {
		setFocusIndex(null);
		window.clearTimeout(closeTimer.current);
		closeTimer.current = window.setTimeout(
			() => setOpenIndex(null),
			TOOLTIP_CLOSE_DELAY_MS,
		);
	}, []);

	const hoverIndex = useCallback((index: number) => {
		window.clearTimeout(closeTimer.current);
		setFocusIndex(index);
		setOpenIndex(index);
	}, []);

	if (entries.length < MIN_ENTRIES || !scrollable) return null;

	const jump = (entry: ChatTraceEntry) => {
		useLive.getState().scrollToItem(sessionId, entry.id);
	};

	return (
		<nav
			aria-label="对话问题导航"
			className="pointer-events-none hidden md:block absolute inset-y-0 left-0 z-10"
		>
			<div
				ref={railRef}
				onPointerLeave={clearHover}
				className="pointer-events-auto absolute left-3 top-1/2 flex max-h-[calc(100%-6rem)] w-[26px] -translate-y-1/2 flex-col"
			>
				<div
					ref={stripRef}
					onScroll={() => {
						clearHover();
						setOpenIndex(null);
					}}
					className="no-scrollbar relative min-h-0 overflow-x-hidden overflow-y-auto py-1"
					style={
						overflowing
							? {
									maskImage:
										"linear-gradient(to bottom, black calc(100% - 48px), transparent)",
									WebkitMaskImage:
										"linear-gradient(to bottom, black calc(100% - 48px), transparent)",
								}
							: undefined
					}
				>
					<div className="relative w-full" style={{ height: entries.length * ROW_PITCH_PX }}>
						{entries.map((entry, i) => {
							const isActive = entry.id === activeId;
							const focused = focusIndex === i;
							const colored = focused || (focusIndex === null && isActive);
							const progress =
								focusIndex === null ? 0 : (NEIGHBOR_PROGRESS[Math.abs(focusIndex - i)] ?? 0);
							return (
								<div
									key={entry.id}
									className="absolute left-0 top-0 h-2.5 w-full"
									style={{ transform: `translateY(${i * ROW_PITCH_PX}px)` }}
								>
									<button
										ref={(el) => {
											btnRefs.current[i] = el;
										}}
										type="button"
										aria-current={isActive ? "location" : undefined}
										aria-label={`跳转到第 ${i + 1} 条问题`}
										aria-posinset={i + 1}
										aria-setsize={entries.length}
										onClick={() => jump(entry)}
										onPointerEnter={() => hoverIndex(i)}
										onFocus={() => hoverIndex(i)}
										onBlur={clearHover}
										className="flex h-2.5 w-full items-center justify-start rounded-sm"
									>
										<span
											className={clsx(
												"block h-0.5 rounded-full transition-[width,opacity,background-color] duration-150 ease-out motion-reduce:transition-none",
												colored ? "bg-[var(--text)]" : "bg-[var(--text-30)]",
											)}
											style={{
												width: BAR_MIN_PX + (BAR_MAX_PX - BAR_MIN_PX) * progress,
												opacity: focusIndex === null && isActive ? 0.95 : 1,
											}}
										/>
									</button>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{openIndex !== null &&
				(() => {
					const entry = entries[openIndex];
					const btn = btnRefs.current[openIndex];
					const rail = railRef.current;
					if (!entry || !btn || !rail) return null;
					const box = btn.getBoundingClientRect();
					// Anchor to the resting rail's right edge — its width never
					// changes on hover, so the popup position is stable.
					const x = rail.getBoundingClientRect().right + 8;
					const y = Math.min(
						Math.max(box.top + box.height / 2, 90),
						window.innerHeight - 90,
					);
					return createPortal(
						<div
							className="pointer-events-none fixed z-(--z-hovercard) w-80 max-w-[calc(100vw-2rem)] -translate-y-1/2 rounded-md border border-[var(--line)] bg-[var(--bg-panel)] p-3 text-[var(--text)] shadow-apple-card"
							style={{ left: x, top: y }}
						>
							<div className="space-y-2">
								<p className="line-clamp-2 whitespace-pre-line text-[13px] font-medium leading-5">
									{entry.userPreview}
								</p>
								<p
									className={clsx(
										"line-clamp-3 whitespace-pre-line text-[13px] leading-5",
										entry.assistantPreviewKind === "text"
											? "text-[var(--text-60)]"
											: "text-[var(--text-40)]",
									)}
								>
									{entry.assistantPreview}
								</p>
							</div>
						</div>,
						document.body,
					);
				})()}
		</nav>
	);
}
