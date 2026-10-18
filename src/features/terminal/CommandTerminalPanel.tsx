/**
 * [E] Right-panel command terminal (RightTab "terminal") for free-form shells
 * and human input (secrets/answers) while an agent works. Multiple tabs, each
 * a login shell PTY via term_open(cwd, [], cols, rows). The panel body
 * unmounts on right-panel tab switches, so xterm instances live in
 * drawerRegistry and are re-attached + re-fitted on mount; PTYs keep running
 * while the tab/panel is hidden. Closing a tab explicitly kills its PTY.
 * Toggle: Cmd+` (App.tsx) or the CenterHeader "终端" dropdown.
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
	GitBranch,
	MessageSquareQuote,
	ClipboardPaste,
	Eraser,
	RefreshCw,
	X,
} from "lucide-react";
import { FloatingLayer, Z_LAYER } from "../../components/FloatingLayer";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText, errMsg } from "../../lib/dialogs";
import {
	appPaths,
	termClose,
	termOpen,
	termResize,
	termWrite,
	terminalSetCurrentSession,
} from "../../lib/ipc";
import { isComposing } from "../../lib/hooks";
import { toast } from "../../lib/toast";
import { sideChatAnnKey, useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { openSideChatTab } from "../sidechat/sideChatActions";
import { useDrawerStore, type DrawerTab } from "./drawerStore";
import { addTerminalTab } from "./terminalTabs";
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

/**
 * Per-mount UI callbacks for xterm handlers. xterm instances outlive the
 * panel, so their handlers go through this object (rebound on every mount)
 * instead of capturing a specific component instance's state setters.
 */
const panelUi = {
	openSearch: () => {},
	setSearchResult: (_r: { index: number; count: number }) => {},
	setHasSelection: (_v: boolean) => {},
	captureSelection: () => {},
};

