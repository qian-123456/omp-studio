/** [B] Chat trace gutter — ported from ZCode desktop's TurnNavigator:
 * one dash per real user query, vertically centered on the left edge of the
 * stream. Hovering a dash stretches it (scaleX falloff on neighbours, 150ms
 * ease-out) and opens a preview popover (user query + its turn's assistant
 * reply) after 120ms; click jumps to the query via live store scrollToItem.
 * The idle highlight follows the query closest to the viewport top.
 *
 * Layout modes (the transcript keeps symmetric px-3 padding either way):
 * - wide (pane ≥ WIDE_MIN_PX): the centered column leaves ≥48px side
 *   margins, so the rail sits permanently in the left margin;
 * - narrow: no margin to spare, so the rail collapses to 4px micro-ticks
 *   inside the 12px left padding and peeks open as an overlay on hover
 *   intent or keyboard focus.
 * In both modes, hover/focus fades in a liquid-glass pill behind the dashes.
 * The pill is a separate layer bleeding outside the strip, so showing it never
 * shifts a dash out from under the pointer. */

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
const TOOLTIP_OPEN_DELAY_MS = 120;
const TOOLTIP_CLOSE_DELAY_MS = 80;
/** Must match MessageList's `@min-[864px]` column breakpoint. */
const WIDE_MIN_PX = 864;
/** Hover intent: crossing the left edge on the way into the pane must not
 * flash the pill / overlay open. */
const PEEK_OPEN_DELAY_MS = 150;
const PEEK_CLOSE_DELAY_MS = 200;
/** Translucent fill + backdrop blur/saturation, a top specular sheen and a
 * hairline rim; collapses to a solid panel under reduced transparency. */
const GLASS_PILL =
	"rounded-full bg-[color-mix(in_oklab,var(--bg-panel)_40%,transparent)] bg-linear-to-b from-white/15 via-transparent to-white/5 backdrop-blur-xl backdrop-saturate-[1.8] ring-1 ring-[var(--line)] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),inset_0_-1px_0_0_rgb(255_255_255/0.06),0_8px_24px_-8px_rgb(0_0_0/0.3)] [@media(prefers-reduced-transparency:reduce)]:bg-[var(--bg-panel)] [@media(prefers-reduced-transparency:reduce)]:backdrop-filter-none";
/** Must match the rail's expanded `w-8` and the pill's `-inset-x-0.5`. */
const RAIL_EXPANDED_PX = 32;
const PILL_BLEED_PX = 2;

/** Dash scale/opacity falloff by distance from the hovered dash. Idle
 * (nothing hovered) keeps every dash unscaled — the active one is coloured
 * by the caller instead. */
