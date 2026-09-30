/**
 * [E] Full-page Agent Terminal (center view).
 * Opens a dedicated login shell with alias injection (omp/claude/codex) via drawer_spawn.
 * Binds app theme (bindXtermTheme), supports text search, selection capture to composer
 * annotations or side-chat forks, and persists across center-view navigation.
 */
import { homeDir } from "@tauri-apps/api/path";
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
	Folder,
	GitBranch,
	MessageSquareQuote,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { onTerminalData, onTerminalExit } from "../../lib/events";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	appPaths,
	createSideChat,
	termClose,
	termOpen,
	termResize,
	termWrite,
	terminalSetCurrentSession,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import {
	destroyAgentTerminal,
	getAgentTerminal,
	setAgentTerminal,
	type AgentTerminalEntry,
	type TerminalPhase as Phase,
} from "./terminalRegistry";
import { bindXtermTheme, currentXtermTheme } from "./terminalTheme";

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

/** Default cwd: selected session → global workspace dir → $HOME. */
async function resolveCwd(): Promise<string> {
	const sessionId = useUi.getState().selectedSessionId;
	const session = sessionId ? useSessions.getState().sessions[sessionId] : undefined;
	if (session?.cwd) return session.cwd;
	try {
		const paths = await appPaths();
		if (paths?.globalDir) return paths.globalDir;
	} catch {
		/* fall through to home */
	}
	try {
		return (await homeDir()) || "/";
	} catch {
		return "/";
	}
}

