import { ArrowUp, Mic, Plus, Square } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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

/** One 28px line plus 12px padding, inside the 44px touch row. */
const LINE_PX = 44;
const MAX_INPUT = "calc(var(--m-vh, 100dvh) * 0.4 - 64px)";

const roundBtn = "m-glass-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill transition-colors duration-(--m-dur-fast)";

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
	onFocusChange,
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
}) {
	const capsule = useRef<HTMLDivElement>(null);
	const actions = useRef<HTMLDivElement>(null);
	const ta = useRef<HTMLTextAreaElement>(null);
	const composing = useRef(false);
	const raf = useRef(0);
	const [hasText, setHasText] = useState(() => initialText.trim() !== "");
	const [multi, setMulti] = useState(false);
	// Latest callbacks without re-creating the imperative api on every render.
	const cb = useRef({ onSync, onInput, onUnmount });
	cb.current = { onSync, onInput, onUnmount };

	/** Measure the real textarea at its inline width, then size it at its displayed width. */
	const measure = useCallback(() => {
		const el = ta.current;
		const box = capsule.current;
		const buttons = actions.current;
		if (!el || !box || !buttons || composing.current) return;
		const style = getComputedStyle(box);
		const inlineWidth = Math.max(1, box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 44 - buttons.offsetWidth - 2 * (parseFloat(style.columnGap) || 0));
		const scrollTop = el.scrollTop;
		el.style.width = `${inlineWidth}px`;
		el.style.height = "0px";
		const wraps = el.value !== "" && el.scrollHeight > LINE_PX;
		setMulti(wraps);
		el.style.width = "100%";
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
	}, [measure, multi, working, top]);

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
	const showStop = working && onStop != null;
	const submit = () => {
		const text = ta.current?.value ?? "";
		// A stale second click on Send must never become an implicit Stop request.
		if (!busy && (text.trim() !== "" || hasExtra)) onSend(text);
	};
	const stacked = multi || top != null;

	return (
		<div
			ref={capsule}
			className="grid items-end gap-x-1 rounded-(--m-composer-radius) border border-white/12 bg-m-composer-bg/80 backdrop-blur-xl p-2 shadow-m-composer"
			style={{
				gridTemplateColumns: "44px minmax(0, 1fr) auto",
				gridTemplateAreas: stacked ? '"top top top" "text text text" "plus . actions"' : '"plus text actions"',
			}}
		>
			{top != null && <div style={{ gridArea: "top" }}>{top}</div>}
			<button
				type="button"
				aria-label="添加"
				onClick={onPlus}
				style={{ gridArea: "plus" }}
				className={`${roundBtn} text-m-text`}
			>
				<Plus size={24} strokeWidth={1.75} />
			</button>
			<textarea
				ref={ta}
				rows={1}
				enterKeyHint="enter"
				placeholder={placeholder}
				aria-label="消息输入框"
				onFocus={() => onFocusChange?.(true)}
				onBlur={() => onFocusChange?.(false)}
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
				style={{ gridArea: "text", maxHeight: MAX_INPUT }}
				className="m-selectable min-h-11 w-full min-w-0 resize-none self-center overflow-y-auto bg-transparent px-1 py-1.5 text-m-md leading-7 text-m-text outline-none placeholder:text-m-text-3"
			/>
			<div ref={actions} className="grid grid-flow-col auto-cols-[44px] items-end gap-1" style={{ gridArea: "actions" }}>
				<button
					type="button"
					aria-label={recording ? "停止录音" : "语音输入"}
					aria-pressed={recording}
					disabled={transcribing}
					onClick={() => void toggleRecording()}
					className={`${roundBtn} ${recording ? "m-pulse bg-m-danger text-m-bg" : "text-m-text"}`}
				>
					{transcribing ? <Spinner size={18} /> : recording ? <Square size={14} fill="currentColor" /> : <Mic size={22} strokeWidth={1.75} />}
				</button>
				{showStop && (
					<button key="stop" type="button" aria-label="停止" onClick={onStop} className={`${roundBtn} bg-m-text text-m-bg active:opacity-80`}>
						<Square size={14} fill="currentColor" />
					</button>
				)}
				<button
					key="send"
					type="button"
					aria-label="发送"
					disabled={!canSend}
					onClick={submit}
					className={`${roundBtn} ${canSend ? "bg-m-accent-soft/80 text-m-accent-soft-text border-m-accent/30 active:opacity-80" : "opacity-40 text-m-text-3"}`}
				>
					{busy ? <Spinner size={18} /> : <ArrowUp size={22} strokeWidth={2} />}
				</button>
			</div>
		</div>
	);
}
