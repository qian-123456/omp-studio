import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { locateLabel, useLocate } from "../../stores/locate";

const btn =
	"inline-flex h-6 items-center gap-0.5 rounded-full border border-[var(--border-divider)] px-2 text-[11px] text-[var(--text-60)] transition-colors enabled:hover:bg-[var(--ghost-hover)] enabled:hover:text-[var(--text)] disabled:opacity-40";

/** Top strip of `host` as a zero-height rect, so the pill hangs under it. */
function useTopStrip(host: HTMLElement | null, active: boolean): DOMRect | null {
	const [rect, setRect] = useState<DOMRect | null>(null);
	useLayoutEffect(() => {
		if (!host || !active) {
			setRect(null);
			return;
		}
		const measure = () => {
			const r = host.getBoundingClientRect();
			setRect(new DOMRect(r.left, r.top, r.width, 0));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(host);
		window.addEventListener("resize", measure);
		return () => {
			ro.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [host, active]);
	return rect;
}

/**
 * 「已定位：web_search #3」 pill shown over the chat while a Token-panel locate
 * target for this session is active; steps through the group's other calls.
 */
export function LocatePill({ sessionId, host }: { sessionId: string; host: HTMLElement | null }) {
	const target = useLocate((s) => (s.target?.sessionId === sessionId ? s.target : null));
	const rect = useTopStrip(host, target !== null);
	if (!target) return null;
	const { index, callIds } = target;
	return (
		<FloatingLayer
			anchor={rect}
			placement="bottom-end"
			offset={36}
			layer="popover"
			role="status"
			aria-label="定位到的工具调用"
			className="flex items-center gap-1.5 overflow-visible rounded-full px-2 py-1"
		>
			<span className="select-text pl-1 text-[12px] text-[var(--text)]">
				{locateLabel(target.name, index)}
			</span>
			<span className="text-[11px] tabular-nums text-[var(--text-40)]">
				{index + 1}/{callIds.length}
			</span>
			<button
				type="button"
				className={btn}
				disabled={index <= 0}
				onClick={() => useLocate.getState().step(-1)}
			>
				<ChevronUp size={12} />
				上一处
			</button>
			<button
				type="button"
				className={btn}
				disabled={index >= callIds.length - 1}
				onClick={() => useLocate.getState().step(1)}
			>
				<ChevronDown size={12} />
				下一处
			</button>
			<button
				type="button"
				className={btn}
				title="关闭定位"
				aria-label="关闭定位"
				onClick={() => useLocate.getState().clear()}
			>
				<X size={12} />
			</button>
		</FloatingLayer>
	);
}
