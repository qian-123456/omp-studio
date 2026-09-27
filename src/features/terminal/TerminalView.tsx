/**
 * [E] Terminal view (xterm) for a session (§11 E).
 * Opens `omp --resume <file> -e <extension>` in a PTY via term_open_session,
 * streams terminal:data/exit events, forwards keystrokes and resizes, and
 * captures the selection as a composer annotation (Cmd+Shift+A / toolbar).
 *
 * Persistent: PTY sessions outlive view unmounts so background tasks continue.
 */
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import clsx from "clsx";
import {
	ArrowDown,
	ArrowUp,
	ClipboardCopy,
	ClipboardPaste,
	Eraser,
	MessageSquareQuote,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { onTerminalData, onTerminalExit } from "../../lib/events";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	termClose,
	termOpenSession,
	termResize,
	termWrite,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import {
	destroySessionTerminal,
	terminalRegistry,
	type TerminalPhase as Phase,
	type TerminalSessionEntry,
} from "./terminalRegistry";

export { destroySessionTerminal, terminalRegistry };

const SEARCH_DECORATIONS = {
	matchBackground: "#3b4252",
	activeMatchBackground: "#4f46e5",
	matchOverviewRuler: "#434c5e",
	activeMatchColorOverviewRuler: "#6366f1",
};

function decodeBase64(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

export function TerminalView({
	sessionId,
	compact = false,
}: {
	sessionId: string;
	compact?: boolean;
}) {
	const meta = useSessions((s) => s.sessions[sessionId]);
	const setSessionViewMode = useUi((s) => s.setSessionViewMode);
	const addAnnotation = useComposer((s) => s.addAnnotation);

	const hostRef = useRef<HTMLDivElement | null>(null);
	const [confirmed, setConfirmed] = useState(false);
	const needsConfirm = Boolean(meta?.live) && !confirmed;
	const [phase, setPhase] = useState<Phase>("opening");
	const [error, setError] = useState<string | null>(null);
	const [exitCode, setExitCode] = useState<number | null>(null);
	const [copied, setCopied] = useState(false);
	const [restartTick, setRestartTick] = useState(0);

	// Search bar state
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
	const [searchWholeWord, setSearchWholeWord] = useState(false);
	const [searchRegex, setSearchRegex] = useState(false);
	const [searchResult, setSearchResult] = useState<{
		index: number;
		count: number;
	} | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	// Context menu state
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);

	// Esc keys
	useEscapeKey(() => setContextMenu(null), contextMenu !== null);
	useEscapeKey(() => {
		if (searchOpen) {
			const entry = terminalRegistry.get(sessionId);
			entry?.search.clearDecorations();
			setSearchOpen(false);
			setSearchResult(null);
			entry?.term.focus();
		}
	}, searchOpen && contextMenu === null);
	const captureSelection = useCallback(() => {
		const entry = terminalRegistry.get(sessionId);
		const text = entry?.term.getSelection()?.trim();
		if (!text) {
			toast.info("未选中任何终端文本");
			return;
		}
		addAnnotation(sessionId, { source: "terminal", text });
		setCopied(true);
		toast.success("已将选中内容添加至批注");
		setTimeout(() => setCopied(false), 1500);
	}, [addAnnotation, sessionId]);

	// Switch back to chat without killing PTY (persists in background)
	const handleBackToChat = useCallback(() => {
		setSessionViewMode(sessionId, "chat");
	}, [sessionId, setSessionViewMode]);

	// Explicitly terminate the terminal process and close
	const handleTerminateAndClose = useCallback(async () => {
		const entry = terminalRegistry.get(sessionId);
		if (entry && entry.phase === "ready") {
			const ok = await confirmDialog(
				"确定要终止终端中的进程并关闭终端吗？此操作将杀死正在运行的任务。",
				{
					danger: true,
					title: "关闭终端",
					okLabel: "终止并关闭",
				},
			);
			if (!ok) return;
		}
		destroySessionTerminal(sessionId);
		setSessionViewMode(sessionId, "chat");
	}, [sessionId, setSessionViewMode]);

	// Reconnect/restart terminal
	const handleReconnect = useCallback(() => {
		destroySessionTerminal(sessionId);
		setPhase("opening");
		setError(null);
		setExitCode(null);
		setSearchResult(null);
		setRestartTick((t) => t + 1);
	}, [sessionId]);

	// Search actions
	const handleFindNext = useCallback(() => {
		const entry = terminalRegistry.get(sessionId);
		if (!entry || !searchQuery) return;
		entry.search.findNext(searchQuery, {
			caseSensitive: searchCaseSensitive,
			wholeWord: searchWholeWord,
			regex: searchRegex,
			incremental: true,
			decorations: SEARCH_DECORATIONS,
		});
	}, [sessionId, searchQuery, searchCaseSensitive, searchWholeWord, searchRegex]);

	const handleFindPrevious = useCallback(() => {
		const entry = terminalRegistry.get(sessionId);
		if (!entry || !searchQuery) return;
		entry.search.findPrevious(searchQuery, {
			caseSensitive: searchCaseSensitive,
			wholeWord: searchWholeWord,
			regex: searchRegex,
			decorations: SEARCH_DECORATIONS,
		});
	}, [sessionId, searchQuery, searchCaseSensitive, searchWholeWord, searchRegex]);
	// Terminal setup & lifecycle
	useEffect(() => {
		const host = hostRef.current;
		if (!host || needsConfirm) return;

		let observer: ResizeObserver | null = null;
		let entry = terminalRegistry.get(sessionId);

		// If existing running terminal found, reattach DOM element
		if (entry && entry.term.element) {
			if (entry.term.element.parentElement !== host) {
				host.appendChild(entry.term.element);
			}
			if (compact && entry.term.options.fontSize !== 11) {
				entry.term.options.fontSize = 11;
				entry.fit.fit();
			} else if (!compact && entry.term.options.fontSize !== 12) {
				entry.term.options.fontSize = 12;
				entry.fit.fit();
			}

			setPhase(entry.phase);
			setExitCode(entry.exitCode);
			setError(entry.error);

			entry.onExit = (code: number | null) => {
				setPhase("exited");
				setExitCode(code);
			};

			const searchSub = entry.search.onDidChangeResults((e) => {
				setSearchResult({
					index: e.resultIndex,
					count: e.resultCount,
				});
			});

			observer = new ResizeObserver(() => {
				try {
					entry?.fit.fit();
					if (entry?.termId && entry.term.cols > 0 && entry.term.rows > 0) {
						void termResize(entry.termId, entry.term.cols, entry.term.rows).catch(
							() => {},
						);
					}
				} catch {}
			});
			observer.observe(host);
			entry.fit.fit();
			entry.term.focus();

			return () => {
				searchSub.dispose();
				observer?.disconnect();
				if (entry) entry.onExit = undefined;
				if (entry?.term.element && host.contains(entry.term.element)) {
					host.removeChild(entry.term.element);
				}
			};
		}

		// Otherwise initialize a brand new terminal instance
		const term = new Terminal({
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			fontSize: compact ? 11 : 12,
			cursorBlink: true,
			scrollback: 5000,
			theme: { background: "#0a0a0a" },
		});
		const fit = new FitAddon();
		const search = new SearchAddon();
		term.loadAddon(fit);
		term.loadAddon(search);
		term.open(host);
		fit.fit();

		const searchSub = search.onDidChangeResults((e) => {
			setSearchResult({
				index: e.resultIndex,
				count: e.resultCount,
			});
		});
		let currentTermId: string | null = null;
		let disposed = false;
		let failed = false;
		let unregisteredCleaned = false;
		const unlisteners: Array<() => void> = [];

		// Key events: Cmd+Shift+A (annotation), Cmd+F (search)
		term.attachCustomKeyEventHandler((e) => {
			if (e.type === "keydown") {
				if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
					captureSelection();
					return false;
				}
				if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
					setSearchOpen(true);
					setTimeout(() => searchInputRef.current?.focus(), 50);
					return false;
				}
			}
			return true;
		});

		const dataSub = term.onData((data) => {
			if (currentTermId) void termWrite(currentTermId, data).catch(() => {});
		});

		const cleanupUnregistered = () => {
			if (unregisteredCleaned) return;
			unregisteredCleaned = true;
			for (const un of unlisteners) {
				try {
					un();
				} catch {}
			}
			unlisteners.length = 0;
			try {
				dataSub.dispose();
			} catch {}
			try {
				searchSub.dispose();
			} catch {}
			try {
				observer?.disconnect();
			} catch {}
			try {
				term.dispose();
			} catch {}
			if (term.element && host.contains(term.element)) {
				try {
					host.removeChild(term.element);
				} catch {}
			}
		};

		const open = async () => {
			try {
				const id = await termOpenSession(
					sessionId,
					term.cols || 80,
					term.rows || 24,
				);
				if (disposed) {
					void termClose(id).catch(() => {});
					cleanupUnregistered();
					return;
				}
				currentTermId = id;
				setPhase("ready");
				term.focus();

				const newEntry: TerminalSessionEntry = {
					termId: id,
					term,
					fit,
					search,
					phase: "ready",
					exitCode: null,
					error: null,
					unlisteners,
					dataSub,
					onExit: (code: number | null) => {
						setPhase("exited");
						setExitCode(code);
					},
				};
				terminalRegistry.set(sessionId, newEntry);
			} catch (e) {
				failed = true;
				cleanupUnregistered();
				if (!disposed) {
					const msg = errMsg(e);
					setError(msg);
					setPhase("error");
					toast.error(`会话终端启动失败: ${msg}`);
				}
			}
		};

		const subs = async () => {
			try {
				const unData = await onTerminalData((p) => {
					const active = terminalRegistry.get(sessionId);
					if (p.termId === currentTermId || (active && p.termId === active.termId)) {
						term.write(decodeBase64(p.data));
					}
				});
				const unExit = await onTerminalExit((p) => {
					const active = terminalRegistry.get(sessionId);
					if (p.termId === currentTermId || (active && p.termId === active.termId)) {
						if (active) {
							active.phase = "exited";
							active.exitCode = p.code;
							active.onExit?.(p.code);
						} else {
							setExitCode(p.code);
							setPhase("exited");
						}
					}
				});
				if (disposed || failed) {
					try {
						unData();
					} catch {}
					try {
						unExit();
					} catch {}
				} else {
					unlisteners.push(unData, unExit);
				}
			} catch (err) {
				console.error("Failed to subscribe to terminal events", err);
			}
		};

		observer = new ResizeObserver(() => {
			try {
				fit.fit();
				if (currentTermId && term.cols > 0 && term.rows > 0) {
					void termResize(currentTermId, term.cols, term.rows).catch(() => {});
				}
			} catch {}
		});
		observer.observe(host);

		void subs();
		void open();

		return () => {
			disposed = true;
			searchSub.dispose();
			observer?.disconnect();
			const active = terminalRegistry.get(sessionId);
			if (active) {
				active.onExit = undefined;
				// Detach DOM element without killing PTY or disposing xterm
				if (term.element && host.contains(term.element)) {
					host.removeChild(term.element);
				}
			} else {
				// Terminal was never registered or open() failed/aborted
				cleanupUnregistered();
			}
		};
	}, [sessionId, needsConfirm, captureSelection, restartTick, compact]);

	// Context menu actions
	const handleCopy = async () => {
		const entry = terminalRegistry.get(sessionId);
		setContextMenu(null);
		const sel = entry?.term.getSelection();
		if (sel) {
			await copyText(sel);
			toast.success("已复制选中内容");
		}
	};

	const handlePaste = async () => {
		const entry = terminalRegistry.get(sessionId);
		setContextMenu(null);
		if (!entry?.termId) return;
		try {
			const text = await navigator.clipboard.readText();
			if (text) {
				await termWrite(entry.termId, text);
			}
		} catch (e) {
			toast.error(`粘贴失败: ${errMsg(e)}`);
		}
	};

	const handleClear = () => {
		const entry = terminalRegistry.get(sessionId);
		setContextMenu(null);
		entry?.term.clear();
	};

	return (
		<div className="relative flex h-full flex-col bg-[#0a0a0a]">
			{/* Top action header */}
			<div
				className={clsx(
					"flex shrink-0 items-center border-b border-neutral-800",
					compact
						? "gap-1 overflow-x-auto px-2 py-1 text-[11px]"
						: "gap-2 px-3 py-1.5 text-xs",
				)}
			>
				<span className="shrink-0 font-medium text-neutral-300">
					会话终端 · {meta?.label ?? sessionId}
				</span>
				{phase === "ready" && !needsConfirm && (
					<span className="shrink-0 flex items-center gap-1 text-emerald-400">
						<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
						{!compact && "已连接"}
					</span>
				)}
				{phase === "opening" && !needsConfirm && (
					<span className="shrink-0 text-sky-400">正在连接…</span>
				)}
				{phase === "exited" && (
					<span className="shrink-0 text-neutral-400">
						已退出{exitCode !== null ? ` (code ${exitCode})` : ""}
					</span>
				)}

				<div className="flex-1 min-w-1" />

				{/* Search toggle */}
				<button
					type="button"
					onClick={() => {
						setSearchOpen((o) => {
							const next = !o;
							if (!next) {
								terminalRegistry.get(sessionId)?.search.clearDecorations();
								setSearchResult(null);
							} else {
								setTimeout(() => searchInputRef.current?.focus(), 50);
							}
							return next;
						});
					}}
					title="搜索终端回滚 (Cmd+F)"
					className={clsx(
						"flex shrink-0 items-center gap-1 rounded border border-neutral-700 px-2 py-0.5 transition-colors focus:opacity-100",
						searchOpen
							? "bg-indigo-600/30 text-indigo-300 border-indigo-500"
							: "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
					)}
				>
					<Search size={12} />
					<span>搜索</span>
				</button>

				{/* Reconnect button if exited */}
				{phase === "exited" && (
					<button
						type="button"
						onClick={handleReconnect}
						title="重启终端进程"
						className="flex shrink-0 items-center gap-1 rounded bg-indigo-600 px-2.5 py-0.5 text-white hover:bg-indigo-500 transition-colors"
					>
						<RefreshCw size={12} />
						<span>重新连接</span>
					</button>
				)}

				<button
					type="button"
					className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 transition-colors focus:opacity-100"
					disabled={phase !== "ready"}
					onClick={captureSelection}
					title="将选中内容加入批注 (Cmd+Shift+A)"
				>
					{copied ? "已加入批注" : "引用选中"}
				</button>

				<button
					type="button"
					className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors focus:opacity-100"
					onClick={handleBackToChat}
					title="返回聊天视图（终端在后台保持运行）"
				>
					返回聊天
				</button>

				<button
					type="button"
					className="shrink-0 rounded border border-rose-900/60 bg-rose-950/20 px-2 py-0.5 text-rose-300 hover:bg-rose-900/40 hover:text-rose-200 transition-colors focus:opacity-100"
					onClick={handleTerminateAndClose}
					title="终止终端中的进程并关闭"
				>
					关闭终端
				</button>
			</div>
			{/* Floating Search Bar (Cmd+F) */}
			{searchOpen && (
				<div
					className={clsx(
						"absolute top-10 z-40 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900/95 p-1.5 shadow-2xl backdrop-blur-md",
						compact ? "right-2" : "right-4",
					)}
				>
					<input
						ref={searchInputRef}
						type="text"
						value={searchQuery}
						onChange={(e) => {
							const val = e.target.value;
							setSearchQuery(val);
							const entry = terminalRegistry.get(sessionId);
							if (entry && val) {
								entry.search.findNext(val, {
									caseSensitive: searchCaseSensitive,
									wholeWord: searchWholeWord,
									regex: searchRegex,
									incremental: true,
									decorations: SEARCH_DECORATIONS,
								});
							} else {
								entry?.search.clearDecorations();
								setSearchResult(null);
							}
						}}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter") {
								e.preventDefault();
								if (e.shiftKey) handleFindPrevious();
								else handleFindNext();
							}
						}}
						placeholder="在终端中搜索…"
						className={clsx(
							"rounded bg-neutral-950 px-2 py-1 text-xs text-neutral-200 outline-none border border-neutral-800 focus:border-indigo-500",
							compact ? "w-28" : "w-44",
						)}
					/>
					{/* Hit counter */}
					{searchQuery.trim() && (
						<span className="shrink-0 text-[11px] text-neutral-400 select-none">
							{searchResult && searchResult.count > 0
								? `第 ${searchResult.index >= 0 ? searchResult.index + 1 : 0} / 共 ${searchResult.count} 项`
								: "共 0 项"}
						</span>
					)}
					<button
						type="button"
						onClick={handleFindPrevious}
						title="上一处匹配 (Shift+Enter)"
						className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
					>
						<ArrowUp size={13} />
					</button>
					<button
						type="button"
						onClick={handleFindNext}
						title="下一处匹配 (Enter)"
						className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
					>
						<ArrowDown size={13} />
					</button>
					<div className="mx-0.5 h-3 w-px bg-neutral-800" />
					<button
						type="button"
						onClick={() => setSearchCaseSensitive((v) => !v)}
						title="大小写匹配"
						className={clsx(
							"rounded px-1.5 py-0.5 text-[10px] font-mono",
							searchCaseSensitive
								? "bg-indigo-600 text-white"
								: "text-neutral-400 hover:bg-neutral-800",
						)}
					>
						Aa
					</button>
					<button
						type="button"
						onClick={() => setSearchWholeWord((v) => !v)}
						title="全字匹配"
						className={clsx(
							"rounded px-1.5 py-0.5 text-[10px] font-mono",
							searchWholeWord
								? "bg-indigo-600 text-white"
								: "text-neutral-400 hover:bg-neutral-800",
						)}
					>
						\b
					</button>
					<button
						type="button"
						onClick={() => setSearchRegex((v) => !v)}
						title="正则表达式"
						className={clsx(
							"rounded px-1.5 py-0.5 text-[10px] font-mono",
							searchRegex
								? "bg-indigo-600 text-white"
								: "text-neutral-400 hover:bg-neutral-800",
						)}
					>
						.*
					</button>
					<button
						type="button"
						onClick={() => {
							terminalRegistry.get(sessionId)?.search.clearDecorations();
							setSearchOpen(false);
							setSearchResult(null);
							terminalRegistry.get(sessionId)?.term.focus();
						}}
						title="关闭搜索 (Esc)"
						className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
					>
						<X size={13} />
					</button>
				</div>
			)}

			{needsConfirm && (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
					<div className="text-sm font-medium text-neutral-300">
						切换到终端会挂起结构化通道
					</div>
					<div className="max-w-sm text-xs leading-5 text-neutral-500">
						该会话的 RPC 进程正在运行。进入终端视图会先停止它，然后在终端里用
						omp --resume 恢复会话；返回聊天视图会重新读取会话记录。
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 transition-colors"
							onClick={() => setConfirmed(true)}
						>
							继续切换到终端
						</button>
						<button
							type="button"
							className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors"
							onClick={() => setSessionViewMode(sessionId, "chat")}
						>
							取消
						</button>
					</div>
				</div>
			)}

			{phase === "error" && !needsConfirm && (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
					<div className="text-sm text-rose-400 font-medium">会话终端启动失败</div>
					<div className="max-w-md text-xs text-neutral-500">{error}</div>
					<div className="flex gap-2">
						<button
							type="button"
							className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500 transition-colors"
							onClick={handleReconnect}
						>
							重试连接
						</button>
						<button
							type="button"
							className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors"
							onClick={() => setSessionViewMode(sessionId, "chat")}
						>
							返回聊天
						</button>
					</div>
				</div>
			)}

			{/* Terminal container */}
			<div
				ref={hostRef}
				onContextMenu={(e) => {
					e.preventDefault();
					const menuWidth = 180;
					const menuHeight = phase === "exited" ? 220 : 170;
					const x =
						e.clientX + menuWidth > window.innerWidth
							? Math.max(8, e.clientX - menuWidth)
							: e.clientX;
					const y =
						e.clientY + menuHeight > window.innerHeight
							? Math.max(8, e.clientY - menuHeight)
							: e.clientY;
					setContextMenu({ x, y });
				}}
				className={clsx(
					"min-h-0 flex-1 px-1",
					(needsConfirm || phase === "error") && "hidden",
				)}
			/>

			{/* Exited floating bottom banner */}
			{phase === "exited" && (
				<div className="shrink-0 flex items-center justify-between border-t border-neutral-800 bg-neutral-900/90 px-3 py-2 text-xs">
					<span className="text-neutral-400">
						终端进程已退出{exitCode !== null ? ` (退出代码: ${exitCode})` : ""}
					</span>
					<button
						type="button"
						onClick={handleReconnect}
						className="flex items-center gap-1.5 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
					>
						<RefreshCw size={12} />
						重新连接终端
					</button>
				</div>
			)}

			{/* Terminal Right-Click Context Menu */}
			{contextMenu && (
				<div
					className="fixed inset-0 z-50"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) setContextMenu(null);
					}}
				>
					<div
						style={{ left: contextMenu.x, top: contextMenu.y }}
						className="fixed z-50 min-w-40 rounded-md border border-neutral-800 bg-neutral-900 py-1 text-xs shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<button
							type="button"
							onClick={handleCopy}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 hover:text-white"
						>
							<ClipboardCopy size={13} className="text-neutral-400" />
							复制选中内容
						</button>
						<button
							type="button"
							onClick={handlePaste}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 hover:text-white"
						>
							<ClipboardPaste size={13} className="text-neutral-400" />
							粘贴至终端
						</button>
						<button
							type="button"
							onClick={() => {
								setContextMenu(null);
								captureSelection();
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 hover:text-white"
						>
							<MessageSquareQuote size={13} className="text-indigo-400" />
							引用至批注 (Cmd+Shift+A)
						</button>
						<div className="my-1 border-t border-neutral-800" />
						<button
							type="button"
							onClick={handleClear}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 hover:text-white"
						>
							<Eraser size={13} className="text-neutral-400" />
							清屏
						</button>
						{phase === "exited" && (
							<>
								<div className="my-1 border-t border-neutral-800" />
								<button
									type="button"
									onClick={() => {
										setContextMenu(null);
										handleReconnect();
									}}
									className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-indigo-400 hover:bg-indigo-950/40 hover:text-indigo-300"
								>
									<RefreshCw size={13} />
									重新连接终端
								</button>
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