export function AgentTerminalPage() {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const lastSessionId = useUi((s) => s.lastSessionId);
	const parentSessionId = selectedSessionId || lastSessionId;
	const setCenter = useUi((s) => s.setCenter);
	const addAnnotation = useComposer((s) => s.addAnnotation);

	const hostRef = useRef<HTMLDivElement | null>(null);
	const [phase, setPhase] = useState<Phase>("opening");
	const [error, setError] = useState<string | null>(null);
	const [exitCode, setExitCode] = useState<number | null>(null);
	const [terminalCwd, setTerminalCwd] = useState<string>("");
	const [copied, setCopied] = useState(false);
	const [restartTick, setRestartTick] = useState(0);
	const [hasSelection, setHasSelection] = useState(false);

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
	const searchButtonRef = useRef<HTMLButtonElement | null>(null);
	// Context menu state
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);

	// Esc keys
	useEscapeKey(() => setContextMenu(null), contextMenu !== null);
	useEscapeKey(() => {
		if (searchOpen) {
			const entry = getAgentTerminal();
			entry?.search.clearDecorations();
			setSearchOpen(false);
			setSearchResult(null);
			entry?.term.focus();
		}
	}, searchOpen && contextMenu === null);

	const captureSelection = useCallback(() => {
		const entry = getAgentTerminal();
		const text = entry?.term.getSelection()?.trim();
		if (!text) {
			toast.info("未选中任何终端文本");
			return;
		}
		if (parentSessionId) {
			addAnnotation(parentSessionId, { source: "terminal", text });
			setCopied(true);
			toast.success("已将选中内容添加至批注");
			setTimeout(() => setCopied(false), 1500);
		} else {
			void copyText(text);
			setCopied(true);
			toast.success("已复制选中内容");
			setTimeout(() => setCopied(false), 1500);
		}
	}, [addAnnotation, parentSessionId]);

	const handleSendToSideChat = useCallback(async () => {
		const entry = getAgentTerminal();
		const sel = entry?.term.getSelection()?.trim();
		if (!sel || !parentSessionId) {
			toast.info("未选中任何终端文本");
			return;
		}
		setContextMenu(null);
		try {
			await createSideChat(parentSessionId, "终端输出", sel);
			void useSessions.getState().load().catch(() => {});
			useUi.getState().setRightTab("sidechat");
			toast.success("已发送到侧聊");
		} catch (e) {
			toast.error(`发送到侧聊失败: ${errMsg(e)}`);
		}
	}, [parentSessionId]);

	const handleClose = useCallback(async () => {
		const entry = getAgentTerminal();
		if (entry && entry.phase === "ready") {
			const ok = await confirmDialog(
				"确定要关闭 Agent 终端吗？正在运行的后台任务将被终止。",
				{
					title: "关闭 Agent 终端",
					okLabel: "关闭终端",
					danger: true,
				},
			);
			if (!ok) return;
		}
		destroyAgentTerminal();
		const prev = useUi.getState().previousCenterView ?? (selectedSessionId ? "session" : "home");
		setCenter(prev === "agentTerminal" ? (selectedSessionId ? "session" : "home") : prev);
	}, [selectedSessionId, setCenter]);

	const handleReconnect = useCallback(() => {
		destroyAgentTerminal();
		setPhase("opening");
		setError(null);
		setExitCode(null);
		setRestartTick((t) => t + 1);
	}, []);

	// Search actions
	const handleFindNext = useCallback(() => {
		const entry = getAgentTerminal();
		if (!entry || !searchQuery) return;
		entry.search.findNext(searchQuery, {
			caseSensitive: searchCaseSensitive,
			wholeWord: searchWholeWord,
			regex: searchRegex,
			decorations: SEARCH_DECORATIONS,
		});
	}, [searchQuery, searchCaseSensitive, searchWholeWord, searchRegex]);

	const handleFindPrevious = useCallback(() => {
		const entry = getAgentTerminal();
		if (!entry || !searchQuery) return;
		entry.search.findPrevious(searchQuery, {
			caseSensitive: searchCaseSensitive,
			wholeWord: searchWholeWord,
			regex: searchRegex,
			decorations: SEARCH_DECORATIONS,
		});
	}, [searchQuery, searchCaseSensitive, searchWholeWord, searchRegex]);

	// Terminal setup & lifecycle
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		let observer: ResizeObserver | null = null;
		const existing = getAgentTerminal();

		// If existing running terminal found, reattach DOM element
		if (existing && existing.term.element) {
			if (existing.term.element.parentElement !== host) {
				host.appendChild(existing.term.element);
			}
			setPhase(existing.phase);
			setExitCode(existing.exitCode);
			setError(existing.error);
			setTerminalCwd(existing.cwd);

			const unbindTheme = bindXtermTheme(existing.term);
			const selSub = existing.term.onSelectionChange(() => {
				setHasSelection(existing.term.hasSelection());
			});

			existing.onExit = (code: number | null) => {
				setPhase("exited");
				setExitCode(code);
			};

			const searchSub = existing.search.onDidChangeResults((e) => {
				setSearchResult({
					index: e.resultIndex,
					count: e.resultCount,
				});
			});

			observer = new ResizeObserver(() => {
				try {
					existing.fit.fit();
					if (existing.termId && existing.term.cols > 0 && existing.term.rows > 0) {
						void termResize(existing.termId, existing.term.cols, existing.term.rows).catch(() => {});
					}
				} catch {}
			});
			observer.observe(host);
			existing.fit.fit();
			existing.term.focus();

			return () => {
				unbindTheme();
				selSub.dispose();
				searchSub.dispose();
				observer?.disconnect();
				if (existing) existing.onExit = undefined;
				if (existing.term.element && host.contains(existing.term.element)) {
					host.removeChild(existing.term.element);
				}
			};
		}

		// Otherwise spawn a brand new agent terminal instance
		let disposed = false;
		let failed = false;
		let unregisteredCleaned = false;
		const unlisteners: Array<() => void> = [];

		const term = new Terminal({
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			fontSize: 12,
			cursorBlink: true,
			scrollback: 5000,
			theme: currentXtermTheme(),
		});
		const unbindTheme = bindXtermTheme(term);
		const fit = new FitAddon();
		const search = new SearchAddon();
		term.loadAddon(fit);
		term.loadAddon(search);
		term.open(host);
		fit.fit();

		const selSub = term.onSelectionChange(() => {
			setHasSelection(term.hasSelection());
		});

		const searchSub = search.onDidChangeResults((e) => {
			setSearchResult({
				index: e.resultIndex,
				count: e.resultCount,
			});
		});

		let currentTermId: string | null = null;

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
			unbindTheme();
			try {
				selSub.dispose();
			} catch {}
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

		const initAndOpen = async () => {
			try {
				const cwd = await resolveCwd();
				if (disposed) return;
				setTerminalCwd(cwd);

				// Sync current session for drawer / alias auto-resume
				const activeSessionFile = parentSessionId
					? useSessions.getState().sessions[parentSessionId]?.file ?? null
					: null;
				void terminalSetCurrentSession(activeSessionFile).catch(() => {});

				// Spawn PTY with empty command to trigger alias injection via drawer_spawn
				const id = await termOpen(cwd, [], term.cols || 80, term.rows || 24);
				if (disposed) {
					void termClose(id).catch(() => {});
					cleanupUnregistered();
					return;
				}
				currentTermId = id;
				setPhase("ready");
				term.focus();

				const newEntry: AgentTerminalEntry = {
					termId: id,
					term,
					fit,
					search,
					cwd,
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
				setAgentTerminal(newEntry);
			} catch (e) {
				failed = true;
				cleanupUnregistered();
				if (!disposed) {
					const msg = errMsg(e);
					setError(msg);
					setPhase("error");
					toast.error(`Agent 终端启动失败: ${msg}`);
				}
			}
		};

		const subs = async () => {
			try {
				const unData = await onTerminalData((p) => {
					const active = getAgentTerminal();
					if (p.termId === currentTermId || (active && p.termId === active.termId)) {
						term.write(decodeBase64(p.data));
					}
				});
				const unExit = await onTerminalExit((p) => {
					const active = getAgentTerminal();
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
		void initAndOpen();

		return () => {
			disposed = true;
			unbindTheme();
			try {
				selSub.dispose();
			} catch {}
			searchSub.dispose();
			observer?.disconnect();
			const active = getAgentTerminal();
			if (active) {
				active.onExit = undefined;
				if (term.element && host.contains(term.element)) {
					host.removeChild(term.element);
				}
			} else {
				cleanupUnregistered();
			}
		};
	}, [restartTick, captureSelection, handleSendToSideChat, parentSessionId]);

	// Context menu actions
	const handleCopy = async () => {
		const entry = getAgentTerminal();
		setContextMenu(null);
		const sel = entry?.term.getSelection();
		if (sel) {
			await copyText(sel);
			toast.success("已复制选中内容");
		}
	};

	const handlePaste = async () => {
		const entry = getAgentTerminal();
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
		const entry = getAgentTerminal();
		setContextMenu(null);
		entry?.term.clear();
	};

	return (
		<div className="relative flex h-full flex-col bg-[var(--bg)]">
			{/* Top action header */}
			<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-divider)] px-3.5 py-1.5 text-xs vibrancy-chrome">
				<div className="flex items-center gap-2 min-w-0">
					<span className="shrink-0 font-semibold text-neutral-200">
						Agent 终端
					</span>
					{terminalCwd && (
						<span
							className="flex items-center gap-1 text-[11px] text-neutral-400 font-mono truncate max-w-[280px] md:max-w-[420px]"
							title={`工作目录: ${terminalCwd}`}
						>
							<Folder size={12} className="text-neutral-500 shrink-0" />
							<span className="truncate">{terminalCwd}</span>
						</span>
					)}
				</div>

				{phase === "ready" && (
					<span className="shrink-0 flex items-center gap-1 text-emerald-400">
						<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
						已就绪
					</span>
				)}
				{phase === "opening" && (
					<span className="shrink-0 text-sky-400">正在连接…</span>
				)}
				{phase === "exited" && (
					<span className="shrink-0 text-neutral-400">
						已退出{exitCode !== null ? ` (code ${exitCode})` : ""}
					</span>
				)}
				{phase === "error" && (
					<span className="shrink-0 text-rose-400">连接错误</span>
				)}

				<div className="flex-1 min-w-1" />

				{/* Search toggle */}
				<button
					ref={searchButtonRef}
					type="button"
					onClick={() => {
						setSearchOpen((o) => {
							const next = !o;
							if (!next) {
								getAgentTerminal()?.search.clearDecorations();
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

				{hasSelection && (
					<button
						type="button"
						className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 transition-colors focus:opacity-100"
						disabled={phase !== "ready"}
						onClick={captureSelection}
						title={parentSessionId ? "将选中内容加入批注 (Cmd+Shift+A)" : "复制选中内容"}
					>
						{copied ? "已复制" : parentSessionId ? "引用选中" : "复制选中"}
					</button>
				)}

				{hasSelection && parentSessionId && (
					<button
						type="button"
						className="shrink-0 flex items-center gap-1 rounded border border-amber-600/40 bg-amber-500/10 px-2 py-0.5 text-amber-300 hover:bg-amber-500/20 transition-colors focus:opacity-100"
						onClick={handleSendToSideChat}
						title="将选中终端文本发送到侧聊"
					>
						<GitBranch size={12} />
						<span>发送到侧聊</span>
					</button>
				)}

				<button
					type="button"
					className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors focus:opacity-100"
					onClick={handleClear}
					title="清空终端屏幕"
				>
					<Eraser size={12} />
				</button>

				<button
					type="button"
					className="shrink-0 flex items-center gap-1 rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors focus:opacity-100"
					onClick={handleClose}
					title="关闭终端页面"
				>
					<X size={13} />
					<span>关闭</span>
				</button>
			</div>

			{/* Floating Search Bar (Cmd+F) */}
			<FloatingLayer
				anchor={searchOpen ? (searchButtonRef.current ?? { x: window.innerWidth - 20, y: 40 }) : null}
				placement="bottom-end"
				layer="popover"
				offset={4}
				onDismiss={() => {
					getAgentTerminal()?.search.clearDecorations();
					setSearchOpen(false);
					setSearchResult(null);
					getAgentTerminal()?.term.focus();
				}}
				ignoreRefs={[searchButtonRef]}
				className="flex max-w-[calc(100vw-32px)] flex-wrap items-center gap-1.5 p-1.5 shadow-apple-modal"
			>
				<div
					className="flex items-center gap-1.5"
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							getAgentTerminal()?.search.clearDecorations();
							setSearchOpen(false);
							setSearchResult(null);
							getAgentTerminal()?.term.focus();
						}
					}}
				>
					<div className="relative flex min-w-44 flex-1 items-center">
						<input
							ref={searchInputRef}
							type="text"
							value={searchQuery}
							onChange={(e) => {
								setSearchQuery(e.target.value);
								if (!e.target.value) {
									getAgentTerminal()?.search.clearDecorations();
									setSearchResult(null);
								} else {
									const entry = getAgentTerminal();
									entry?.search.findNext(e.target.value, {
										caseSensitive: searchCaseSensitive,
										wholeWord: searchWholeWord,
										regex: searchRegex,
										decorations: SEARCH_DECORATIONS,
									});
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
							placeholder="在终端回滚中搜索…"
							className="w-full rounded-lg bg-[var(--well-bg)] px-2 py-1 text-xs text-[var(--text)] placeholder-neutral-500 outline-none border border-[var(--border-divider)] focus:border-indigo-500"
						/>
					</div>

					{searchResult && (
						<span className="shrink-0 px-1 text-[11px] text-neutral-400">
							{searchResult.count > 0
								? `${searchResult.index + 1} / ${searchResult.count}`
								: "无结果"}
						</span>
					)}

					<div className="flex items-center gap-0.5 border-l border-[var(--border-divider)] pl-1">
						<button
							type="button"
							onClick={handleFindPrevious}
							disabled={!searchQuery}
							className="rounded p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-30"
							title="上一个匹配 (Shift+Enter)"
						>
							<ArrowUp size={13} />
						</button>
						<button
							type="button"
							onClick={handleFindNext}
							disabled={!searchQuery}
							className="rounded p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-30"
							title="下一个匹配 (Enter)"
						>
							<ArrowDown size={13} />
						</button>
					</div>

					<div className="flex items-center gap-0.5 border-l border-[var(--border-divider)] pl-1 text-[10px]">
						<button
							type="button"
							onClick={() => setSearchCaseSensitive((v) => !v)}
							className={clsx(
								"rounded px-1.5 py-0.5 font-mono font-medium transition-colors",
								searchCaseSensitive
									? "bg-indigo-600 text-white"
									: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
							)}
							title="区分大小写 (Alt+C)"
						>
							Aa
						</button>
						<button
							type="button"
							onClick={() => setSearchWholeWord((v) => !v)}
							className={clsx(
								"rounded px-1.5 py-0.5 font-mono font-medium transition-colors",
								searchWholeWord
									? "bg-indigo-600 text-white"
									: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
							)}
							title="全字匹配 (Alt+W)"
						>
							\b
						</button>
						<button
							type="button"
							onClick={() => setSearchRegex((v) => !v)}
							className={clsx(
								"rounded px-1.5 py-0.5 font-mono font-medium transition-colors",
								searchRegex
									? "bg-indigo-600 text-white"
									: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
							)}
							title="正则表达式 (Alt+R)"
						>
							.*
						</button>
					</div>

					<button
						type="button"
						onClick={() => {
							getAgentTerminal()?.search.clearDecorations();
							setSearchOpen(false);
							setSearchResult(null);
							getAgentTerminal()?.term.focus();
						}}
						className="rounded p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
						title="关闭搜索 (Esc)"
					>
						<X size={13} />
					</button>
				</div>
			</FloatingLayer>

			{/* Terminal mounting container */}
			<div
				ref={hostRef}
				onContextMenu={(e) => {
					e.preventDefault();
					setContextMenu({ x: e.clientX, y: e.clientY });
				}}
				className={clsx(
					"min-h-0 flex-1 px-1",
					phase === "error" && "hidden",
				)}
			/>

			{/* Error banner */}
			{phase === "error" && (
				<div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
					<div className="max-w-md rounded-lg border border-red-500/30 bg-red-950/20 p-4">
						<h3 className="text-sm font-semibold text-red-300">
							Agent 终端启动失败
						</h3>
						<p className="mt-1 text-xs text-neutral-300">
							{error ?? "未能成功连接至终端底层进程。"}
						</p>
						<div className="mt-4 flex justify-center gap-2">
							<button
								type="button"
								onClick={handleReconnect}
								className="flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
							>
								<RefreshCw size={13} />
								重试
							</button>
							<button
								type="button"
								onClick={handleClose}
								className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 transition-colors"
							>
								返回主视图
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Exited floating bottom banner */}
			{phase === "exited" && (
				<div className="shrink-0 flex items-center justify-between border-t border-[var(--border-divider)] bg-neutral-900/90 px-3 py-2 text-xs">
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
			<FloatingLayer
				anchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
				layer="menu"
				placement="bottom-start"
				offset={2}
				onDismiss={() => setContextMenu(null)}
				className="min-w-40 py-1 text-xs shadow-apple-modal"
			>
				{contextMenu && (
					<>
						<button
							type="button"
							onClick={handleCopy}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
						>
							<ClipboardCopy size={13} className="text-neutral-400" />
							复制选中内容
						</button>
						<button
							type="button"
							onClick={handlePaste}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
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
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
						>
							<MessageSquareQuote size={13} className="text-indigo-400" />
							{parentSessionId ? "引用至批注 (Cmd+Shift+A)" : "复制选中内容"}
						</button>
						{parentSessionId && (
							<button
								type="button"
								onClick={handleSendToSideChat}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
							>
								<GitBranch size={13} className="text-amber-400" />
								发送到侧聊
							</button>
						)}
						<div className="my-1 border-t border-[var(--border-divider)]" />
						<button
							type="button"
							onClick={handleClear}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
						>
							<Eraser size={13} className="text-neutral-400" />
							清屏
						</button>
						{phase === "exited" && (
							<>
								<div className="my-1 border-t border-[var(--border-divider)]" />
								<button
									type="button"
									onClick={() => {
										setContextMenu(null);
										handleReconnect();
									}}
									className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300 transition-colors"
								>
									<RefreshCw size={13} />
									重新连接终端
								</button>
							</>
						)}
						<div className="my-1 border-t border-[var(--border-divider)]" />
						<button
							type="button"
							onClick={() => {
								setContextMenu(null);
								void handleClose();
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
						>
							<X size={13} />
							关闭终端
						</button>
					</>
				)}
			</FloatingLayer>
		</div>
	);
}
