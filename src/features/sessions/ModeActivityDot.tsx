import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { ModeActivity } from "../inbox/useInboxBadge";
import { useT } from "../../stores/language";
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
    const { t } = useT();
    const attention = activity.badge > 0 ? (
        <span
            className="min-w-[14px] shrink-0 rounded-full bg-indigo-500 px-1 text-center font-mono text-[9px] font-medium leading-[14px] text-white"
            title={t("sessions.sessionsNeedAttention", { count: activity.badge })}
        >
            {activity.badge > 99 ? "99+" : activity.badge}
        </span>
    ) : null;
    if (activity.running > 0) {
        if (variant === "dot") {
            return (
                <Loader2
                    size={11}
                    className={clsx("shrink-0 animate-spin text-[var(--text-muted)]", className)}
                    aria-label={t("sessions.sessionsRunning", { count: activity.running })}
                />
            );
        }
        return (
            <span
                className={clsx("flex shrink-0 items-center gap-1", className)}
                title={t("sessions.sessionsRunning", { count: activity.running })}
            >
                <Loader2 size={13} className="shrink-0 animate-spin text-[var(--text-muted)]" aria-hidden />
                {attention}
            </span>
        );
    }
    if (attention) return attention;
    return null;
}
