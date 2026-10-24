import { Lightbulb } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { BacklogItem } from "../../lib/contracts";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useT } from "../../stores/language";
import { useBacklog } from "./backlogStore";
import { DispatchDialog } from "./DispatchDialog";
import { IdeasPanel } from "./IdeasPanel";
import { needsAttentionCount } from "./ideasLogic";

/** Top-bar 「想法」 capsule: badge = pending + review (trash excluded) + the ideas popover. */
export function IdeasCapsule() {
	const { t } = useT();
	const items = useBacklog((s) => s.items);
	const load = useBacklog((s) => s.load);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const sessions = useSessions((s) => s.sessions);
	const currentProject = selectedSessionId ? (sessions[selectedSessionId]?.cwd ?? null) : null;

	// Reopen the popover after a reload if an unsaved edit was in progress.
	const [open, setOpen] = useState(() => useBacklog.getState().editBuffer !== null);
	const [dispatching, setDispatching] = useState<BacklogItem[] | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		void load().catch(() => {});
	}, [load]);

	const badgeCount = useMemo(() => needsAttentionCount(items, sessions), [items, sessions]);

	return (
		<div className="relative flex items-center">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(!open)}
				className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-95 ${
					open
						? "bg-[var(--bg-selected)] text-[var(--text)]"
						: "text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200"
				}`}
				title={
					badgeCount > 0
						? t("backlog.capsuleTitleWithCount", { count: badgeCount })
						: t("backlog.capsuleTitle")
				}
				aria-label={t("backlog.capsuleAriaLabel")}
			>
				<Lightbulb size={15} className={badgeCount > 0 ? "text-amber-500" : undefined} />
			</button>

			<FloatingLayer
				anchor={open ? triggerRef.current : null}
				placement="bottom-end"
				offset={6}
				layer="popover"
				onDismiss={() => setOpen(false)}
				ignoreRefs={[triggerRef]}
				className="w-[420px] rounded-[18px] p-3 shadow-apple-modal"
			>
				<IdeasPanel
					items={items}
					currentProject={currentProject}
					onDispatch={(batch) => {
						setOpen(false);
						setDispatching(batch);
					}}
				/>
			</FloatingLayer>

			{dispatching && (
				<DispatchDialog items={dispatching} currentProject={currentProject} onClose={() => setDispatching(null)} />
			)}
		</div>
	);
}