export function CommandTerminalPanel() {
	const tabs = useDrawerStore((s) => s.tabs);
	const activeTabId = useDrawerStore((s) => s.activeTabId);
	const updateTab = useDrawerStore((s) => s.updateTab);

	const visibleTabs = tabs.filter((t) => !t.detached);
	const activeTab = visibleTabs.find((t) => t.id === activeTabId) ?? null;
	const activeEntry = activeTabId ? drawerRegistry.get(activeTabId) : undefined;

	const hostRefs = useRef<Map<string, HTMLDivElement>>(new Map());
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

	// Search bar state (operates on the active tab's entry)
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
	const [searchWholeWord, setSearchWholeWord] = useState(false);
	const [searchRegex, setSearchRegex] = useState(false);
	const [searchResult, setSearchResult] = useState<{ index: number; count: number } | null>(null);

	// Agent ops state (selection of the active tab)
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const lastSessionId = useUi((s) => s.lastSessionId);
	const parentSessionId = selectedSessionId || lastSessionId;
	const [hasSelection, setHasSelection] = useState(false);
	const [copied, setCopied] = useState(false);
	const captureSelectionRef = useRef<() => void>(() => {});

	// Start the shared event bridge; showing the panel with no visible tabs
	// spawns the first shell (StrictMode-safe: re-checks the store).
	useEffect(() => {
		ensureDrawerEventBridge();
		if (!useDrawerStore.getState().tabs.some((t) => !t.detached)) addTerminalTab();
	}, []);

	// Rebind xterm handler callbacks to this mount
	useEffect(() => {
		panelUi.openSearch = () => {
			setSearchOpen(true);
			setTimeout(() => searchInputRef.current?.focus(), 50);
		};
		panelUi.setSearchResult = setSearchResult;
		panelUi.setHasSelection = setHasSelection;
		panelUi.captureSelection = () => captureSelectionRef.current();
		return () => {
			panelUi.openSearch = () => {};
			panelUi.setSearchResult = () => {};
			panelUi.setHasSelection = () => {};
			panelUi.captureSelection = () => {};
		};
	}, []);

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

		// Cmd+F opens search; Cmd+Shift+A quotes the selection (not fed to the shell)
		term.attachCustomKeyEventHandler((e) => {
			if (e.type !== "keydown" || !(e.metaKey || e.ctrlKey)) return true;
			const key = e.key.toLowerCase();
			if (e.shiftKey && key === "a") {
				panelUi.captureSelection();
				return false;
			}
			if (key === "f") {
				panelUi.openSearch();
				return false;
			}
			return true;
		});

		let typedSinceEnter = false;
		const inputSub = term.onData((data) => {
			const entry = drawerRegistry.get(tab.id);
			if (!entry?.termId) return;
			// Submitting a non-empty line marks the shell as used ("+" reuses unused shells)
			if (data.includes("\r")) {
				if (typedSinceEnter || data.length > 1) entry.used = true;
				typedSinceEnter = false;
			} else {
				typedSinceEnter = true;
			}
			void termWrite(entry.termId, data).catch(() => {});
		});

		// Search results / selection only drive UI for the active tab
		const searchSub = search.onDidChangeResults((e) => {
			if (useDrawerStore.getState().activeTabId !== tab.id) return;
			panelUi.setSearchResult({ index: e.resultIndex, count: e.resultCount });
		});
		const selSub = term.onSelectionChange(() => {
			if (useDrawerStore.getState().activeTabId !== tab.id) return;
			panelUi.setHasSelection(term.hasSelection());
		});
		// Folded into the registry's dataSub so destroyDrawerTerminal disposes all
		const dataSub = {
			dispose() {
				inputSub.dispose();
				searchSub.dispose();
				selSub.dispose();
			},
		};

		// Observes whichever host currently holds the xterm element (re-pointed
		// on re-attach after the panel remounts).
		const observer = new ResizeObserver(() => {
			try {
				const host = term.element?.parentElement;
				if (!host || host.clientWidth <= 0 || host.clientHeight <= 0) return;
				fit.fit();
				const entry = drawerRegistry.get(tab.id);
				if (entry?.termId && term.cols > 2 && term.rows > 1) {
					void termResize(entry.termId, term.cols, term.rows).catch(() => {});
				}
			} catch {}
		});
		observer.observe(host);

		// Register synchronously: the effect below can re-run while the spawn is
		// in flight, and an unregistered tab would get a second xterm + PTY.
		const entry: DrawerTerminalEntry = {
			termId: null,
			term,
			fit,
			search,
			observer,
			dataSub,
			themeSub,
			phase: "opening",
			exitCode: null,
			error: null,
		};
		drawerRegistry.set(tab.id, entry);

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
					useDrawerStore.getState().updateTab(tab.id, { cwd });
				}
				const id = await termOpen(cwd, [], term.cols || 80, term.rows || 24);
				// Tab closed or reconnected while the spawn was in flight
				if (drawerRegistry.get(tab.id) !== entry) {
					void termClose(id).catch(() => {});
					return;
				}
				entry.termId = id;
				entry.phase = "ready";
				if (term.cols > 2 && term.rows > 1) {
					void termResize(id, term.cols, term.rows).catch(() => {});
				}
				useDrawerStore.getState().updateTab(tab.id, { status: "ready", exitCode: null });
				term.focus();
			} catch (e) {
				if (drawerRegistry.get(tab.id) !== entry) return;
				const msg = errMsg(e);
				entry.phase = "error";
				entry.error = msg;
				useDrawerStore.getState().updateTab(tab.id, { status: "error", exitCode: null });
				toast.error(`终端启动失败: ${msg}`);
			}
		})();
	}, []);

	const activeTabVisible = visibleTabs.some((t) => t.id === activeTabId);

	// Ensure the active tab has a terminal; re-attach on tab switches/remounts
	useEffect(() => {
		if (!activeTabId || !activeTabVisible) return;
		const tab = useDrawerStore.getState().tabs.find((t) => t.id === activeTabId);
		const host = hostRefs.current.get(activeTabId);
		if (!tab || !host) return;
		const existing = drawerRegistry.get(tab.id);
		if (existing) {
			if (existing.term.element && existing.term.element.parentElement !== host) {
				host.appendChild(existing.term.element);
				existing.observer.disconnect();
				existing.observer.observe(host);
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
	}, [activeTabId, activeTabVisible, createTerminal]);

	// Selection UI follows the active tab only
	useEffect(() => {
		const entry = activeTabId ? drawerRegistry.get(activeTabId) : undefined;
		setHasSelection(entry?.term.hasSelection() ?? false);
	}, [activeTabId]);

	const handleReconnect = useCallback(
		(tabId: string) => {
			destroyDrawerTerminal(tabId);
			updateTab(tabId, { status: "opening", exitCode: null });
		},
		[updateTab],
	);

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

	// Agent ops: quote selection into the composer / send to side chat.
	// Read live state so the xterm key handler (created once) stays current.
	const captureSelection = useCallback(() => {
		const id = useDrawerStore.getState().activeTabId;
		const entry = id ? drawerRegistry.get(id) : undefined;
		const text = entry?.term.getSelection()?.trim();
		if (!text) {
			toast.info("未选中任何终端文本");
			return;
		}
		const ui = useUi.getState();
		const sessionId = ui.selectedSessionId || ui.lastSessionId;
		if (sessionId) {
			useComposer.getState().addAnnotation(sessionId, { source: "terminal", text });
			toast.success("已将选中内容添加至批注");
		} else {
			void copyText(text);
			toast.success("已复制选中内容");
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, []);
	captureSelectionRef.current = captureSelection;

	const handleSendToSideChat = useCallback(() => {
		setContextMenu(null);
		const id = useDrawerStore.getState().activeTabId;
		const entry = id ? drawerRegistry.get(id) : undefined;
		const sel = entry?.term.getSelection()?.trim();
		const ui = useUi.getState();
		const sessionId = ui.selectedSessionId || ui.lastSessionId;
		if (!sel || !sessionId) {
			toast.info("未选中任何终端文本");
			return;
		}
		// Stage the output as quoted context in a blank side chat; nothing is sent.
		useComposer.getState().addAnnotation(sideChatAnnKey(sessionId), { source: "terminal", text: sel });
		void openSideChatTab(sessionId);
	}, []);

	return (
		<div className="flex h-full flex-col bg-[var(--bg-panel)]">
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
							点击 + 新建终端
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

					{/* Selection affordance: quote / side chat for the active tab */}
					{hasSelection && !searchOpen && (
						<div
							style={{ zIndex: Z_LAYER.popover }}
							className="absolute right-3 top-2 flex items-center gap-1 rounded-lg vibrancy-popover shadow-apple-modal hairline p-1 text-xs"
						>
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={captureSelection}
								title={parentSessionId ? "将选中内容加入批注 (⌘⇧A)" : "复制选中内容"}
								className="flex items-center gap-1 rounded-md px-2 py-0.5 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95 transition-all"
							>
								<MessageSquareQuote size={12} className="text-indigo-400" />
								{copied ? "已完成" : parentSessionId ? "引用" : "复制"}
							</button>
							{parentSessionId && (
								<button
									type="button"
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => void handleSendToSideChat()}
									title="将选中终端文本发送到侧聊"
									className="flex items-center gap-1 rounded-md px-2 py-0.5 text-amber-300 hover:bg-amber-500/20 active:scale-95 transition-all"
								>
									<GitBranch size={12} />
									发送到侧聊
								</button>
							)}
						</div>
					)}

					{/* Floating search bar (Cmd+F) */}
					{searchOpen && (
						<div
							style={{ zIndex: Z_LAYER.popover }}
							className="absolute right-3 top-2 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-1.5 rounded-xl vibrancy-popover shadow-apple-modal hairline p-1.5"
						>
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

				{/* Right-click context menu: agent ops (quote / side chat) + clipboard */}
				<FloatingLayer
					anchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
					layer="menu"
					placement="bottom-start"
					offset={2}
					onDismiss={() => setContextMenu(null)}
					className="min-w-40 py-1 text-xs"
				>
					{contextMenu && (
						<>
							{hasSelection && (
								<button
									type="button"
									onClick={() => {
										setContextMenu(null);
										captureSelection();
									}}
									className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
								>
									<MessageSquareQuote size={13} className="text-indigo-400" />
									{parentSessionId ? "引用至批注 (⌘⇧A)" : "复制选中内容"}
								</button>
							)}
							{hasSelection && parentSessionId && (
								<button
									type="button"
									onClick={() => void handleSendToSideChat()}
									className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
								>
									<GitBranch size={13} className="text-amber-400" />
									发送到侧聊
								</button>
							)}
							{hasSelection && <div className="my-1 border-t border-[var(--border-divider)]" />}
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
						</>
					)}
				</FloatingLayer>
		</div>
	);
}
