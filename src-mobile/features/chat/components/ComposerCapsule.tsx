import { ArrowUp, Mic, Plus, Square } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Spinner } from "../../../ui";
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

const SUPPORTS_FIELD_SIZING = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");
/** Height of one text line: 28px line box + 12px vertical padding (`min-h-10 py-1.5 leading-7`). */
const LINE_PX = 40;
const MAX_INPUT = "calc(var(--m-vh, 100dvh) * 0.4 - 64px)";

const roundBtn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill transition-colors duration-(--m-dur-fast)";

/**
 * Gemini capsule `[+] text [mic] [send/stop]` (docs/MOBILE_DESIGN.md §4.4). The textarea is
 * uncontrolled: input only schedules one frame-coalesced pass, and nothing runs during IME
 * composition (docs/MOBILE_PRD.md §5.1). When the text wraps the capsule grows and the buttons
 * move to their own bottom row.
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
}: {
	apiRef?: RefObject<ComposerApi | null>;
	initialText?: string;
	placeholder: string;
	/** A run is in progress: the send button becomes stop while the text is empty. */
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
}) {
	const ta = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);
	const raf = useRef(0);
	const multiAt = useRef(0);
	const [hasText, setHasText] = useState(() => initialText.trim() !== "");
	const [multi, setMulti] = useState(false);
	// Latest callbacks without re-creating the imperative api on every render.
	const cb = useRef({ onSync, onInput, onUnmount });
	cb.current = { onSync, onInput, onUnmount };

	/** One frame-coalesced pass: hasText, wrap layout, JS autosize fallback. Never mid-composition. */
	const flush = useCallback(() => {
		raf.current = 0;
		const el = ta.current;
		if (!el || composing.current) return;
		const v = el.value;
		setHasText(v.trim() !== "");
		cb.current.onSync?.(v);
		if (!SUPPORTS_FIELD_SIZING) {
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		}
		// Stack once the text wraps; unstack only when it is shorter than where it wrapped (no flip-flop).
		const wraps = v.includes("\n") || el.scrollHeight > LINE_PX + 4;
		if (wraps && multiAt.current === 0) {
			multiAt.current = Math.max(1, v.length);
			setMulti(true);
		} else if (multiAt.current > 0 && !v.includes("\n") && v.length < multiAt.current) {
			multiAt.current = 0;
			setMulti(false);
		}
	}, []);

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

	const canSend = (hasText || hasExtra) && !busy;
	const showStop = working && !hasText && !hasExtra && onStop != null;
	const submit = () => onSend(ta.current?.value ?? "");
	const stacked = multi || top != null;

	return (
		<div
			className="grid items-end gap-x-1 rounded-(--m-composer-radius) bg-m-composer-bg p-2 shadow-m-composer"
			style={{
				gridTemplateColumns: "auto 1fr auto auto",
				gridTemplateAreas: stacked ? '"top top top top" "text text text text" "plus . mic send"' : '"plus text mic send"',
			}}
		>
			{top != null && <div style={{ gridArea: "top" }}>{top}</div>}
			<button
				type="button"
				aria-label="添加"
				onClick={onPlus}
				style={{ gridArea: "plus" }}
				className={`${roundBtn} text-m-text-2 active:bg-m-surface-hover`}
			>
				<Plus size={24} strokeWidth={1.75} />
			</button>
			<textarea
				ref={ta}
				rows={1}
				enterKeyHint="enter"
				placeholder={placeholder}
				aria-label="消息输入框"
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
					// Hardware keyboards: Enter sends, Shift+Enter newline. Soft keyboards keep newline behaviour.
					if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && matchMedia("(hover: hover)").matches) {
						e.preventDefault();
						if (canSend) submit();
					}
				}}
				style={{ gridArea: "text", maxHeight: MAX_INPUT, fieldSizing: "content" } as CSSProperties}
				className={`m-selectable min-h-11 w-full min-w-0 resize-none self-center overflow-y-auto bg-transparent py-1.5 text-m-md leading-7 text-m-text outline-none placeholder:text-m-text-3 ${
					stacked ? "px-2 pb-2" : "px-1"
				}`}
			/>
			<button
				type="button"
				aria-label={recording ? "停止录音" : "语音输入"}
				aria-pressed={recording}
				disabled={transcribing}
				onClick={() => void toggleRecording()}
				style={{ gridArea: "mic" }}
				className={`${roundBtn} ${recording ? "m-pulse bg-m-danger text-m-bg" : "text-m-text-2 active:bg-m-surface-hover"}`}
			>
				{transcribing ? <Spinner size={18} /> : recording ? <Square size={14} fill="currentColor" /> : <Mic size={22} strokeWidth={1.75} />}
			</button>
			{showStop ? (
				<button type="button" aria-label="停止" onClick={onStop} style={{ gridArea: "send" }} className={`${roundBtn} bg-m-text text-m-bg active:opacity-80`}>
					<Square size={14} fill="currentColor" />
				</button>
			) : (
				<button
					type="button"
					aria-label="发送"
					disabled={!canSend}
					onClick={submit}
					style={{ gridArea: "send" }}
					className={`${roundBtn} ${canSend ? "bg-m-accent-soft text-m-accent-soft-text active:opacity-80" : "bg-m-surface-2 text-m-text-3"}`}
				>
					{busy ? <Spinner size={18} /> : <ArrowUp size={22} strokeWidth={2} />}
				</button>
			)}
		</div>
	);
}
