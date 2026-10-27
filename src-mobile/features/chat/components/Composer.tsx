import { ArrowUp, Camera, FileText, GitBranch, Image as ImageIcon, Paperclip, PenLine, Plus, Square, Target, X, Compass } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { usePref } from "../../../core/stores/prefs";
import { BottomSheet, Chip, Spinner, toast } from "../../../ui";
import { useChat, useChatUi } from "../ChatContext";
import { contextTone, formatContextPercent, resolveContextPercent } from "../lib/context";
import { BEHAVIOR_HINT, BEHAVIOR_LABEL, type StreamBehavior } from "../lib/prompt";
import { commandAction, commandInput, detectSlashQuery, type SlashCmd } from "../lib/slash";
import { saveUnsent, UNSENT_DEBOUNCE_MS } from "../lib/unsent";
import { shortModel } from "../lib/models";
import { ContextSheet } from "./ContextSheet";
import { GoalSheet, goalLabel } from "./GoalSheet";
import { ModelSheet } from "./ModelSheet";
import { SketchPad } from "./SketchPad";
import { SlashPopup, SlashSheet } from "./SlashSheet";
import { ThinkingSheet } from "./ThinkingSheet";

type Sheet = "plus" | "slash" | "model" | "think" | "goal" | "context" | null;

const SUPPORTS_FIELD_SIZING = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");
const MAX_INPUT_PX = 140;
const iconBtn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-m-surface-hover";

