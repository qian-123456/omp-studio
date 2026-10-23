/**
 * [P] Privacy layer for the composer textarea: mirrored highlight backdrop,
 * "标记为隐私" selection action / context menu, and per-occurrence actions.
 * Listens to the textarea via native events so the Composer only mounts it.
 */

import clsx from "clsx";
import { type ClipAction, runClipboardAction } from "./composerClipboard";
import { ClipboardPaste, Copy, Lock, Scissors, TextSelect } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { FloatingLayer } from "../../../components/FloatingLayer";
import { SelectionBubble } from "../../../components/SelectionBubble";
import { addMark, type Highlight, type HighlightKind, isReplaced, toggleHighlight } from "./composerPrivacy";
import { MarkSecretPopover } from "./MarkSecretPopover";
import type { ComposerPrivacy } from "./useComposerPrivacy";

/** Must mirror the textarea's box/typography classes exactly. */
const MIRROR_CLASS =
	"pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-3 pb-1.5 font-sans text-[var(--chat-font-size,14px)] leading-[1.35] text-transparent select-none";

const KIND_CLASS: Record<HighlightKind, string> = {
	marked: "rounded-[3px] bg-amber-400/35",
	auto: "rounded-[3px] bg-amber-400/35",
	accepted: "rounded-[3px] bg-amber-400/35",
	suggestion: "underline decoration-dashed decoration-amber-500 decoration-[1.5px] underline-offset-[3px]",
	undone:
		"underline decoration-dotted decoration-[color:var(--text-40,var(--text-dim))] decoration-[1.5px] underline-offset-[3px]",
};

interface Selection {
	start: number;
	end: number;
}

interface MarkTarget extends Selection {
	value: string;
	anchor: DOMRect;
}

function mirrorChildren(
	text: string,
	ranges: Array<{ start: number; end: number; className: string; key: string }>,
	onRef?: (key: string, el: HTMLSpanElement | null) => void,
): ReactNode[] {
	const parts: ReactNode[] = [];
	let last = 0;
	for (const r of ranges) {
		if (r.start > last) parts.push(text.slice(last, r.start));
		parts.push(
			<span key={r.key} ref={onRef ? (el) => onRef(r.key, el) : undefined} className={r.className}>
				{text.slice(r.start, r.end)}
			</span>,
		);
		last = r.end;
	}
	if (last < text.length) parts.push(text.slice(last));
	// Trailing newline needs a glyph to occupy the last line like the textarea does.
	if (text.endsWith("\n")) parts.push("\u200b");
	return parts;
}

const highlightKey = (h: Highlight) => `${h.start}:${h.end}:${h.entry.id}`;

