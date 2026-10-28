import { ArrowDown } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, PullToRefresh } from "../../../ui";
import { useChat, useChatUi } from "../ChatContext";
import type { Block, Turn } from "../lib/turns";
import { SubagentCapsule } from "../../subagents";
import { SelectionToolbar } from "./SelectionToolbar";
import { PendingBubble, TurnView } from "./TurnView";

/** Turns rendered initially / per 「更早」 press; the rest stay in memory only. */
export const WINDOW_STEP = 40;
const NEAR_BOTTOM_PX = 120;

/** Hosts the live row when no persisted turn can (new prompt not persisted yet, or the tail is a notice). */
const SYNTHETIC_TURN: Turn = {
	type: "turn",
	id: "turn-live",
	user: null,
	steps: [],
	answer: null,
	answerStat: null,
	start: 0,
	end: 0,
	lastAssistantId: null,
	src: [],
};

const BlockView = memo(function BlockView({ block, isLast, sessionId }: { block: Block; isLast: boolean; sessionId: string }) {
	if (block.type === "notice") {
		return <div className="m-turn px-5 py-3 text-center text-m-xs text-m-text-3">{block.text}</div>;
	}
	return (
		<div className={isLast ? "m-turn-live" : "m-turn"}>
			<TurnView turn={block} isLast={isLast} sessionId={sessionId} />
		</div>
	);
});

export function MessageList({ sessionId }: { sessionId: string }) {
	const { controller } = useChatUi();
	const blocks = useChat((s) => s.blocks);
	const optimistic = useChat((s) => s.optimistic);
	const localOut = useChat((s) => s.localOut);
	const loaded = useChat((s) => s.loaded);
	const working = useChat((s) => s.working);
	const live = useChat((s) => s.live);
	const delivery = useChat((s) => s.delivery);
	const [limit, setLimit] = useState(WINDOW_STEP);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const stick = useRef(true);
	const lastCH = useRef(0);
	const raf = useRef(0);
	const [showJump, setShowJump] = useState(false);

	const scrollToEnd = useCallback((smooth = false) => {
		const sc = scrollRef.current;
		if (!sc) return;
		if (smooth) sc.scrollTo({ top: sc.scrollHeight, behavior: "smooth" });
		else sc.scrollTop = sc.scrollHeight;
	}, []);

	const onScroll = useCallback(() => {
		const sc = scrollRef.current;
		if (!sc) return;
		const dist = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
		// A resize (keyboard) also fires scroll; it is not user intent.
		if (sc.clientHeight === lastCH.current) stick.current = dist < NEAR_BOTTOM_PX;
		lastCH.current = sc.clientHeight;
		setShowJump(dist >= NEAR_BOTTOM_PX);
	}, []);

	// Following the tail: any content or viewport (keyboard) size change re-pins to the bottom, once per frame.
	useEffect(() => {
		const sc = scrollRef.current;
		const content = contentRef.current;
		if (!sc || !content) return;
		const pin = () => {
			raf.current = 0;
			if (stick.current) scrollToEnd();
		};
		const ro = new ResizeObserver(() => {
			if (stick.current && !raf.current) raf.current = requestAnimationFrame(pin);
		});
		ro.observe(content);
		ro.observe(sc);
		lastCH.current = sc.clientHeight;
		sc.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			sc.removeEventListener("scroll", onScroll);
			ro.disconnect();
			cancelAnimationFrame(raf.current);
		};
	}, [scrollToEnd, onScroll]);

	useLayoutEffect(() => {
		if (loaded) scrollToEnd();
	}, [loaded, scrollToEnd]);

	const jump = () => {
		stick.current = true;
		scrollToEnd(true);
		setShowJump(false);
	};

	const lastBlock = blocks[blocks.length - 1];
	const syntheticLive = (working || live !== null) && (optimistic.length > 0 || !lastBlock || lastBlock.type !== "turn");
	const shown = blocks.length > limit ? blocks.slice(-limit) : blocks;
	const hidden = blocks.length - shown.length;
	const empty = loaded && blocks.length === 0 && optimistic.length === 0 && localOut.length === 0;

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			{/* Own row with its own height: the capsule can never sit on top of message text. */}
			<div className="flex shrink-0 justify-end px-4 py-1 empty:hidden">
				<SubagentCapsule sessionId={sessionId} />
			</div>
			<SelectionToolbar containerRef={contentRef} sessionId={sessionId} />
			{delivery?.phase === "unknown" && (
				<section role="alert" className="mx-4 mb-2 max-h-[40%] shrink-0 space-y-2 overflow-y-auto rounded-m-lg bg-m-danger-bg p-3 text-m-sm">
					<p className="font-medium">消息送达状态未知</p>
					<p>电脑可能已经收到，系统不会自动重发。请先核对会话记录，再决定是否恢复输入。</p>
					<p className="whitespace-pre-wrap break-words">{delivery.text}</p>
					{delivery.atts.map((a) => <p key={a.id}>{a.name}</p>)}
					<div className="flex flex-wrap gap-2">
						<Button size="sm" onClick={() => void controller.refresh()}>核对记录</Button>
						<Button size="sm" onClick={() => void controller.resolveDelivery(true)}>恢复输入</Button>
						<Button size="sm" onClick={() => void controller.resolveDelivery(false)}>已核对，不再重发</Button>
					</div>
				</section>
			)}
			<PullToRefresh ref={scrollRef} onRefresh={() => controller.refresh()}>
				<div ref={contentRef} className="pt-1 pb-4">
					{hidden > 0 && (
						<div className="flex justify-center py-3">
							<Button
								size="sm"
								onClick={() => {
									stick.current = false;
									setLimit((n) => n + WINDOW_STEP);
								}}
							>
								加载更早的 {Math.min(hidden, WINDOW_STEP)} 轮
							</Button>
						</div>
					)}
					{shown.map((b, i) => (
						<BlockView key={b.id} block={b} isLast={!syntheticLive && i === shown.length - 1} sessionId={sessionId} />
					))}
					{optimistic.map((o) => (
						<PendingBubble key={o.id} text={o.text} imageUrls={o.imageUrls} />
					))}
					{syntheticLive && (
						<div className="m-turn-live">
							<TurnView turn={SYNTHETIC_TURN} isLast sessionId={sessionId} />
						</div>
					)}
					{localOut.map((o) => (
						<div key={o.id} className="px-5 py-2">
							<div className="rounded-m-lg bg-m-surface p-4">
								<div className="mb-2 whitespace-nowrap text-m-xs text-m-text-3">/{o.name} · 仅本地显示</div>
								<pre className="m-selectable m-0 whitespace-pre-wrap break-words font-m-mono text-m-sm text-m-text-2">{o.text}</pre>
							</div>
						</div>
					))}
					{empty && <div className="py-20 text-center text-m-sm text-m-text-3">还没有消息，发一条开始吧</div>}
				</div>
			</PullToRefresh>
			{showJump && (
				<button
					type="button"
					onClick={jump}
					aria-label="回到底部"
					className="absolute bottom-2 left-1/2 z-(--z-banner) flex h-11 w-11 -translate-x-1/2 items-center justify-center"
				>
					<span className="flex h-10 w-10 items-center justify-center rounded-m-pill bg-m-surface text-m-text shadow-m-pop active:bg-m-surface-2">
						<ArrowDown size={20} strokeWidth={1.75} />
					</span>
				</button>
			)}
		</div>
	);
}