export function Composer({ sessionId }: { sessionId: string }) {
	const { controller } = useChatUi();
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
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const sizing = useRef({ len: 0, lines: 1, h: 0 });
	const fileAny = useRef<HTMLInputElement>(null);
	const fileImg = useRef<HTMLInputElement>(null);
	const fileCam = useRef<HTMLInputElement>(null);

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
		if (saveTimer.current !== null) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => saveUnsent(sessionId, ta.current?.value ?? ""), UNSENT_DEBOUNCE_MS);
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
		};
		flush();
		return () => {
			controller.lastText = el.value;
			controller.composer = null;
			cancelAnimationFrame(raf.current);
			if (saveTimer.current !== null) clearTimeout(saveTimer.current);
			saveUnsent(sessionId, el.value);
		};
	}, [controller, sessionId, flush, persist]);

	// Flush pending text if the tab is closed/backgrounded before the debounce fires.
	useEffect(() => {
		const onHide = () => saveUnsent(sessionId, ta.current?.value ?? "");
		window.addEventListener("pagehide", onHide);
		return () => window.removeEventListener("pagehide", onHide);
	}, [sessionId]);

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
			toast(r.on ? "规划模式已开启" : "规划模式已关闭");
		} catch (e) {
			toast(`切换失败：${errorMessage(e)}`, { kind: "error" });
		}
	};

	const pct = cstate ? resolveContextPercent(cstate) : null;
	const pctText = formatContextPercent(pct);
	const tone = contextTone(pct);
	const model = shortModel(cstate?.model ?? "");
	const goal = cstate?.goal && cstate.goal.objective ? cstate.goal : null;

	const sheetBtn = "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-m-md border border-m-border bg-m-surface text-m-sm active:bg-m-surface-hover";

	return (
		<div className="relative shrink-0 border-t border-m-border bg-m-bg px-3 pt-2" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 8px)" }}>
			{slashQuery !== null && sheet === null && <SlashPopup sessionId={sessionId} query={slashQuery} onPick={pickCommand} />}

			{cstate && (
				<div className="-mx-3 mb-2 flex gap-2 overflow-x-auto px-3 pb-0.5">
					{model && (
						<Chip onClick={() => setSheet("model")} className="h-8">
							{model} ▾
						</Chip>
					)}
					{(model || cstate.thinkingLevel) && (
						<Chip onClick={() => setSheet("think")} className="h-8">
							思考 {cstate.thinkingLevel || "auto"} ▾
						</Chip>
					)}
					{cstate.planMode && (
						<Chip tone="accent" onClick={() => void togglePlan()} className="h-8">
							规划模式 ●
						</Chip>
					)}
					{goal && (
						<Chip tone="accent" onClick={() => setSheet("goal")} className="h-8">
							目标 · {goalLabel(goal)}：{goal.objective}
						</Chip>
					)}
					{pctText && (
						<Chip tone={tone === "neutral" ? "neutral" : tone} onClick={() => setSheet("context")} className="h-8">
							上下文 {pctText}
						</Chip>
					)}
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
					<button type="button" aria-label="取消分支" onClick={() => controller.cancelFork()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-m-surface-hover">
						<X size={16} />
					</button>
				</div>
			)}

			{atts.length > 0 && (
				<div className="mb-2 flex gap-2 overflow-x-auto">
					{atts.map((a) => (
						<div key={a.id} className={`flex shrink-0 items-center gap-2 rounded-m-md border bg-m-surface py-1 pl-2 pr-1 ${a.status === "err" ? "border-m-danger" : "border-m-border"}`}>
							{a.isImage && a.url ? <img src={a.url} alt="" className="h-9 w-9 rounded-m-sm object-cover" /> : <FileText size={20} className="text-m-text-3" />}
							<span className="max-w-40 break-all text-m-xs">{a.name}</span>
							{a.status === "up" && (
								<span className="flex items-center gap-1 whitespace-nowrap text-m-xs text-m-text-3">
									<Spinner size={12} />
									上传中
								</span>
							)}
							{a.status === "err" && <span className="whitespace-nowrap text-m-xs text-m-danger">失败</span>}
							<button type="button" aria-label="移除附件" onClick={() => controller.removeAtt(a.id)} className="flex h-9 w-9 items-center justify-center rounded-full active:bg-m-surface-hover">
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
								className={`min-h-9 whitespace-nowrap rounded-m-pill px-4 text-m-sm font-medium ${behavior === b ? "bg-m-accent text-m-accent-text" : "text-m-text-2"}`}
							>
								{BEHAVIOR_LABEL[b]}
							</button>
						))}
					</div>
					<span className="min-w-0 flex-1 text-m-xs text-m-text-3">{BEHAVIOR_HINT[behavior]}</span>
				</div>
			)}

			<div className="flex items-end gap-1 rounded-[var(--m-composer-radius,24px)] border border-m-border bg-m-composer-bg px-1 py-1">
				<button type="button" aria-label="添加" onClick={() => setSheet("plus")} className={`${iconBtn} text-m-text-2`}>
					<Plus size={22} />
				</button>
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
				<button type="button" aria-label="命令列表" onClick={() => setSheet("slash")} className={`${iconBtn} font-m-mono text-m-lg font-semibold text-m-text-2`}>
					/
				</button>
				{working && (
					<button type="button" aria-label="停止" onClick={() => void controller.stop()} className={`${iconBtn} border border-m-border text-m-text`}>
						<Square size={16} fill="currentColor" />
					</button>
				)}
				<button
					type="button"
					aria-label="发送"
					disabled={!hasContent}
					onClick={submit}
					className={`${iconBtn} ${hasContent ? "bg-m-accent text-m-accent-text" : "bg-m-surface-2 text-m-text-3"}`}
				>
					<ArrowUp size={20} />
				</button>
			</div>

			<input ref={fileAny} type="file" multiple hidden onChange={(e) => pickFiles(e, controller, false)} />
			<input ref={fileImg} type="file" accept="image/*" multiple hidden onChange={(e) => pickFiles(e, controller, true)} />
			<input ref={fileCam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickFiles(e, controller, true)} />

			<BottomSheet open={sheet === "plus"} onClose={() => setSheet(null)} title="添加">
				<div className="grid grid-cols-3 gap-3 px-4 pb-4">
					<button type="button" className={sheetBtn} onClick={() => { setSheet(null); fileAny.current?.click(); }}>
						<Paperclip size={22} />
						文件
					</button>
					<button type="button" className={sheetBtn} onClick={() => { setSheet(null); fileImg.current?.click(); }}>
						<ImageIcon size={22} />
						相册
					</button>
					<button type="button" className={sheetBtn} onClick={() => { setSheet(null); fileCam.current?.click(); }}>
						<Camera size={22} />
						拍照
					</button>
					<button type="button" className={sheetBtn} onClick={() => { setSheet(null); setSketch(true); }}>
						<PenLine size={22} />
						草图
					</button>
					<button type="button" className={sheetBtn} onClick={() => setSheet("goal")}>
						<Target size={22} />
						<span className="whitespace-nowrap">目标{goal ? " ●" : ""}</span>
					</button>
					<button type="button" aria-pressed={!!cstate?.planMode} className={`${sheetBtn} ${cstate?.planMode ? "!border-m-accent" : ""}`} onClick={() => { setSheet(null); void togglePlan(); }}>
						<Compass size={22} />
						<span className="whitespace-nowrap">规划模式{cstate?.planMode ? " 开" : ""}</span>
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
