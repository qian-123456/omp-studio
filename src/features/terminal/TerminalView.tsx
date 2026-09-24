/** [E] Terminal view (xterm) for a session. Placeholder. */
export function TerminalView({ sessionId }: { sessionId: string }) {
	return (
		<div className="flex h-full items-center justify-center text-neutral-500">
			终端 {sessionId} — TODO(module E)
		</div>
	);
}
