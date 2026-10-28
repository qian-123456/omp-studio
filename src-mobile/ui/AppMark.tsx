import { useId } from "react";

/**
 * Our brand mark: a soft four-point star with a blue → violet → rose gradient.
 * Own artwork (not the Gemini sparkle) — the repo is public.
 */
export function AppMark({ size = 32, className = "" }: { size?: number; className?: string }) {
	const id = useId();
	return (
		<svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={`shrink-0 ${className}`}>
			<defs>
				<linearGradient id={`${id}-g`} x1="6" y1="8" x2="42" y2="40" gradientUnits="userSpaceOnUse">
					<stop offset="0" stopColor="#5b8cff" />
					<stop offset="0.5" stopColor="#9b72f2" />
					<stop offset="1" stopColor="#f06292" />
				</linearGradient>
			</defs>
			<path
				d="M24 3c1.2 9.6 4.9 15.6 21 21-16.1 5.4-19.8 11.4-21 21-1.2-9.6-4.9-15.6-21-21 16.1-5.4 19.8-11.4 21-21Z"
				fill={`url(#${id}-g)`}
			/>
		</svg>
	);
}
