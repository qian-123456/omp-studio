/** Full composer for a desktop-local draft; no transcript/RPC is needed to render it. */
import { StartGlow, StartHero } from "../../components/StartHero";
import { useT } from "../../stores/language";
import { Composer } from "../chat/Composer";
import { usePendingSession } from "./pendingSession";

export function PendingSessionView() {
	const { t } = useT();
	const id = usePendingSession((s) => (s.selectedId && s.drafts[s.selectedId] ? s.selectedId : null));
	const startError = usePendingSession((s) => (id ? (s.drafts[id]?.startError ?? null) : null));
	if (!id) return null;
	return (
		<div className="relative @container flex h-full flex-col justify-center pb-[6vh]">
			<StartGlow />
			<StartHero />
			<div aria-hidden className="pb-8" />
			<div className="mx-auto w-full max-w-[880px] px-6">
				<div className="start-rise">
					<Composer key={id} sessionId={id} />
				</div>
				{startError && (
					<div role="alert" className="mt-2 px-2 text-[12px] text-red-500 select-text">
						{t("sessions.createSessionFailed", { error: startError })}
					</div>
				)}
			</div>
		</div>
	);
}