function dashStress(itemIndex: number, focusIndex: number | null) {
	if (focusIndex === null) return { opacity: 0.58, scaleX: 1, focused: false };
	const dist = Math.abs(itemIndex - focusIndex);
	if (dist === 0) return { opacity: 1, scaleX: 2.2, focused: true };
	if (dist === 1) return { opacity: 0.86, scaleX: 1.6, focused: false };
	if (dist === 2) return { opacity: 0.72, scaleX: 1.2, focused: false };
	return { opacity: 0.58, scaleX: 1, focused: false };
}

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
	const [wide, setWide] = useState(false);
	const [peek, setPeek] = useState(false);
	const peekTimer = useRef(0);
	const rafRef = useRef(0);
	const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const stripRef = useRef<HTMLDivElement>(null);
	const railRef = useRef<HTMLDivElement>(null);
	const openTimer = useRef(0);
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
			// offsetWidth includes the scrollbar, i.e. the @container's width.
			setWide(el.offsetWidth >= WIDE_MIN_PX);
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

	useEffect(
		() => () => {
			window.clearTimeout(openTimer.current);
			window.clearTimeout(closeTimer.current);
			window.clearTimeout(peekTimer.current);
		},
		[],
	);

	const clearHover = useCallback(() => {
		window.clearTimeout(openTimer.current);
		setFocusIndex(null);
		window.clearTimeout(closeTimer.current);
		closeTimer.current = window.setTimeout(
			() => setOpenIndex(null),
			TOOLTIP_CLOSE_DELAY_MS,
		);
	}, []);

	const schedulePeek = useCallback((open: boolean) => {
		window.clearTimeout(peekTimer.current);
		peekTimer.current = window.setTimeout(
			() => setPeek(open),
			open ? PEEK_OPEN_DELAY_MS : PEEK_CLOSE_DELAY_MS,
		);
	}, []);

	const hoverIndex = useCallback(
		(index: number) => {
			window.clearTimeout(closeTimer.current);
			setFocusIndex(index);
			if (openIndex !== null) {
				// Already open — follow the pointer across dashes immediately
				// (Radix tooltip behaviour in the original).
				window.clearTimeout(openTimer.current);
				setOpenIndex(index);
				return;
			}
			window.clearTimeout(openTimer.current);
			openTimer.current = window.setTimeout(() => {
				setOpenIndex(index);
			}, TOOLTIP_OPEN_DELAY_MS);
		},
		[openIndex],
	);

	if (entries.length < MIN_ENTRIES || !scrollable) return null;

	const jump = (entry: ChatTraceEntry) => {
		useLive.getState().scrollToItem(sessionId, entry.id);
	};

	const expanded = wide || peek;
	// While collapsed, hover only arms the peek; stress and preview start once
	// the rail is actually open.
	const safeFocus =
		expanded && focusIndex !== null && focusIndex < entries.length ? focusIndex : null;

	return (
		<nav
			aria-label="对话问题导航"
			className="pointer-events-none hidden md:block absolute inset-y-0 left-0 z-10"
		>
			<div
				ref={railRef}
				onPointerEnter={() => schedulePeek(true)}
				onPointerLeave={() => {
					clearHover();
					schedulePeek(false);
				}}
				onFocus={() => {
					window.clearTimeout(peekTimer.current);
					setPeek(true);
				}}
				onBlur={() => schedulePeek(false)}
				className={clsx(
					"pointer-events-auto absolute top-1/2 flex max-h-[calc(100%-6rem)] -translate-y-1/2 flex-col",
					wide ? "left-2 w-8 px-[5px]" : clsx("left-1 px-[2px]", peek ? "w-8" : "w-2"),
				)}
			>
				<div
					aria-hidden
					className={clsx(
						"pointer-events-none absolute -inset-x-0.5 -inset-y-2 origin-left transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
						GLASS_PILL,
						peek ? "scale-100 opacity-100" : "scale-90 opacity-0",
					)}
				/>
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
							const stress = dashStress(i, safeFocus);
							const colored = stress.focused || (safeFocus === null && isActive);
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
												"block h-0.5 origin-left rounded-full transition-[width,height,opacity,transform,background-color] duration-150 ease-out motion-reduce:transition-none",
												expanded ? "w-2.5" : "w-1",
												colored ? "bg-[var(--text)]" : "bg-[var(--text-30)]",
											)}
											style={{
												opacity:
													safeFocus === null && isActive
														? 0.9
														: entry.isRunning
															? Math.max(stress.opacity, 0.72)
															: stress.opacity,
												transform: `scaleX(${stress.scaleX})`,
											}}
										/>
									</button>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{expanded &&
				openIndex !== null &&
				(() => {
					const entry = entries[openIndex];
					const btn = btnRefs.current[openIndex];
					const rail = railRef.current;
					if (!entry || !btn || !rail) return null;
					const box = btn.getBoundingClientRect();
					// Measured during render, i.e. possibly before the narrow
					// rail's peek width commits: anchor to the stable rail origin
					// plus the expanded pill extent instead of the button's edge.
					const x =
						rail.getBoundingClientRect().left + RAIL_EXPANDED_PX + PILL_BLEED_PX + 8;
					const y = Math.min(
						Math.max(box.top + box.height / 2, 90),
						window.innerHeight - 90,
					);
					return createPortal(
						<div
							className="pointer-events-none fixed z-50 w-80 max-w-[calc(100vw-2rem)] -translate-y-1/2 rounded-md border border-[var(--line)] bg-[var(--bg-panel)] p-3 text-[var(--text)] shadow-apple-card"
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
