import { CloudOff, KeyRound } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { reconnectEvents } from "../core/sse";
import { useConnection } from "../core/stores/connection";
import { BottomSheet } from "../ui/BottomSheet";
import { Spinner } from "../ui/Spinner";

/** Floating capsule just below the top bar; never covers the bar's buttons. */
function Pill({ role, tone, icon, text, action, onAction }: { role: "alert" | "status"; tone: "warn" | "danger"; icon: ReactNode; text: string; action: string; onAction: () => void }) {
	return (
		<div className="pointer-events-none fixed inset-x-0 z-(--z-banner) flex justify-center px-4" style={{ top: "calc(var(--m-safe-top) + 60px)" }}>
			<div
				role={role}
				className={`pointer-events-auto flex max-w-full items-center gap-2 rounded-m-pill py-1 pr-1 pl-4 text-m-sm shadow-m-pop ${
					tone === "danger" ? "bg-m-danger-bg text-m-danger" : "bg-m-warn-bg text-m-warn"
				}`}
			>
				<span className="shrink-0">{icon}</span>
				<span className="min-w-0 break-words">{text}</span>
				<button type="button" onClick={onAction} className="min-h-11 min-w-11 shrink-0 rounded-m-pill px-3 font-medium whitespace-nowrap active:bg-m-surface-hover">
					{action}
				</button>
			</div>
		</div>
	);
}

/** Offline / reconnecting / unpaired (401) indicator with a re-pair guide. */
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
				<Pill role="alert" tone="danger" icon={<KeyRound size={16} />} text="配对已失效" action="重新配对" onAction={() => setGuide(true)} />
				<BottomSheet open={guide} onClose={() => setGuide(false)} title="重新配对">
					<ol className="m-selectable list-decimal space-y-3 px-5 pt-2 pb-6 pl-10 text-m-md text-m-text-2">
						<li>在电脑上打开 omp-workspace，进入「设置 → 连接与设备」。</li>
						<li>点击「生成配对二维码」。</li>
						<li>用手机相机扫描二维码，或直接打开配对链接。</li>
						<li>配对成功后这里会自动恢复。</li>
					</ol>
				</BottomSheet>
			</>
		);
	}

	const offline = phase === "closed" || (phase === "connecting" && sawClosed.current);
	if (!offline) return null;
	const connecting = phase === "connecting";
	return (
		<Pill
			role="status"
			tone="warn"
			icon={connecting ? <Spinner size={14} /> : <CloudOff size={16} />}
			text={connecting ? "正在重新连接" : error || "连接已断开"}
			action="重试"
			onAction={reconnectEvents}
		/>
	);
}
