/** [B] Textarea that grows with its content up to `maxHeightPx`, then scrolls. */

import { type TextareaHTMLAttributes, useLayoutEffect, useRef } from "react";

export function AutoGrowTextarea({
	value,
	maxHeightPx = 480,
	className,
	...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "rows"> & {
	value: string;
	maxHeightPx?: number;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on every value change
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, maxHeightPx)}px`;
		el.style.overflowY = el.scrollHeight > maxHeightPx ? "auto" : "hidden";
	}, [value, maxHeightPx]);
	return (
		<textarea
			{...rest}
			ref={ref}
			rows={1}
			value={value}
			className={className}
		/>
	);
}