export function ComposerSecretOverlay({
	sessionId,
	text,
	taRef,
	privacy,
	indent = 0,
}: {
	sessionId: string;
	text: string;
	taRef: RefObject<HTMLTextAreaElement | null>;
	privacy: ComposerPrivacy;
	/** First-line indent in px (command chip width) mirrored from the textarea. */
	indent?: number;
}) {
	const { highlights } = privacy;
	const mirrorRef = useRef<HTMLDivElement>(null);
	const selMirrorRef = useRef<HTMLDivElement>(null);
	const [selSpan, setSelSpan] = useState<HTMLSpanElement | null>(null);
	const spanRefs = useRef(new Map<string, HTMLSpanElement>());
	const [selection, setSelection] = useState<Selection | null>(null);
	const [focused, setFocused] = useState(false);
	const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
	const [markTarget, setMarkTarget] = useState<MarkTarget | null>(null);
	const [active, setActive] = useState<{ key: string; anchor: DOMRect } | null>(null);

	// Latest values for native listeners.
	const latest = useRef({ text, highlights });
	latest.current = { text, highlights };

	useEffect(() => {
		const ta = taRef.current;
		if (!ta) return;
		const readSelection = () => {
			const { selectionStart: start, selectionEnd: end } = ta;
			setSelection(start !== end ? { start, end } : null);
			return { start, end };
		};
		// WebKit collapses the selection after mouseup/keyup handlers run, so
		// also re-read on the next frame. Mousedown (primary button) hides the
		// pill immediately: the old selection is about to be replaced anyway.
		const onSettle = () => {
			readSelection();
			requestAnimationFrame(readSelection);
		};
		const onMouseDown = (e: MouseEvent) => {
			if (e.button === 0) setSelection(null);
		};
		const onClick = () => {
			const { start, end } = readSelection();
			if (start !== end) return;
			const hit = latest.current.highlights.find((h) => h.start <= start && start < h.end);
			const el = hit ? spanRefs.current.get(highlightKey(hit)) : undefined;
			setActive(hit && el ? { key: highlightKey(hit), anchor: el.getBoundingClientRect() } : null);
		};
		const onContextMenu = (e: MouseEvent) => {
			const { start, end } = readSelection();
			if (start === end) return;
			e.preventDefault();
			setMenuAt({ x: e.clientX, y: e.clientY });
		};
		const onScroll = () => {
			for (const m of [mirrorRef.current, selMirrorRef.current]) if (m) m.scrollTop = ta.scrollTop;
		};
		const onFocus = () => setFocused(true);
		const onBlur = () => setFocused(false);
		const onInput = () => {
			readSelection();
			setActive(null);
			setMenuAt(null);
		};
		// Selection can collapse without select/keyup (IME, programmatic text
		// changes, caret moves by mouse drag end outside the textarea).
		const onSelectionChange = () => {
			if (document.activeElement === ta) readSelection();
		};
		ta.addEventListener("select", readSelection);
		ta.addEventListener("keyup", onSettle);
		ta.addEventListener("mouseup", onSettle);
		ta.addEventListener("mousedown", onMouseDown);
		ta.addEventListener("click", onClick);
		ta.addEventListener("contextmenu", onContextMenu);
		ta.addEventListener("scroll", onScroll);
		ta.addEventListener("focus", onFocus);
		ta.addEventListener("blur", onBlur);
		ta.addEventListener("input", onInput);
		document.addEventListener("selectionchange", onSelectionChange);
		setFocused(document.activeElement === ta);
		return () => {
			ta.removeEventListener("select", readSelection);
			ta.removeEventListener("keyup", onSettle);
			ta.removeEventListener("mouseup", onSettle);
			ta.removeEventListener("mousedown", onMouseDown);
			ta.removeEventListener("click", onClick);
			ta.removeEventListener("contextmenu", onContextMenu);
			ta.removeEventListener("scroll", onScroll);
			ta.removeEventListener("focus", onFocus);
			ta.removeEventListener("blur", onBlur);
			ta.removeEventListener("input", onInput);
			document.removeEventListener("selectionchange", onSelectionChange);
		};
	}, [taRef]);

	// Keep mirrors scrolled with the textarea after re-render.
	useEffect(() => {
		const ta = taRef.current;
		if (!ta) return;
		for (const m of [mirrorRef.current, selMirrorRef.current]) if (m) m.scrollTop = ta.scrollTop;
	});

	// Guard against stale state: the live textarea selection is the truth.
	const liveTa = taRef.current;
	const validSelection =
		selection &&
		selection.end <= text.length &&
		liveTa &&
		liveTa.selectionStart === selection.start &&
		liveTa.selectionEnd === selection.end
			? selection
			: null;
	const selectedValue = validSelection ? text.slice(validSelection.start, validSelection.end) : "";
	const canMark = selectedValue.trim().length > 0 && !selectedValue.includes("\n");

	const openMark = () => {
		if (!validSelection || !canMark) return;
		const anchor = selSpan?.getBoundingClientRect() ?? taRef.current?.getBoundingClientRect() ?? new DOMRect();
		setMenuAt(null);
		setMarkTarget({ ...validSelection, value: selectedValue, anchor });
	};

	const runAction = async (action: ClipAction) => {
		const ta = taRef.current;
		setMenuAt(null);
		if (!ta) return;
		ta.focus();
		await runClipboardAction(ta, action);
		ta.focus();
		const { selectionStart: start, selectionEnd: end } = ta;
		setSelection(start !== end ? { start, end } : null);
	};

	const activeHighlight = active ? highlights.find((h) => highlightKey(h) === active.key) : undefined;
	const showPill = focused && !!validSelection && !markTarget && !menuAt;

	return (
		<>
			{highlights.length > 0 && (
				<div ref={mirrorRef} aria-hidden="true" className={clsx(MIRROR_CLASS, "z-0")} style={{ wordBreak: "break-word", textIndent: indent }}>
					{mirrorChildren(
						text,
						highlights.map((h) => ({
							start: h.start,
							end: h.end,
							key: highlightKey(h),
							className: KIND_CLASS[h.kind],
						})),
						(key, el) => {
							if (el) spanRefs.current.set(key, el);
							else spanRefs.current.delete(key);
						},
					)}
				</div>
			)}
			{validSelection && (
				<div
					ref={selMirrorRef}
					aria-hidden="true"
					className={clsx(MIRROR_CLASS, "invisible")}
					style={{ wordBreak: "break-word", textIndent: indent }}
				>
					{text.slice(0, validSelection.start)}
					<span ref={setSelSpan}>{selectedValue}</span>
					{text.slice(validSelection.end)}
				</div>
			)}
			{showPill && selSpan && canMark && (
				<SelectionBubble anchor={selSpan}>
					<PillButton icon={<Lock size={11} />} label="标记为隐私" onClick={openMark} />
				</SelectionBubble>
			)}
			{menuAt && (
				<FloatingLayer
					anchor={menuAt}
					placement="bottom-start"
					layer="menu"
					onDismiss={() => setMenuAt(null)}
					className="min-w-[140px] rounded-lg border border-[var(--line,var(--border))] bg-[var(--bg-panel)] p-1 text-[12px] shadow-lg"
				>
					<MenuItem icon={<Scissors size={12} />} label="剪切" onClick={() => void runAction("cut")} />
					<MenuItem icon={<Copy size={12} />} label="复制" onClick={() => void runAction("copy")} />
					<MenuItem icon={<ClipboardPaste size={12} />} label="粘贴" onClick={() => void runAction("paste")} />
					<MenuItem icon={<TextSelect size={12} />} label="全选" onClick={() => void runAction("selectAll")} />
					<div className="my-1 border-t border-[var(--border-divider)]" />
					<MenuItem icon={<Lock size={12} />} label="标记为隐私" disabled={!canMark} onClick={openMark} />
				</FloatingLayer>
			)}
			{markTarget && (
				<MarkSecretPopover
					sessionId={sessionId}
					value={markTarget.value}
					anchor={markTarget.anchor}
					onClose={() => {
						setMarkTarget(null);
						taRef.current?.focus();
					}}
					onMarked={(entry, scope) => {
						const { start, end, value } = markTarget;
						// The draft may have changed while the popover was open; only bind a still-matching range.
						if (latest.current.text.slice(start, end) === value) {
							privacy.update((d) => addMark(d, { start, end, entry }, scope));
						}
						setMarkTarget(null);
						taRef.current?.focus();
					}}
				/>
			)}
			{active && activeHighlight && (
				<FloatingLayer
					anchor={active.anchor}
					placement="top-start"
					offset={6}
					layer="popover"
					onDismiss={() => setActive(null)}
					className="max-w-[300px] rounded-lg border border-[var(--line,var(--border))] bg-[var(--bg-panel)] p-2 text-[12px] text-[var(--text)] shadow-lg"
				>
					<HighlightAction
						highlight={activeHighlight}
						onToggle={() => {
							privacy.update((d) => toggleHighlight(d, activeHighlight));
							setActive(null);
							taRef.current?.focus();
						}}
					/>
				</FloatingLayer>
			)}
		</>
	);
}

