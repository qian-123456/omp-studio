import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal } from "@xterm/xterm";
import { termClose } from "../../lib/ipc";

export type TerminalPhase = "opening" | "ready" | "exited" | "error";

export interface TerminalSessionEntry {
	termId: string;
	term: Terminal;
	fit: FitAddon;
	search: SearchAddon;
	phase: TerminalPhase;
	exitCode: number | null;
	error: string | null;
	unlisteners: Array<() => void>;
	dataSub: { dispose: () => void };
	onExit?: (code: number | null) => void;
}

// Module-level global registry to keep PTY processes alive across view switches
export const terminalRegistry = new Map<string, TerminalSessionEntry>();

/**
 * Destroy and clean up a session's terminal: unlisten events, close backend PTY,
 * dispose xterm instance and remove from registry.
 */
export function destroySessionTerminal(sessionId: string): void {
	const entry = terminalRegistry.get(sessionId);
	if (!entry) return;
	for (const un of entry.unlisteners) {
		try {
			un();
		} catch {}
	}
	try {
		entry.dataSub.dispose();
	} catch {}
	void termClose(entry.termId).catch(() => {});
	try {
		entry.term.dispose();
	} catch {}
	terminalRegistry.delete(sessionId);
}

export interface AgentTerminalEntry {
	termId: string;
	term: Terminal;
	fit: FitAddon;
	search: SearchAddon;
	cwd: string;
	phase: TerminalPhase;
	exitCode: number | null;
	error: string | null;
	unlisteners: Array<() => void>;
	dataSub: { dispose: () => void };
	onExit?: (code: number | null) => void;
}

let agentTerminalInstance: AgentTerminalEntry | null = null;

export function getAgentTerminal(): AgentTerminalEntry | null {
	return agentTerminalInstance;
}

export function setAgentTerminal(entry: AgentTerminalEntry | null): void {
	agentTerminalInstance = entry;
}

/**
 * Destroy and clean up the full-page agent terminal:
 * unlisten events, close backend PTY, dispose xterm instance and clear registry.
 */
export function destroyAgentTerminal(): void {
	if (!agentTerminalInstance) return;
	for (const un of agentTerminalInstance.unlisteners) {
		try {
			un();
		} catch {}
	}
	try {
		agentTerminalInstance.dataSub.dispose();
	} catch {}
	void termClose(agentTerminalInstance.termId).catch(() => {});
	try {
		agentTerminalInstance.term.dispose();
	} catch {}
	agentTerminalInstance = null;
}
