/**
 * [E] Global bottom-drawer terminal (Codex-style) for arbitrary shells and
 * human input (secrets/answers) while an agent works. Fixed overlay sliding
 * up from the bottom edge (z-40, below modals); multiple tabs, each a login
 * shell PTY via term_open(cwd, [], cols, rows). PTYs persist while the
 * drawer is closed or across tab switches; closing a tab explicitly kills
 * its PTY. Toggle: Cmd+` (Ctrl+` on non-mac) or the topbar "终端" button.
 * Esc deliberately does NOT close the drawer (it is a terminal key).
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
	ChevronDown,
	ClipboardCopy,
	ClipboardPaste,
	Eraser,
	Maximize2,
	Minimize2,
	Minus,
	Plus,
	RefreshCw,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { appPaths, termClose, termOpen, termResize, termWrite, terminalSetCurrentSession } from "../../lib/ipc";
import { isComposing } from "../../lib/hooks";
import { basename } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import {
	useDrawerStore,
	type DrawerTab,
} from "./drawerStore";
import {
	destroyDrawerTerminal,
	drawerRegistry,
	ensureDrawerEventBridge,
	type DrawerTerminalEntry,
} from "./drawerRegistry";
import { bindXtermTheme } from "./terminalTheme";

const SEARCH_DECORATIONS = {
	matchBackground: "#3b4252",
	activeMatchBackground: "#4f46e5",
	matchOverviewRuler: "#434c5e",
	activeMatchColorOverviewRuler: "#6366f1",
};

const STATUS_DOT: Record<DrawerTab["status"], string> = {
	opening: "bg-sky-400 animate-pulse",
	ready: "bg-emerald-400",
	exited: "bg-neutral-600",
	error: "bg-red-500",
};

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

export function TerminalDrawer() {
	const open = useDrawerStore((s) => s.open);
	const height = useDrawerStore((s) => s.height);
	const maximized = useDrawerStore((s) => s.maximized);
	const tabs = useDrawerStore((s) => s.tabs);
	const activeTabId = useDrawerStore((s) => s.activeTabId);
	const setOpen = useDrawerStore((s) => s.setOpen);
	const setHeight = useDrawerStore((s) => s.setHeight);
	const setMaximized = useDrawerStore((s) => s.setMaximized);
	const toggleMaximized = useDrawerStore((s) => s.toggleMaximized);
	const updateTab = useDrawerStore((s) => s.updateTab);
	const removeTab = useDrawerStore((s) => s.removeTab);
	const detachTab = useDrawerStore((s) => s.detachTab);

	const visibleTabs = tabs.filter((t) => !t.detached);
	const activeTab = visibleTabs.find((t) => t.id === activeTabId) ?? null;
	const activeEntry = activeTabId ? drawerRegistry.get(activeTabId) : undefined;

	const hostRefs = useRef<Map<string, HTMLDivElement>>(new Map());
	const ensuringTabRef = useRef(false);
	const dragActiveRef = useRef(false);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const [hydrated, setHydrated] = useState(false);
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

	// Search bar state (operates on the active tab's entry)
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
	const [searchWholeWord, setSearchWholeWord] = useState(false);
	const [searchRegex, setSearchRegex] = useState(false);
	const [searchResult, setSearchResult] = useState<{ index: number; count: number } | null>(null);

	// Hydrate persisted state once + start the shared event bridge
	useEffect(() => {
		useDrawerStore.getState().hydrate();
		ensureDrawerEventBridge();
		setHydrated(true);
	}, []);

	// Global toggle: Cmd+` (Meta+Backquote) / Ctrl+Backquote elsewhere
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
			if (e.key !== "`" && e.code !== "Backquote") return;
			e.preventDefault();
			useDrawerStore.getState().toggle();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const handleNewTab = useCallback(async () => {
		const cwd = await resolveCwd();
		useDrawerStore.getState().addTab(cwd, basename(cwd));
	}, []);

	// Opening the drawer with no visible tabs spawns the first shell
	useEffect(() => {
		if (!open || !hydrated) return;
		const hasVisible = useDrawerStore.getState().tabs.some((t) => !t.detached);
		if (hasVisible) return;
		if (ensuringTabRef.current) return;
		ensuringTabRef.current = true;
		void handleNewTab().finally(() => {
			ensuringTabRef.current = false;
		});
	}, [open, hydrated, handleNewTab]);

	// Focus the active terminal whenever the drawer opens
	useEffect(() => {
		if (!open) return;
		const timer = setTimeout(() => {
			const id = useDrawerStore.getState().activeTabId;
			const entry = id ? drawerRegistry.get(id) : undefined;
			entry?.term.focus();
		}, 220);
		return () => clearTimeout(timer);
	}, [open]);

	/** Create the xterm instance + PTY for a tab and register it. */
	const createTerminal = useCallback((tab: DrawerTab, host: HTMLDivElement) => {
		if (drawerRegistry.has(tab.id)) return;
		const term = new Terminal({
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			fontSize: 12,
			cursorBlink: true,
			scrollback: 5000,
		});
		const themeSub = bindXtermTheme(term);
		const fit = new FitAddon();
		const search = new SearchAddon();
		term.loadAddon(fit);
		term.loadAddon(search);
		term.open(host);
		try {
			fit.fit();
		} catch {}

		// Cmd+F opens the search bar instead of feeding the shell
		term.attachCustomKeyEventHandler((e) => {
			if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
				setSearchOpen(true);
				setTimeout(() => searchInputRef.current?.focus(), 50);
				return false;
			}
			return true;
		});

		const dataSub = term.onData((data) => {
			const entry = drawerRegistry.get(tab.id);
			if (entry?.termId) void termWrite(entry.termId, data).catch(() => {});
		});

		// Lives as long as the xterm instance; disposed with the terminal
		search.onDidChangeResults((e) => {
			if (useDrawerStore.getState().activeTabId !== tab.id) return;
			setSearchResult({ index: e.resultIndex, count: e.resultCount });
		});

		const observer = new ResizeObserver(() => {
			try {
				if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
				fit.fit();
				const entry = drawerRegistry.get(tab.id);
				if (entry?.termId && term.cols > 2 && term.rows > 1) {
					void termResize(entry.termId, term.cols, term.rows).catch(() => {});
				}
			} catch {}
		});
		observer.observe(host);

		void (async () => {
			try {
				// Prefer the currently selected session's cwd/file over the stored
				// tab cwd so a restored or freshly spawned shell lands in the
				// session context (agent-aware init resumes its transcript).
				const selected = useUi.getState().selectedSessionId;
				const session = selected ? useSessions.getState().sessions[selected] : undefined;
				void terminalSetCurrentSession(session?.file ?? null).catch(() => {});
				const cwd = session?.cwd || tab.cwd || (await resolveCwd());
				if (cwd !== tab.cwd) {
					useDrawerStore.getState().updateTab(tab.id, { cwd, title: basename(cwd) });
				}
				const id = await termOpen(cwd, [], term.cols || 80, term.rows || 24);
				// Tab may have been closed while the spawn was in flight
				if (!useDrawerStore.getState().tabs.some((t) => t.id === tab.id)) {
					void termClose(id).catch(() => {});
					return;
				}
				const entry: DrawerTerminalEntry = {
					termId: id,
					term,
					fit,
					search,
					observer,
					dataSub,
					themeSub,
					phase: "ready",
					exitCode: null,
					error: null,
				};
				drawerRegistry.set(tab.id, entry);
				useDrawerStore.getState().updateTab(tab.id, { status: "ready", exitCode: null });
				term.focus();
			} catch (e) {
				const msg = errMsg(e);
				const entry: DrawerTerminalEntry = {
					termId: null,
					term,
					fit,
					search,
					observer,
					dataSub,
					themeSub,
					phase: "error",
					exitCode: null,
					error: msg,
				};
				drawerRegistry.set(tab.id, entry);
				useDrawerStore.getState().updateTab(tab.id, { status: "error", exitCode: null });
				toast.error(`命令终端启动失败: ${msg}`);
			}
		})();
	}, []);

	// Ensure the active tab has a terminal; reattach on tab switches
	useEffect(() => {
		if (!open || !activeTabId) return;
		const tab = visibleTabs.find((t) => t.id === activeTabId);
		const host = hostRefs.current.get(activeTabId);
		if (!tab || !host) return;
		const existing = drawerRegistry.get(tab.id);
		if (existing) {
			if (existing.term.element && existing.term.element.parentElement !== host) {
				host.appendChild(existing.term.element);
			}
			// Refit after the tab becomes visible again and update PTY size
			const raf = requestAnimationFrame(() => {
				try {
					existing.fit.fit();
					if (existing.termId && existing.term.cols > 0 && existing.term.rows > 0) {
						void termResize(
							existing.termId,
							existing.term.cols,
							existing.term.rows,
						).catch(() => {});
					}
				} catch {}
			});
			existing.term.focus();
			return () => cancelAnimationFrame(raf);
		}
		createTerminal(tab, host);
	}, [open, activeTabId, visibleTabs, createTerminal]);

	// Detach a tab to headless background service
	const handleDetachTab = useCallback(
		(tabId: string) => {
			const host = hostRefs.current.get(tabId);
			const entry = drawerRegistry.get(tabId);
			if (entry?.term.element && host && host.contains(entry.term.element)) {
				host.removeChild(entry.term.element);
			}
			hostRefs.current.delete(tabId);
			detachTab(tabId);
			toast.success("已折叠为后台服务（可在右侧「服务」面板查看与恢复）");
		},
		[detachTab],
	);

	// Close a tab: confirm-kill a running PTY, then drop tab + terminal
	const handleCloseTab = useCallback(
		async (tabId: string) => {
			const entry = drawerRegistry.get(tabId);
			if (entry && entry.phase === "ready") {
				const ok = await confirmDialog("终止此终端中正在运行的进程？", {
					danger: true,
					title: "关闭终端",
					okLabel: "终止并关闭",
				});
				if (!ok) return;
			}
			destroyDrawerTerminal(tabId);
			const remainingVisible = useDrawerStore
				.getState()
				.tabs.filter((t) => !t.detached && t.id !== tabId).length;
			removeTab(tabId);
			// Closing the last visible tab also collapses the drawer
			if (remainingVisible === 0) setOpen(false);
		},
		[removeTab, setOpen],
	);

	const handleReconnect = useCallback(
		(tabId: string) => {
			destroyDrawerTerminal(tabId);
			updateTab(tabId, { status: "opening", exitCode: null });
		},
		[updateTab],
	);

	// When maximized state changes, refit the active terminal
	useEffect(() => {
		if (!open || !activeTabId) return;
		const entry = drawerRegistry.get(activeTabId);
		if (!entry) return;
		const timer = setTimeout(() => {
			try {
				entry.fit.fit();
				if (entry.termId && entry.term.cols > 0 && entry.term.rows > 0) {
					void termResize(entry.termId, entry.term.cols, entry.term.rows).catch(() => {});
				}
			} catch {}
		}, 50);
		return () => clearTimeout(timer);
	}, [maximized, open, activeTabId]);
	// Drag the top edge to resize (disable text selection while dragging)
	const onDragStart = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		if (useDrawerStore.getState().maximized) {
			setMaximized(false);
		}
		dragActiveRef.current = true;
		document.body.style.userSelect = "none";
		document.body.style.cursor = "row-resize";
	}, [setMaximized]);

	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!dragActiveRef.current) return;
			setHeight(window.innerHeight - e.clientY - 28);
		};
		const onUp = () => {
			if (!dragActiveRef.current) return;
			dragActiveRef.current = false;
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		};
	}, [setHeight]);

	// Search actions on the active tab's entry
	const handleFindNext = useCallback(() => {
		if (!activeEntry || !searchQuery) return;
		activeEntry.search.findNext(searchQuery, {
			caseSensitive: searchCaseSensitive,
			wholeWord: searchWholeWord,
			regex: searchRegex,
			incremental: true,
			decorations: SEARCH_DECORATIONS,
		});
	}, [activeEntry, searchQuery, searchCaseSensitive, searchWholeWord, searchRegex]);

	const handleFindPrevious = useCallback(() => {
		if (!activeEntry || !searchQuery) return;
		activeEntry.search.findPrevious(searchQuery, {
			caseSensitive: searchCaseSensitive,
			wholeWord: searchWholeWord,
			regex: searchRegex,
			decorations: SEARCH_DECORATIONS,
		});
	}, [activeEntry, searchQuery, searchCaseSensitive, searchWholeWord, searchRegex]);

	const closeSearch = useCallback(() => {
		const id = useDrawerStore.getState().activeTabId;
		const entry = id ? drawerRegistry.get(id) : undefined;
		entry?.search.clearDecorations();
		setSearchOpen(false);
		setSearchResult(null);
		entry?.term.focus();
	}, []);

	// Context menu actions on the active tab
	const handleCopy = useCallback(async () => {
		setContextMenu(null);
		const sel = activeEntry?.term.getSelection();
		if (sel) {
			await copyText(sel);
			toast.success("已复制选中内容");
		}
	}, [activeEntry]);

	const handlePaste = useCallback(async () => {
		setContextMenu(null);
		if (!activeEntry?.termId) return;
		try {
			const text = await navigator.clipboard.readText();
			if (text) {
				await termWrite(activeEntry.termId, text);
			}
		} catch (e) {
			toast.error(`粘贴失败: ${errMsg(e)}`);
		}
	}, [activeEntry]);

	const handleClear = useCallback(() => {
		setContextMenu(null);
		activeEntry?.term.clear();
	}, [activeEntry]);

	return (
		<>
			{/* Drawer panel — always mounted so PTYs persist; slides via transform */}
			<div
				className="fixed left-0 right-0 z-40 flex flex-col border-t border-[var(--border-divider)] bg-[var(--bg-panel)] shadow-apple-modal"
				style={{
					height: maximized ? "calc(100vh - 38px)" : height,
					bottom: open ? (maximized ? 0 : 28) : 0,
					transform: open ? "translateY(0)" : "translateY(100%)",
					transition: "transform 200ms cubic-bezier(0.32, 0.72, 0, 1), height 150ms ease-out",
					pointerEvents: open ? "auto" : "none",
				}}
				aria-hidden={!open}
				inert={!open}
			>
				{/* Resize grab strip (hidden when maximized) */}
				{!maximized && (
					<div
						onMouseDown={onDragStart}
						className="h-1 w-full shrink-0 cursor-row-resize bg-transparent hover:bg-indigo-500/40"
						title="拖拽调节终端高度"
					/>
				)}

				{/* Header: tabs + actions */}
				<div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-divider)] bg-[var(--bg-active-fill)] px-2 py-1 text-xs select-none">
					<span className="shrink-0 px-1 text-[10px] font-medium tracking-wide text-neutral-500 uppercase">命令终端</span>
					<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
						{visibleTabs.map((tab) => (
							<div
								key={tab.id}
								onClick={() => useDrawerStore.getState().setActive(tab.id)}
								title={`工作目录: ${tab.cwd}`}
								className={clsx(
									"group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all active:scale-[0.98]",
									tab.id === activeTabId
										? "bg-[var(--bg-hover)] text-neutral-100 shadow-sm"
										: "text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200",
								)}
							>
								<span
									className={clsx(
										"h-1.5 w-1.5 shrink-0 rounded-full",
										STATUS_DOT[tab.status],
										tab.status === "ready" && "animate-pulse",
									)}
								/>
								<span className="max-w-[140px] truncate">{tab.title}</span>
								<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											handleDetachTab(tab.id);
										}}
										title="折叠为后台服务"
										className="rounded p-0.5 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-90 transition-all"
									>
										<Minus size={11} />
									</button>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											void handleCloseTab(tab.id);
										}}
										title="关闭此终端"
										className="rounded p-0.5 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-90 transition-all"
									>
										<X size={11} />
									</button>
								</div>
							</div>
						))}
						<button
							type="button"
							onClick={() => void handleNewTab()}
							title="新建终端"
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-95 transition-all"
						>
							<Plus size={14} />
						</button>
					</div>

					{/* Active tab status text */}
					{activeTab?.status === "opening" && (
						<span className="shrink-0 text-sky-400">正在连接…</span>
					)}
					{activeTab?.status === "ready" && (
						<span className="flex shrink-0 items-center gap-1 text-emerald-400">
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
							已连接
						</span>
					)}
					{activeTab?.status === "exited" && (
						<span className="shrink-0 text-neutral-400">
							已退出{activeTab.exitCode !== null ? ` (code ${activeTab.exitCode})` : ""}
						</span>
					)}

					{/* Maximize / restore toggle */}
					<button
						type="button"
						onClick={toggleMaximized}
						title={maximized ? "还原高度" : "最大化全屏"}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-95 transition-all"
					>
						{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						title="收起终端 (⌘`)，进程保持运行"
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200 active:scale-95 transition-all"
					>
						<ChevronDown size={14} />
					</button>
				</div>

				{/* Body: one host per tab, inactive tabs hidden (PTYs stay alive) */}
				<div className="relative min-h-0 flex-1">
					{visibleTabs.map((tab) => (
						<div
							key={tab.id}
							ref={(el) => {
								if (el) hostRefs.current.set(tab.id, el);
								else hostRefs.current.delete(tab.id);
							}}
							onContextMenu={(e) => {
								e.preventDefault();
								const menuWidth = 180;
								const menuHeight = 150;
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
								"absolute inset-0 px-1",
								tab.id !== activeTabId && "invisible pointer-events-none",
							)}
						/>
					))}

					{visibleTabs.length === 0 && (
						<div className="flex h-full items-center justify-center text-xs text-neutral-600">
							按 ⌘` 或点击 + 新建终端
						</div>
					)}

					{/* Exited banner with reconnect */}
					{activeTab?.status === "exited" && (
						<div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between border-t border-[var(--border-divider)] bg-[var(--bg-panel)]/95 backdrop-blur-md px-3 py-2 text-xs">
							<span className="text-neutral-400">
								终端进程已退出
								{activeTab.exitCode !== null ? ` (退出代码: ${activeTab.exitCode})` : ""}
							</span>
							<button
								type="button"
								onClick={() => handleReconnect(activeTab.id)}
								className="flex items-center gap-1.5 rounded-lg bg-[#0A84FF] px-2.5 py-1 font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-sm"
							>
								<RefreshCw size={12} />
								重新连接
							</button>
						</div>
					)}

					{/* Spawn failure banner */}
					{activeTab?.status === "error" && activeEntry?.error && (
						<div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between gap-3 border-t border-rose-800/40 bg-rose-950/40 backdrop-blur-md px-3 py-2 text-xs">
							<span className="min-w-0 truncate text-rose-300">
								本地终端启动失败: {activeEntry.error}
							</span>
							<button
								type="button"
								onClick={() => handleReconnect(activeTab.id)}
								className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#0A84FF] px-2.5 py-1 font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-sm"
							>
								<RefreshCw size={12} />
								重试
							</button>
						</div>
					)}

					{/* Floating search bar (Cmd+F) */}
					{searchOpen && (
						<div className="absolute right-3 top-2 z-20 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-1.5 rounded-xl vibrancy-popover shadow-apple-modal hairline p-1.5">
							<input
								ref={searchInputRef}
								type="text"
								value={searchQuery}
								onChange={(e) => {
									const val = e.target.value;
									setSearchQuery(val);
									if (activeEntry && val) {
										activeEntry.search.findNext(val, {
											caseSensitive: searchCaseSensitive,
											wholeWord: searchWholeWord,
											regex: searchRegex,
											incremental: true,
											decorations: SEARCH_DECORATIONS,
										});
									} else {
										activeEntry?.search.clearDecorations();
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
								className="w-44 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 text-xs text-neutral-200 outline-none focus:ring-1 focus:ring-[#0A84FF]/50"
							/>
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
								className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95 transition-all"
							>
								<ArrowUp size={13} />
							</button>
							<button
								type="button"
								onClick={handleFindNext}
								title="下一处匹配 (Enter)"
								className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95 transition-all"
							>
								<ArrowDown size={13} />
							</button>
							<div className="mx-0.5 h-3 w-px bg-[var(--border-divider)]" />
							<button
								type="button"
								onClick={() => setSearchCaseSensitive((v) => !v)}
								title="大小写匹配"
								className={clsx(
									"rounded-md px-1.5 py-0.5 text-[10px] font-mono transition-all active:scale-95",
									searchCaseSensitive
										? "bg-[#0A84FF] text-white"
										: "text-neutral-400 hover:bg-[var(--bg-hover)]",
								)}
							>
								Aa
							</button>
							<button
								type="button"
								onClick={() => setSearchWholeWord((v) => !v)}
								title="全字匹配"
								className={clsx(
									"rounded-md px-1.5 py-0.5 text-[10px] font-mono transition-all active:scale-95",
									searchWholeWord
										? "bg-[#0A84FF] text-white"
										: "text-neutral-400 hover:bg-[var(--bg-hover)]",
								)}
							>
								\b
							</button>
							<button
								type="button"
								onClick={() => setSearchRegex((v) => !v)}
								title="正则表达式"
								className={clsx(
									"rounded-md px-1.5 py-0.5 text-[10px] font-mono transition-all active:scale-95",
									searchRegex ? "bg-[#0A84FF] text-white" : "text-neutral-400 hover:bg-[var(--bg-hover)]",
								)}
							>
								.*
							</button>
							<button
								type="button"
								onClick={closeSearch}
								title="关闭搜索 (Esc)"
								className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95 transition-all"
							>
								<X size={13} />
							</button>
						</div>
					)}
				</div>

				{/* Right-click context menu (no annotation capture — that is session-only) */}
				{contextMenu && (
					<div
						className="fixed inset-0 z-50"
						onMouseDown={(e) => {
							if (e.target === e.currentTarget) setContextMenu(null);
						}}
					>
						<div
							style={{ left: contextMenu.x, top: contextMenu.y }}
							className="fixed z-50 min-w-40 rounded-xl vibrancy-popover shadow-apple-modal hairline py-1 text-xs"
							onClick={(e) => e.stopPropagation()}
						>
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
								onClick={() => void handlePaste()}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
							>
								<ClipboardPaste size={13} className="text-neutral-400" />
								粘贴至终端
							</button>
							<div className="my-1 border-t border-[var(--border-divider)]" />
							<button
								type="button"
								onClick={handleClear}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
							>
								<Eraser size={13} className="text-neutral-400" />
								清屏
							</button>
						</div>
					</div>
				)}
			</div>

		</>
	);
}
