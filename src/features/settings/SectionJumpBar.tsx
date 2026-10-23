/**
 * Jump chips for long settings pages. Place it right under the page header: it scans
 * its parent element for `[data-jump="<label>"]` anchors (`SettingsCard jump="…"`, omp
 * section wrappers, custom panels) and renders one chip per anchor in DOM order. Anchors
 * may mount late (config loading, lazy panels), so the scan follows DOM mutations.
 * Hidden until the page has at least `min` anchors.
 */
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

/** Attribute that marks a jump target; its value is the chip label. */
export const JUMP_ATTR = "data-jump";

const SELECTOR = `[${JUMP_ATTR}]`;

export function SectionJumpBar({ min = 4 }: { min?: number }) {
	const ref = useRef<HTMLDivElement>(null);
	const [labels, setLabels] = useState<string[]>([]);

	useEffect(() => {
		const root = ref.current?.parentElement;
		if (!root) return;
		let frame = 0;
		const scan = () => {
			frame = 0;
			const next = [...root.querySelectorAll<HTMLElement>(SELECTOR)].map((el) => el.getAttribute(JUMP_ATTR) ?? "");
			setLabels((prev) => (prev.length === next.length && prev.every((l, i) => l === next[i]) ? prev : next));
		};
		scan();
		const observer = new MutationObserver(() => {
			if (!frame) frame = requestAnimationFrame(scan);
		});
		observer.observe(root, { childList: true, subtree: true });
		return () => {
			observer.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	}, []);

	const jump = useCallback((index: number) => {
		const root = ref.current?.parentElement;
		root?.querySelectorAll<HTMLElement>(SELECTOR)[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, []);

	const visible = labels.length >= min;
	return (
		<div ref={ref} className={clsx("flex flex-wrap gap-1.5", !visible && "hidden")}>
			{visible &&
				labels.map((label, i) => (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat; order is the identity
						key={i}
						type="button"
						onClick={() => jump(i)}
						className="whitespace-nowrap rounded-full hairline bg-[var(--well-bg)] px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
					>
						{label}
					</button>
				))}
		</div>
	);
}
