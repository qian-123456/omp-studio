/**
 * OMP status-report extension for omp-workspace (docs/ARCHITECTURE.md §8).
 * Installed at startup to ~/.omp-workspace/extension/omp-workspace-status.ts.
 *
 * TODO(module E): hook session_start / agent_start / agent_end /
 * tool_approval_requested / tool_approval_resolved / session_shutdown and write
 * ~/.omp-workspace/status/<sessionId>.json atomically. Never throws.
 */
export default function ompWorkspaceStatus(pi: unknown): void {
	// no-op scaffold
}
