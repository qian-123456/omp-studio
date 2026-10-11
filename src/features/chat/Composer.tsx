/** [B] Composer: annotation pills, slash menu, held queue,
 * steer/stop, model + thinking pickers, /fork interception. */

import clsx from "clsx";
import {
	ArrowUp,
	Check,
	ChevronDown,
	CornerDownRight,
	Loader2,
	Play,
	Lightbulb,
	Plus,
	Square,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { listWorkspaceFiles, readTextFile, rpcSend, saveClipboardImage, sessionUsage } from "../../lib/ipc";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ImageAttachment } from "../../lib/contracts";
import { AttachmentThumb } from "./ImageChips";
export interface InlineImageToken {
	match: string;
	index: number;
	path?: string;
}
export const IMAGE_TOKEN_PALETTES = [
	{ text: "text-amber-400", decoration: "decoration-amber-400", hex: "#fbbf24" }, // #1: Amber/Peach
	{ text: "text-sky-400", decoration: "decoration-sky-400", hex: "#38bdf8" },     // #2: Sky Blue
	{ text: "text-emerald-400", decoration: "decoration-emerald-400", hex: "#34d399" }, // #3: Emerald
	{ text: "text-purple-400", decoration: "decoration-purple-400", hex: "#c084fc" }, // #4: Purple
	{ text: "text-rose-400", decoration: "decoration-rose-400", hex: "#fb7185" },     // #5: Rose Pink
	{ text: "text-teal-400", decoration: "decoration-teal-400", hex: "#2dd4bf" },     // #6: Teal
	{ text: "text-yellow-300", decoration: "decoration-yellow-300", hex: "#fde047" }, // #7: Yellow
	{ text: "text-indigo-400", decoration: "decoration-indigo-400", hex: "#818cf8" }, // #8: Indigo
];

export function getImageTokenPalette(index: number) {
	const i = Math.max(1, index);
	return IMAGE_TOKEN_PALETTES[(i - 1) % IMAGE_TOKEN_PALETTES.length];
}

export function renderHighlightedText(content: string) {
	const regex = /(🖼️\s*#\d+|\[(?:Image|图片)\s*#\d+\])/gu;
	const parts: React.ReactNode[] = [];
	let lastIdx = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		if (match.index > lastIdx) {
			parts.push(content.slice(lastIdx, match.index));
		}
		const tokenText = match[0];
		const numMatch = /\d+/.exec(tokenText);
		const num = numMatch ? parseInt(numMatch[0], 10) : 1;
		const palette = getImageTokenPalette(num);

		parts.push(
			<span
				key={match.index}
				className="underline decoration-2 underline-offset-[3px]"
				style={{ color: palette.hex, textDecorationColor: palette.hex }}
			>
				{tokenText}
			</span>,
		);
		lastIdx = regex.lastIndex;
	}

	if (lastIdx < content.length) {
		parts.push(content.slice(lastIdx));
	}
	if (content.endsWith("\n")) {
		parts.push("\n ");
	}
	return parts;
}
export function getImageTokenRanges(content: string): Array<{
	start: number;
	end: number;
	num: number;
	token: string;
}> {
	const regex = /(?:🖼️\s*#\d+|\[(?:Image|图片)\s*#\d+\])/gu;
	const ranges: Array<{ start: number; end: number; num: number; token: string }> = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(content)) !== null) {
		const numMatch = /\d+/.exec(match[0]);
		const num = numMatch ? parseInt(numMatch[0], 10) : 1;
		ranges.push({
			start: match.index,
			end: match.index + match[0].length,
			num,
			token: match[0],
		});
	}
	return ranges;
}