function HighlightAction({ highlight, onToggle }: { highlight: Highlight; onToggle: () => void }) {
	const { kind, entry } = highlight;
	const name = entry.label ?? "隐私内容";
	const description = isReplaced(kind)
		? `发送时替换为 ${entry.placeholder}`
		: kind === "suggestion"
			? `⚠ 可能是隐私「${name}」，较短/常见，默认不替换`
			: "这一处本次发送不替换";
	const action = isReplaced(kind) ? "撤销" : kind === "suggestion" ? "替换这一处" : "恢复替换";
	return (
		<div className="flex items-center gap-2">
			<span className="min-w-0 flex-1 break-all text-[var(--text-60,var(--text-muted))]">{description}</span>
			<button
				type="button"
				onMouseDown={(e) => e.preventDefault()}
				onClick={onToggle}
				className="shrink-0 rounded-md px-2 py-0.5 hover:bg-[var(--ghost-hover,var(--bg-hover))]"
			>
				{action}
			</button>
		</div>
	);
}

function PillButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			// Keep the textarea selection alive.
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]"
		>
			{icon}
			{label}
		</button>
	);
}

function MenuItem({
	icon,
	label,
	onClick,
	disabled,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
			className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-[var(--ghost-hover,var(--bg-hover))] disabled:opacity-50"
		>
			{icon}
			{label}
		</button>
	);
}
