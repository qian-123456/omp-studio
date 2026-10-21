/** [B] Composer: annotation chip, slash menu, held queue,
 * steer/stop, model + thinking pickers, /fork interception. */

import clsx from "clsx";
import { caretVisualLines } from "./caretLine";
import {
	ArrowUp,
	ChevronDown,
	CornerDownRight,
	Loader2,
	Play,
	Lightbulb,
	Plus,
	Square,
	X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clipboardFilePaths, importImageFile, listWorkspaceFiles, readTextFile, rpcSend, saveClipboardFile, saveClipboardImage, sessionSnapshot, sessionUsage, validatePath } from "../../lib/ipc";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ImageAttachment, SessionSnapshot } from "../../lib/contracts";
import { applyArgName, buildArgItems, type ArgCandidate } from "./slash/argComplete";
import { findArgProvider } from "./slash/argProviders";
import { AttachmentThumb, FileChip } from "./ImageChips";

import {
	baseName,
	getFileTokenRanges,
	isProbablyBinaryPath,
	parseInlineFiles,
} from "./fileAttach";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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
	const regex = /(🖼️\s*#\d+|📎\s*#\d+|\[(?:Image|图片|File|文件)\s*#\d+\])/gu;
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

import { ensureLive, isResumeCancelled } from "../../lib/ensureLive";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ContextRing } from "./ContextRing";
import { ImagePreviewModal } from "../../components/ImagePreviewModal";
import { FloatingLayer } from "../../components/FloatingLayer";
import { ThinkingLevelPicker, ThinkingLevelStrip } from "../../components/ThinkingLevelPicker";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { isComposing } from "../../lib/hooks";
import { formatWithAnnotations, useComposer } from "../../stores/composer";
import { moveToMain, moveToSideChat } from "../sidechat/annotationRoute";
import { MAX_SIDE_CHAT_DEPTH } from "../sidechat/depth";
import { useUi } from "../../stores/ui";
import { hasLiveUserActivity, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useHeldQueue } from "./heldQueue";
import { abortTurn, interruptAndWait, linkSentSecrets, sendPrompt, useAbortState } from "./send";
import {
	type FollowUpAction,
	FOLLOW_UP_LABEL,
	alternateShortcutHint,
	decideEnterKey,
	normalizeFollowUpBehavior,
	normalizeSendShortcut,
	resolveFollowUpAction,
} from "./sendKeys";
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
	thinkingChipState,
	toModelKey,
} from "../../lib/models";
import { ModelMenuContent } from "../../components/ModelSelect";
import { mergedSuffix, pickToolbarTier, TIER_FULL, TIER_MERGED, TIER_BADGE, TIER_TIGHT } from "./composerToolbar";
import {
	buildSlashSections,
	buildSubcommandItems,
	chipArgHint,
	findCommandItemExact,
	findSubcommandExact,
	flattenSections,
	type SlashMenuItem,
} from "./slash/menu";
import { detectFirstWordSpace, detectSpaceToken, splitFirstWord } from "./slash/spaceToken";
import { SlashMenu } from "./slash/SlashMenu";
import { expandImagesForSend, expandImageTokens } from "./imageTokens";
import { runSlashInput, sendSlashPrompt, type SlashDeps } from "./slash/executors";
import { runCompaction, useCompaction } from "./slash/compaction";
import { findSlashCommand } from "./slash/registry";
import { applyListEdit, continueListOnEnter, indentList, type ListEdit } from "./mdListEdit";
import { useTypeToFocus } from "./useTypeToFocus";
import { useRestoreComposerFocus } from "./useRestoreComposerFocus";
import { remainingDraft } from "./composerRelease";
import {
	argHintLabel,
	chipLiteral,
	findChipRange,
	inlineChipRange,
	insertChipAt,
	isSkillChip,
	loadChip,
	saveChip,
	serializeChip,
	shiftChipOffset,
	type CommandChip,
} from "./slash/chip";
import { CommandChipBadge } from "./slash/CommandChip";
import { requestTakeover } from "../sessions/sessionActions";
import { ContextPillBar, WorkspacePickerPopover } from "./ContextPillBar";
import { AddMenuPopover } from "./AddMenuPopover";
import { SketchPad } from "./sketch/SketchPad";
import { ensureSettings, useSettings } from "../settings/store";
import { runSessionBash } from "./sessionShell";
import { textAnnotationsOf } from "./annotations";
import { AnnotationChip } from "./AnnotationChip";
import { GoalBar } from "./GoalBar";
import { claimEscape } from "../../lib/escapeClaim";

/** How long an interrupt waits for the aborted turn to stop before holding the message. */
const INTERRUPT_WAIT_MS = 15_000;

/** Prepended to outgoing prompts while plan mode is on. */
const PLAN_MODE_PREFIX =
	"[规划模式] 请先分析需求并给出详细的分步实施计划，在我确认之前不要修改任何文件或执行有副作用的操作。\n\n";
const GOAL_TEMPLATE = "[目标: 请输入本次任务目标]";
const FINDER_SELECTION_SCRIPT =
	`osascript -e 'tell application "Finder" to set sel to selection as alias list' -e 'set out to ""' -e 'repeat with f in sel' -e 'set out to out & POSIX path of f & linefeed' -e 'end repeat' -e 'return out'`;


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

/** Ghost/placeholder hint for a legacy chip. A merged subcommand shows only
 * its own usage (none when it takes no arguments). */
