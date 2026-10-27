import {
	ArrowUp,
	Compass,
	FileText,
	Folder,
	FolderOpen,
	GitBranch,
	Lightbulb,
	Mic,
	Monitor,
	Paperclip,
	PenLine,
	Plus,
	Square,
	Target,
	X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { baseName } from "../../../core/lib/format";
import { useSession } from "../../../core/stores/sessions";
import { usePref } from "../../../core/stores/prefs";
import { BottomSheet, Chip, Spinner, toast } from "../../../ui";
import { useChat, useChatUi } from "../ChatContext";
import { contextTone, formatContextPercent, resolveContextPercent } from "../lib/context";
import { BEHAVIOR_HINT, BEHAVIOR_LABEL, type StreamBehavior } from "../lib/prompt";
import { commandAction, commandInput, detectSlashQuery, type SlashCmd } from "../lib/slash";
import { saveUnsent, UNSENT_DEBOUNCE_MS } from "../lib/unsent";
import { ContextSheet } from "./ContextSheet";
import { GoalSheet, goalLabel } from "./GoalSheet";
import { ModelSheet } from "./ModelSheet";
import { PathSheet } from "./PathSheet";
import { RemoteFilePickerSheet } from "./RemoteFilePickerSheet";
import { SketchPad } from "./SketchPad";
import { SlashPopup, SlashSheet } from "./SlashSheet";
import { ThinkingSheet } from "./ThinkingSheet";
import { useVoiceInput } from "./useVoiceInput";
import { WorkspacePickerSheet } from "./WorkspacePickerSheet";

type Sheet = "plus" | "slash" | "model" | "think" | "goal" | "context" | "path" | "finder" | "workspace" | null;

const SUPPORTS_FIELD_SIZING = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");
const MAX_INPUT_PX = 140;
const iconBtn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-m-surface-hover";

export function Composer({ sessionId }: { sessionId: string }) {
	const { controller } = useChatUi();
	const session = useSession(sessionId);
	const working = useChat((s) => s.working);
	const atts = useChat((s) => s.atts);
	const cstate = useChat((s) => s.cstate);
	const forkFrom = useChat((s) => s.forkFrom);
	const compacting = useChat((s) => s.compacting);
	const [behavior, setBehavior] = usePref<StreamBehavior>("chat.streamBehavior", "followUp");
	const [hasText, setHasText] = useState(() => controller.initialText.trim() !== "");
	const [slashQuery, setSlashQuery] = useState<string | null>(null);
	const [sheet, setSheet] = useState<Sheet>(null);
	const [sketch, setSketch] = useState(false);
	const ta = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);
	const raf = useRef(0);
	const saveTimer = useRef<number | undefined>(undefined);
	const sizing = useRef({ len: 0, lines: 1, h: 0 });
	const fileAny = useRef<HTMLInputElement>(null);

	/** One frame-coalesced pass: autosize (JS fallback only), slash detection, hasText. Never runs mid-composition. */
	const flush = useCallback(() => {
		raf.current = 0;
		const el = ta.current;
		if (!el || composing.current) return;
		const v = el.value;
		setHasText(v.trim() !== "");
		setSlashQuery(detectSlashQuery(v));
		if (SUPPORTS_FIELD_SIZING) return;
		const z = sizing.current;
		let lines = 1;
		for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) === 10) lines++;
		// Layout is only read when the height can have changed (grew past the box, or text/lines shrank).
		if (v.length < z.len || lines !== z.lines || el.scrollHeight > el.clientHeight) {
			el.style.height = "auto";
			const h = Math.min(el.scrollHeight, MAX_INPUT_PX);
			if (h !== z.h) z.h = h;
			el.style.height = `${h}px`;
		}
		z.len = v.length;
		z.lines = lines;
	}, []);

	const schedule = useCallback(() => {
		if (!raf.current) raf.current = requestAnimationFrame(flush);
	}, [flush]);

	const persist = useCallback(() => {
		clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(() => saveUnsent(sessionId, ta.current?.value ?? ""), UNSENT_DEBOUNCE_MS);
	}, [sessionId]);

	const onInput = () => {
		persist();
		controller.noteEdit();
		if (!composing.current) schedule();
	};

	useLayoutEffect(() => {
		const el = ta.current;
		if (!el) return;
		el.value = controller.initialText;
		controller.composer = {
			get: () => ta.current?.value ?? "",
			set: (text, focus) => {
				const t = ta.current;
				if (!t) return;
				t.value = text;
				if (focus) {
					t.focus();
					t.setSelectionRange(text.length, text.length);
				}
				composing.current = false;
				persist();
				flush();
			},
			focus: () => ta.current?.focus(),
			clear: () => {
				if (ta.current) {
					ta.current.value = "";
					persist();
					flush();
				}
			},
		};
		flush();
		return () => {
			controller.lastText = el.value;
			controller.composer = null;
			cancelAnimationFrame(raf.current);
			clearTimeout(saveTimer.current);
			saveUnsent(sessionId, el.value);
		};
	}, [controller, sessionId, flush, persist]);

	// Flush pending text if the tab is closed/backgrounded before the debounce fires.
	useEffect(() => {
		const onHide = () => saveUnsent(sessionId, ta.current?.value ?? "");
		window.addEventListener("pagehide", onHide);
		return () => window.removeEventListener("pagehide", onHide);
	}, [sessionId]);

	// Voice input hook: inserts transcribed text into composer (editable, does not auto-send)
	const { recording, transcribing, toggleRecording } = useVoiceInput({
		onTranscribed: (text) => {
			if (!ta.current) return;
			const cur = ta.current.value;
			const next = cur ? (cur.endsWith("\n") || cur.endsWith(" ") ? `${cur}${text}` : `${cur} ${text}`) : text;
			ta.current.value = next;
			flush();
			persist();
			ta.current.focus();
		},
	});

	const hasContent = hasText || atts.length > 0;
	const submit = () => {
		const value = ta.current?.value ?? "";
		void controller.send(value, behavior);
	};

	const pickCommand = (c: SlashCmd) => {
		setSheet(null);
		if (commandAction(c) === "run") {
			controller.composer?.set("");
			void controller.runCommand(c.name, "");
		} else {
			controller.composer?.set(commandInput(c), true);
		}
	};

	const togglePlan = async () => {
		try {
			const r = await api<{ on: boolean }>("POST", `/sessions/${sessionId}/plan-mode`, {});
			controller.patchState({ planMode: r.on });
			toast(r.on ? "规划模式已启用" : "规划模式已关闭");
		} catch (e) {
			toast(`切换失败：${errorMessage(e)}`, { kind: "error" });
		}
	};
	const cwd = session?.cwd ?? null;
	const pct = cstate ? resolveContextPercent(cstate) : null;
	const pctText = formatContextPercent(pct);
	const tone = contextTone(pct);
	const goal = cstate?.goal && cstate.goal.objective ? cstate.goal : null;

	const sheetBtn =
		"flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-m-md border border-m-border bg-m-surface text-m-sm active:bg-m-surface-hover";

	return (
		<div className="relative shrink-0 border-t border-m-border bg-m-bg px-3 pt-2" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 8px)" }}>
			{slashQuery !== null && sheet === null && <SlashPopup sessionId={sessionId} query={slashQuery} onPick={pickCommand} />}

			{/* Status bar above composer: Current directory (left, tap opens path sheet), Context usage % (right, tap opens ContextSheet) */}
			<div className="mb-2 flex items-center justify-between gap-2 px-1 text-m-xs">
				<button
					type="button"
					aria-label="当前工作目录"
					onClick={() => setSheet("path")}
					className="flex min-h-8 max-w-[55%] items-center gap-1.5 truncate rounded-m-pill px-2 py-0.5 text-m-text-2 active:bg-m-surface-hover"
				>
					<Folder size={14} className="shrink-0 text-m-text-3" />
					<span className="truncate">{cwd ? baseName(cwd) : "未设置目录"}</span>
				</button>

				<button
					type="button"
					aria-label="上下文用量"
					onClick={() => setSheet("context")}
					className="flex min-h-8 items-center gap-1 rounded-m-pill px-2 py-0.5 font-medium active:bg-m-surface-hover"
				>
					<span className={tone === "danger" ? "text-m-danger" : tone === "warn" ? "text-m-warn" : "text-m-text-2"}>
						上下文 {pctText ?? "0%"}
					</span>
				</button>
			</div>

			{/* Plan mode active indicator */}
			{cstate?.planMode && (
				<div className="mb-2 flex items-center justify-between rounded-m-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-m-xs text-amber-500">
					<span className="flex items-center gap-1.5 font-medium">
						<Compass size={14} />
						规划模式已启用
					</span>
					<button
						type="button"
						onClick={() => void togglePlan()}
						className="text-m-xs text-amber-500 underline active:opacity-70"
					>
						关闭
					</button>
				</div>
			)}

			{goal && (
				<div className="mb-2">
					<Chip tone="accent" onClick={() => setSheet("goal")} className="h-8">
						目标 · {goalLabel(goal)}：{goal.objective}
					</Chip>
				</div>
			)}

			{forkFrom && (
				<div className="mb-2 flex items-start gap-2 rounded-m-md border border-m-border bg-m-surface px-3 py-2">
					<GitBranch size={16} className="mt-0.5 shrink-0 text-m-accent" />
					<div className="min-w-0 flex-1 text-m-sm">
						<div className="font-medium">从这条回复分支</div>
						<div className="break-words text-m-xs text-m-text-2">{forkFrom.preview}</div>
						<div className="text-m-xs text-m-text-3">输入分支后的第一条消息并发送</div>
					</div>
					<button
						type="button"
						aria-label="取消分支"
						onClick={() => controller.cancelFork()}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-m-surface-hover"
					>
						<X size={16} />
					</button>
				</div>
			)}

			{atts.length > 0 && (
				<div className="mb-2 flex gap-2 overflow-x-auto">
					{atts.map((a) => (
						<div
							key={a.id}
							className={`flex shrink-0 items-center gap-2 rounded-m-md border bg-m-surface py-1 pl-2 pr-1 ${
								a.status === "err" ? "border-m-danger" : "border-m-border"
							}`}
						>
							{a.isImage && a.url ? (
								<img src={a.url} alt="" className="h-9 w-9 rounded-m-sm object-cover" />
							) : (
								<FileText size={20} className="text-m-text-3" />
							)}
							<span className="max-w-40 break-all text-m-xs">{a.name}</span>
							{a.status === "up" && (
								<span className="flex items-center gap-1 whitespace-nowrap text-m-xs text-m-text-3">
									<Spinner size={12} />
									上传中
								</span>
							)}
							{a.status === "err" && <span className="whitespace-nowrap text-m-xs text-m-danger">失败</span>}
							<button
								type="button"
								aria-label="移除附件"
								onClick={() => controller.removeAtt(a.id)}
								className="flex h-9 w-9 items-center justify-center rounded-full active:bg-m-surface-hover"
							>
								<X size={16} />
							</button>
						</div>
					))}
				</div>
			)}

			{working && (
				<div className="mb-2 flex items-center gap-2">
					<div role="group" aria-label="发送方式" className="inline-flex rounded-m-pill border border-m-border p-0.5">
						{(["followUp", "steer"] as const).map((b) => (
							<button
								key={b}
								type="button"
								aria-pressed={behavior === b}
								onClick={() => setBehavior(b)}
								className={`min-h-9 whitespace-nowrap rounded-m-pill px-4 text-m-sm font-medium ${
									behavior === b ? "bg-m-accent text-m-accent-text" : "text-m-text-2"
								}`}
							>
								{BEHAVIOR_LABEL[b]}
							</button>
						))}
					</div>
					<span className="min-w-0 flex-1 text-m-xs text-m-text-3">{BEHAVIOR_HINT[behavior]}</span>
				</div>
			)}

			{/* Main input bar */}
			<div className="flex items-end gap-1 rounded-[var(--m-composer-radius,24px)] border border-m-border bg-m-composer-bg px-1 py-1">
				{/* Left: Plus (+) menu button */}
				<button type="button" aria-label="添加" onClick={() => setSheet("plus")} className={`${iconBtn} text-m-text-2`}>
					<Plus size={22} />
				</button>

				{/* Middle: Textarea */}
				<textarea
					ref={ta}
					rows={1}
					enterKeyHint="enter"
					placeholder={forkFrom ? "输入分支后的第一条消息" : "发消息"}
					aria-label="消息输入框"
					onInput={onInput}
					onCompositionStart={() => {
						composing.current = true;
					}}
					onCompositionEnd={() => {
						composing.current = false;
						schedule();
					}}
					onKeyDown={(e) => {
						// Hardware keyboards: Enter sends, Shift+Enter newline. Soft keyboards keep newline behaviour.
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && matchMedia("(hover: hover)").matches) {
							e.preventDefault();
							submit();
						}
					}}
					className="m-composer-input min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-2 leading-6 outline-none"
					style={SUPPORTS_FIELD_SIZING ? undefined : { height: 40, maxHeight: MAX_INPUT_PX }}
				/>

				{/* Right side: 2 round buttons: Voice input (microphone) + Send (turns to Stop while streaming) */}
				<button
					type="button"
					aria-label={recording ? "停止录音" : "语音输入"}
					disabled={transcribing}
					onClick={() => void toggleRecording()}
					className={`${iconBtn} ${
						recording
							? "bg-m-danger text-white animate-pulse"
							: transcribing
								? "text-m-accent"
								: "text-m-text-2 active:bg-m-surface-hover"
					}`}
				>
					{transcribing ? <Spinner size={18} /> : <Mic size={20} />}
				</button>

				{working ? (
					<button
						type="button"
						aria-label="停止"
						onClick={() => void controller.stop()}
						className={`${iconBtn} border border-m-border text-m-text active:bg-m-surface-hover`}
					>
						<Square size={16} fill="currentColor" />
					</button>
				) : (
					<button
						type="button"
						aria-label="发送"
						disabled={!hasContent}
						onClick={submit}
						className={`${iconBtn} ${hasContent ? "bg-m-accent text-m-accent-text" : "bg-m-surface-2 text-m-text-3"}`}
					>
						<ArrowUp size={20} />
					</button>
				)}
			</div>

			<input ref={fileAny} type="file" multiple hidden onChange={(e) => pickFiles(e, controller, false)} />

			{/* Plus (+) menu: Exact 6 desktop options: 文件, Finder 选中项, 在项目中工作, 目标, 规划模式, 草图 */}
			<BottomSheet open={sheet === "plus"} onClose={() => setSheet(null)} title="添加">
				<div className="grid grid-cols-3 gap-3 px-4 pb-4">
					<button
						type="button"
						className={sheetBtn}
						onClick={() => {
							setSheet(null);
							fileAny.current?.click();
						}}
					>
						<Paperclip size={22} className="text-blue-500" />
						文件
					</button>
					<button
						type="button"
						className={sheetBtn}
						onClick={() => {
							setSheet("finder");
						}}
					>
						<Monitor size={22} className="text-teal-500" />
						<span className="whitespace-nowrap">Finder 选中项</span>
					</button>
					<button
						type="button"
						className={sheetBtn}
						onClick={() => {
							setSheet("workspace");
						}}
					>
						<FolderOpen size={22} className="text-purple-500" />
						<span className="whitespace-nowrap">在项目中工作</span>
					</button>
					<button
						type="button"
						className={sheetBtn}
						onClick={() => {
							setSheet("goal");
						}}
					>
						<Target size={22} className="text-rose-500" />
						<span className="whitespace-nowrap">目标{goal ? " ●" : ""}</span>
					</button>
					<button
						type="button"
						aria-pressed={!!cstate?.planMode}
						className={`${sheetBtn} ${cstate?.planMode ? "!border-amber-500 text-amber-500" : ""}`}
						onClick={() => {
							setSheet(null);
							void togglePlan();
						}}
					>
						<Lightbulb size={22} className={cstate?.planMode ? "text-amber-500" : "text-amber-400"} />
						<span className="whitespace-nowrap">规划模式{cstate?.planMode ? " 开" : ""}</span>
					</button>
					<button
						type="button"
						className={sheetBtn}
						onClick={() => {
							setSheet(null);
							setSketch(true);
						}}
					>
						<PenLine size={22} className="text-emerald-500" />
						草图
					</button>
				</div>
			</BottomSheet>

			<SlashSheet open={sheet === "slash"} onClose={() => setSheet(null)} sessionId={sessionId} onPick={pickCommand} />
			<ModelSheet
				open={sheet === "model"}
				onClose={() => setSheet(null)}
				sessionId={sessionId}
				onFacts={(f) => controller.patchState({ model: f.model, thinkingLevel: f.thinkingLevel })}
			/>
			<ThinkingSheet
				open={sheet === "think"}
				onClose={() => setSheet(null)}
				sessionId={sessionId}
				currentLevel={cstate?.thinkingLevel ?? null}
				onFacts={(f) => controller.patchState({ thinkingLevel: f.thinkingLevel })}
			/>
			<GoalSheet open={sheet === "goal"} onClose={() => setSheet(null)} sessionId={sessionId} goal={goal} onGoal={(g) => controller.patchState({ goal: g })} />
			<ContextSheet open={sheet === "context"} onClose={() => setSheet(null)} cstate={cstate} compacting={compacting} controller={controller} />
			<PathSheet
				open={sheet === "path"}
				onClose={() => setSheet(null)}
				cwd={cwd}
				sessionId={sessionId}
				onSwitchProject={() => setSheet("workspace")}
			/>
			<RemoteFilePickerSheet
				open={sheet === "finder"}
				onClose={() => setSheet(null)}
				sessionId={sessionId}
				onSelectFile={(f) => {
					// Stage file reference into composer or add file
					const cur = ta.current?.value ?? "";
					const ref = `[${f.name}](${f.path})`;
					const next = cur ? `${cur} ${ref}` : ref;
					if (ta.current) {
						ta.current.value = next;
						flush();
						persist();
					}
				}}
			/>
			<WorkspacePickerSheet
				open={sheet === "workspace"}
				onClose={() => setSheet(null)}
				sessionId={sessionId}
				currentCwd={cwd}
			/>
			<SketchPad
				open={sketch}
				onClose={() => setSketch(false)}
				onDone={(blob) => {
					setSketch(false);
					controller.addFiles([new File([blob], `sketch-${Date.now()}.png`, { type: "image/png" })], true);
				}}
			/>
		</div>
	);
}

function pickFiles(e: React.ChangeEvent<HTMLInputElement>, controller: { addFiles(f: File[], img: boolean): void }, image: boolean) {
	controller.addFiles(Array.from(e.target.files ?? []), image);
	e.target.value = "";
}
