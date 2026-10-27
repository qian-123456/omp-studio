import { RefreshCw, SquarePlus, SquareX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, apiUrl, errorMessage } from "../../core/api";
import type { PageProps } from "../../core/nav";
import { HeaderButton, PageHeader, toast } from "../../ui";
import {
	InputQueue,
	TERMINAL_KEYS,
	applyCtrl,
	decodeChunk,
	isTerminalGone,
	isTerminalLimit,
	parseExit,
	reconnectDelay,
} from "./terminalPure";

type Phase = "connecting" | "connected" | "reconnecting" | "dropped" | "exited" | "error";
type XTerm = import("@xterm/xterm").Terminal;
type Fit = import("@xterm/addon-fit").FitAddon;

const PHASE_LABEL: Record<Phase, string> = {
	connecting: "连接中",
	connected: "已连接",
	reconnecting: "连接中断，重连中",
	dropped: "连接断开，点击重连",
	exited: "进程已退出",
	error: "打开失败",
};

function cssVar(name: string, fallback: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function TerminalPage({ route }: PageProps) {
	const sessionId = route.params.id;
	const host = useRef<HTMLDivElement>(null);
	const term = useRef<XTerm | null>(null);
	const fit = useRef<Fit | null>(null);
	const termId = useRef<string | null>(null);
	const source = useRef<EventSource | null>(null);
	const retries = useRef(0);
	const retryTimer = useRef(0);
	const exited = useRef(false);
	const alive = useRef(true);
	const lastSize = useRef("");
	const queue = useRef<InputQueue | null>(null);
	const ctrlRef = useRef(false);
	const [ctrl, setCtrlState] = useState(false);
	const [phase, setPhase] = useState<Phase>("connecting");
	const [detail, setDetail] = useState("");

	const setCtrl = (v: boolean) => {
		ctrlRef.current = v;
		setCtrlState(v);
	};

	const sendResize = useCallback(() => {
		const t = term.current;
		const id = termId.current;
		if (!t || !id) return;
		const key = `${t.cols}x${t.rows}`;
		if (key === lastSize.current) return;
		lastSize.current = key;
		api("POST", `/terminal/${id}/resize`, { cols: t.cols, rows: t.rows }).catch(() => {});
	}, []);

	const attach = useCallback(() => {
		const id = termId.current;
		if (!id || !alive.current) return;
		source.current?.close();
		const es = new EventSource(apiUrl(`/terminal/${id}/stream`));
		source.current = es;
		es.onopen = () => {
			retries.current = 0;
			// The server replays its backlog on every (re)attach: start from a clean screen.
			term.current?.reset();
			setPhase("connected");
			setDetail("");
		};
		es.addEventListener("data", (ev) => {
			try {
				term.current?.write(decodeChunk((ev as MessageEvent<string>).data));
			} catch (err) {
				console.error("terminal data", err);
			}
		});
		es.addEventListener("exit", (ev) => {
			exited.current = true;
			es.close();
			const code = parseExit((ev as MessageEvent<string>).data);
			setPhase("exited");
			setDetail(code !== null ? `退出码 ${code}` : "");
		});
		es.onerror = () => {
			if (exited.current || !alive.current) return;
			es.close();
			if (source.current === es) source.current = null;
			retries.current += 1;
			const delay = reconnectDelay(retries.current);
			if (delay === null) {
				setPhase("dropped");
				return;
			}
			setPhase("reconnecting");
			setDetail(`第 ${retries.current} 次`);
			window.clearTimeout(retryTimer.current);
			retryTimer.current = window.setTimeout(attach, delay);
		};
	}, []);

	const closeTerm = useCallback(async () => {
		window.clearTimeout(retryTimer.current);
		source.current?.close();
		source.current = null;
		queue.current?.clear();
		const id = termId.current;
		termId.current = null;
		if (id) await api("DELETE", `/terminal/${id}`).catch(() => {});
	}, []);

	const open = useCallback(async () => {
		const t = term.current;
		if (!t || !alive.current) return;
		exited.current = false;
		retries.current = 0;
		setPhase("connecting");
		setDetail("");
		try {
			fit.current?.fit();
		} catch {
			/* host not laid out yet; defaults are used */
		}
		try {
			const res = await api<{ termId: string }>("POST", "/terminal", { sessionId, cols: t.cols, rows: t.rows });
			if (!alive.current) {
				api("DELETE", `/terminal/${res.termId}`).catch(() => {});
				return;
			}
			termId.current = res.termId;
			lastSize.current = `${t.cols}x${t.rows}`;
			attach();
		} catch (e) {
			if (!alive.current) return;
			const msg = errorMessage(e, "打开失败");
			setPhase("error");
			setDetail(isTerminalLimit(msg) ? "终端数量已达上限（最多 4 个），请先关闭多余终端后点“新终端”" : msg);
		}
	}, [sessionId, attach]);

	const openNew = useCallback(async () => {
		await closeTerm();
		term.current?.reset();
		await open();
	}, [closeTerm, open]);

	const handleClose = useCallback(async () => {
		await closeTerm();
		setPhase("exited");
		setDetail("终端已关闭");
		toast("已关闭终端");
	}, [closeTerm]);

	const reconnect = useCallback(async () => {
		const t = term.current;
		if (!termId.current || exited.current || !t) return openNew();
		// The server reaps a detached PTY after 60 s (e.g. the tab was suspended): probe it first.
		try {
			await api("POST", `/terminal/${termId.current}/resize`, { cols: t.cols, rows: t.rows });
		} catch (e) {
			if (e instanceof ApiError && isTerminalGone(e.status)) return openNew();
		}
		retries.current = 0;
		attach();
	}, [attach, openNew]);

	// Mount: lazy-load xterm (separate chunk), wire input, open the PTY.
	useEffect(() => {
		alive.current = true;
		let cleanup = () => {};
		void (async () => {
			const [{ Terminal }, { FitAddon }] = await Promise.all([
				import("@xterm/xterm"),
				import("@xterm/addon-fit"),
				import("@xterm/xterm/css/xterm.css"),
			]);
			const el = host.current;
			if (!alive.current || !el) return;
			const t = new Terminal({
				fontFamily: cssVar("--m-font-mono", "monospace"),
				fontSize: 13,
				cursorBlink: true,
				scrollback: 3000,
				allowProposedApi: false,
				theme: {
					background: cssVar("--m-code-bg", "#111111"),
					foreground: cssVar("--m-text", "#eeeeee"),
					cursor: cssVar("--m-accent", "#ffffff"),
				},
			});
			const f = new FitAddon();
			t.loadAddon(f);
			t.open(el);
			term.current = t;
			fit.current = f;
			queue.current = new InputQueue(
				(data) => {
					const id = termId.current;
					if (!id || exited.current) return Promise.reject(new Error("终端未连接"));
					return api("POST", `/terminal/${id}/input`, { data });
				},
				(e) => toast(`发送失败：${errorMessage(e)}`, { kind: "error" }),
			);
			// xterm's hidden textarea handles IME composition; onData only fires with committed text.
			const dataSub = t.onData((raw) => {
				const { data, consumed } = applyCtrl(raw, ctrlRef.current);
				if (consumed) setCtrl(false);
				queue.current?.push(data);
			});
			let frame = 0;
			const ro = new ResizeObserver(() => {
				if (frame) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					try {
						f.fit();
					} catch {
						/* detached */
					}
					sendResize();
				});
			});
			ro.observe(el);
			const onVisible = () => {
				if (document.visibilityState === "visible" && termId.current && !exited.current && !source.current) {
					retries.current = 0;
					attach();
				}
			};
			document.addEventListener("visibilitychange", onVisible);
			cleanup = () => {
				document.removeEventListener("visibilitychange", onVisible);
				ro.disconnect();
				if (frame) cancelAnimationFrame(frame);
				dataSub.dispose();
				t.dispose();
				term.current = null;
				fit.current = null;
			};
			void open();
		})();
		return () => {
			alive.current = false;
			cleanup();
			void closeTerm();
		};
	}, [open, attach, closeTerm, sendResize]);

	const sendKey = (seq: string) => {
		if (!termId.current || exited.current) {
			toast("终端未连接", { kind: "error" });
			return;
		}
		queue.current?.push(seq);
	};

	const bad = phase === "dropped" || phase === "error" || phase === "reconnecting" || phase === "exited";
	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader
				title="终端"
				subtitle={
					<span className={bad ? "text-m-danger" : undefined}>
						{PHASE_LABEL[phase]}
						{detail ? `（${detail}）` : ""}
					</span>
				}
				right={
					<>
						{(phase === "dropped" || phase === "reconnecting") && (
							<HeaderButton icon={<RefreshCw size={20} />} label="重连" onClick={() => void reconnect()} />
						)}
						<HeaderButton icon={<SquarePlus size={20} />} label="新终端" onClick={() => void openNew()} />
						{phase !== "exited" && (
							<HeaderButton icon={<SquareX size={20} />} label="关闭终端" onClick={() => void handleClose()} />
						)}
					</>
				}
			/>
			<div
				ref={host}
				onClick={() => term.current?.focus()}
				className="m-0 min-h-0 flex-1 overflow-hidden bg-m-code-bg p-1"
			/>
			<div
				className="flex shrink-0 gap-2 overflow-x-auto border-t border-m-border bg-m-bg px-2 pt-2"
				style={{ paddingBottom: "calc(var(--m-safe-bottom) + 8px)" }}
			>
				<KeyButton active={ctrl} onPress={() => setCtrl(!ctrlRef.current)}>
					Ctrl
				</KeyButton>
				{TERMINAL_KEYS.map((k) => (
					<KeyButton key={k.id} onPress={() => sendKey(k.seq)}>
						{k.label}
					</KeyButton>
				))}
			</div>
		</div>
	);
}

function KeyButton({
	children,
	onPress,
	active = false,
}: {
	children: string;
	onPress: () => void;
	active?: boolean;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			// Keep the soft keyboard up: do not steal focus from xterm's textarea.
			onPointerDown={(e) => e.preventDefault()}
			onClick={onPress}
			className={`min-h-11 min-w-11 shrink-0 whitespace-nowrap rounded-m-md border px-3 text-m-sm font-medium ${
				active ? "border-m-accent bg-m-accent text-m-accent-text" : "border-m-border bg-m-surface text-m-text active:bg-m-surface-hover"
			}`}
		>
			{children}
		</button>
	);
}
