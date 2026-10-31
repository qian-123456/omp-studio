import { Plus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, api, apiUrl, errorMessage } from "../../core/api";
import type { PageProps } from "../../core/nav";
import { Button, EmptyState, IconButton, PageHeader, confirm, toast } from "../../ui";
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
import { WorkspacePanelBar } from "./WorkspacePanelBar";

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

/**
 * The terminal is dark in both schemes: in light mode the inverse text/page tokens give a dark
 * canvas with light text, in dark mode the code tokens do.
 */
function terminalColors(): { background: string; foreground: string; cursor: string } {
	const light = document.documentElement.dataset.scheme === "light";
	const background = cssVar(light ? "--m-text" : "--m-code-bg", "black");
	const foreground = cssVar(light ? "--m-bg" : "--m-code-text", "white");
	return { background, foreground, cursor: foreground };
}

export function TerminalPage({ route }: PageProps) {
	const sessionId = route.params.id;
	const nextId = useRef(1);
	const [tabs, setTabs] = useState([1]);
	const tabsRef = useRef(tabs);
	const [active, setActive] = useState(1);
	const addTab = () => {
		if (tabsRef.current.length >= 4) { toast("最多同时打开 4 个终端，请先关闭一个终端", { kind: "error" }); return; }
		const id = ++nextId.current;
		tabsRef.current = [...tabsRef.current, id];
		setTabs(tabsRef.current);
		setActive(id);
	};
	const removeTab = (id: number) => {
		const remaining = tabsRef.current.filter((tab) => tab !== id);
		tabsRef.current = remaining;
		setTabs(remaining);
		setActive((current) => current === id ? remaining[remaining.length - 1] ?? 0 : current);
	};
	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="终端" right={<IconButton variant="filled" icon={<Plus size={22} strokeWidth={1.75} />} label="新终端" onClick={addTab} />} />
			<WorkspacePanelBar sessionId={sessionId} current="terminal" />
			<div role="tablist" aria-label="终端实例" className="m-noscrollbar flex shrink-0 gap-2 overflow-x-auto px-4 py-1">
				{tabs.map((id) => <button key={id} id={`terminal-tab-${id}`} type="button" role="tab" aria-selected={active === id} aria-controls={`terminal-pane-${id}`} onClick={() => setActive(id)} className={`min-h-11 min-w-11 shrink-0 rounded-m-pill px-4 text-m-sm whitespace-nowrap ${active === id ? "bg-m-accent-soft text-m-accent-soft-text" : "bg-m-surface text-m-text-2"}`}>终端 {id}</button>)}
			</div>
			{tabs.map((id) => <TerminalPane key={id} sessionId={sessionId} tabId={id} active={active === id} onClosed={() => removeTab(id)} />)}
			{tabs.length === 0 && <EmptyState title="终端已关闭" hint="新建终端会启动独立的真实终端进程" action={<Button onClick={addTab}>新终端</Button>} />}
		</div>
	);
}

