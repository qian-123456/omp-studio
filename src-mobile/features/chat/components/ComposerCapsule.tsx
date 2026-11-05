import { ArrowUp, ChevronDown, Mic, Plus, Square } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Spinner } from "../../../ui";
import { shortModel, thinkLabel } from "../lib/models";
import { useKeyboardOpen } from "./ComposerToolbar";
import { ContextIndicator } from "./ContextIndicator";
import { useVoiceInput } from "./useVoiceInput";

/** Imperative handle of the uncontrolled textarea. */
export interface ComposerApi {
	get(): string;
	set(text: string, focus?: boolean): void;
	focus(): void;
	clear(): void;
	/** Insert at the caret (voice transcript, file references). */
	insert(text: string): void;
}

/** One 28px line plus 12px padding, inside the 44px touch row. */
const LINE_PX = 44;
const MAX_INPUT = "calc(var(--m-vh, 100dvh) * 0.4 - 64px)";

const roundBtn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill transition-colors duration-(--m-dur-fast)";

/**
 * Desktop-parity mobile composer card:
 * Textarea on top, toolbar on bottom (Plus, Model, Thinking, Extra chips, Context, Mic, Send).
 * When virtual keyboard opens, model, thinking, and context size are hidden to keep the composer compact.
 */
export function ComposerCapsule({
	apiRef,
	initialText = "",
	placeholder,
	working = false,
	hasExtra = false,
	busy = false,
	top,
	onPlus,
	onSend,
	onStop,
	onInput,
	onSync,
	onUnmount,
	onFocusChange,
	model,
	thinking,
	onModel,
	onThinking,
	contextText,
	contextPercent,
	contextToneClass = "text-m-text-3",
	onContext,
	extraLeft,
}: {
	apiRef?: RefObject<ComposerApi | null>;
	initialText?: string;
	placeholder: string;
	/** A run is in progress: stop remains available alongside the independent send action. */
	working?: boolean;
	/** Something other than text can be sent (attachments). */
	hasExtra?: boolean;
	/** Sending is in flight: disables send. */
	busy?: boolean;
	/** Content inside the capsule above the text (attachment tiles). Forces the stacked layout. */
	top?: ReactNode;
	onPlus: () => void;
	onSend: (text: string) => void;
	onStop?: () => void;
	/** Every input event (persisting, draft activity). Cheap: no layout, no React state. */
	onInput?: () => void;
	/** Frame-coalesced, never mid-composition: the current value (slash detection). */
	onSync?: (value: string) => void;
	/** Final text when the capsule unmounts (save the unsent draft). */
	onUnmount?: (value: string) => void;
	onFocusChange?: (focused: boolean) => void;
	model?: string | null;
	thinking?: string | null;
	onModel?: () => void;
	onThinking?: () => void;
	contextText?: string | null;
	contextPercent?: number | null;
	contextToneClass?: string;
	onContext?: () => void;
	extraLeft?: ReactNode;
}) {
	const capsule = useRef<HTMLDivElement>(null);
	const ta = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);
	const raf = useRef(0);
	const [hasText, setHasText] = useState(() => initialText.trim() !== "");
	// Latest callbacks without re-creating the imperative api on every render.
	const cb = useRef({ onSync, onInput, onUnmount });
	cb.current = { onSync, onInput, onUnmount };

	/** Size textarea at its displayed width. */
	const measure = useCallback(() => {
		const el = ta.current;
		const box = capsule.current;
		if (!el || !box || composing.current) return;
		const scrollTop = el.scrollTop;
		el.style.height = "0px";
		el.style.height = `${Math.max(LINE_PX, el.scrollHeight)}px`;
		el.scrollTop = scrollTop;
	}, []);

	/** One frame-coalesced pass; never change layout or sync drafts during IME composition. */
	const flush = useCallback(() => {
		raf.current = 0;
		const el = ta.current;
		if (!el || composing.current) return;
		setHasText(el.value.trim() !== "");
		cb.current.onSync?.(el.value);
		measure();
	}, [measure]);

	const schedule = useCallback(() => {
		if (!raf.current) raf.current = requestAnimationFrame(flush);
	}, [flush]);

	useLayoutEffect(() => {
		const el = ta.current;
		if (!el) return;
		el.value = initialText;
		flush();
		return () => {
			cancelAnimationFrame(raf.current);
			cb.current.onUnmount?.(el.value);
		};
		// initialText is the mount-time value only; later changes go through the api.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [flush]);

	useLayoutEffect(() => {
		measure();
		const box = capsule.current;
		if (!box) return;
		let width = box.clientWidth;
		const observer = new ResizeObserver(() => {
			if (box.clientWidth === width) return;
			width = box.clientWidth;
			measure();
		});
		observer.observe(box);
		return () => observer.disconnect();
	}, [measure, working, top]);

	const insert = useCallback(
		(text: string) => {
			const el = ta.current;
			if (!el) return;
			const cur = el.value;
			const start = el.selectionStart ?? cur.length;
			const end = el.selectionEnd ?? cur.length;
			const before = cur.slice(0, start);
			const after = cur.slice(end);
			const pad = before && !/\s$/.test(before) ? " " : "";
			const next = `${before}${pad}${text}${after}`;
			el.value = next;
			const caret = before.length + pad.length + text.length;
			el.focus();
			el.setSelectionRange(caret, caret);
			composing.current = false;
			cb.current.onInput?.();
			flush();
		},
		[flush],
	);

	useLayoutEffect(() => {
		if (!apiRef) return;
		apiRef.current = {
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
				cb.current.onInput?.();
				flush();
			},
			focus: () => ta.current?.focus(),
			clear: () => {
				if (!ta.current) return;
				ta.current.value = "";
				cb.current.onInput?.();
				flush();
			},
			insert,
		};
		return () => {
			apiRef.current = null;
		};
	}, [apiRef, flush, insert]);

	const { recording, transcribing, toggleRecording } = useVoiceInput({ onTranscribed: insert });
	const [focused, setFocused] = useState(false);
	const keyboardOpen = useKeyboardOpen(focused);
	const canSend = (hasText || hasExtra) && !busy;
	const showStop = working && onStop != null;
	const submit = () => {
		const text = ta.current?.value ?? "";
		// A stale second click on Send must never become an implicit Stop request.
		if (!busy && (text.trim() !== "" || hasExtra)) onSend(text);
	};
	const hasMeta = Boolean(
		(!keyboardOpen && (onModel || model != null)) ||
		(!keyboardOpen && (onThinking || thinking != null)) ||
		(!keyboardOpen && extraLeft) ||
		(!keyboardOpen && contextText)
	);

	return (
		<div
			ref={capsule}
			className="relative flex flex-col rounded-[24px] bg-m-composer-bg p-2 border border-m-border shadow-m-composer transition-shadow"
		>
			{top != null && <div className="mb-1.5">{top}</div>}

			{/* Main Input Row: [+] [Textarea] [Mic] [Stop?] [Send] */}
			<div className="flex min-w-0 items-end gap-1">
				<button
					type="button"
					aria-label="添加"
					onClick={onPlus}
					className={`${roundBtn} text-m-text-2 hover:text-m-text hover:bg-m-surface active:bg-m-surface-2 active:scale-95`}
				>
					<Plus size={22} strokeWidth={1.75} />
				</button>

				<textarea
					ref={ta}
					rows={1}
					enterKeyHint="enter"
					placeholder={placeholder}
					aria-label="消息输入框"
					onFocus={() => {
						setFocused(true);
						onFocusChange?.(true);
					}}
					onBlur={() => {
						setFocused(false);
						onFocusChange?.(false);
					}}
					onInput={() => {
						if (!composing.current) {
							onInput?.();
							schedule();
						}
					}}
					onCompositionStart={() => {
						composing.current = true;
					}}
					onCompositionEnd={() => {
						composing.current = false;
						onInput?.();
						schedule();
					}}
					onKeyDown={(e) => {
						const native = e.nativeEvent as KeyboardEvent & { inputType?: string };
						// Native mobile line breaks and IME commits are never message submissions.
						if (e.key !== "Enter" || e.shiftKey || composing.current || native.isComposing || e.keyCode === 229 || native.inputType === "insertLineBreak") return;
						const hardware = e.metaKey || e.ctrlKey || (typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches);
						if (!hardware || e.altKey) return;
						e.preventDefault();
						if (!e.repeat) submit();
					}}
					style={{ maxHeight: MAX_INPUT, outline: "none", boxShadow: "none" }}
					className="m-selectable min-h-[44px] w-full min-w-0 resize-none bg-transparent px-2.5 pt-2.5 pb-2 text-m-md leading-6 text-m-text outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 placeholder:text-m-text-3"
				/>

				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						aria-label={recording ? "停止录音" : "语音输入"}
						aria-pressed={recording}
						disabled={transcribing}
						onClick={() => void toggleRecording()}
						className={`${roundBtn} ${recording ? "m-pulse bg-m-danger text-white shadow-sm" : "text-m-text-2 hover:text-m-text hover:bg-m-surface active:bg-m-surface-2 active:scale-95"}`}
					>
						{transcribing ? <Spinner size={18} /> : recording ? <Square size={14} fill="currentColor" /> : <Mic size={22} strokeWidth={1.75} />}
					</button>

					{showStop && (
						<button
							type="button"
							aria-label="停止"
							onClick={onStop}
							className={`${roundBtn} bg-m-text text-m-bg active:scale-95`}
						>
							<Square size={14} fill="currentColor" />
						</button>
					)}

					<button
						key="send"
						type="button"
						aria-label="发送"
						disabled={!canSend}
						onClick={submit}
						className={`${roundBtn} ${
							canSend
								? "bg-m-accent text-m-accent-text shadow-sm hover:brightness-105 active:scale-95 cursor-pointer"
								: "bg-m-surface-2 text-m-text-3 border border-m-border/60 cursor-not-allowed"
						}`}
					>
						{busy ? <Spinner size={18} /> : <ArrowUp size={20} strokeWidth={2.25} />}
					</button>
				</div>
			</div>

			{/* Secondary metadata toolbar: only visible when virtual keyboard is closed */}
			{hasMeta && (
				<div className="flex min-w-0 items-center justify-between gap-1.5 pt-1.5 border-t border-m-border/30 mt-1">
					{/* Left: [Model ⌵] [Thinking ⌵] [extra chips] */}
					<div className="m-noscrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap">
						{(onModel || model != null) && (
							<button
								type="button"
								aria-label={`当前模型：${shortModel(model ?? "") || "默认模型"}，点击切换`}
								onClick={onModel}
								disabled={!onModel}
								className="flex min-h-8 shrink-0 items-center gap-1 rounded-m-pill bg-m-surface/80 px-2.5 py-1 text-m-xs font-medium whitespace-nowrap text-m-text hover:bg-m-surface active:bg-m-surface-2 transition-colors disabled:cursor-default"
							>
								<span className="max-w-[130px] truncate">{shortModel(model ?? "") || "默认模型"}</span>
								<ChevronDown size={13} className="shrink-0 text-m-text-3" aria-hidden />
							</button>
						)}
						{(onThinking || thinking != null) && (
							<button
								type="button"
								aria-label={`当前思考强度：${thinkLabel(thinking)}，点击切换`}
								onClick={onThinking ?? onModel}
								disabled={!onThinking && !onModel}
								className="flex min-h-8 shrink-0 items-center gap-1 rounded-m-pill bg-m-surface/80 px-2 py-1 text-m-xs whitespace-nowrap text-m-text-2 hover:bg-m-surface active:bg-m-surface-2 transition-colors disabled:cursor-default"
							>
								<span>{thinkLabel(thinking)}</span>
								<ChevronDown size={13} className="shrink-0 text-m-text-3" aria-hidden />
							</button>
						)}
						{extraLeft}
					</div>

					{/* Right: [Context %] */}
					{contextText && (
						<div className="flex shrink-0 items-center">
							<button
								type="button"
								aria-label={`上下文用量：${contextText}`}
								onClick={onContext}
								disabled={!onContext}
								className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-m-pill bg-m-surface/80 px-2.5 py-1 text-m-xs whitespace-nowrap hover:bg-m-surface active:bg-m-surface-2 transition-colors disabled:opacity-60 ${contextToneClass}`}
							>
								<ContextIndicator text={contextText} percent={contextPercent} />
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
