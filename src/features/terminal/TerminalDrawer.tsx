/**
 * [E] Global bottom-drawer terminal (Codex-style) for arbitrary shells and
 * human input (secrets/answers) while an agent works. Fixed overlay sliding
 * up from the bottom edge (z-40, below modals); multiple tabs, each a login
 * shell PTY via term_open(cwd, [], cols, rows). PTYs persist while the
 * drawer is closed or across tab switches; closing a tab explicitly kills
 * its PTY. Toggle: Cmd+` (Ctrl+` on non-mac) or the bottom handle pill.
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
	Plus,
	RefreshCw,
	TerminalSquare,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { appPaths, termClose, termOpen, termResize, termWrite } from "../../lib/ipc";
import { isComposing } from "../../lib/hooks";
import { basename } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import {
	MAXIMIZED_DRAWER_HEIGHT_VH,
	DEFAULT_DRAWER_HEIGHT_VH,
	useDrawerStore,
	type DrawerTab,
} from "./drawerStore";
import {
	destroyDrawerTerminal,
	drawerRegistry,
	ensureDrawerEventBridge,
	type DrawerTerminalEntry,
} from "./drawerRegistry";

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
	const tabs = useDrawerStore((s) => s.tabs);
	const activeTabId = useDrawerStore((s) => s.activeTabId);
	const setOpen = useDrawerStore((s) => s.setOpen);
	const setHeight = useDrawerStore((s) => s.setHeight);
	const updateTab = useDrawerStore((s) => s.updateTab);
	const removeTab = useDrawerStore((s) => s.removeTab);

	const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
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

	// Opening the drawer with no tabs spawns the first shell
	useEffect(() => {
		if (!open || !hydrated) return;
		if (useDrawerStore.getState().tabs.length > 0) return;
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
			theme: { background: "#0a0a0a" },
		});
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
				fit.fit();
				const entry = drawerRegistry.get(tab.id);
				if (entry?.termId && term.cols > 0 && term.rows > 0) {
					void termResize(entry.termId, term.cols, term.rows).catch(() => {});
				}
			} catch {}
		});
		observer.observe(host);

		void (async () => {
			try {
				const id = await termOpen(tab.cwd, [], term.cols || 80, term.rows || 24);
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
					phase: "error",
					exitCode: null,
					error: msg,
				};
				drawerRegistry.set(tab.id, entry);
				useDrawerStore.getState().updateTab(tab.id, { status: "error", exitCode: null });
				toast.error(`终端启动失败: ${msg}`);
			}
		})();
	}, []);

	// Ensure the active tab has a terminal; reattach on tab switches
	useEffect(() => {
		if (!open || !activeTabId) return;
		const tab = tabs.find((t) => t.id === activeTabId);
		const host = hostRefs.current.get(activeTabId);
		if (!tab || !host) return;
		const existing = drawerRegistry.get(tab.id);
		if (existing) {
			if (existing.term.element && existing.term.element.parentElement !== host) {
				host.appendChild(existing.term.element);
			}
			// Refit after the tab becomes visible again
			const raf = requestAnimationFrame(() => {
				try {
					existing.fit.fit();
				} catch {}
			});
			existing.term.focus();
			return () => cancelAnimationFrame(raf);
		}
		createTerminal(tab, host);
	}, [open, activeTabId, tabs, createTerminal]);

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
			const remaining = useDrawerStore.getState().tabs.length;
			removeTab(tabId);
			// Closing the last tab also collapses the drawer
			if (remaining <= 1) setOpen(false);
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

	const maxHeight = typeof window === "undefined" ? 800 : window.innerHeight * MAXIMIZED_DRAWER_HEIGHT_VH;
	const isMaximized = height >= Math.round(maxHeight) - 1;
	const toggleMaximize = useCallback(() => {
		if (typeof window === "undefined") return;
		setHeight(
			isMaximized
				? window.innerHeight * DEFAULT_DRAWER_HEIGHT_VH
				: window.innerHeight * MAXIMIZED_DRAWER_HEIGHT_VH,
		);
	}, [isMaximized, setHeight]);

	// Drag the top edge to resize (disable text selection while dragging)
	const onDragStart = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		dragActiveRef.current = true;
		document.body.style.userSelect = "none";
		document.body.style.cursor = "row-resize";
	}, []);

	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (!dragActiveRef.current) return;
			setHeight(window.innerHeight - e.clientY);
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
				className="fixed bottom-0 left-0 right-0 z-40 flex flex-col border-t border-neutral-800 bg-[#0a0a0a] shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
				style={{
					height,
					transform: open ? "translateY(0)" : "translateY(100%)",
					transition: "transform 200ms ease-out",
					pointerEvents: open ? "auto" : "none",
				}}
				aria-hidden={!open}
			>
				{/* Resize grab strip */}
				<div
					onMouseDown={onDragStart}
					className="h-1 w-full shrink-0 cursor-row-resize bg-transparent hover:bg-indigo-500/40"
					title="拖拽调节终端高度"
				/>

				{/* Header: tabs + actions */}
				<div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-800 px-2 py-1 text-xs select-none">
					<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
						{tabs.map((tab) => (
							<div
								key={tab.id}
								onClick={() => useDrawerStore.getState().setActive(tab.id)}
								title={`工作目录: ${tab.cwd}`}
								className={clsx(
									"group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-colors",
									tab.id === activeTabId
										? "bg-neutral-800 text-neutral-100"
										: "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
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
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										void handleCloseTab(tab.id);
									}}
									title="关闭此终端"
									className="rounded p-0.5 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-200 group-hover:opacity-100"
								>
									<X size={11} />
								</button>
							</div>
						))}
						<button
							type="button"
							onClick={() => void handleNewTab()}
							title="新建终端"
							className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
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

					{/* Height toggle */}
					<button
						type="button"
						onClick={toggleMaximize}
						title={isMaximized ? "恢复默认高度 (40vh)" : "最大化 (70vh)"}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
					>
						{isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						title="收起终端 (⌘`)，进程保持运行"
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
					>
						<ChevronDown size={14} />
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						title="关闭抽屉"
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
					>
						<X size={14} />
					</button>
				</div>

				{/* Body: one host per tab, inactive tabs hidden (PTYs stay alive) */}
				<div className="relative min-h-0 flex-1">
					{tabs.map((tab) => (
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
							className={clsx("absolute inset-0 px-1", tab.id !== activeTabId && "hidden")}
						/>
					))}

					{tabs.length === 0 && (
						<div className="flex h-full items-center justify-center text-xs text-neutral-600">
							按 ⌘` 或点击 + 新建终端
						</div>
					)}

					{/* Exited banner with reconnect */}
					{activeTab?.status === "exited" && (
						<div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between border-t border-neutral-800 bg-neutral-900/90 px-3 py-2 text-xs">
							<span className="text-neutral-400">
								终端进程已退出
								{activeTab.exitCode !== null ? ` (退出代码: ${activeTab.exitCode})` : ""}
							</span>
							<button
								type="button"
								onClick={() => handleReconnect(activeTab.id)}
								className="flex items-center gap-1.5 rounded bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-500 transition-colors"
							>
								<RefreshCw size={12} />
								重新连接
							</button>
						</div>
					)}

					{/* Spawn failure banner */}
					{activeTab?.status === "error" && activeEntry?.error && (
						<div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between gap-3 border-t border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs">
							<span className="min-w-0 truncate text-rose-300">
								终端启动失败: {activeEntry.error}
							</span>
							<button
								type="button"
								onClick={() => handleReconnect(activeTab.id)}
								className="flex shrink-0 items-center gap-1.5 rounded bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-500 transition-colors"
							>
								<RefreshCw size={12} />
								重试
							</button>
						</div>
					)}

					{/* Floating search bar (Cmd+F) */}
					{searchOpen && (
						<div className="absolute right-3 top-2 z-20 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900/95 p-1.5 shadow-2xl backdrop-blur-md">
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
								className="w-44 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-indigo-500"
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
									searchRegex ? "bg-indigo-600 text-white" : "text-neutral-400 hover:bg-neutral-800",
								)}
							>
								.*
							</button>
							<button
								type="button"
								onClick={closeSearch}
								title="关闭搜索 (Esc)"
								className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
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
								onClick={() => void handlePaste()}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-neutral-800 hover:text-white"
							>
								<ClipboardPaste size={13} className="text-neutral-400" />
								粘贴至终端
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
						</div>
					</div>
				)}
			</div>

			{/* Closed-state handle: subtle pill at the bottom edge, above BottomBar */}
			{!open && (
				<div className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-1">
					<button
						type="button"
						onClick={() => setOpen(true)}
						title="打开终端 (⌘`)"
						className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/90 px-3 py-0.5 text-[11px] text-neutral-500 shadow transition-colors hover:border-neutral-700 hover:text-neutral-200"
					>
						<TerminalSquare size={12} />
						<span>⌘` 终端</span>
					</button>
				</div>
			)}
		</>
	);
}
