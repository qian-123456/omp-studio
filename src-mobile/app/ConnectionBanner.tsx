import { useRef, useState } from "react";
import { reconnectEvents } from "../core/sse";
import { useConnection } from "../core/stores/connection";
import { BottomSheet } from "../ui/BottomSheet";
import { Spinner } from "../ui/Spinner";

/** Thin status strip under the safe area: offline / reconnecting / unpaired (401) with a re-pair guide. */
export function ConnectionBanner() {
	const phase = useConnection((s) => s.phase);
	const error = useConnection((s) => s.error);
	const [guide, setGuide] = useState(false);
	const sawClosed = useRef(false);
	if (phase === "closed") sawClosed.current = true;
	if (phase === "open") sawClosed.current = false;

	if (phase === "unauthorized") {
		return (
			<>
				<div role="alert" className="z-(--z-banner) flex shrink-0 items-center gap-2 bg-m-danger px-3 pt-[var(--m-safe-top)] text-m-sm text-m-accent-text">
					<span className="min-h-11 flex-1 py-2.5">未配对：配对已失效或被撤销</span>
					<button type="button" className="min-h-11 whitespace-nowrap px-2 font-semibold underline" onClick={() => setGuide(true)}>
						重新配对
					</button>
				</div>
				<BottomSheet open={guide} onClose={() => setGuide(false)} title="重新配对">
					<ol className="m-selectable list-decimal space-y-2 py-2 pl-5 pr-3 text-m-md text-m-text-2">
						<li>在电脑上打开 omp-workspace，进入「设置 → 手机」。</li>
						<li>点击「生成配对二维码」。</li>
						<li>用手机相机扫描二维码，或直接打开配对链接。</li>
						<li>配对成功后本页会自动恢复。</li>
					</ol>
				</BottomSheet>
			</>
		);
	}

	const offline = phase === "closed" || (phase === "connecting" && sawClosed.current);
	if (offline) {
		return (
			<div role="status" className="z-(--z-banner) flex shrink-0 items-center gap-2 bg-m-warn px-3 pt-[var(--m-safe-top)] text-m-sm text-m-accent-text">
				<span className="flex min-h-11 flex-1 items-center gap-2 py-2">
					{phase === "connecting" ? <Spinner size={14} /> : null}
					<span>{phase === "connecting" ? "正在重连" : error || "连接已断开，正在重连"}</span>
				</span>
				<button type="button" className="min-h-11 whitespace-nowrap px-2 font-semibold underline" onClick={reconnectEvents}>
					立即重试
				</button>
			</div>
		);
	}
	return null;
}
