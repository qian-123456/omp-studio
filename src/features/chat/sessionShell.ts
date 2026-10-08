import { ensureLive } from "../../lib/ensureLive";
import { rpcSend } from "../../lib/ipc";

/** POSIX single-quote escaping for shell arguments. */
export function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Runs a shell command in the session's cwd through the omp RPC `bash`
 * command and returns its output. Throws on non-zero exit.
 */
export async function runSessionBash(
	sessionId: string,
	command: string,
): Promise<string> {
	await ensureLive(sessionId);
	const resp = (await rpcSend(sessionId, { type: "bash", command })) as {
		success?: boolean;
		error?: string;
		data?: { output?: string; exitCode?: number };
	} | null;
	if (resp && resp.success === false) {
		throw new Error(resp.error ?? "命令执行失败");
	}
	const output = resp?.data?.output ?? "";
	const code = resp?.data?.exitCode;
	if (typeof code === "number" && code !== 0) {
		throw new Error(output.trim() || `退出码 ${code}`);
	}
	return output;
}
