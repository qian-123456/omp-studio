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
import {
	buildProviderRows,
	formatHostOnly,
	providerRowMatchesQuery,
	providerRowName,
	type ProviderListRow,
} from "./providerRows";
import { useProviders } from "./store";

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

export function ProviderTrace({
	scrollRef,
}: {
	scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
	const providers = useProviders((s) => s.providers);
	const ompProviders = useProviders((s) => s.ompProviders);
	const query = useProviders((s) => s.query);
	const expandedKey = useProviders((s) => s.expandedKey);
	const setExpandedKey = useProviders((s) => s.setExpandedKey);

	const entries = useMemo(
		() =>
			buildProviderRows(ompProviders, providers).filter((r) =>
				providerRowMatchesQuery(r, query),
			),
		[ompProviders, providers, query],
	);

	const dashKeys = useMemo(
		() => new Set(entries.map((e) => e.key)),
		[entries],
	);

	const [activeKey, setActiveKey] = useState<string | null>(null);
	const [focusIndex, setFocusIndex] = useState<number | null>(null);
	const [openIndex, setOpenIndex] = useState<number | null>(null);
	const [overflowing, setOverflowing] = useState(false);
	const rafRef = useRef(0);
	const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const stripRef = useRef<HTMLDivElement>(null);
	const openTimer = useRef(0);
	const closeTimer = useRef(0);

	// Idle highlight: scan [data-row-key] elements inside scrollRef, pick whose
	// top sits closest to viewport top.
	const computeActive = useCallback(() => {
		const el = scrollRef.current;
		if (!el || entries.length === 0) return;
		const rect = el.getBoundingClientRect();
		const viewportH = rect.height;
		let best: { key: string; dist: number } | null = null;
		let lastAbove: string | null = null;
		let firstBelow: string | null = null;
		for (const node of el.querySelectorAll<HTMLElement>("[data-row-key]")) {
			const key = node.dataset.rowKey || "";
			if (!dashKeys.has(key)) continue;
			const box = node.getBoundingClientRect();
			const start = box.top - rect.top;
			const end = start + box.height;
			if (end >= 0 && start <= viewportH) {
				const dist = Math.abs(start);
				if (!best || dist < best.dist) best = { key, dist };
			} else if (end < 0) {
				lastAbove = key;
			} else if (firstBelow === null) {
				firstBelow = key;
			}
		}
		const active = best?.key ?? lastAbove ?? firstBelow;
		if (active) setActiveKey(active);
	}, [entries.length, dashKeys, scrollRef]);

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

	// Keep the active dash visible when the strip itself overflows.
	useEffect(() => {
		if (!activeKey || entries.length < 2) return;
		const idx = entries.findIndex((e) => e.key === activeKey);
		const strip = stripRef.current;
		if (idx < 0 || !strip) return;
		strip.scrollTop = Math.max(
			0,
			idx * ROW_PITCH_PX + ROW_PITCH_PX / 2 - strip.clientHeight / 2,
		);
	}, [activeKey, entries]);

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

	if (entries.length === 0) return null;

	const jump = (row: ProviderListRow) => {
		document.getElementById(`provider-row-${row.key}`)?.scrollIntoView({
			behavior: "smooth",
			block: "center",
		});
		setExpandedKey(row.key);
	};

	const safeFocus =
		focusIndex !== null && focusIndex < entries.length ? focusIndex : null;

	return (
		<nav
			aria-label="供应商导航"
			className="pointer-events-none hidden md:block absolute inset-y-0 left-0 z-10 w-12"
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
				<div
					className="relative w-9"
					style={{ height: entries.length * ROW_PITCH_PX }}
				>
					{entries.map((row, i) => {
						const isActive = row.key === activeKey || row.key === expandedKey;
						const stress = dashStress(i, safeFocus);
						const colored = stress.focused || (safeFocus === null && isActive);
						const name = providerRowName(row);
						return (
							<div
								key={row.key}
								className="absolute left-0 top-0 h-2.5 w-9"
								style={{ transform: `translateY(${i * ROW_PITCH_PX}px)` }}
							>
								<button
									ref={(el) => {
										btnRefs.current[i] = el;
									}}
									type="button"
									aria-current={isActive ? "location" : undefined}
									aria-label={`跳转到 ${name}`}
									aria-posinset={i + 1}
									aria-setsize={entries.length}
									onClick={() => jump(row)}
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
					const row = entries[openIndex];
					const btn = btnRefs.current[openIndex];
					if (!row || !btn) return null;
					const name = providerRowName(row);
					const rawUrl = row.workbench?.baseUrl ?? row.omp?.baseUrl ?? null;
					const host = formatHostOnly(rawUrl);
					const modelCount =
						row.workbench?.models?.length ?? row.omp?.modelIds?.length ?? 0;
					const box = btn.getBoundingClientRect();
					const x = box.right + 8;
					const y = Math.min(
						Math.max(box.top + box.height / 2, 90),
						window.innerHeight - 90,
					);
					const detail = [host, `${modelCount} 模型`].filter(Boolean).join(" · ");
					return createPortal(
						<div
							className="pointer-events-none fixed z-50 w-80 max-w-[calc(100vw-2rem)] -translate-y-1/2 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-neutral-100 shadow-lg"
							style={{ left: x, top: y }}
						>
							<div className="space-y-1">
								<p className="line-clamp-1 text-[13px] font-medium leading-5 text-neutral-100">
									{name}
								</p>
								<p className="line-clamp-1 text-[12px] text-neutral-400 leading-4">
									{detail}
								</p>
							</div>
						</div>,
						document.body,
					);
				})()}
		</nav>
	);
}
