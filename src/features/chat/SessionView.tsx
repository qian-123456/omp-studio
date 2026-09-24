/** [B] Center session view: stream, composer, tool cards, approvals. Placeholder. */
export function SessionView({
	sessionId,
	compact,
}: {
	sessionId: string;
	compact?: boolean;
}) {
	return (
		<div className="flex h-full items-center justify-center text-neutral-500">
			会话视图 {sessionId}
			{compact ? " (compact)" : ""} — TODO(module B)
		</div>
	);
}