/** Each mounted pane owns one PTY; switching tabs does not recreate that process. */
function TerminalPane({ sessionId, tabId, active, onClosed }: { sessionId: string; tabId: number; active: boolean; onClosed: () => void }) {
	const activeRef = useRef(active);
	activeRef.current = active;
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
	const [bg, setBg] = useState<string | null>(null);
	const [fontSize, setFontSize] = useState(13);

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
			if (source.current === es) source.current = null;
			const code = parseExit((ev as MessageEvent<string>).data);
			setPhase("exited");
			setDetail(code !== null ? `退出码 ${code}` : "");
		});
		es.onerror = () => {
			if (exited.current || !alive.current) return;
			es.close();
			if (source.current === es) source.current = null;
			retries.current += 1;
			if (!activeRef.current || document.visibilityState === "hidden") { setPhase("dropped"); return; }
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
		const id = termId.current;
		if (id) await api("DELETE", `/terminal/${id}`);
		window.clearTimeout(retryTimer.current);
		source.current?.close();
		source.current = null;
		queue.current?.clear();
		termId.current = null;
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
		try {
			await closeTerm();
			term.current?.reset();
			await open();
		} catch (e) {
			setPhase("error");
			setDetail(errorMessage(e, "重连失败"));
		}
	}, [closeTerm, open]);

	const handleClose = useCallback(async () => {
		const ok = await confirm({
			title: "关闭终端",
			message: "正在运行的命令会被结束。",
			confirmText: "关闭",
			danger: true,
		});
		if (!ok) return;
		try {
			await closeTerm();
			onClosed();
			toast("已关闭终端");
		} catch (e) {
			setDetail(`关闭失败：${errorMessage(e)}`);
			toast(`关闭失败：${errorMessage(e)}`, { kind: "error" });
		}
	}, [closeTerm, onClosed]);

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
				theme: terminalColors(),
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
					if (!activeRef.current || document.visibilityState === "hidden") return;
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
				if (document.visibilityState === "hidden") { window.clearTimeout(retryTimer.current); return; }
				if (activeRef.current && termId.current && !exited.current && !source.current) { retries.current = 0; attach(); }
			};
			document.addEventListener("visibilitychange", onVisible);
			const schemeObserver = new MutationObserver(() => {
				const c = terminalColors();
				t.options.theme = c;
				setBg(c.background);
			});
			schemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
			setBg(terminalColors().background);
			cleanup = () => {
				document.removeEventListener("visibilitychange", onVisible);
				schemeObserver.disconnect();
				ro.disconnect();
				if (frame) cancelAnimationFrame(frame);
				dataSub.dispose();
				t.dispose();
				term.current = null;
				fit.current = null;
			};
			void open();
		})().catch((e: unknown) => {
			if (!alive.current) return;
			setPhase("error");
			setDetail(errorMessage(e, "终端加载失败"));
		});
		return () => {
			alive.current = false;
			cleanup();
			window.clearTimeout(retryTimer.current);
			source.current?.close();
			source.current = null;
			queue.current?.clear();
			void closeTerm().catch(() => {});
		};
	}, [open, attach, closeTerm, sendResize]);

	useEffect(() => {
		if (!active) { window.clearTimeout(retryTimer.current); return; }
		const frame = requestAnimationFrame(() => {
			const t = term.current;
			if (!t) return;
			t.options.fontSize = fontSize;
			try { fit.current?.fit(); } catch { /* The host may still be laying out. */ }
			sendResize();
			if (termId.current && !exited.current && !source.current && document.visibilityState === "visible") attach();
		});
		return () => cancelAnimationFrame(frame);
	}, [active, fontSize, attach, sendResize]);

	const paste = async () => {
		try {
			if (!navigator.clipboard?.readText) throw new Error("浏览器不支持读取剪贴板，请长按终端粘贴");
			const text = await navigator.clipboard.readText();
			if (!termId.current || exited.current) throw new Error("终端未连接");
			if (text) term.current?.paste(text);
			term.current?.focus();
		} catch (e) { toast(`粘贴失败：${errorMessage(e)}`, { kind: "error" }); }
	};

	const sendKey = (seq: string) => {
		if (!termId.current || exited.current) {
			toast("终端未连接", { kind: "error" });
			return;
		}
		queue.current?.push(seq);
	};

	const bad = phase === "dropped" || phase === "error" || phase === "reconnecting" || phase === "exited";
	return (
		<div id={`terminal-pane-${tabId}`} role="tabpanel" aria-labelledby={`terminal-tab-${tabId}`} hidden={!active} className="min-h-0 flex-1 flex-col" style={{ display: active ? "flex" : "none", paddingBottom: "calc(var(--m-safe-bottom) + 100px)" }}>
			<div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-1 pb-2">
				<div role="status" className={`flex min-w-0 flex-wrap items-center gap-2 text-m-xs ${bad ? "text-m-danger" : "text-m-text-3"}`}>
					<span aria-hidden className={`h-2 w-2 shrink-0 rounded-m-pill ${phase === "connected" ? "bg-m-success" : bad ? "bg-m-danger" : "m-pulse bg-m-accent"}`} />
					<span>{PHASE_LABEL[phase]}</span>
				</div>
				<div className="flex shrink-0 gap-1">
					{bad && <IconButton variant="plain" icon={<RefreshCw size={20} strokeWidth={1.75} />} label="重连终端" onClick={() => void reconnect()} />}
					<IconButton variant="plain" icon={<X size={20} strokeWidth={1.75} />} label={`关闭终端 ${tabId}`} onClick={() => void handleClose()} />
				</div>
			</div>
			{detail && <p role={bad ? "status" : undefined} className={`m-selectable px-5 pb-2 text-m-sm break-words ${bad ? "text-m-danger" : "text-m-text-3"}`}>{detail}</p>}
			<div className="min-h-0 flex-1 px-3 pb-1">
				<div className="h-full overflow-hidden rounded-m-lg p-3" style={bg ? { background: bg } : undefined}>
					<div ref={host} onClick={() => term.current?.focus()} className="h-full w-full overflow-hidden" />
				</div>
			</div>
			{active && createPortal(
				<div className="fixed inset-x-0 z-20 bg-m-bg px-3 pt-1" style={{ bottom: "var(--m-kb, 0px)", paddingBottom: "calc(var(--m-safe-bottom) + 4px)" }}>
					<div className="m-noscrollbar flex items-center gap-2 overflow-x-auto">
						<KeyButton onPress={() => void paste()}>粘贴</KeyButton>
						<KeyButton onPress={() => term.current?.clear()}>清屏</KeyButton>
						<KeyButton onPress={() => setFontSize((size) => Math.max(11, size - 1))}>字号−</KeyButton>
						<KeyButton onPress={() => setFontSize((size) => Math.min(22, size + 1))}>字号＋</KeyButton>
						<KeyButton onPress={() => term.current?.blur()}>收起键盘</KeyButton>
					</div>
					<div className="m-noscrollbar flex items-center gap-2 overflow-x-auto">
						{TERMINAL_KEYS.map((key) => (
							<span key={key.id} className="flex shrink-0 items-center gap-2">
								<KeyButton onPress={() => sendKey(key.seq)}>{key.label}</KeyButton>
								{key.id === "esc" && <KeyButton active={ctrl} onPress={() => setCtrl(!ctrlRef.current)}>Ctrl</KeyButton>}
							</span>
						))}
					</div>
				</div>, document.body,
			)}
		</div>
	);
}

/** 36px tonal capsule with a 44px hit area. */
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
			className="flex min-h-11 shrink-0 items-center"
		>
			<span
				className={`flex h-9 min-w-12 items-center justify-center rounded-m-pill px-4 text-m-sm font-medium whitespace-nowrap ${
					active ? "bg-m-accent text-m-accent-text" : "bg-m-surface text-m-text active:bg-m-surface-2"
				}`}
			>
				{children}
			</span>
		</button>
	);
}
