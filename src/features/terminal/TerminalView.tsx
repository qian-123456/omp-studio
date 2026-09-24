/**
 * [E] Terminal view (xterm) for a session (§11 E).
 * Opens `omp --resume <file> -e <extension>` in a PTY via term_open_session,
 * streams terminal:data/exit events, forwards keystrokes and resizes, and
 * captures the selection as a composer annotation (Cmd+Shift+A / toolbar).
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { onTerminalData, onTerminalExit } from "../../lib/events";
import {
	termClose,
	termOpenSession,
	termResize,
	termWrite,
} from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

type Phase = "opening" | "ready" | "exited" | "error";

function decodeBase64(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

export function TerminalView({ sessionId }: { sessionId: string }) {
	const meta = useSessions((s) => s.sessions[sessionId]);
	const setSessionViewMode = useUi((s) => s.setSessionViewMode);
	const addAnnotation = useComposer((s) => s.addAnnotation);

	const hostRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const termIdRef = useRef<string | null>(null);

	// Live sessions confirm the RPC handoff before the PTY opens.
	const [confirmed, setConfirmed] = useState(false);
	const needsConfirm = Boolean(meta?.live) && !confirmed;
	const [phase, setPhase] = useState<Phase>("opening");
	const [error, setError] = useState<string | null>(null);
	const [exitCode, setExitCode] = useState<number | null>(null);
	const [copied, setCopied] = useState(false);

	const backToChat = useCallback(
		(confirmClose: boolean) => {
			if (
				confirmClose &&
				termIdRef.current &&
				phase === "ready" &&
				!window.confirm("关闭终端并返回聊天视图？终端中的进程会被终止。")
			) {
				return;
			}
			const id = termIdRef.current;
			termIdRef.current = null;
			if (id) void termClose(id).catch(() => {});
			setSessionViewMode(sessionId, "chat");
		},
		[phase, sessionId, setSessionViewMode],
	);

	const captureSelection = useCallback(() => {
		const text = termRef.current?.getSelection()?.trim();
		if (!text) return;
		addAnnotation(sessionId, { source: "terminal", text });
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [addAnnotation, sessionId]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host || needsConfirm) return;

		const term = new Terminal({
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			fontSize: 12,
			cursorBlink: true,
			scrollback: 5000,
			theme: { background: "#0a0a0a" },
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(host);
		fit.fit();
		termRef.current = term;
		fitRef.current = fit;

		let disposed = false;
		const unlisteners: Array<() => void> = [];

		// Cmd+Shift+A captures the selection as an annotation.
		term.attachCustomKeyEventHandler((e) => {
			if (
				e.type === "keydown" &&
				(e.metaKey || e.ctrlKey) &&
				e.shiftKey &&
				e.key.toLowerCase() === "a"
			) {
				captureSelection();
				return false;
			}
			return true;
		});

		const dataSub = term.onData((data) => {
			const id = termIdRef.current;
			if (id) void termWrite(id, data).catch(() => {});
		});

		const open = async () => {
			try {
				const id = await termOpenSession(
					sessionId,
					term.cols || 80,
					term.rows || 24,
				);
				if (disposed) {
					void termClose(id).catch(() => {});
					return;
				}
				termIdRef.current = id;
				setPhase("ready");
				term.focus();
			} catch (e) {
				if (!disposed) {
					setError(String(e));
					setPhase("error");
				}
			}
		};

		const subs = async () => {
			const unData = await onTerminalData((p) => {
				if (p.termId === termIdRef.current) term.write(decodeBase64(p.data));
			});
			const unExit = await onTerminalExit((p) => {
				if (p.termId === termIdRef.current) {
					termIdRef.current = null;
					setExitCode(p.code);
					setPhase("exited");
				}
			});
			if (disposed) {
				unData();
				unExit();
			} else {
				unlisteners.push(unData, unExit);
			}
		};

		const observer = new ResizeObserver(() => {
			try {
				fit.fit();
				const id = termIdRef.current;
				if (id && term.cols > 0 && term.rows > 0) {
					void termResize(id, term.cols, term.rows).catch(() => {});
				}
			} catch {
				// Hidden/zero-size host: skip.
			}
		});
		observer.observe(host);

		void subs();
		void open();

		return () => {
			disposed = true;
			observer.disconnect();
			dataSub.dispose();
			for (const un of unlisteners) un();
			const id = termIdRef.current;
			termIdRef.current = null;
			if (id) void termClose(id).catch(() => {});
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, [sessionId, needsConfirm, captureSelection]);

	return (
		<div className="flex h-full flex-col bg-[#0a0a0a]">
			<div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5 text-xs">
				<span className="text-neutral-400">
					终端 · {meta?.label ?? sessionId}
				</span>
				{phase === "ready" && !needsConfirm && (
					<span className="text-emerald-400">已连接</span>
				)}
				{phase === "exited" && (
					<span className="text-neutral-500">
						已退出{exitCode !== null ? ` (code ${exitCode})` : ""}
					</span>
				)}
				<div className="flex-1" />
				<button
					className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800 disabled:opacity-40"
					disabled={phase !== "ready"}
					onClick={captureSelection}
					title="将选中内容加入批注 (Cmd+Shift+A)"
				>
					{copied ? "已加入批注" : "引用选中"}
				</button>
				<button
					className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800"
					onClick={() => backToChat(true)}
				>
					返回聊天
				</button>
			</div>

			{needsConfirm && (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
					<div className="text-sm text-neutral-300">
						切换到终端会挂起结构化通道
					</div>
					<div className="max-w-sm text-xs leading-5 text-neutral-500">
						该会话的 RPC 进程正在运行。进入终端视图会先停止它，然后在终端里用
						omp --resume 恢复会话；返回聊天视图会重新读取会话记录。
					</div>
					<div className="flex gap-2">
						<button
							className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500"
							onClick={() => setConfirmed(true)}
						>
							继续切换到终端
						</button>
						<button
							className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
							onClick={() => setSessionViewMode(sessionId, "chat")}
						>
							取消
						</button>
					</div>
				</div>
			)}

			{phase === "error" && !needsConfirm && (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
					<div className="text-sm text-red-400">终端启动失败</div>
					<div className="max-w-md text-xs text-neutral-500">{error}</div>
					<button
						className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
						onClick={() => setSessionViewMode(sessionId, "chat")}
					>
						返回聊天
					</button>
				</div>
			)}

			<div
				ref={hostRef}
				className={
					"min-h-0 flex-1 px-1 " +
					(needsConfirm || phase === "error" ? "hidden" : "")
				}
			/>
		</div>
	);
}