export const INLINE_IMAGE_RE =
	/(?:\[(?:Image|图片)\s*#(?<num1>\d+)\]|🖼️\s*#(?<num2>\d+)|\[(?:Image|图片)\s*#(?<num3>\d+)(?:,\s*\d+x\d+)?:\s*(?<path3>[^\]]+)\])/gu;

export function parseInlineImages(
	text: string,
	knownImages?: Array<{ path: string }>,
): InlineImageToken[] {
	const tokens: InlineImageToken[] = [];
	const re = new RegExp(INLINE_IMAGE_RE.source, "gu");
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const numStr = m.groups?.num1 || m.groups?.num2 || m.groups?.num3 || "1";
		const num = parseInt(numStr, 10);
		let path = (m.groups?.path3 || "").trim() || undefined;
		if (!path && knownImages && knownImages[num - 1]) {
			path = knownImages[num - 1].path;
		}
		tokens.push({ match: m[0], index: num, path });
	}
	return tokens;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const isImageAnnotation = (a: { file?: string; text?: string }) =>
	(!!a.file && IMAGE_EXT_RE.test(a.file)) || !!a.text?.includes("[图片:");
import { ensureLive, isResumeCancelled } from "../../lib/ensureLive";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ContextRing } from "./ContextRing";
import { ImagePreviewModal } from "../../components/ImagePreviewModal";
import { FloatingLayer } from "../../components/FloatingLayer";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { isComposing } from "../../lib/hooks";
import { formatWithAnnotations, useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useHeldQueue } from "./heldQueue";
import { abortTurn, linkSentSecrets, sendPrompt, useAbortState } from "./send";
import { usePrivacy } from "../../stores/privacy";
import { ComposerSecretOverlay } from "./privacy/ComposerSecretOverlay";
import { LibraryPromptCard } from "./privacy/LibraryPromptCard";
import { libraryPromptCandidates, maskText, replacedEntries } from "./privacy/composerPrivacy";
import { useComposerPrivacy } from "./privacy/useComposerPrivacy";
import {
	buildSetModelPayload,
	type ModelOption,
	parseModels,
	resolveCurrentModel,
	resolveThinkingLevels,
	toModelKey,
} from "../../lib/models";
import { ModelMenuContent } from "../../components/ModelSelect";
import { buildSlashSections, flattenSections, type SlashMenuItem } from "./slash/menu";
import { SlashMenu } from "./slash/SlashMenu";
import { runSlashInput, sendSlashPrompt, type SlashDeps } from "./slash/executors";
import { requestTakeover } from "../sessions/sessionActions";
import { ContextPillBar } from "./ContextPillBar";
import { AddMenuPopover } from "./AddMenuPopover";
import { runSessionBash } from "./sessionShell";

/** Prepended to outgoing prompts while plan mode is on. */
const PLAN_MODE_PREFIX =
	"[规划模式] 请先分析需求并给出详细的分步实施计划，在我确认之前不要修改任何文件或执行有副作用的操作。\n\n";
const GOAL_TEMPLATE = "[目标: 请输入本次任务目标]";
const FINDER_SELECTION_SCRIPT =
	`osascript -e 'tell application "Finder" to set sel to selection as alias list' -e 'set out to ""' -e 'repeat with f in sel' -e 'set out to out & POSIX path of f & linefeed' -e 'end repeat' -e 'return out'`;
/** Tooltip descriptions for known thinking levels. The visible label is the
 * raw omp level name (low/high/xhigh/…), English, matching the omp TUI. */
const THINKING_DESCS: Record<string, string> = {
	auto: "跟随模型的默认力度",
	off: "不启用深度推理思考",
	minimal: "轻度推理，适合简单问答",
	low: "较少推理步骤，响应较快",
	medium: "均衡推理与响应速度",
	high: "完整多步推理，适合复杂分析",
	xhigh: "高强度推理，适合复杂推演",
	max: "无限制深度推理，耗费最多预算",
};

function thinkingLabel(level: string): { label: string; desc: string } {
	return { label: level, desc: THINKING_DESCS[level] ?? "" };
}

const EMPTY_LIST: string[] = [];

interface SlashToken {
	query: string;
	start: number;
	end: number;
}

function getSlashToken(fullText: string, cursor: number): SlashToken | null {
	const beforeCursor = fullText.slice(0, cursor);
	const match = /(?:^|\s)(\/([^\s/]*))$/.exec(beforeCursor);
	if (!match) return null;
	const fullToken = match[1];
	const query = match[2];
	const start = beforeCursor.length - fullToken.length;
	return { query, start, end: cursor };
}

export function Composer({
	sessionId,
	readonly,
	compact,
}: {
	sessionId: string;
	/** External session — observation only. */
	readonly?: boolean;
	compact?: boolean;
}) {
	const [busy, setBusy] = useState(false);
	const [menuIndex, setMenuIndex] = useState(0);
	const [menuDismissed, setMenuDismissed] = useState(false);
	const [cursorPos, setCursorPos] = useState(0);
	const [historyIdx, setHistoryIdx] = useState(-1);
	const draftBeforeHistory = useRef("");
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
	const [editingComment, setEditingComment] = useState("");
	const catalogModels = useModelOptions();
	// rpc `get_available_models` fallback, used only while the catalog is empty.
	const [rpcModels, setRpcModels] = useState<ModelOption[] | null>(null);
	const models = catalogModels && catalogModels.length > 0 ? catalogModels : rpcModels;
	const [modelOpen, setModelOpen] = useState(false);
	const modelMenuRef = useRef<HTMLDivElement>(null);

	const [thinkingOpen, setThinkingOpen] = useState(false);
	const thinkingMenuRef = useRef<HTMLDivElement>(null);

	/** Hint line shown after picking an arg-taking command (`/name <arg>`). */
	const [argHintLine, setArgHintLine] = useState<string | null>(null);

	const taRef = useRef<HTMLTextAreaElement>(null);
	const backdropRef = useRef<HTMLDivElement>(null);
	const composerCardRef = useRef<HTMLDivElement>(null);
	// Draft state bound to useComposer store so switching sessions does not lose input
	const text = useComposer((s) => s.drafts[sessionId] ?? "");
	const hasImageTokens = useMemo(
		() => /(?:🖼️\s*#\d+|\[(?:Image|图片)\s*#\d+\])/u.test(text),
		[text],
	);
	const setDraft = useComposer((s) => s.setDraft);
	const clearDraft = useComposer((s) => s.clearDraft);
	const setText = (nextText: string) => setDraft(sessionId, nextText);
	const privacy = useComposerPrivacy(sessionId, text);
	const privacyEntries = usePrivacy((s) => s.entries);
	const libraryCandidates = useMemo(
		() => libraryPromptCandidates(privacyEntries, privacy.sessionEntryIds),
		[privacyEntries, privacy.sessionEntryIds],
	);
	// Library prompt appears only after a send from this composer.
	const [libraryPromptArmed, setLibraryPromptArmed] = useState(false);
	const [taFocused, setTaFocused] = useState(false);

	const history = useComposer((s) => s.history);
	const pushHistory = useComposer((s) => s.pushHistory);
	const focusNonce = useComposer((s) => s.focusNonce[sessionId]);

	const live = useLive((s) => s.sessions[sessionId]);
	const streaming = live?.streaming === true;
	// Codex-style resume affordance: the latest turn ended aborted → the send
	// button shows ▶ and fires a bare "继续" with empty input.
	const canResume = useMemo(() => {
		if (streaming) return false;
		const items = live?.items ?? [];
		for (let i = items.length - 1; i >= 0; i--) {
			const it = items[i];
			if (it.kind !== "assistant") continue;
			return it.stopReason === "aborted";
		}
		return false;
	}, [live?.items, streaming]);
	const commands = live?.commands ?? [];
	const annotations = useComposer(
		(s) => s.annotations[sessionId] ?? EMPTY_LIST,
	);
	const addAnnotation = useComposer((s) => s.addAnnotation);
	const updateAnnotation = useComposer((s) => s.updateAnnotation);
	const removeAnnotation = useComposer((s) => s.removeAnnotation);
	const clearAnnotations = useComposer((s) => s.clearAnnotations);
	const composerImages = useComposer(
		(s) => s.images[sessionId] ?? EMPTY_LIST,
	);
	const addImage = useComposer((s) => s.addImage);
	const clearImages = useComposer((s) => s.clearImages);
	const textAnnotations = useMemo(
		() => annotations.filter((a) => !isImageAnnotation(a)),
		[annotations],
	);
	const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
	const scrollToItem = useLive((s) => s.scrollToItem);

	const held = useHeldQueue((s) => s.queues[sessionId] ?? EMPTY_LIST);
	const setDismissed = useHeldQueue((s) => s.setDismissed);
	const pushHeld = useHeldQueue((s) => s.push);


	// @ file-completion state
	const sessionMeta = useSessions((s) => s.sessions[sessionId]);
	const [atFiles, setAtFiles] = useState<string[] | null>(null);
	const atToken = useMemo(() => {
		const beforeCursor = text.slice(0, cursorPos);
		const m = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
		if (!m) return null;
		return { query: m[1], start: beforeCursor.length - m[1].length - 1 };
	}, [text, cursorPos]);
	const atMenu = useMemo(() => {
		if (!atToken || !atFiles) return [];
		const q = atToken.query.toLowerCase();
		return atFiles
			.filter((p) => !q || p.toLowerCase().includes(q))
			.slice(0, 10);
	}, [atToken, atFiles]);
	useEffect(() => {
		if (atToken && atFiles === null) {
			const cwd = sessionMeta?.cwd;
			if (!cwd) return;
			void listWorkspaceFiles(cwd)
				.then(setAtFiles)
				.catch(() => setAtFiles([]));
		}
	}, [atToken !== null, atFiles === null, sessionMeta?.cwd]);
	const isAborting = useAbortState((s) => s.aborting[sessionId] === true);


	// Context usage calculations for ContextRing
	const contextRaw = live?.state?.contextUsage;
	const contextUsageObj =
		typeof contextRaw === "object" && contextRaw !== null
			? (contextRaw as Record<string, unknown>)
			: null;
	const contextPct =
		typeof contextUsageObj?.percent === "number"
			? contextUsageObj.percent
			: undefined;

	// Total tokens summary
	const [totalTokensStr, setTotalTokensStr] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		sessionUsage(sessionId)
			.then((u) => {
				if (!cancelled && u.available) {
					setTotalTokensStr(`${(u.tokens / 1000).toFixed(1)}k tok`);
				}
			})
			.catch((err) => console.warn("[composer] session usage fetch failed", err));
		return () => {
			cancelled = true;
		};
	}, [sessionId, streaming]);

	// Pull the slash-command list once when the session comes up empty —
	// available_commands_update only arrives when the list changes.
	const commandsRequested = useRef(false);
	useEffect(() => {
		commandsRequested.current = false;
	}, [sessionId]);
	useEffect(() => {
		if (!live?.alive || commandsRequested.current) return;
		if ((live.commands?.length ?? 0) > 0) return;
		commandsRequested.current = true;
		void rpcSend(sessionId, { type: "get_available_commands" }).catch((err) =>
			console.warn("[composer] get_available_commands failed", err),
		);
	}, [sessionId, live?.alive, live?.commands?.length]);

	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const addBtnRef = useRef<HTMLButtonElement>(null);
	const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
	const planMode = useComposer((s) => s.planModes[sessionId] === true);
	const togglePlanMode = useComposer((s) => s.togglePlanMode);

	/** Attach one filesystem path: images go to the gallery, text files are
	 * inlined as doc references, folders/binaries as path-only references. */
	const attachPath = async (filePath: string, isDir = false) => {
		if (isDir) {
			addAnnotation(sessionId, { source: "doc", file: filePath, text: `文件夹: ${filePath}` });
			return;
		}
		if (IMAGE_EXT_RE.test(filePath)) {
			try {
				const res = await fetch(convertFileSrc(filePath));
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				await processImageFile(await res.blob());
			} catch (imgErr) {
				toast.error(`读取图片失败: ${errMsg(imgErr)}`);
			}
			return;
		}
		try {
			const content = await readTextFile(filePath);
			addAnnotation(sessionId, { source: "doc", file: filePath, text: content });
		} catch {
			addAnnotation(sessionId, { source: "doc", file: filePath, text: `文件: ${filePath}` });
		}
	};

	// "Files and folders": native picker for files (multi-select).
	const handleAddAttachment = async () => {
		try {
			const selected = await openDialog({
				multiple: true,
				directory: false,
				title: "选择附加文件",
			});
			if (!selected) return;
			const paths = typeof selected === "string" ? [selected] : selected;
			for (const p of paths) await attachPath(p);
			if (paths.length > 0) toast.success(`已添加 ${paths.length} 个文件引用`);
		} catch (dialogErr) {
			toast.error(`打开文件对话框失败: ${errMsg(dialogErr)}`);
		}
	};

	// "Attach Finder": attach the frontmost Finder selection (macOS).
	const handleAttachFinder = async () => {
		try {
			const out = await runSessionBash(sessionId, FINDER_SELECTION_SCRIPT);
			const paths = out.split("\n").map((l) => l.trim()).filter(Boolean);
			if (paths.length === 0) {
				toast.info("Finder 中没有选中的项目");
				return;
			}
			for (const p of paths) {
				const isDir = p.endsWith("/");
				await attachPath(isDir ? p.replace(/\/+$/, "") || p : p, isDir);
			}
			toast.success(`已附加 ${paths.length} 个 Finder 选中项`);
		} catch (err) {
			if (!isResumeCancelled(err)) toast.error(`读取 Finder 选中项失败: ${errMsg(err)}`);
		}
	};

	const handleInsertGoal = () => {
		const cur = useComposer.getState().drafts[sessionId] ?? "";
		if (cur.includes(GOAL_TEMPLATE)) return;
		const next = cur.trim() ? `${GOAL_TEMPLATE}\n${cur}` : GOAL_TEMPLATE;
		setDraft(sessionId, next);
		requestAnimationFrame(() => {
			const ta = taRef.current;
			if (!ta) return;
			ta.focus();
			// Select the placeholder text inside the brackets for quick overwrite.
			const start = GOAL_TEMPLATE.indexOf(":") + 2;
			ta.setSelectionRange(start, GOAL_TEMPLATE.length - 1);
		});
	};
	useEffect(() => setMenuIndex(0), [atToken?.query]);

	// Focus textarea whenever focusNonce increments (e.g. from SelectionToolbar)
	useEffect(() => {
		if (focusNonce) {
			taRef.current?.focus();
		}
	}, [focusNonce]);

	// Slash token at cursor position (opens the command menu)
	const slashToken = useMemo(() => {
		if (menuDismissed) return null;
		return getSlashToken(text, cursorPos);
	}, [text, cursorPos, menuDismissed]);

	/** True when the composer holds text outside the `/query` token —
	 * hides `requiresEmptyComposer` commands. */
	const composerHasOtherText = useMemo(() => {
		if (!slashToken) return false;
		return (
			text.slice(0, slashToken.start).trim().length > 0 ||
			text.slice(slashToken.end).trim().length > 0
		);
	}, [text, slashToken]);

	const slashSections = useMemo(() => {
		if (!slashToken) return [];
		return buildSlashSections(slashToken.query, commands, composerHasOtherText);
	}, [slashToken, commands, composerHasOtherText]);
	const slashItems = useMemo(
		() => flattenSections(slashSections),
		[slashSections],
	);

	useEffect(() => setMenuIndex(0), [slashToken?.query]);

	const state = live?.state ?? {};
	const stateThinkingLevel = typeof state.thinkingLevel === "string" ? state.thinkingLevel : undefined;
	const currentThinking = stateThinkingLevel ?? "auto";

	const current = useMemo(
		() => resolveCurrentModel(state.model ?? sessionMeta?.model, models),
		[state.model, sessionMeta?.model, models],
	);

	// Live model metadata takes precedence; catalog capabilities are the fallback.
	const currentModelOption = useMemo(
		() =>
			models?.find(
				(m) => current.value && toModelKey(m.provider, m.id) === current.value,
			) ?? models?.find((m) => m.id === current.id && m.provider === current.provider),
		[models, current],
	);
	const thinkingLevels = useMemo(
		() =>
			resolveThinkingLevels(
				(state.model as Record<string, unknown> | undefined)?.thinking,
				currentModelOption?.thinking,
				stateThinkingLevel,
			),
		[state.model, currentModelOption, stateThinkingLevel],
	);
	const curThinkingObj = thinkingLabel(currentThinking);

	const selectThinkingLevel = async (level: string) => {
		try {
			if (!live?.alive) await ensureLive(sessionId);
			await rpcSend(sessionId, { type: "set_thinking_level", level });
			await rpcSend(sessionId, { type: "get_state" });
			setThinkingOpen(false);
		} catch (err) {
			if (isResumeCancelled(err)) setThinkingOpen(false);
			else toast.error(`切换思考等级失败: ${errMsg(err)}`);
		}
	};
	const loadModels = async () => {
		// Catalog (`omp models --json`) first; get_available_models is only a
		// fallback — large catalogs exceed the rpc transport limit there.
		await useModelCatalog.getState().refresh();
		if ((useModelCatalog.getState().models?.length ?? 0) > 0) return;
		try {
			if (live?.alive) {
				const resp = (await rpcSend(sessionId, {
					type: "get_available_models",
				})) as Record<string, unknown>;
				setRpcModels(parseModels(resp.data ?? resp));
			}
		} catch {
			setRpcModels([]);
		}
	};

	// Preload models regardless of session alive state
	useEffect(() => {
		void loadModels();
	}, [sessionId, live?.alive]);

	// Reset aborting state once streaming stops
	useEffect(() => {
		if (!streaming && isAborting) {
			useAbortState.getState().setAborting(sessionId, false);
		}
	}, [streaming, isAborting, sessionId]);

	// Auto-resizing textarea with max height constraint
	useEffect(() => {
		const ta = taRef.current;
		if (!ta) return;
		ta.style.height = "auto";
		const minH = compact ? 22 : 26;
		const maxH = 220;
		const nextH = Math.min(Math.max(ta.scrollHeight, minH), maxH);
		ta.style.height = `${nextH}px`;
		ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
		if (backdropRef.current) {
			backdropRef.current.style.height = `${nextH}px`;
			backdropRef.current.scrollTop = ta.scrollTop;
		}
	}, [text, compact]);
	/** Registry-facing hooks: pickers, text insertion. Fresh closure per call
	 * so executors always see current state. */
	const makeSlashDeps = (): SlashDeps => ({
		openModelPicker: () => {
			setModelOpen(true);
			if (!models || models.length === 0) void loadModels();
		},
		openThinkingPicker: () => setThinkingOpen(true),
		insertText: (t) =>
			setText(`${useComposer.getState().drafts[sessionId] ?? ""}${t}`),
	});

	/** Menu selection: arg commands fill `/name ` + hint; the rest run now,
	 * removing only the `/token` and keeping any other draft text. */
	const selectSlashItem = (item: SlashMenuItem) => {
		if (!slashToken) return;
		setArgHintLine(null);
		if (item.argHint) {
			const before = text.slice(0, slashToken.start);
			const after = text.slice(slashToken.end);
			const replacement = `/${item.name} `;
			const nextText = `${before}${replacement}${after}`;
			setText(nextText);
			const nextCursor = before.length + replacement.length;
			setCursorPos(nextCursor);
			setMenuDismissed(true);
			setArgHintLine(`/${item.name} ${item.argHint}`);
			setTimeout(() => {
				if (taRef.current) {
					taRef.current.focus();
					taRef.current.setSelectionRange(nextCursor, nextCursor);
				}
			}, 0);
			return;
		}
		const before = text.slice(0, slashToken.start);
		const after = text.slice(slashToken.end);
		setText(`${before}${after}`);
		setCursorPos(before.length);
		setMenuDismissed(true);
		void (async () => {
			try {
				if (item.registry) {
					await runSlashInput(sessionId, `/${item.name}`, makeSlashDeps());
				} else {
					pushHistory(`/${item.name}`);
					await sendSlashPrompt(sessionId, `/${item.name}`);
				}
			} catch (err) {
				if (!isResumeCancelled(err))
					toast.error(`/${item.name} 失败: ${errMsg(err)}`);
			}
			setTimeout(() => taRef.current?.focus(), 0);
		})();
	};
	const submit = async (steer: boolean) => {
		const raw = text;
		if (!raw.trim() || busy) return;
		const trimmedRaw = raw.trim();
		// Privacy: replace marked / auto / accepted ranges with placeholders.
		// The draft and local history keep the real text; everything sent is masked.
		const maskedRaw = maskText(raw, privacy.highlights);
		const trimmedMasked = maskedRaw.trim();
		const sentSecrets = replacedEntries(privacy.highlights);
		const sessionEntryIds = privacy.sessionEntryIds;
		const markScopes = privacy.draft.scopes;
		const finishPrivacySend = () => {
			privacy.reset();
			if (sentSecrets.length === 0) return;
			setLibraryPromptArmed(true);
			void linkSentSecrets(sessionId, sentSecrets, sessionEntryIds, markScopes);
		};
		setArgHintLine(null);
		if (trimmedRaw.startsWith("/")) {
			// Registry command (/fork, /status, …) — run natively or forward.
			setBusy(true);
			try {
				const outcome = await runSlashInput(
					sessionId,
					trimmedMasked,
					makeSlashDeps(),
				);
				if (outcome === "keep") return;
				if (outcome === null) {
					// Unknown `/x`: send to omp so its own builtins still run.
					pushHistory(trimmedRaw);
					await sendSlashPrompt(sessionId, trimmedMasked);
				}
				finishPrivacySend();
				clearDraft(sessionId);
				clearAnnotations(sessionId);
				clearImages(sessionId);
			} catch (err) {
				if (!isResumeCancelled(err))
					toast.error(`发送失败: ${errMsg(err)}`);
			} finally {
				setBusy(false);
			}
			return;
		}
		const currentSessionImages = useComposer.getState().images[sessionId] ?? [];
		// Convert `🖼️ #N` to standard OMP token `[Image #N: path]`
		let outgoingRaw = maskedRaw.replace(/🖼️\s*#(\d+)/gu, (_match, numStr) => {
			const n = parseInt(numStr, 10);
			const img = currentSessionImages[n - 1];
			if (img?.path) {
				const dimStr = img.width && img.height ? `, ${img.width}x${img.height}` : "";
				return `[Image #${n}${dimStr}: ${img.path}]`;
			}
			return `[Image #${n}]`;
		});

		// If some images attached in Composer were not referenced in text (e.g. user deleted the token),
		// ensure they are still included in the outgoing prompt.
		const missingImages = currentSessionImages.filter((_img, i) => {
			const n = i + 1;
			return !outgoingRaw.includes(`[Image #${n}`);
		});
		if (missingImages.length > 0) {
			const missingMarkers = missingImages
				.map((img) => {
					const n = currentSessionImages.indexOf(img) + 1;
					const dimStr = img.width && img.height ? `, ${img.width}x${img.height}` : "";
					return `[Image #${n}${dimStr}: ${img.path}]`;
				})
				.join(" ");
			outgoingRaw = outgoingRaw.trim()
				? `${missingMarkers} ${outgoingRaw}`
				: missingMarkers;
		}

		const imageAttachments: ImageAttachment[] = currentSessionImages.map((img, i) => ({
			id: img.id || `img-${i + 1}`,
			path: img.path,
			marker: `[Image #${i + 1}]`,
			width: img.width,
			height: img.height,
		}));

		const formatted = formatWithAnnotations(outgoingRaw, textAnnotations);
		const message = planMode ? `${PLAN_MODE_PREFIX}${formatted}` : formatted;
		// Streaming + plain Enter: hold locally (ARCHITECTURE §11 B); the
		// post-turn HeldQueueBar sends it with its image attachments.
		if (streaming && !steer) {
			pushHeld(sessionId, message, imageAttachments);
			pushHistory(raw.trim());
			finishPrivacySend();
			clearDraft(sessionId);
			clearAnnotations(sessionId);
			clearImages(sessionId);
			return;
		}
		setBusy(true);
		try {
			await sendPrompt(sessionId, message, { steer, images: imageAttachments });
			pushHistory(raw.trim());
			finishPrivacySend();
			clearDraft(sessionId);
			clearAnnotations(sessionId);
			clearImages(sessionId);
		} catch (err) {
			if (!isResumeCancelled(err)) toast.error(`发送失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	// @ completion: replace the @token with @"<path>" and keep typing.
	const applyAtCompletion = (path: string) => {
		if (!atToken) return;
		const before = text.slice(0, atToken.start);
		const after = text.slice(cursorPos);
		const replacement = `@"${path}" `;
		const nextText = `${before}${replacement}${after}`;
		setText(nextText);
		const nextCursor = before.length + replacement.length;
		setCursorPos(nextCursor);
		setAtFiles(null); // reset; re-fetch next @
		setTimeout(() => {
			taRef.current?.focus();
			taRef.current?.setSelectionRange(nextCursor, nextCursor);
		}, 0);
	};

	const handleAbort = async () => {
		try {
			await abortTurn(sessionId);
			toast.info("已请求停止当前回合");
		} catch (err) {
			toast.error(`停止失败: ${errMsg(err)}`);
		}
	};
	const fileToBase64 = (file: File | Blob): Promise<string> =>
		new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				const commaIdx = result.indexOf(",");
				resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result);
			};
			reader.onerror = (err) => reject(err);
			reader.readAsDataURL(file);
		});

	const getImageDimensions = (src: string): Promise<{ width: number; height: number }> =>
		new Promise<{ width: number; height: number }>((resolve) => {
			const img = new Image();
			img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
			img.onerror = () => resolve({ width: 0, height: 0 });
			img.src = src;
		});

	const removeImageByIndex = (imageIndex: number, currentText?: string) => {
		const textToUse = currentText !== undefined ? currentText : text;
		const curImages = useComposer.getState().images[sessionId] ?? [];
		if (imageIndex < 0 || imageIndex >= curImages.length) return;
		const num = imageIndex + 1;
		const nextImages = curImages.filter((_, idx) => idx !== imageIndex);
		useComposer.getState().setImages(sessionId, nextImages);

		// Remove token for this image from text: `🖼️ #1` or `[Image #1]`
		const tokenRe = new RegExp(
			`\\s*(?:🖼️\\s*#${num}|\\[(?:Image|图片)\\s*#${num}(?:,[^\\]]*)?(?::[^\\]]*)?\\])\\s*`,
			"gu",
		);
		let nextText = textToUse.replace(tokenRe, " ").trim();
		// Renumber remaining tokens > num
		for (let i = num + 1; i <= curImages.length; i++) {
			const oldRe1 = new RegExp(`🖼️\\s*#${i}\\b`, "gu");
			const oldRe2 = new RegExp(`(\\[(?:Image|图片)\\s*#)${i}(\\b|\\]|:)`, "gu");
			nextText = nextText.replace(oldRe1, `🖼️#${i - 1}`).replace(oldRe2, `$1${i - 1}$2`);
		}
		setText(nextText);
		setDraft(sessionId, nextText);
	};

	const processImageFile = async (file: File | Blob) => {
		try {
			const base64 = await fileToBase64(file);
			const savedPath = await saveClipboardImage(base64);
			const dims = await getImageDimensions(convertFileSrc(savedPath));
			const dimensions = dims.width > 0 && dims.height > 0 ? dims : undefined;

			addImage(
				sessionId,
				savedPath,
				file instanceof File ? file.name : undefined,
				dimensions,
			);
			const currentImages = useComposer.getState().images[sessionId] ?? [];
			const nextNum = currentImages.length;

			const ta = taRef.current;
			const start = ta ? ta.selectionStart : cursorPos;
			const end = ta ? ta.selectionEnd : cursorPos;
			const before = text.slice(0, start);
			const after = text.slice(end);
			const spacerBefore =
				before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n")
					? " "
					: "";
			// Always leave a space after the token so the caret never sits flush
			// against it (paste at end-of-text previously had no trailing gap).
			const spacerAfter = after.startsWith(" ") || after.startsWith("\n") ? "" : " ";
			const marker = `${spacerBefore}🖼️#${nextNum}${spacerAfter}`;
			const nextText = `${before}${marker}${after}`;
			setText(nextText);
			setDraft(sessionId, nextText);
			const nextCursor = before.length + marker.length;
			setCursorPos(nextCursor);
			setTimeout(() => {
				if (taRef.current) {
					taRef.current.focus();
					taRef.current.setSelectionRange(nextCursor, nextCursor);
				}
			}, 0);
			toast.success(`已插入图片 #${nextNum}`);
		} catch (err) {
			toast.error(`处理图片失败: ${errMsg(err)}`);
		}
	};

	const processTextFile = async (file: File) => {
		try {
			const content = await file.text();
			addAnnotation(sessionId, {
				source: "doc",
				file: file.name,
				text: content,
			});
			toast.success(`已附加文件内容: ${file.name}`);
		} catch (err) {
			toast.error(`读取文件失败: ${errMsg(err)}`);
		}
	};

	const onDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDraggingOver(true);
	};

	const onDragLeave = (e: React.DragEvent<HTMLTextAreaElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDraggingOver(false);
	};

	const onDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDraggingOver(false);
		const files = Array.from(e.dataTransfer.files);
		if (files.length === 0) return;
		for (const file of files) {
			if (file.type.startsWith("image/")) {
				await processImageFile(file);
			} else {
				await processTextFile(file);
			}
		}
	};

	const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		let handledImage = false;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.type.startsWith("image/")) {
				const blob = item.getAsFile();
				if (blob) {
					handledImage = true;
					await processImageFile(blob);
				}
			}
		}
		if (handledImage) {
			e.preventDefault();
		}
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (isComposing(e)) return;
		// Atomic ArrowLeft navigation across image token
		if (e.key === "ArrowLeft" && !e.altKey && !e.metaKey) {
			const ta = taRef.current;
			if (ta && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
				const pos = ta.selectionStart;
				const ranges = getImageTokenRanges(text);
				const token = ranges.find((r) => r.start < pos && pos <= r.end);
				if (token) {
					e.preventDefault();
					ta.setSelectionRange(token.start, token.start);
					setCursorPos(token.start);
					return;
				}
			}
		}

		// Atomic ArrowRight navigation across image token
		if (e.key === "ArrowRight" && !e.altKey && !e.metaKey) {
			const ta = taRef.current;
			if (ta && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
				const pos = ta.selectionStart;
				const ranges = getImageTokenRanges(text);
				const token = ranges.find((r) => r.start <= pos && pos < r.end);
				if (token) {
					e.preventDefault();
					ta.setSelectionRange(token.end, token.end);
					setCursorPos(token.end);
					return;
				}
			}
		}

		// Atomic backspace for image token `🖼️ #N` or `[Image #N]`
		if (e.key === "Backspace" && !e.shiftKey && !e.metaKey && !e.altKey) {
			const ta = taRef.current;
			if (ta && ta.selectionStart === ta.selectionEnd) {
				const pos = ta.selectionStart;
				const before = text.slice(0, pos);
				const match = /(?:🖼️\s*#\d+|\[(?:Image|图片)\s*#\d+(?:,[^\]]*)?\])\s*$/.exec(before);
				if (match) {
					e.preventDefault();
					const tokenStr = match[0];
					const startIdx = pos - tokenStr.length;
					const numMatch = /\d+/.exec(tokenStr);
					const imgNum = numMatch ? parseInt(numMatch[0], 10) : null;

					const nextText = text.slice(0, startIdx) + text.slice(pos);
					setText(nextText);
					setDraft(sessionId, nextText);
					setCursorPos(startIdx);
					setTimeout(() => {
						ta.setSelectionRange(startIdx, startIdx);
					}, 0);
					if (imgNum !== null) {
						removeImageByIndex(imgNum - 1, nextText);
					}
					return;
				}
			}
		}

		// Atomic delete for image token `🖼️ #N` or `[Image #N]`
		if (e.key === "Delete" && !e.shiftKey && !e.metaKey && !e.altKey) {
			const ta = taRef.current;
			if (ta && ta.selectionStart === ta.selectionEnd) {
				const pos = ta.selectionStart;
				const after = text.slice(pos);
				const match = /^\s*(?:🖼️\s*#\d+|\[(?:Image|图片)\s*#\d+(?:,[^\]]*)?\])/.exec(after);
				if (match) {
					e.preventDefault();
					const tokenStr = match[0];
					const endIdx = pos + tokenStr.length;
					const numMatch = /\d+/.exec(tokenStr);
					const imgNum = numMatch ? parseInt(numMatch[0], 10) : null;

					const nextText = text.slice(0, pos) + text.slice(endIdx);
					setText(nextText);
					setDraft(sessionId, nextText);
					setCursorPos(pos);
					setTimeout(() => {
						ta.setSelectionRange(pos, pos);
					}, 0);
					if (imgNum !== null) {
						removeImageByIndex(imgNum - 1, nextText);
					}
					return;
				}
			}
		}


		// @ file-completion navigation — takes precedence over slash.
		if (atMenu.length > 0 && atToken) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setMenuIndex(
					(i) => (i + (e.key === "ArrowDown" ? 1 : -1) + atMenu.length) % atMenu.length,
				);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				applyAtCompletion(atMenu[menuIndex]);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setAtFiles(null);
				return;
			}
		}

		// Slash menu keyboard navigation
		if (slashItems.length > 0 && slashToken) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setMenuIndex(
					(i) =>
						(i + (e.key === "ArrowDown" ? 1 : -1) + slashItems.length) %
						slashItems.length,
				);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				const item =
					slashItems[Math.min(menuIndex, slashItems.length - 1)];
				if (item) selectSlashItem(item);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setMenuDismissed(true);
				return;
			}
		}

		// Prompt history navigation on empty text
		if (e.key === "ArrowUp") {
			if (text === "" && history.length > 0) {
				e.preventDefault();
				draftBeforeHistory.current = "";
				const targetIdx = history.length - 1;
				setHistoryIdx(targetIdx);
				setText(history[targetIdx]);
				return;
			}
			if (historyIdx !== -1) {
				e.preventDefault();
				if (historyIdx > 0) {
					const targetIdx = historyIdx - 1;
					setHistoryIdx(targetIdx);
					setText(history[targetIdx]);
				}
				return;
			}
		}
		if (e.key === "ArrowDown") {
			if (historyIdx !== -1) {
				e.preventDefault();
				if (historyIdx < history.length - 1) {
					const targetIdx = historyIdx + 1;
					setHistoryIdx(targetIdx);
					setText(history[targetIdx]);
				} else {
					setHistoryIdx(-1);
					setText(draftBeforeHistory.current);
				}
				return;
			}
		}

		if (e.key === "Enter") {
			if (e.metaKey || e.ctrlKey) {
				e.preventDefault();
				void submit(true);
			} else if (!e.shiftKey) {
				e.preventDefault();
				void submit(false);
			}
		}
	};

	if (readonly) {
		return (
			<div className="shrink-0 px-3 pb-3 pt-1">
				<div className="flex items-center justify-between gap-3 rounded-[18px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)] px-4 py-3 shadow-sm">
					<div className="flex items-center gap-2.5">
						<span className="relative flex h-2.5 w-2.5 items-center justify-center">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-60" />
							<span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500" />
						</span>
						<span className="text-[13px] font-semibold text-[var(--text)]">
							外部终端正在运行
						</span>
						<span className="text-[var(--text-30,var(--text-dim))]">·</span>
						<span className="text-[12px] text-[var(--text-muted,var(--text-60))]">
							当前为只读观察模式
						</span>
					</div>
					<button
						type="button"
						onClick={() => requestTakeover(sessionId)}
						className="press-scale flex shrink-0 items-center gap-1.5 rounded-lg bg-purple-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-purple-500 active:bg-purple-700"
					>
						<span>接管会话</span>
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="shrink-0 px-3 pb-3 pt-1">
			{libraryPromptArmed &&
				libraryCandidates.length > 0 &&
				!(taFocused && text.trim().length > 0) && (
					<LibraryPromptCard entries={libraryCandidates} />
				)}
			<div
				ref={composerCardRef}
				className={clsx(
					"relative rounded-[22px] border bg-[var(--bg-panel)] transition-colors duration-150",
					isDraggingOver
						? "border-[var(--text-30,var(--border))]"
						: "border-[var(--line,var(--border))]",
				)}
			>
				<ContextPillBar
					sessionId={sessionId}
					workspaceOpen={workspacePickerOpen}
					onWorkspaceOpenChange={setWorkspacePickerOpen}
				/>
				{planMode && (
					<div className="flex items-center gap-1 px-3 pt-2">
						<button
							type="button"
							onClick={() => togglePlanMode(sessionId)}
							title="点击关闭规划模式"
							className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 hover:bg-amber-500/20"
						>
							<Lightbulb size={11} />
							规划模式已启用
							<X size={10} />
						</button>
					</div>
				)}
				{/* Annotation pills — clickable to edit the attached comment. */}
				{textAnnotations.length > 0 && (
					<div className="flex flex-wrap gap-1 px-3 pt-2.5">
						{textAnnotations.map((a, i) => {
							const isEditing = editingAnnId === a.id;
							if (isEditing) {
								return (
									<div
										key={a.id}
										className="flex items-center gap-1 rounded-full border border-[var(--text-30,var(--border))] bg-[var(--bg)] px-2 py-0.5 text-[11px]"
									>
										<span className="shrink-0 text-[var(--text-40,var(--text-dim))]">
											[{i + 1}] {a.file ?? a.source}
											{a.lines ? ` ${a.lines}` : ""}:
										</span>
										<input
											type="text"
											autoFocus
											value={editingComment}
											placeholder="输入批注 (Enter保存, Esc取消)..."
											onChange={(e) => setEditingComment(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													if (isComposing(e)) return;
													e.preventDefault();
													e.stopPropagation();
													updateAnnotation(sessionId, a.id, {
														comment: editingComment.trim() || undefined,
													});
													setEditingAnnId(null);
												} else if (e.key === "Escape") {
													e.preventDefault();
													e.stopPropagation();
													setEditingAnnId(null);
												}
											}}
											onBlur={() => {
												updateAnnotation(sessionId, a.id, {
													comment: editingComment.trim() || undefined,
												});
												setEditingAnnId(null);
											}}
											className="w-32 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-30,var(--text-dim))] focus:w-48 transition-all"
										/>
									</div>
								);
							}
							return (
								<span
									key={a.id}
									onClick={() => {
										setEditingAnnId(a.id);
										setEditingComment(a.comment ?? "");
									}}
									title={`点击修改批注${a.comment ? `\n批注: ${a.comment}` : ""}${a.text ? `\n原内容: ${a.text}` : ""}`}
									className="group flex max-w-72 cursor-pointer items-center gap-1 rounded-full border border-[var(--line,var(--border))] bg-[var(--bg)] px-2 py-0.5 text-[11px] text-[var(--text-60,var(--text-muted))] hover:border-[var(--text-30,var(--border))] hover:text-[var(--text)]"
								>
									<span className="flex min-w-0 items-center gap-1 truncate">
										{isImageAnnotation(a) && a.file && (
											<AttachmentThumb path={a.file} index={i + 1} variant="inline" />
										)}
										<span className="truncate">
										[{i + 1}] {a.file ?? a.source}
										{a.lines ? ` ${a.lines}` : ""}
										{a.comment ? `：${a.comment}` : ""}
										</span>
									</span>
									{a.itemId && (
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												scrollToItem(sessionId, a.itemId!);
											}}
											title="定位到原消息"
											className="text-[var(--text-30,var(--text-dim))] hover:text-[var(--text)]"
										>
											<CornerDownRight size={10} />
										</button>
									)}
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											removeAnnotation(sessionId, a.id);
										}}
										title="删除引用"
										className="text-[var(--text-30,var(--text-dim))] hover:text-[var(--text)]"
									>
										<X size={10} />
									</button>
								</span>
							);
						})}
					</div>
				)}

				{/* Attached image cards gallery (Codex style) */}
				{composerImages.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2.5">
						{composerImages.map((img, i) => (
							<AttachmentThumb
								key={img.id || `${i + 1}-${img.path}`}
								path={img.path}
								index={i + 1}
								showIndex
								variant="strip"
								onOpen={() => setPreviewImageIndex(i)}
								onRemove={() => removeImageByIndex(i)}
							/>
						))}
					</div>
				)}
				{previewImageIndex !== null && (
					<ImagePreviewModal
						images={composerImages.map((img, i) => ({
							path: img.path,
							name: img.name,
							marker: `🖼️#${i + 1}`,
						}))}
						initialIndex={previewImageIndex}
						onClose={() => setPreviewImageIndex(null)}
					/>
				)}
				{/* Textarea container with mirrored syntax-highlighting backdrop */}
				<div className="relative w-full">
					<ComposerSecretOverlay
						sessionId={sessionId}
						text={text}
						taRef={taRef}
						privacy={privacy}
					/>
					{hasImageTokens && (
						<div
							ref={backdropRef}
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-3 pb-1.5 font-sans text-[var(--chat-font-size,14px)] leading-[1.5] text-[var(--text)] select-none"
							style={{
								boxSizing: "border-box",
								wordBreak: "break-word",
							}}
						>
							{renderHighlightedText(text)}
						</div>
					)}
					<textarea
						ref={taRef}
						data-composer={sessionId}
						value={text}
						onScroll={() => {
							if (backdropRef.current && taRef.current) {
								backdropRef.current.scrollTop = taRef.current.scrollTop;
							}
						}}
						onChange={(e) => {
							const next = e.target.value;
							setText(next);
							setDraft(sessionId, next);
							setCursorPos(e.target.selectionStart ?? next.length);
							setMenuDismissed(false);
							setArgHintLine(null);
							if (historyIdx !== -1) setHistoryIdx(-1);
							// Sync composerImages if tokens were completely deleted from text
							const curImages = useComposer.getState().images[sessionId] ?? [];
							if (curImages.length > 0) {
								const remainingTokens = parseInlineImages(next);
								const presentIndices = new Set(remainingTokens.map((t) => t.index));
								if (curImages.some((_, idx) => !presentIndices.has(idx + 1))) {
									const filtered = curImages.filter((_, idx) =>
										presentIndices.has(idx + 1),
									);
									useComposer.getState().setImages(sessionId, filtered);
								}
							}
						}}
						onSelect={(e) => {
							const ta = e.target as HTMLTextAreaElement;
							if (ta.selectionStart !== ta.selectionEnd) {
								setCursorPos(ta.selectionStart);
								return;
							}
							const pos = ta.selectionStart;
							const ranges = getImageTokenRanges(text);
							const token = ranges.find((r) => r.start < pos && pos < r.end);
							if (token) {
								const snapPos = pos - token.start < token.end - pos ? token.start : token.end;
								ta.setSelectionRange(snapPos, snapPos);
								setCursorPos(snapPos);
							} else {
								setCursorPos(pos);
							}
						}}
						onKeyUp={(e) => {
							const ta = e.target as HTMLTextAreaElement;
							if (ta.selectionStart !== ta.selectionEnd) {
								setCursorPos(ta.selectionStart);
								return;
							}
							const pos = ta.selectionStart;
							const ranges = getImageTokenRanges(text);
							const token = ranges.find((r) => r.start < pos && pos < r.end);
							if (token) {
								const snapPos = pos - token.start < token.end - pos ? token.start : token.end;
								ta.setSelectionRange(snapPos, snapPos);
								setCursorPos(snapPos);
							} else {
								setCursorPos(pos);
							}
						}}
						onClick={(e) => {
							const ta = e.target as HTMLTextAreaElement;
							if (ta.selectionStart !== ta.selectionEnd) {
								setCursorPos(ta.selectionStart);
								return;
							}
							const pos = ta.selectionStart;
							const ranges = getImageTokenRanges(text);
							const token = ranges.find((r) => r.start < pos && pos < r.end);
							if (token) {
								const snapPos = pos - token.start < token.end - pos ? token.start : token.end;
								ta.setSelectionRange(snapPos, snapPos);
								setCursorPos(snapPos);
							} else {
								setCursorPos(pos);
							}
						}}
						onKeyDown={onKeyDown}
						onDragOver={onDragOver}
						onDragLeave={onDragLeave}
						onDrop={(e) => void onDrop(e)}
						onPaste={(e) => void onPaste(e)}
						onFocus={() => setTaFocused(true)}
						onBlur={() => setTaFocused(false)}
						rows={1}
						placeholder={
							streaming
								? "输入后续消息…"
								: "输入消息，/ 命令，@ 引用文件"
						}
						style={{ outline: "none", boxShadow: "none" }}
						className={clsx(
							"w-full resize-none bg-transparent px-4 pt-3 pb-1.5 font-sans text-[var(--chat-font-size,14px)] leading-[1.5] outline-none !outline-none focus:outline-none focus:ring-0 placeholder:text-[var(--text-30,var(--text-dim))]",
							hasImageTokens
								? "relative z-10 text-transparent caret-[var(--text)] selection:bg-sky-500/30 selection:text-transparent"
								: "relative text-[var(--text)]",
						)}
					/>
				</div>

				{/* Arg hint shown after picking `/name <arg>` from the menu. */}
				{argHintLine && (
					<div className="px-4 pb-1 font-mono text-[11px] text-[var(--text-40,var(--text-dim))]">
						{argHintLine}
					</div>
				)}

				{/* Bottom toolbar: attach / model / thinking (left); held pill,
				 * context ring and send/stop (right). */}
				<div className="flex items-center justify-between gap-2 px-2.5 pb-2 text-[12px]">
					<div className="flex items-center gap-0.5">
						<button
							ref={addBtnRef}
							type="button"
							onClick={() => setAddMenuOpen((v) => !v)}
							aria-label="添加"
							title="添加文件、项目、目标或规划模式"
							className={clsx(
								"flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors",
								addMenuOpen ? "bg-[var(--ghost-hover,var(--bg-hover))] text-[var(--text)]" : "text-[var(--text-60,var(--text-muted))]",
							)}
						>
							<Plus size={15} />
						</button>
						{addMenuOpen && (
							<AddMenuPopover
								anchor={addBtnRef.current}
								ignoreRef={addBtnRef}
								planMode={planMode}
								onClose={() => setAddMenuOpen(false)}
								onAddFiles={() => void handleAddAttachment()}
								onAttachFinder={() => void handleAttachFinder()}
								onPickProject={() => setWorkspacePickerOpen(true)}
								onGoal={handleInsertGoal}
								onTogglePlan={() => togglePlanMode(sessionId)}
							/>
						)}
						{planMode && (
							<span title="规划模式已启用" className="flex h-7 items-center px-1 text-amber-500">
								<Lightbulb size={13} />
							</span>
						)}

						{/* Model picker */}
						<div className="relative" ref={modelMenuRef}>
							<button
								type="button"
								onClick={() => {
									setModelOpen((v) => !v);
									if (!models || models.length === 0) void loadModels();
								}}
								title={current.label || sessionMeta?.model || "选择模型"}
								className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors"
							>
								<span className={clsx("truncate", compact ? "max-w-24" : "max-w-36")}>
									{current.label ||
										sessionMeta?.model ||
										(models === null ? "加载中…" : "选择模型…")}
								</span>
								<ChevronDown size={10} className="shrink-0 text-[var(--text-30,var(--text-dim))]" />
							</button>

							{modelOpen && (
								<FloatingLayer
									anchor={modelMenuRef.current}
									placement="top-start"
									offset={6}
									layer="popover"
									ignoreRefs={[modelMenuRef]}
									onDismiss={() => setModelOpen(false)}
									className="w-[400px] rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] py-1"
								>
									<ModelMenuContent
										models={models}
										currentValue={current.value}
										onSelect={async (key) => {
											const payload = buildSetModelPayload(key, models);
											if (payload) {
												try {
													if (!live?.alive) {
														await ensureLive(sessionId);
													}
													await rpcSend(sessionId, payload);
													await rpcSend(sessionId, { type: "get_state" });
													toast.success("已切换模型");
												} catch (err) {
													if (!isResumeCancelled(err))
														toast.error(`切换模型失败: ${errMsg(err)}`);
												}
											}
											setModelOpen(false);
										}}
									/>
								</FloatingLayer>
							)}
						</div>

						{/* Thinking-level picker (per-model levels) */}
						{thinkingLevels.length > 0 && (
							<div className="relative" ref={thinkingMenuRef}>
								<button
									type="button"
									onClick={() => setThinkingOpen((v) => !v)}
									title={
										curThinkingObj
											? `思考等级: ${curThinkingObj.label}${curThinkingObj.desc ? ` (${curThinkingObj.desc})` : ""}`
											: "配置思考等级"
									}
									className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors"
								>
									<span className="truncate">
										{curThinkingObj?.label ?? "思考等级"}
									</span>
									<ChevronDown size={10} className="shrink-0 text-[var(--text-30,var(--text-dim))]" />
								</button>

								{thinkingOpen && (
									<FloatingLayer
										anchor={thinkingMenuRef.current}
										placement="top-start"
										offset={6}
										layer="popover"
										ignoreRefs={[thinkingMenuRef]}
										onDismiss={() => setThinkingOpen(false)}
										className="w-[260px] rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] py-1"
									>
										<div className="border-b border-[var(--line,var(--border-divider))] px-2.5 py-1.5 text-[11px] text-[var(--text-40,var(--text-dim))]">
											思考等级
										</div>
										<div className="py-0.5">
											{thinkingLevels.map((level) => {
												const opt = thinkingLabel(level);
												const isSelected = currentThinking === level;
												return (
													<button
														key={level}
														type="button"
														onClick={() => void selectThinkingLevel(level)}
														className={clsx(
															"flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors",
															isSelected
																? "bg-[var(--bg-active-fill)] text-[var(--text)]"
																: "text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]",
														)}
													>
														<div className="min-w-0 pr-2">
															<div className="font-medium">{opt.label}</div>
															{opt.desc && (
																<div className="text-[10px] text-[var(--text-40,var(--text-dim))]">
																	{opt.desc}
																</div>
															)}
														</div>
														{isSelected && (
															<Check
																size={13}
																className="shrink-0 text-[var(--text-60,var(--text-muted))]"
															/>
														)}
													</button>
												);
											})}
										</div>
									</FloatingLayer>
								)}
							</div>
						)}
					</div>

					{/* Right side actions */}
					<div className="flex items-center gap-1.5">
						{/* Held queue count pill: post-turn only (manual mode, un-dismisses the bar);
						    while streaming the QueuedBar popover lists the items itself. */}
						{held.length > 0 && !streaming && (
							<button
								type="button"
								onClick={() => setDismissed(sessionId, false)}
								aria-label="查看排队消息"
								title="点击查看排队消息"
								className="flex items-center gap-1 rounded-full bg-[var(--ghost-hover,var(--bg-active-fill))] px-2 py-0.5 text-[11px] text-[var(--text-60,var(--text-muted))] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
							>
								<CornerDownRight size={11} />
								<span>排队 {held.length}</span>
							</button>
						)}

						{/* Context ring */}
						<ContextRing
							percent={contextPct}
							usageObj={contextUsageObj}
							totalTokensStr={totalTokensStr}
							className="shrink-0"
						/>

						{/* Send / streaming controls (Codex circular button) */}
						<div className="flex items-center gap-1.5">
							{streaming ? (
								<>
									<button
										type="button"
										onClick={() => void handleAbort()}
										disabled={isAborting}
										aria-label="停止当前回合"
										title={isAborting ? "正在停止当前回合…" : "停止当前回合"}
										className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)] hover:opacity-85 disabled:opacity-50 transition-opacity"
									>
										{isAborting ? (
											<Loader2 size={13} className="animate-spin" />
										) : (
											<Square size={11} />
										)}
									</button>
								</>
							) : (
								<button
									type="button"
									onClick={() => {
										if (canResume && !text.trim()) {
											void sendPrompt(sessionId, "Continue");
										} else {
											void submit(false);
										}
									}}
									disabled={busy || (!text.trim() && !canResume)}
									aria-label={canResume && !text.trim() ? "恢复中断的回合" : "发送消息"}
									title={
										canResume && !text.trim()
											? "恢复中断的回合（发送 Continue）"
											: "发送消息 (Enter)"
									}
									className={clsx(
										"flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150",
										(text.trim() || canResume) && !busy
											? "bg-[var(--text)] text-[var(--bg)] hover:opacity-85 active:scale-95"
											: "bg-[var(--bg-active-fill)] text-[var(--text-30,var(--text-dim))] cursor-not-allowed",
									)}
								>
									{canResume && !text.trim() ? (
										<Play size={11} className="fill-current" />
									) : (
										<ArrowUp size={14} />
									)}
								</button>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* @ file-completion menu — floats above the composer box. */}
			{atMenu.length > 0 && atToken && (
				<FloatingLayer
					anchor={composerCardRef.current}
					placement="top-start"
					offset={6}
					layer="popover"
					onDismiss={() => setMenuDismissed(true)}
					className="max-h-64 overflow-y-auto overflow-x-hidden rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] p-1 w-[min(calc(100vw-32px),600px)]"
				>
					{atMenu.map((p, i) => (
						<button
							key={p}
							type="button"
							onMouseDown={(e) => {
								e.preventDefault();
								applyAtCompletion(p);
							}}
							className={clsx(
								"flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] transition-colors",
								i === menuIndex
									? "bg-[var(--ghost-hover,var(--bg-hover))] text-[var(--text)]"
									: "text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))]",
							)}
						>
							<span className="truncate font-mono">{p}</span>
						</button>
					))}
				</FloatingLayer>
			)}

			{/* Slash-command menu — Codex-style grouped popup. */}
			{slashToken && (
				<SlashMenu
					anchor={composerCardRef.current}
					sections={slashSections}
					activeIndex={Math.min(
						menuIndex,
						Math.max(0, slashItems.length - 1),
					)}
					empty={slashItems.length === 0}
					onSelect={selectSlashItem}
					onDismiss={() => setMenuDismissed(true)}
				/>
			)}
		</div>
	);
}
