import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { copyText, errMsg } from "../lib/dialogs";
import { toast } from "../lib/toast";

export interface CopyButtonProps {
	/** Text to copy; a function is evaluated at click time (e.g. to read a live draft). */
	text: string | (() => string);
	/** Icon size in px. Default 12. */
	size?: number;
	/** Visible text next to the icon while idle. Omit for an icon-only button. */
	label?: ReactNode;
	/** Visible text while in the copied state. Defaults to `label`. */
	copiedLabel?: ReactNode;
	/** Tooltip and accessible name. Default 「复制」 (「已复制」 while copied). */
	title?: string;
	/** Hide the icon (text-only button, e.g. 「复制」/「已复制」). */
	hideIcon?: boolean;
	/** Classes for the button element. */
	className?: string;
	/** Extra classes applied only while in the copied state. */
	copiedClassName?: string;
	/** How long the copied state lasts. Default 1500 ms. */
	resetMs?: number;
	disabled?: boolean;
	/** Fired after a successful copy. */
	onCopied?: () => void;
}

/**
 * Copy-to-clipboard button: `copyText` (Tauri fallback), Copy → Check icon swap
 * for `resetMs`, and a 「复制失败」 error toast. Pass `className` to match the host surface.
 */
export function CopyButton({
	text,
	size = 12,
	label,
	copiedLabel,
	title,
	hideIcon,
	className,
	copiedClassName,
	resetMs = 1500,
	disabled,
	onCopied,
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | undefined>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

	const onClick = useCallback(
		async (e: MouseEvent<HTMLButtonElement>) => {
			e.stopPropagation();
			try {
				await copyText(typeof text === "function" ? text() : text);
			} catch (err) {
				toast.error(`复制失败: ${errMsg(err)}`);
				return;
			}
			setCopied(true);
			onCopied?.();
			clearTimeout(timer.current);
			timer.current = window.setTimeout(() => setCopied(false), resetMs);
		},
		[text, resetMs, onCopied],
	);

	const name = copied ? "已复制" : (title ?? "复制");
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={name}
			aria-label={name}
			className={clsx(className, copied && copiedClassName)}
		>
			{!hideIcon &&
				(copied ? (
					<Check size={size} className="text-[var(--status-success)]" />
				) : (
					<Copy size={size} />
				))}
			{copied ? (copiedLabel ?? label) : label}
		</button>
	);
}
