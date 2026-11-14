import { useId } from "react";

/**
 * Vecway brand mark: monochrome wrench-V emblem (BW1) in a dark obsidian squircle.
 */
export function AppMark({ size = 32, className = "" }: { size?: number; className?: string }) {
	const id = useId();
	return (
		<svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden className={`shrink-0 ${className}`}>
			<defs>
				<linearGradient id={`${id}-bg`} x1="64" y1="24" x2="448" y2="488" gradientUnits="userSpaceOnUse">
					<stop offset="0%" stopColor="#141417" />
					<stop offset="100%" stopColor="#09090B" />
				</linearGradient>
				<linearGradient id={`${id}-left`} x1="120" y1="128" x2="232" y2="388" gradientUnits="userSpaceOnUse">
					<stop offset="0%" stopColor="#A1A1AA" />
					<stop offset="100%" stopColor="#52525B" />
				</linearGradient>
				<linearGradient id={`${id}-right`} x1="396" y1="96" x2="216" y2="388" gradientUnits="userSpaceOnUse">
					<stop offset="0%" stopColor="#FFFFFF" />
					<stop offset="100%" stopColor="#D4D4D8" />
				</linearGradient>
			</defs>
			<rect x="24" y="24" width="464" height="464" rx="108" fill={`url(#${id}-bg)`} stroke="#27272A" strokeWidth="8" />
			<path d="M132 148 L228 368" stroke={`url(#${id}-left)`} strokeWidth="56" strokeLinecap="round" />
			<path
				d="M200 356 L284 188 C268 148, 284 104, 322 86 C338 78, 354 78, 366 84 L328 138 L364 174 L418 136 C424 148, 424 164, 416 180 C398 218, 354 234, 314 218 L254 380 C240 404, 188 380, 200 356 Z"
				fill={`url(#${id}-right)`}
			/>
			<circle cx="228" cy="368" r="16" fill="#090B0E" />
		</svg>
	);
}
