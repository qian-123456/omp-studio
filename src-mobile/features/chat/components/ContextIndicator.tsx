/** Desktop-sized context usage ring and its compact textual value. */
export function ContextIndicator({ text, percent }: { text: string; percent?: number | null }) {
	const parsed = text.startsWith("<") ? Number.parseFloat(text.slice(1)) / 2 : Number.parseFloat(text);
	const value = percent === undefined ? parsed : percent;
	const fraction = typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : 0;
	const circumference = 2 * Math.PI * 7;
	return (
		<>
			<svg width={18} height={18} viewBox="0 0 18 18" className="shrink-0 -rotate-90" aria-hidden="true">
				<circle cx={9} cy={9} r={7} fill="none" strokeWidth={2.2} className="stroke-m-surface-2" />
				<circle cx={9} cy={9} r={7} fill="none" strokeWidth={2.2} stroke="currentColor" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)} strokeLinecap="round" className="transition-all duration-300" />
			</svg>
			<span className="font-mono text-[11px] font-medium leading-none">{text === "未知" ? "—" : text}</span>
		</>
	);
}
