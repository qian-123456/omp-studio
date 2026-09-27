/** [B] Chat trace gutter — ported from ZCode desktop's TurnNavigator:
 * one dash per real user query, vertically centered on the left edge of the
 * stream. Hovering a dash stretches it (scaleX falloff on neighbours, 150ms
 * ease-out) and opens a preview popover (user query + its turn's assistant
 * reply) after 120ms; click jumps to the query via live store scrollToItem.
 * The idle highlight follows the query closest to the viewport top. */

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
import { messageText } from "./MessageList";
import { collectChatTraceEntries, type ChatTraceEntry } from "./messageTrace";

const EMPTY_ITEMS: TranscriptItem[] = [];
const EMPTY_ECHOES: TranscriptItem[] = [];
const ROW_PITCH_PX = 10;
const TOOLTIP_OPEN_DELAY_MS = 120;
const TOOLTIP_CLOSE_DELAY_MS = 80;

/** Dash scale/opacity falloff by distance from the hovered dash. Idle
 * (nothing hovered) keeps every dash unscaled — the active one is coloured
 * by the caller instead. */
function dashStress(itemIndex: number, focusIndex: number | null) {
	if (focusIndex === null) return { opacity: 0.58, scaleX: 1, focused: false };
	const dist = Math.abs(itemIndex - focusIndex);
	if (dist === 0) return { opacity: 1, scaleX: 2.6, focused: true };
	if (dist === 1) return { opacity: 0.86, scaleX: 1.7, focused: false };
	if (dist === 2) return { opacity: 0.72, scaleX: 1.25, focused: false };
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
	const streamingMessage = useLive(
		(s) => s.sessions[sessionId]?.streamingMessage ?? null,
	);

	const entries = useMemo(
		() =>
			collectChatTraceEntries(
				items,
				pendingEchoes,
				streamingMessage ? messageText(streamingMessage.content) : null,
			),
		[items, pendingEchoes, streamingMessage],
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

	if (entries.length < 2) return null;

	const jump = (entry: ChatTraceEntry) => {
		useLive.getState().scrollToItem(sessionId, entry.id);
	};

	const safeFocus = focusIndex !== null && focusIndex < entries.length ? focusIndex : null;

	return (
		<nav
			aria-label="对话问题导航"
			className="pointer-events-none invisible absolute inset-y-0 left-0 z-10 w-12 -translate-x-2 opacity-0 transition-[opacity,transform,visibility] duration-150 ease-out motion-reduce:transition-none @min-[640px]:visible @min-[640px]:translate-x-0 @min-[640px]:opacity-100"
		>
			<div
				ref={stripRef}
				onPointerLeave={clearHover}
				onScroll={() => {
					clearHover();
					setOpenIndex(null);
				}}
				className="no-scrollbar pointer-events-auto absolute left-3 top-1/2 max-h-[calc(100%-6rem)] w-9 -translate-y-1/2 overflow-x-hidden overflow-y-auto py-1"
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
				<div className="relative w-9" style={{ height: entries.length * ROW_PITCH_PX }}>
					{entries.map((entry, i) => {
						const isActive = entry.id === activeId;
						const stress = dashStress(i, safeFocus);
						const colored = stress.focused || (safeFocus === null && isActive);
						return (
							<div
								key={entry.id}
								className="absolute left-0 top-0 h-2.5 w-9"
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
									className="flex h-2.5 w-9 items-center justify-start rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
								>
									<span
										className={clsx(
											"block h-0.5 w-3 origin-left rounded-full transition-[height,opacity,transform,background-color] duration-150 ease-out motion-reduce:transition-none",
											colored ? "bg-neutral-200" : "bg-neutral-700",
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

			{openIndex !== null &&
				(() => {
					const entry = entries[openIndex];
					const btn = btnRefs.current[openIndex];
					if (!entry || !btn) return null;
					const box = btn.getBoundingClientRect();
					const x = box.right + 8;
					const y = Math.min(
						Math.max(box.top + box.height / 2, 90),
						window.innerHeight - 90,
					);
					return createPortal(
						<div
							className="pointer-events-none fixed z-50 w-80 max-w-[calc(100vw-2rem)] -translate-y-1/2 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-neutral-100 shadow-lg"
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
											? "text-neutral-100/80"
											: "text-neutral-500",
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