function chipHintText(chip: CommandChip): string {
	if (chip.sub) return chip.argHint ?? "";
	const hint = chip.argHint ?? findSlashCommand(chip.name)?.argHint;
	return hint === undefined ? "<参数>" : argHintLabel(chip.name, hint);
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
	const catalogModels = useModelOptions();
	// rpc `get_available_models` fallback, used only while the catalog is empty.
	const [rpcModels, setRpcModels] = useState<ModelOption[] | null>(null);
	const models = catalogModels && catalogModels.length > 0 ? catalogModels : rpcModels;
	const [modelOpen, setModelOpen] = useState(false);
	const modelMenuRef = useRef<HTMLDivElement>(null);

	const [thinkingOpen, setThinkingOpen] = useState(false);


	/** Hint line shown after picking an arg-taking command (`/name <arg>`). */
	const [argHintLine, setArgHintLine] = useState<string | null>(null);

	const taRef = useRef<HTMLTextAreaElement>(null);
	const [contextOpen, setContextOpen] = useState(false);
	const backdropRef = useRef<HTMLDivElement>(null);
	const composerCardRef = useRef<HTMLDivElement>(null);
	// Draft state bound to useComposer store so switching sessions does not lose input
	const text = useComposer((s) => s.drafts[sessionId] ?? "");
	const hasImageTokens = useMemo(
		() => /(?:🖼️\s*#\d+|📎\s*#\d+|\[(?:Image|图片|File|文件)\s*#\d+\])/u.test(text),
		[text],
	);
	const setDraft = useComposer((s) => s.setDraft);
	const clearDraft = useComposer((s) => s.clearDraft);

	// Command chip: an atomic `/name` pinned to the input start; the draft
	// holds only its arguments and `serializeChip` restores `/name args` on
	// send. Persisted per session alongside drafts (see slash/chip.ts).
	const [chip, setChipState] = useState<CommandChip | null>(() => loadChip(sessionId));
	const hasInlineTokens = hasImageTokens || chip !== null;
	const setChip = useCallback(
		(next: CommandChip | null) => {
			setChipState(next);
			saveChip(sessionId, next);
		},
		[sessionId],
	);
	useEffect(() => {
		setChipState(loadChip(sessionId));
	}, [sessionId]);
	// Inline (skill) chips keep their literal in the draft; every draft edit
	// shifts the recorded offset, and an edit that breaks the literal drops
	// the chip (the text stays as plain text).
	const setText = (nextText: string) => {
		if (chip?.offset !== undefined) {
			const prev = useComposer.getState().drafts[sessionId] ?? "";
			const offset = shiftChipOffset(prev, nextText, chip.offset, chipLiteral(chip).length);
			const moved = { ...chip, offset };
			if (!inlineChipRange(moved, nextText)) setChip(null);
			else if (offset !== chip.offset) setChip(moved);
		}
		setDraft(sessionId, nextText);
	};
	const inlineRange = useMemo(() => inlineChipRange(chip, text), [chip, text]);
	const legacyChip = chip !== null && chip.offset === undefined;
	// Draft changed behind our back (restore, insertText, session switch):
	// re-anchor to the nearest intact literal or drop the chip.
	useEffect(() => {
		if (!chip || chip.offset === undefined || inlineRange) return;
		const found = findChipRange(chip, text, chip.offset);
		setChip(found ? { ...chip, offset: found.start } : null);
	}, [chip, text, inlineRange, setChip]);
	// Measured overlay width → text-indent on textarea + mirrors so typed
	// args start right after the chip.
	const chipElRef = useRef<HTMLSpanElement>(null);
	const [chipIndent, setChipIndent] = useState(0);
	useLayoutEffect(() => {
		const el = chipElRef.current;
		setChipIndent(el ? el.offsetWidth + 6 : 0);
		if (!el) return;
		const ro = new ResizeObserver(() => setChipIndent(el.offsetWidth + 6));
		ro.observe(el);
		return () => ro.disconnect();
	}, [chip, legacyChip]);
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
	const clearAnnotations = useComposer((s) => s.clearAnnotations);
	const composerImages = useComposer(
		(s) => s.images[sessionId] ?? EMPTY_LIST,
	);
	const composerFiles = useComposer(
		(s) => s.files[sessionId] ?? EMPTY_LIST,
	);
	const addImage = useComposer((s) => s.addImage);
	const addFile = useComposer((s) => s.addFile);
	const clearImages = useComposer((s) => s.clearImages);
	const clearFiles = useComposer((s) => s.clearFiles);
	const textAnnotations = useMemo(() => textAnnotationsOf(annotations), [annotations]);
	// Quote annotations alone are a sendable message (formatWithAnnotations
	// handles empty text); only a fully empty composer turns ▶ into resume.
	const hasPayload = text.trim().length > 0 || textAnnotations.length > 0 || chip !== null;
	const resumeMode = canResume && !hasPayload;
	// Send shortcut + follow-up behavior (Settings ▸ General); defaults until settings load.
	const sendShortcut = normalizeSendShortcut(useSettings((s) => s.settings?.sendShortcut));
	const followUpBehavior = normalizeFollowUpBehavior(
		useSettings((s) => s.settings?.followUpBehavior),
	);
	// What a plain send does while a turn runs (streaming round button).
	const streamingSendAction = resolveFollowUpAction(followUpBehavior, false, true);
	const streamingAltAction = resolveFollowUpAction(followUpBehavior, true, true);
	const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);

	const held = useHeldQueue((s) => s.queues[sessionId] ?? EMPTY_LIST);
	const setDismissed = useHeldQueue((s) => s.setDismissed);
	const pushHeld = useHeldQueue((s) => s.push);


	// @ file-completion state
	const sessionMeta = useSessions((s) => s.sessions[sessionId]);
	// Annotation move ⇄: main composer → side chat; a side chat's own composer (embedded
	// in the right panel) → its parent's main composer. Depth-capped parents cannot fork.
	const annotationMove = useMemo(() => {
		const parentId = sessionMeta?.parentId;
		if (compact && parentId) {
			return { label: "移到主对话", run: (id: string) => moveToMain(sessionId, parentId, id) };
		}
		if ((sessionMeta?.forkDepth ?? 0) >= MAX_SIDE_CHAT_DEPTH) return null;
		return { label: "移到辅助对话", run: (id: string) => moveToSideChat(sessionId, id) };
	}, [compact, sessionId, sessionMeta?.parentId, sessionMeta?.forkDepth]);
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


	// With no live get_state (app restarted or the process was idle-suspended)
	// the thinking level / context size come from the transcript instead of
	// falling back to "auto" / 0%.
	const hasLiveState = live?.state != null;
	const [snapshotRec, setSnapshotRec] = useState<{ id: string; snap: SessionSnapshot } | null>(null);
	useEffect(() => {
		if (hasLiveState) return;
		let cancelled = false;
		sessionSnapshot(sessionId)
			.then((snap) => {
				if (!cancelled) setSnapshotRec({ id: sessionId, snap });
			})
			.catch((err) => console.warn("[composer] session snapshot fetch failed", err));
		return () => {
			cancelled = true;
		};
	}, [sessionId, hasLiveState]);
	const snapshot = snapshotRec?.id === sessionId ? snapshotRec.snap : null;

	// Total tokens summary
	const [totalTokensStr, setTotalTokensStr] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		sessionUsage(sessionId)
			.then((u) => {
				if (!cancelled && u.available) {
					setTotalTokensStr(`${(u.tokens / 1000).toFixed(1)}k token`);
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
	const [sketchOpen, setSketchOpen] = useState(false);
	const addBtnRef = useRef<HTMLButtonElement>(null);
	const wsPillBtnRef = useRef<HTMLButtonElement>(null);
	const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
	// Context pill bar exists only on a blank draft: the session has seen no
	// user/assistant activity (transcript items, pending echoes, in-flight
	// turn) and the backend reports no last-assistant snippet yet.
	const sessionHasMessages = useLive((s) =>
		hasLiveUserActivity(s.sessions[sessionId]),
	) || Boolean(sessionMeta?.lastAssistant);
	const workspacePickerIgnoreRefs = useMemo(
		() => [wsPillBtnRef, addBtnRef],
		[],
	);
	const planMode = useComposer((s) => s.planModes[sessionId] === true);
	const togglePlanMode = useComposer((s) => s.togglePlanMode);

	// When a plan-mode turn yields, surface the produced plan in the
	// right-side 计划 tab (once per streaming round).
	const planPanelOpenedForTurn = useRef(false);
	useEffect(() => {
		if (streaming) planPanelOpenedForTurn.current = false;
		else if (planMode && !planPanelOpenedForTurn.current) {
			planPanelOpenedForTurn.current = true;
			useUi.getState().setRightTab("plan");
		}
	}, [streaming, planMode]);

	/** Attach one filesystem path: images go to the gallery, text files are
	 * inlined as doc references, folders/binaries as path-only references. */
	const attachPath = async (filePath: string, isDir = false) => {
		if (isDir) {
			addAnnotation(sessionId, { source: "doc", file: filePath, text: `文件夹: ${filePath}` });
			return;
		}
		if (IMAGE_EXT_RE.test(filePath)) {
			await insertImageToken(filePath);
			return;
		}
		// Known-binary formats never get inlined — even if a file happens to
		// decode as UTF-8, office/archive payloads are meaningless as text.
		if (isProbablyBinaryPath(filePath)) {
			addAnnotation(sessionId, { source: "doc", file: filePath, text: `文件: ${filePath}` });
			return;
		}
		try {
			const content = await readTextFile(filePath);
			addAnnotation(sessionId, { source: "doc", file: filePath, text: content });
		} catch {
			addAnnotation(sessionId, { source: "doc", file: filePath, text: `文件: ${filePath}` });
		}
	};

	/** Attach a pasted/dropped path as an inline token instead of a doc
	 * annotation: images get the 🖼️ gallery, everything else a 📎#N token
	 * carrying the REAL path (omp reads the file when the prompt is sent). */
	const attachPastedPath = async (filePath: string, isDir = false) => {
		if (!isDir && IMAGE_EXT_RE.test(filePath)) {
			await insertImageToken(filePath);
			return;
		}
		processFilePath(filePath, isDir ? `${baseName(filePath)}/` : baseName(filePath));
	};

	/** Resolve a dropped path (from Tauri drag-drop) and attach it. */
	const attachDroppedPath = async (filePath: string) => {
		try {
			const info = await validatePath(filePath);
			await attachPastedPath(filePath, info.isDir);
		} catch {
			await attachPastedPath(filePath, false);
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
		if (!focusNonce) return;
		const ta = taRef.current;
		if (!ta) return;
		const wasFocused = document.activeElement === ta;
		ta.focus();
		// A pre-filled draft (e.g. text typed in the new-session placeholder) must
		// not leave the caret at position 0.
		if (!wasFocused) ta.setSelectionRange(ta.value.length, ta.value.length);
	}, [focusNonce]);
	// Keys typed while nothing editable is focused go to the composer.
	useTypeToFocus(taRef, compact);
	// Keep focus in the composer (session entry, closed popovers, blank clicks).
	useRestoreComposerFocus(taRef, compact, sessionId);

	// Slash token at cursor position (opens the command menu)
	const slashToken = useMemo(() => {
		if (menuDismissed) return null;
		// The chip's own `/skill:x` literal must not reopen the menu.
		if (inlineRange && cursorPos > inlineRange.start && cursorPos <= inlineRange.end) return null;
		return getSlashToken(text, cursorPos);
	}, [text, cursorPos, menuDismissed, inlineRange]);

	/** True when the composer holds text outside the `/query` token —
	 * hides `requiresEmptyComposer` commands. */
	const composerHasOtherText = useMemo(() => {
		if (chip) return true;
		if (!slashToken) return false;
		return (
			text.slice(0, slashToken.start).trim().length > 0 ||
			text.slice(slashToken.end).trim().length > 0
		);
	}, [text, slashToken, chip]);

	const visualizeEnabled = useSettings((s) => s.settings?.visualizeEnabled !== false);
	useEffect(ensureSettings, []);
	const slashSections = useMemo(() => {
		if (!slashToken) return [];
		return buildSlashSections(slashToken.query, commands, composerHasOtherText, {
			visualizeEnabled,
		});
	}, [slashToken, commands, composerHasOtherText, visualizeEnabled]);
	const slashItems = useMemo(
		() => flattenSections(slashSections),
		[slashSections],
	);

	useEffect(() => setMenuIndex(0), [slashToken?.query]);

	// Subcommand menu: a legacy chip whose command takes subcommands lists them
	// while the caret sits in the draft's first word.
	const subParent = useMemo(
		() => (legacyChip && chip && !chip.sub ? findCommandItemExact(chip.name, commands) : null),
		[legacyChip, chip, commands],
	);
	const subQuery = useMemo(() => {
		const before = text.slice(0, cursorPos);
		return /^\S*$/.test(before) ? before : null;
	}, [text, cursorPos]);
	const subItems = useMemo(
		() =>
			subParent?.subcommands?.length && subQuery !== null && !menuDismissed
				? buildSubcommandItems(subParent, subQuery)
				: [],
		[subParent, subQuery, menuDismissed],
	);
	const subSections = useMemo(
		() => (subItems.length > 0 ? [{ label: "子命令" as const, items: subItems }] : []),
		[subItems],
	);
	useEffect(() => setMenuIndex(0), [subQuery]);

	// Argument menu: `/<cmd> <sub> <name>` completes from the provider table
	// (MCP servers, plugins, …) while the caret sits in the draft's first word.
	const argKey = legacyChip && chip?.sub ? `${chip.name} ${chip.sub}` : null;
	const argProvider = legacyChip && chip ? findArgProvider(chip.name, chip.sub) : null;
	const argWanted = argProvider !== null && subQuery !== null && !menuDismissed;
	const [argCandidates, setArgCandidates] = useState<{ key: string; list: ArgCandidate[] } | null>(null);
	useEffect(() => {
		if (!argProvider || !argKey || !argWanted || argCandidates?.key === argKey) return;
		let cancelled = false;
		argProvider
			.load(sessionMeta?.cwd)
			.then((list) => {
				if (!cancelled) setArgCandidates({ key: argKey, list });
			})
			.catch(() => {
				if (!cancelled) setArgCandidates({ key: argKey, list: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [argProvider, argKey, argWanted, argCandidates?.key, sessionMeta?.cwd]);
	const argItems = useMemo(
		() =>
			argWanted && argProvider && chip?.sub && argCandidates?.key === argKey
				? buildArgItems(argProvider, argCandidates.list, chip.sub, /^\S*/.exec(text)?.[0].slice(0, cursorPos) ?? "")
				: [],
		[argWanted, argProvider, argCandidates, argKey, chip?.sub, text, cursorPos],
	);
	const argSections = useMemo(
		() =>
			argProvider && argItems.length > 0
				? [{ label: argProvider.groupLabel, items: argItems }]
				: [],
		[argProvider, argItems],
	);
	useEffect(() => setMenuIndex(0), [argKey, subQuery]);

	const state = live?.state ?? {};
	const stateThinkingLevel =
		typeof state.thinkingLevel === "string" ? state.thinkingLevel : (snapshot?.thinkingLevel ?? undefined);
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

	// Context usage calculations for ContextRing
	const contextRaw = live?.state?.contextUsage;
	// Catalog window (models.yml, refreshed when Settings ▸ 上下文窗口 writes) wins over the
	// window baked into the running omp process, so a settings change shows up immediately.
	const contextWindow = currentModelOption?.contextWindow;
	const liveUsage =
		typeof contextRaw === "object" && contextRaw !== null ? (contextRaw as Record<string, unknown>) : null;
	const contextUsageObj: Record<string, unknown> | null = liveUsage
		? contextWindow && typeof liveUsage.tokens === "number"
			? { ...liveUsage, contextWindow, percent: (liveUsage.tokens / contextWindow) * 100 }
			: liveUsage
		: snapshot?.contextTokens != null && contextWindow
			? {
					tokens: snapshot.contextTokens,
					contextWindow,
					percent: (snapshot.contextTokens / contextWindow) * 100,
				}
			: null;
	const contextPct =
		typeof contextUsageObj?.percent === "number"
			? contextUsageObj.percent
			: undefined;
	const thinkingLevels = useMemo(
		() =>
			resolveThinkingLevels(
				(state.model as Record<string, unknown> | undefined)?.thinking,
				currentModelOption?.thinking,
				stateThinkingLevel,
			),
		[state.model, currentModelOption, stateThinkingLevel],
	);


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

	// The toolbar never wraps: its own width picks how much collapses (composerToolbar.ts).
	const toolbarRef = useRef<HTMLDivElement>(null);
	const [toolbarWidth, setToolbarWidth] = useState(0);
	useLayoutEffect(() => {
		const el = toolbarRef.current;
		if (!el) return;
		const measure = () => setToolbarWidth(el.clientWidth);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	const modelLabel = current.label || sessionMeta?.model || (models === null ? "加载中…" : "选择模型…");
	const thinkingKind = thinkingChipState(thinkingLevels, currentModelOption?.reasoning).kind;
	const toolbarTier = pickToolbarTier({
		width: toolbarWidth,
		modelLabel,
		thinkingKind,
		thinkingLevel: currentThinking,
		extra: (planMode ? 24 : 0) + (held.length > 0 && !streaming ? 64 : 0),
	});
	const compacting = useCompaction((s) => s.active[sessionId] === true);
	const compactContext = async () => {
		await runCompaction({
			sessionId,
			rpcSend: (command) => rpcSend(sessionId, command),
			ensureAlive: async () => {
				if (!live?.alive) await ensureLive(sessionId);
			},
			errorText: (err) => (isResumeCancelled(err) ? null : errMsg(err)),
		});
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
		openContextPopover: () => setContextOpen(true),
		insertText: (t) =>
			setText(`${useComposer.getState().drafts[sessionId] ?? ""}${t}`),
	});

	/** Menu selection: arg commands become an atomic chip at the input start
	 * (draft keeps only the args); the rest run now, removing only the
	 * `/token` and keeping any other draft text. */
	const selectSlashItem = (
		item: SlashMenuItem,
		ctx?: { text: string; token: { query: string; start: number; end: number } },
	) => {
		const tok = ctx?.token ?? slashToken;
		const src = ctx?.text ?? text;
		if (!tok) return;
		setArgHintLine(null);
		if (item.argHint && isSkillChip({ name: item.name, title: "" })) {
			// Skill: the token lives right where `/query` was typed.
			const next = insertChipAt(
				{ name: item.name, title: item.title || item.name, argHint: item.argHint },
				src,
				tok.start,
				tok.end,
			);
			// Replace any previous inline chip (its literal stays as plain text).
			setChip(next.chip);
			setDraft(sessionId, next.text);
			setCursorPos(next.caret);
			setMenuDismissed(true);
			setTimeout(() => {
				if (taRef.current) {
					taRef.current.focus();
					taRef.current.setSelectionRange(next.caret, next.caret);
				}
			}, 0);
			return;
		}
		// A subcommand row picked from the top-level list becomes `/parent sub`.
		if (item.subOf) {
			const before = src.slice(0, tok.start);
			setText(`${before}${src.slice(tok.end)}`);
			setChip({
				name: item.subOf,
				title: item.parentTitle || item.subOf,
				sub: item.name,
				...(item.argHint ? { argHint: item.argHint } : {}),
			});
			setCursorPos(before.length);
			setMenuDismissed(!findArgProvider(item.subOf, item.name));
			setTimeout(() => {
				if (taRef.current) {
					taRef.current.focus();
					taRef.current.setSelectionRange(before.length, before.length);
				}
			}, 0);
			return;
		}
		// Commands that take args or subcommands become a chip; the subcommand
		// list opens right away (its first entry runs the command itself).
		if (item.argHint || item.subcommands?.length) {
			const before = src.slice(0, tok.start);
			const after = src.slice(tok.end);
			// Any text around the token becomes the command's arguments.
			const nextText = `${before}${after}`;
			setText(nextText);
			setChip({ name: item.name, title: item.title || item.name, argHint: chipArgHint(item) });
			setCursorPos(before.length);
			// Commands with subcommands open the subcommand menu right away.
			setMenuDismissed(!item.subcommands?.length);
			setTimeout(() => {
				if (taRef.current) {
					taRef.current.focus();
					taRef.current.setSelectionRange(before.length, before.length);
				}
			}, 0);
			return;
		}
		const before = src.slice(0, tok.start);
		const after = src.slice(tok.end);
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
	/** Merge a picked subcommand into the legacy chip and drop the typed word. */
	const selectSubcommand = (item: SlashMenuItem, rest?: string) => {
		if (!chip || chip.offset !== undefined || chip.sub) return;
		const { argHint: _drop, ...base } = chip;
		if (item.bare) {
			// The parent command's own (native) action, e.g. `/memory` → settings.
			const name = chip.name;
			setChip(null);
			setText(splitFirstWord(text).rest);
			setCursorPos(0);
			setMenuDismissed(true);
			setArgHintLine(null);
			void runSlashInput(sessionId, `/${name}`, makeSlashDeps()).catch((err) => {
				if (!isResumeCancelled(err)) toast.error(`/${name} 失败: ${errMsg(err)}`);
			});
			setTimeout(() => taRef.current?.focus(), 0);
			return;
		}
		setChip({ ...base, sub: item.name, ...(item.argHint ? { argHint: item.argHint } : {}) });
		setText(rest ?? splitFirstWord(text).rest);
		setCursorPos(0);
		// Subcommands with an argument provider open its completion menu right away.
		setMenuDismissed(!findArgProvider(chip.name, item.name));
		setArgHintLine(null);
		setTimeout(() => {
			if (taRef.current) {
				taRef.current.focus();
				taRef.current.setSelectionRange(0, 0);
			}
		}, 0);
	};
	/** Write a picked completion in as the argument (not merged into the chip). */
	const selectArgItem = (item: SlashMenuItem) => {
		const next = applyArgName(text, item.name);
		setText(next.text);
		setCursorPos(next.caret);
		setTimeout(() => {
			if (taRef.current) {
				taRef.current.focus();
				taRef.current.setSelectionRange(next.caret, next.caret);
			}
		}, 0);
	};
	const submit = async (action: FollowUpAction) => {
		const raw = text;
		if (!hasPayload || busy) return;
		// Chip + args serialize to the exact `/name args` the user would have
		// typed — history, masking and dispatch all run on that form.
		const trimmedRaw = serializeChip(chip, raw).trim();
		// Privacy: replace marked / auto / accepted ranges with placeholders.
		// The draft and local history keep the real text; everything sent is masked.
		const maskedRaw = maskText(raw, privacy.highlights);
		const trimmedMasked = serializeChip(chip, maskedRaw, inlineRange ? "fuzzy" : "exact").trim();
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
		const slashImages = useComposer.getState().images[sessionId] ?? [];
		const slashAttachments: ImageAttachment[] = slashImages.map((img, i) => ({
			id: img.id || `img-${i + 1}`,
			path: img.path,
			marker: `[Image #${i + 1}]`,
			width: img.width,
			height: img.height,
		}));
		const currentSessionImages = slashImages;
		if (trimmedRaw.startsWith("/")) {
			// Registry command (/fork, /status, …) — run natively or forward.
			setBusy(true);
			try {
				const outcome = await runSlashInput(
					sessionId,
					expandImageTokens(trimmedMasked, slashImages),
					makeSlashDeps(),
				);
				if (outcome === "keep") return;
				if (outcome === null) {
					// Unknown `/x`: send to omp so its own builtins still run.
					pushHistory(trimmedRaw);
					await sendSlashPrompt(
						sessionId,
						expandImagesForSend(trimmedMasked, slashImages, "suffix"),
						slashAttachments,
					);
				}
				finishPrivacySend();
				setChip(null);
				clearDraft(sessionId);
				clearAnnotations(sessionId);
				clearImages(sessionId);
				clearFiles(sessionId);
			} catch (err) {
				if (!isResumeCancelled(err))
					toast.error(`发送失败: ${errMsg(err)}`);
			} finally {
				setBusy(false);
			}
			return;
		}
		let outgoingRaw = expandImagesForSend(maskedRaw, currentSessionImages);

		// Convert `📎#N` to `[文件 #N: <real path>]` — omp reads the file itself.
		const currentSessionFiles = useComposer.getState().files[sessionId] ?? [];
		outgoingRaw = outgoingRaw.replace(/📎\s*#(\d+)/gu, (_match, numStr) => {
			const n = parseInt(numStr, 10);
			const f = currentSessionFiles[n - 1];
			return f?.path ? `[文件 #${n}: ${f.path}]` : `[文件 #${n}]`;
		});
		// Same missing-token safety as images: deleted 📎#N tokens still ship
		// their path so nothing silently drops out of the prompt.
		const missingFiles = currentSessionFiles.filter((_f, i) => {
			const n = i + 1;
			return !outgoingRaw.includes(`[文件 #${n}`);
		});
		if (missingFiles.length > 0) {
			const missingMarkers = missingFiles
				.map((f) => `[文件 #${currentSessionFiles.indexOf(f) + 1}: ${f.path}]`)
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
		// Queue (and a plain send that raced turn-end while streaming): hold locally
		// (ARCHITECTURE §11 B); the post-turn HeldQueueBar sends it with its image attachments.
		if (action === "queue" || (action === "send" && streaming)) {
			pushHeld(sessionId, message, imageAttachments);
			pushHistory(raw.trim());
			finishPrivacySend();
			clearDraft(sessionId);
			clearAnnotations(sessionId);
			clearImages(sessionId);
			clearFiles(sessionId);
			return;
		}
		setBusy(true);
		// Release the input as soon as the message is echoed into the thread; the
		// resume/RPC awaits below can take seconds. Restore everything if the send fails.
		const prevAnnotations = annotations;
		let released = false;
		const releaseComposer = () => {
			released = true;
			const store = useComposer.getState();
			const cur = store.drafts[sessionId] ?? "";
			if (cur === raw) {
				clearDraft(sessionId);
				clearAnnotations(sessionId);
				clearImages(sessionId);
				clearFiles(sessionId);
				return;
			}
			// Typed while the send was in flight: keep the new input and drop
			// only what this send consumed (sent attachments + their tokens).
			const nImg = currentSessionImages.length;
			const nFile = currentSessionFiles.length;
			setDraft(sessionId, remainingDraft(cur, raw, nImg, nFile));
			if (nImg > 0) {
				const sentIds = new Set(currentSessionImages);
				store.setImages(
					sessionId,
					(store.images[sessionId] ?? []).filter((i) => !sentIds.has(i)),
				);
			}
			if (nFile > 0) {
				const sentIds = new Set(currentSessionFiles);
				store.setFiles(
					sessionId,
					(store.files[sessionId] ?? []).filter((f) => !sentIds.has(f)),
				);
			}
			for (const a of prevAnnotations) store.removeAnnotation(sessionId, a.id);
		};
		const restoreComposer = () => {
			if (!released) return;
			if (!useComposer.getState().drafts[sessionId]) setDraft(sessionId, raw);
			useComposer.getState().setImages(sessionId, currentSessionImages);
			useComposer.getState().setFiles(sessionId, currentSessionFiles);
			for (const { id: _id, ...a } of prevAnnotations) addAnnotation(sessionId, a);
		};
		try {
			// Interrupt: abort and wait for the turn to stop. If it keeps running,
			// hold the message rather than dropping it.
			const idle =
				action === "interrupt" && streaming
					? await interruptAndWait(sessionId, INTERRUPT_WAIT_MS)
					: true;
			if (idle) {
				await sendPrompt(sessionId, message, {
					steer: action === "steer",
					images: imageAttachments,
					onEchoed: releaseComposer,
				});
				// Cancelled takeover returns without echoing: keep the draft for retry.
				if (!released) return;
			} else {
				pushHeld(sessionId, message, imageAttachments);
				toast.error("打断超时，回合仍在运行：消息已暂存，回合结束后自动发送");
				releaseComposer();
			}
			pushHistory(raw.trim());
			finishPrivacySend();
		} catch (err) {
			restoreComposer();
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

	const removeFileByIndex = (fileIndex: number, currentText?: string) => {
		const textToUse = currentText !== undefined ? currentText : text;
		const curFiles = useComposer.getState().files[sessionId] ?? [];
		if (fileIndex < 0 || fileIndex >= curFiles.length) return;
		const num = fileIndex + 1;
		const nextFiles = curFiles.filter((_, idx) => idx !== fileIndex);
		useComposer.getState().setFiles(sessionId, nextFiles);

		// Remove token for this file from text: `📎 #1` or `[文件 #1: ...]`
		const tokenRe = new RegExp(
			`\\s*(?:📎\\s*#${num}|\\[(?:File|文件)\\s*#${num}(?::[^\\]]*)?\\])\\s*`,
			"gu",
		);
		let nextText = textToUse.replace(tokenRe, " ").trim();
		// Renumber remaining tokens > num
		for (let i = num + 1; i <= curFiles.length; i++) {
			const oldRe1 = new RegExp(`📎\\s*#${i}\\b`, "gu");
			const oldRe2 = new RegExp(`(\\[(?:File|文件)\\s*#)${i}(\\b|\\]|:)`, "gu");
			nextText = nextText.replace(oldRe1, `📎#${i - 1}`).replace(oldRe2, `$1${i - 1}$2`);
		}
		setText(nextText);
		setDraft(sessionId, nextText);
	};

	/** Insert one atomic attachment token at the caret, restoring focus. Reads
	 * the draft fresh so it also works from non-DOM events (Tauri drop). */
	const insertMarkerAtCursor = (marker: string) => {
		const currentText = useComposer.getState().drafts[sessionId] ?? "";
		const ta = taRef.current;
		const start = ta ? ta.selectionStart : Math.min(cursorPos, currentText.length);
		const end = ta ? ta.selectionEnd : start;
		const before = currentText.slice(0, start);
		const after = currentText.slice(end);
		const spacerBefore =
			before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n")
				? " "
				: "";
		// Always leave a space after the token so the caret never sits flush
		// against it (paste at end-of-text previously had no trailing gap).
		const spacerAfter = after.startsWith(" ") || after.startsWith("\n") ? "" : " ";
		const token = `${spacerBefore}${marker}${spacerAfter}`;
		const nextText = `${before}${token}${after}`;
		setText(nextText);
		setDraft(sessionId, nextText);
		const nextCursor = before.length + token.length;
		setCursorPos(nextCursor);
		setTimeout(() => {
			if (taRef.current) {
				taRef.current.focus();
				taRef.current.setSelectionRange(nextCursor, nextCursor);
			}
		}, 0);
	};

	/** Register an image path as a `🖼️#N` token at the caret (saved clipboard
	 * images and real paths alike). */
	const insertImageToken = async (imagePath: string, name?: string) => {
		try {
			// Copy into the app clip cache: the asset protocol can only serve that
			// directory, and temp sources (Finder screenshots) get deleted. Fall
			// back to the original path if the copy fails.
			const stored = await importImageFile(imagePath).catch(() => imagePath);
			const dims = await getImageDimensions(convertFileSrc(stored));
			const dimensions = dims.width > 0 && dims.height > 0 ? dims : undefined;
			addImage(sessionId, stored, name, dimensions);
			const nextNum = (useComposer.getState().images[sessionId] ?? []).length;
			insertMarkerAtCursor(`🖼️#${nextNum}`);
			toast.success(`已插入图片 #${nextNum}`);
		} catch (err) {
			toast.error(`处理图片失败: ${errMsg(err)}`);
		}
	};

	const processImageFile = async (file: File | Blob) => {
		try {
			const base64 = await fileToBase64(file);
			const savedPath = await saveClipboardImage(base64);
			await insertImageToken(savedPath, file instanceof File ? file.name : undefined);
		} catch (err) {
			toast.error(`处理图片失败: ${errMsg(err)}`);
		}
	};

	/** Register a non-image path as a `📎#N` token at the caret; the real
	 * filesystem path is serialized into the outgoing prompt. */
	const processFilePath = (filePath: string, name?: string) => {
		try {
			addFile(sessionId, filePath, name);
			const nextNum = (useComposer.getState().files[sessionId] ?? []).length;
			insertMarkerAtCursor(`📎#${nextNum}`);
			toast.success(`已插入文件 #${nextNum}`);
		} catch (err) {
			toast.error(`附加文件失败: ${errMsg(err)}`);
		}
	};

	/** WKWebView File objects carry no filesystem path: persist the bytes
	 * under the app cache dir and attach that path as a 📎 token. File bytes
	 * are never decoded or inlined here — binary formats stay safe. */
	const processPastedFile = async (file: File) => {
		try {
			const base64 = await fileToBase64(file);
			const savedPath = await saveClipboardFile(base64, file.name || undefined);
			processFilePath(savedPath, file.name || undefined);
		} catch (err) {
			toast.error(`附加文件失败: ${errMsg(err)}`);
		}
	};

	const handleInsertSketch = async (dataUrl: string) => {
		setSketchOpen(false);
		try {
			const blob = await (await fetch(dataUrl)).blob();
			await processImageFile(new File([blob], `sketch-${Date.now()}.png`, { type: "image/png" }));
		} catch (err) {
			toast.error(`插入草图失败: ${errMsg(err)}`);
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

	/** DOM drop fallback: under Tauri the native drag-drop event delivers real
	 * paths (see the listener effect below); this only fires for HTML5 drops
	 * that carry File objects. Bytes go through processPastedFile — a docx is
	 * never inlined as text. */
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
				await processPastedFile(file);
			}
		}
	};

	/** Paste: screenshots keep the image pipeline; a Finder copy resolves the
	 * REAL paths from the macOS pasteboard so the file attaches as a token
	 * (the filename is never pasted as text). */
	const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		const fileItems: File[] = [];
		const types: string[] = e.clipboardData ? Array.from(e.clipboardData.types) : [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.kind !== "file") continue;
			const f = item.getAsFile();
			if (f) fileItems.push(f);
		}
		const hasFilesType = types.includes("Files");
		if (fileItems.length === 0 && !hasFilesType) return;
		// Files present → suppress default now, before any await, so the
		// filename/text flavor can't sneak into the draft.
		e.preventDefault();

		const imageFiles = fileItems.filter((f) => f.type.startsWith("image/"));
		const nonImageFiles = fileItems.filter((f) => !f.type.startsWith("image/"));
		let nativePaths: string[] = [];
		if (nonImageFiles.length > 0 || hasFilesType) {
			try {
				nativePaths = await clipboardFilePaths();
			} catch {
				nativePaths = [];
			}
		}

		if (nativePaths.length === 0 && nonImageFiles.length === 0) {
			if (imageFiles.length === 0) {
				// Clipboard advertised Files but nothing resolved — surface it.
				toast.error("无法读取剪贴板中的文件路径");
				return;
			}
			// Screenshot-style image data only (no file URLs on the pasteboard).
			for (const img of imageFiles) await processImageFile(img);
			return;
		}
		// Attach real paths first, in pasteboard order (images included).
		const covered = new Set(nativePaths.map((p) => baseName(p).toLowerCase()));
		for (const p of nativePaths) await attachDroppedPath(p);
		// Anything the pasteboard didn't resolve (no file URL) falls back to
		// the File bytes: images through the image pipeline, the rest through
		// a cache-dir write + 📎 token.
		for (const f of fileItems) {
			if (f.name && covered.has(f.name.toLowerCase())) continue;
			if (f.type.startsWith("image/")) {
				await processImageFile(f);
			} else {
				await processPastedFile(f);
			}
		}
	};

	// Tauri intercepts OS file drops before the DOM: listen for the native
	// event and hit-test against this textarea so drops land as real paths.
	const osDropRef = useRef<(paths: string[]) => void>(() => {});
	useEffect(() => {
		osDropRef.current = (paths) => {
			for (const p of paths) void attachDroppedPath(p);
		};
	});
	useEffect(() => {
		const hitTest = (pos: { x: number; y: number }) => {
			const ta = taRef.current;
			if (!ta) return false;
			// Drag-drop positions are physical pixels.
			const scale = window.devicePixelRatio || 1;
			const r = ta.getBoundingClientRect();
			return (
				pos.x / scale >= r.left &&
				pos.x / scale <= r.right &&
				pos.y / scale >= r.top &&
				pos.y / scale <= r.bottom
			);
		};
		let unlisten: (() => void) | undefined;
		let disposed = false;
		getCurrentWebview()
			.onDragDropEvent((event) => {
				const p = event.payload;
				if (p.type === "enter" || p.type === "over") {
					setIsDraggingOver(hitTest(p.position));
				} else if (p.type === "drop") {
					setIsDraggingOver(false);
					if (hitTest(p.position) && p.paths.length > 0) {
						osDropRef.current(p.paths);
					}
				} else {
					setIsDraggingOver(false);
				}
			})
			.then((u) => {
				if (disposed) u();
				else unlisten = u;
			})
			.catch((err) => console.warn("[composer] drag-drop listener failed", err));
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, []);

	// Atomic caret targets: image + file tokens share navigation/deletion.
	const tokenRanges = useMemo(
		() =>
			[
				...getImageTokenRanges(text),
				...getFileTokenRanges(text),
				...(inlineRange && chip
					? [{ ...inlineRange, num: 0, token: chipLiteral(chip) }]
					: []),
			].sort((a, b) => a.start - b.start),
		[text, inlineRange, chip],
	);

	/** Apply a list edit through `execCommand` so the browser keeps native
	 * undo/redo; falls back to a direct value write when it is unavailable. */
	const applyTextEdit = (ta: HTMLTextAreaElement, edit: ListEdit) => {
		if (edit.from !== edit.to || edit.insert !== "") {
			ta.setSelectionRange(edit.from, edit.to);
			const ok =
				edit.insert === ""
					? document.execCommand("delete")
					: document.execCommand("insertText", false, edit.insert);
			if (!ok) {
				const next = applyListEdit(ta.value, edit);
				setText(next);
				setDraft(sessionId, next);
			}
		}
		requestAnimationFrame(() => {
			ta.setSelectionRange(edit.selStart, edit.selEnd);
			setCursorPos(edit.selStart);
		});
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (isComposing(e)) return;
		// Atomic ArrowLeft navigation across image token
		if (e.key === "ArrowLeft" && !e.altKey && !e.metaKey) {
			const ta = taRef.current;
			if (ta && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
				const pos = ta.selectionStart;
				const ranges = tokenRanges;
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
				const ranges = tokenRanges;
				const token = ranges.find((r) => r.start <= pos && pos < r.end);
				if (token) {
					e.preventDefault();
					ta.setSelectionRange(token.end, token.end);
					setCursorPos(token.end);
					return;
				}
			}
		}
		// Command chip: one Backspace at the start of the args deletes it whole.
		if (e.key === "Backspace" && inlineRange && !e.shiftKey && !e.metaKey && !e.altKey) {
			const ta = taRef.current;
			if (ta && ta.selectionStart === ta.selectionEnd) {
				const pos = ta.selectionStart;
				const spaceAfter = text[inlineRange.end] === " ";
				if (pos === inlineRange.end || (spaceAfter && pos === inlineRange.end + 1)) {
					e.preventDefault();
					const cutEnd = spaceAfter ? inlineRange.end + 1 : inlineRange.end;
					const nextText = text.slice(0, inlineRange.start) + text.slice(cutEnd);
					setChip(null);
					setDraft(sessionId, nextText);
					setCursorPos(inlineRange.start);
					setTimeout(() => ta.setSelectionRange(inlineRange.start, inlineRange.start), 0);
					return;
				}
			}
		}
		if (e.key === "Backspace" && legacyChip && !e.shiftKey && !e.metaKey && !e.altKey) {
			const ta = taRef.current;
			if (ta && ta.selectionStart === 0 && ta.selectionEnd === 0) {
				e.preventDefault();
				if (chip?.sub) {
					// Only the merged subcommand goes; the chip stays.
					const { sub: _s, argHint: _a, ...base } = chip;
					const exact = findCommandItemExact(chip.name, commands);
					const hint =
						(exact ? chipArgHint(exact) : undefined) ?? findSlashCommand(chip.name)?.argHint;
					setChip({ ...base, ...(hint ? { argHint: hint } : {}) });
					setMenuDismissed(false);
				} else {
					setChip(null);
				}
				return;
			}
		}

		// Atomic backspace for attachment tokens `🖼️ #N` / `📎 #N` (either bracket form)
		if (e.key === "Backspace" && !e.shiftKey && !e.metaKey && !e.altKey) {
			const ta = taRef.current;
			if (ta && ta.selectionStart === ta.selectionEnd) {
				const pos = ta.selectionStart;
				const before = text.slice(0, pos);
				const match = /(?:🖼️\s*#\d+|📎\s*#\d+|\[(?:Image|图片|File|文件)\s*#\d+(?:,[^\]]*)?\])\s*$/.exec(before);
				if (match) {
					e.preventDefault();
					const tokenStr = match[0];
					const startIdx = pos - tokenStr.length;
					const numMatch = /\d+/.exec(tokenStr);
					const tokNum = numMatch ? parseInt(numMatch[0], 10) : null;
					const isFileToken = tokenStr.includes("📎") || /\[(?:File|文件)/.test(tokenStr);

					const nextText = text.slice(0, startIdx) + text.slice(pos);
					setText(nextText);
					setDraft(sessionId, nextText);
					setCursorPos(startIdx);
					setTimeout(() => {
						ta.setSelectionRange(startIdx, startIdx);
					}, 0);
					if (tokNum !== null) {
						if (isFileToken) removeFileByIndex(tokNum - 1, nextText);
						else removeImageByIndex(tokNum - 1, nextText);
					}
					return;
				}
			}
		}

		// Atomic delete for attachment tokens `🖼️ #N` / `📎 #N`
		if (e.key === "Delete" && !e.shiftKey && !e.metaKey && !e.altKey) {
			const ta = taRef.current;
			if (ta && ta.selectionStart === ta.selectionEnd) {
				const pos = ta.selectionStart;
				const after = text.slice(pos);
				const match = /^\s*(?:🖼️\s*#\d+|📎\s*#\d+|\[(?:Image|图片|File|文件)\s*#\d+(?:,[^\]]*)?\])/.exec(after);
				if (match) {
					e.preventDefault();
					const tokenStr = match[0];
					const endIdx = pos + tokenStr.length;
					const numMatch = /\d+/.exec(tokenStr);
					const tokNum = numMatch ? parseInt(numMatch[0], 10) : null;
					const isFileToken = tokenStr.includes("📎") || /\[(?:File|文件)/.test(tokenStr);

					const nextText = text.slice(0, pos) + text.slice(endIdx);
					setText(nextText);
					setDraft(sessionId, nextText);
					setCursorPos(pos);
					setTimeout(() => {
						ta.setSelectionRange(pos, pos);
					}, 0);
					if (tokNum !== null) {
						if (isFileToken) removeFileByIndex(tokNum - 1, nextText);
						else removeImageByIndex(tokNum - 1, nextText);
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
				claimEscape(e);
				setAtFiles(null);
				return;
			}
		}

		// Subcommand menu keyboard navigation
		if (subItems.length > 0) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setMenuIndex(
					(i) => (i + (e.key === "ArrowDown" ? 1 : -1) + subItems.length) % subItems.length,
				);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				const item = subItems[Math.min(menuIndex, subItems.length - 1)];
				if (item) selectSubcommand(item);
				return;
			}
			if (e.key === "Escape") {
				claimEscape(e);
				setMenuDismissed(true);
				return;
			}
		}

		// Argument-completion menu (`/mcp enable <name>`, `/plugins enable <name>`, …)
		if (argItems.length > 0) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setMenuIndex(
					(i) => (i + (e.key === "ArrowDown" ? 1 : -1) + argItems.length) % argItems.length,
				);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				const item = argItems[Math.min(menuIndex, argItems.length - 1)];
				if (item) selectArgItem(item);
				return;
			}
			if (e.key === "Escape") {
				claimEscape(e);
				setMenuDismissed(true);
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
				claimEscape(e);
				setMenuDismissed(true);
				return;
			}
		}

		// Markdown list editing: Enter (when it would insert a newline) continues
		// the list; Tab / Shift+Tab indent or outdent list items. Menus above and
		// IME composition (early return) take precedence.
		if (!e.metaKey && !e.ctrlKey && !e.altKey) {
			const ta = taRef.current;
			if (ta) {
				const decision =
					e.key === "Enter"
						? decideEnterKey(
								{
									key: e.key,
									shiftKey: e.shiftKey,
									metaKey: false,
									ctrlKey: false,
									altKey: false,
									isComposing: false,
								},
								sendShortcut,
							)
						: null;
				const edit =
					decision === "newline"
						? continueListOnEnter(ta.value, ta.selectionStart, ta.selectionEnd)
						: e.key === "Tab"
							? indentList(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey)
							: null;
				if (edit) {
					e.preventDefault();
					applyTextEdit(ta, edit);
					return;
				}
			}
		}

		// Prompt history navigation: only when the caret can't move further vertically.
		const plainArrow = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && !isComposing(e);
		const caretEl = e.currentTarget as HTMLTextAreaElement;
		const caretCollapsed = caretEl.selectionStart === caretEl.selectionEnd;
		const vis =
			(e.key === "ArrowUp" || e.key === "ArrowDown") && plainArrow && caretCollapsed
				? caretVisualLines(caretEl)
				: { first: false, last: false };
		const onFirstLine = vis.first;
		const onLastLine = vis.last;
		if (e.key === "ArrowUp" && plainArrow && caretCollapsed && onFirstLine) {
			if (text === "" && history.length > 0) {
				e.preventDefault();
				if (chip) setChip(null);
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
		if (e.key === "ArrowDown" && plainArrow && caretCollapsed && onLastLine) {
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

		// Enter / ⌘Enter / ⌥Enter per the send-shortcut setting; everything else stays native (newline).
		const decision = decideEnterKey(
			{
				key: e.key,
				shiftKey: e.shiftKey,
				metaKey: e.metaKey,
				ctrlKey: e.ctrlKey,
				altKey: e.altKey,
				isComposing: isComposing(e),
			},
			sendShortcut,
		);
		if (decision === "send" || decision === "send-alternate") {
			e.preventDefault();
			void submit(
				resolveFollowUpAction(followUpBehavior, decision === "send-alternate", streaming),
			);
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
			{/* omp goal-mode bar: live objective directly above the composer. */}
			<GoalBar
				sessionId={sessionId}
				onEdit={(objective) => {
					setChip({ name: "goal", title: "目标" });
					setText(objective);
					setDraft(sessionId, objective);
					setTimeout(() => {
						const ta = taRef.current;
						if (ta) {
							ta.focus();
							ta.setSelectionRange(objective.length, objective.length);
						}
					}, 0);
				}}
			/>
			<div
				ref={composerCardRef}
				className={clsx(
					"relative rounded-[22px] border bg-[var(--bg-panel)] transition-colors duration-150",
					isDraggingOver
						? "border-[var(--text-30,var(--border))]"
						: "border-[var(--line,var(--border))]",
				)}
			>
				{!sessionHasMessages && (
					<ContextPillBar
						sessionId={sessionId}
						onWorkspaceClick={() => setWorkspacePickerOpen((v) => !v)}
						workspaceBtnRef={wsPillBtnRef}
					/>
				)}
				{workspacePickerOpen && (
					<WorkspacePickerPopover
						anchor={sessionHasMessages ? addBtnRef.current : (wsPillBtnRef.current ?? addBtnRef.current)}
						ignoreRefs={workspacePickerIgnoreRefs}
						activeWorkspaceId={sessionMeta?.workspaceId ?? null}
						onClose={() => setWorkspacePickerOpen(false)}
					/>
				)}
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
				{/* Annotation chip: one compact count pill; hover/focus lists the quotes. */}
				{textAnnotations.length > 0 && (
					<div className="px-3 pt-2.5">
						<AnnotationChip
							key={sessionId}
							sessionId={sessionId}
							annotations={textAnnotations}
							onMove={annotationMove?.run}
							moveLabel={annotationMove?.label}
						/>
					</div>
				)}

				{/* Attached image cards + file chips (Codex style), above the input */}
				{(composerImages.length > 0 || composerFiles.length > 0) && (
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
						{composerFiles.map((f, i) => (
							<FileChip
								key={f.id || `${i + 1}-${f.path}`}
								path={f.path}
								index={i + 1}
								name={f.name}
								variant="strip"
								onRemove={() => removeFileByIndex(i)}
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
				{sketchOpen && (
					<SketchPad
						composerTop={composerCardRef.current?.getBoundingClientRect().top ?? null}
						onCancel={() => setSketchOpen(false)}
						onInsert={(d) => void handleInsertSketch(d)}
					/>
				)}
				{/* Textarea container with mirrored syntax-highlighting backdrop */}
				<div className="relative w-full">
					<ComposerSecretOverlay
						sessionId={sessionId}
						text={text}
						taRef={taRef}
						privacy={privacy}
						indent={legacyChip ? chipIndent : 0}
					/>
					{hasInlineTokens && (
						<div
							ref={backdropRef}
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-3 pb-1.5 font-sans text-[var(--chat-font-size,14px)] leading-[1.35] text-[var(--text)] select-none"
							style={{
								boxSizing: "border-box",
								wordBreak: "break-word",
							}}
						>
							{legacyChip && chip && (
								<span
									ref={chipElRef}
									className="mr-[6px] inline-block h-[19px] align-top text-[13px] leading-[19px]"
								>
									<CommandChipBadge chip={chip} />
								</span>
							)}
							{inlineRange && chip ? (
								<>
									{renderHighlightedText(text.slice(0, inlineRange.start))}
									{/* The literal is plain, breakable text exactly like the
									 * textarea's own (so both wrap identically, including at the
									 * hyphen of `/skill:grill-me`); the badge is painted over its
									 * first fragment instead of replacing it with an atomic box. */}
									<span className="relative">
										<span className="invisible">{chipLiteral(chip)}</span>
										<span className="absolute inset-y-0 left-0 flex items-center overflow-hidden">
											<CommandChipBadge chip={chip} />
										</span>
									</span>
									{renderHighlightedText(text.slice(inlineRange.end))}
									{text.slice(inlineRange.end).trim() === "" && chipHintText(chip) && (
										<span className="text-[var(--text-30,var(--text-dim))]">
											{chipHintText(chip)}
										</span>
									)}
								</>
							) : (
								renderHighlightedText(text)
							)}
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
							const caret = e.target.selectionStart ?? next.length;
							// Space right after an exact arg-taking `/command` makes it a chip.
							if (!legacyChip) {
								const tok = detectSpaceToken(text, next, caret);
								const item = tok ? findCommandItemExact(tok.query, commands) : null;
								if (tok && item) {
									setHistoryIdx(-1);
									selectSlashItem(item, { text, token: tok });
									return;
								}
							}
							// Space right after an exact subcommand name merges it into the chip.
							if (subParent) {
								const fw = detectFirstWordSpace(text, next, caret);
								const sub = fw ? findSubcommandExact(subParent, fw.word) : null;
								if (fw && sub) {
									selectSubcommand({
										name: sub.name,
										subOf: subParent.name,
										title: "",
										description: sub.description ?? "",
										argHint: sub.usage,
										group: "子命令",
										icon: subParent.icon,
										registry: subParent.registry,
									}, fw.rest);
									return;
								}
							}
							setText(next);
							setDraft(sessionId, next);
							setCursorPos(e.target.selectionStart ?? next.length);
							setMenuDismissed(false);
							setArgHintLine(null);
							if (historyIdx !== -1) setHistoryIdx(-1);
							// Sync composerImages/composerFiles if tokens were deleted from text
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
							const curFiles = useComposer.getState().files[sessionId] ?? [];
							if (curFiles.length > 0) {
								const remainingTokens = parseInlineFiles(next);
								const presentIndices = new Set(remainingTokens.map((t) => t.index));
								if (curFiles.some((_, idx) => !presentIndices.has(idx + 1))) {
									const filtered = curFiles.filter((_, idx) =>
										presentIndices.has(idx + 1),
									);
									useComposer.getState().setFiles(sessionId, filtered);
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
							const ranges = tokenRanges;
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
							const ranges = tokenRanges;
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
							const ranges = tokenRanges;
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
							legacyChip && !text
								? chipHintText(chip)
								: streaming
									? "输入后续消息…"
									: "输入消息，/ 命令，@ 引用文件"
						}
						style={{ outline: "none", boxShadow: "none", textIndent: legacyChip ? chipIndent : 0 }}
						className={clsx(
							"w-full resize-none bg-transparent px-4 pt-3 pb-1.5 font-sans text-[var(--chat-font-size,14px)] leading-[1.35] outline-none !outline-none focus:outline-none focus:ring-0 placeholder:text-[var(--text-30,var(--text-dim))]",
							hasInlineTokens
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
				<div className="@container">
				<div
					ref={toolbarRef}
					className={clsx(
						"flex flex-nowrap items-center justify-between px-2.5 pb-2 text-[12px]",
						toolbarTier >= TIER_TIGHT ? "gap-x-1" : "gap-x-2",
					)}
				>
					<div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5">
						<button
							ref={addBtnRef}
							type="button"
							onClick={() => setAddMenuOpen((v) => !v)}
							aria-label="添加"
							title="添加文件、项目、目标或规划模式"
							className={clsx(
								"flex h-7 shrink-0 w-7 items-center justify-center rounded-md hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors",
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
								onSketch={() => setSketchOpen(true)}
							/>
						)}
						{planMode && (
							<span title="规划模式已启用" className="flex h-7 items-center px-1 text-amber-500">
								<Lightbulb size={13} />
							</span>
						)}

						{/* Model picker */}
						<div className="relative min-w-0" ref={modelMenuRef}>
							<button
								type="button"
								onClick={() => {
									setModelOpen((v) => !v);
									if (!models || models.length === 0) void loadModels();
								}}
							title={
								toolbarTier >= TIER_MERGED && thinkingKind !== "unsupported"
									? `${modelLabel}，思考等级: ${currentThinking}`
									: modelLabel
							}
							className={clsx(
								"flex min-w-0 items-center gap-1 rounded-md py-1 text-[12px] text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] transition-colors",
								toolbarTier >= TIER_TIGHT ? "px-1.5" : "px-2",
							"max-w-full",
							)}
						>
							<span className={clsx("min-w-0 truncate", !compact && "max-w-36")}>{modelLabel}</span>
							{toolbarTier >= TIER_MERGED && (
								<span className="shrink-0 whitespace-pre">
									{mergedSuffix(thinkingKind, currentThinking, toolbarTier === TIER_BADGE)}
								</span>
							)}
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
									{toolbarTier >= TIER_MERGED && (
										<ThinkingLevelStrip
											levels={thinkingLevels}
											reasoning={currentModelOption?.reasoning}
											value={currentThinking}
											onSelect={(level) => {
												void selectThinkingLevel(level);
												setModelOpen(false);
											}}
										/>
									)}
								</FloatingLayer>
							)}
						</div>

						{/* Thinking chip: levels from the catalog, or a grey 未配置/不支持 chip; never hidden */}
						{toolbarTier < TIER_MERGED && (
							<ThinkingLevelPicker
								levels={thinkingLevels}
								reasoning={currentModelOption?.reasoning}
								value={currentThinking}
								open={thinkingOpen}
								onOpenChange={setThinkingOpen}
								onSelect={(level) => void selectThinkingLevel(level)}
								tight={toolbarTier >= TIER_TIGHT}
							/>
						)}
					</div>

					{/* Right side actions */}
					<div className="flex shrink-0 items-center gap-1.5">
						{/* Held queue count pill: post-turn only (manual mode, un-dismisses the bar);
						    while streaming the items show as queued bubbles in the thread. */}
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
							onCompact={compactContext}
							compactDisabled={streaming}
							compacting={compacting}
							open={contextOpen}
							onOpenChange={setContextOpen}
							showPercent={toolbarTier === TIER_FULL}
							className="shrink-0"
						/>

						{/* Send / streaming controls (Codex circular button) */}
						<div className="flex items-center gap-1.5">
							{streaming ? (
								<>
									{hasPayload && (
										<button
											type="button"
											onClick={() => void submit(streamingSendAction)}
											disabled={busy}
											aria-label={FOLLOW_UP_LABEL[streamingSendAction]}
											title={`${FOLLOW_UP_LABEL[streamingSendAction]}（${alternateShortcutHint(sendShortcut)} 改为${FOLLOW_UP_LABEL[streamingAltAction]}）`}
											className={clsx(
												"flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150",
												busy
													? "bg-[var(--bg-active-fill)] text-[var(--text-30,var(--text-dim))] cursor-not-allowed"
													: "bg-[var(--text)] text-[var(--bg)] hover:opacity-85 active:scale-95",
											)}
										>
											<ArrowUp size={14} />
										</button>
									)}
									{!hasPayload && (
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
									)}
								</>
							) : (
								<button
									type="button"
									onClick={() => {
										if (resumeMode) {
											void sendPrompt(sessionId, "Continue");
										} else {
											void submit("send");
										}
									}}
									disabled={busy || (!hasPayload && !canResume)}
									aria-label={resumeMode ? "恢复中断的回合" : "发送消息"}
									title={
										resumeMode
											? "恢复中断的回合（发送 Continue）"
											: `发送消息 (${sendShortcut === "mod-enter" ? "⌘/Ctrl+Enter" : "Enter"})`
									}
									className={clsx(
										"flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150",
										(hasPayload || canResume) && !busy
											? "bg-[var(--text)] text-[var(--bg)] hover:opacity-85 active:scale-95"
											: "bg-[var(--bg-active-fill)] text-[var(--text-30,var(--text-dim))] cursor-not-allowed",
									)}
								>
									{resumeMode ? (
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
			{subItems.length > 0 ? (
				<SlashMenu
					anchor={composerCardRef.current}
					sections={subSections}
					activeIndex={Math.min(menuIndex, Math.max(0, subItems.length - 1))}
					empty={false}
					footer="↑↓ 选择 · ↵ 选择 · Esc 关闭"
					onSelect={selectSubcommand}
					onDismiss={() => setMenuDismissed(true)}
				/>
			) : argItems.length > 0 ? (
				<SlashMenu
					anchor={composerCardRef.current}
					sections={argSections}
					activeIndex={Math.min(menuIndex, Math.max(0, argItems.length - 1))}
					empty={false}
					footer="↑↓ 选择 · ↵ 选择 · Esc 关闭"
					onSelect={selectArgItem}
					onDismiss={() => setMenuDismissed(true)}
				/>
			) : (
				slashToken && (
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
				)
			)}
		</div>
	);
}
