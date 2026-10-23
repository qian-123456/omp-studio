import clsx from "clsx";
import type { ModeActivity } from "../inbox/useInboxBadge";

/**
 * Compact "something happened elsewhere" hint: a count pill when sessions need
 * attention (awaiting / error / unread), else a pulsing dot while sessions run.
 */
export function ModeActivityDot({
	activity,
	variant = "badge",
	className,
}: {
	activity: ModeActivity;
	variant?: "dot" | "badge";
	className?: string;
}) {
	if (activity.badge > 0) {
		if (variant === "dot") {
			return (
				<span
					className={clsx(
						"h-2 w-2 shrink-0 rounded-full bg-indigo-500 ring-2 ring-neutral-950",
						className,
					)}
					title={`${activity.badge} 个会话需要关注`}
				/>
			);
		}
		return (
			<span
				className={clsx(
					"min-w-[14px] shrink-0 rounded-full bg-indigo-500 px-1 text-center font-mono text-[9px] font-medium leading-[14px] text-white",
					className,
				)}
				title={`${activity.badge} 个会话需要关注`}
			>
				{activity.badge > 99 ? "99+" : activity.badge}
			</span>
		);
	}
	if (activity.running > 0) {
		return (
			<span
				className={clsx("relative flex h-2 w-2 shrink-0", className)}
				title={`${activity.running} 个会话运行中`}
			>
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
				<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
			</span>
		);
	}
	return null;
}
