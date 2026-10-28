// Feeds transcript entries to the real bundled extension's session_start handler (boundary: omp supplies entries).
import { readFileSync } from "node:fs";
process.argv.push("--mode=rpc");
const mod = await import("<repo>/extension/omp-workspace-plan.ts");
function run(lines) {
	const handlers = {};
	const entries = lines.map((l) => JSON.parse(l));
	let status;
	const pi = {
		on: (e, h) => (handlers[e] = h), registerCommand() {}, getActiveTools: () => ["read"], getAllTools: () => [{ name: "read" }],
		setActiveTools: async () => {}, appendEntry() {}, pi: { Settings: { instance: { get: () => undefined, getModelRole: () => undefined } } },
	};
	mod.default(pi);
	const ctx = { cwd: "/w", ui: { setStatus: (_k, t) => (status = JSON.parse(t)), notify() {} }, sessionManager: { getEntries: () => entries, getSessionId: () => "replay" } };
	return handlers.session_start({}, ctx).then(() => status.enabled);
}
const forkLines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const parentLines = [...forkLines, '{"type":"custom","id":"e2","customType":"ompws-plan-state","data":{"enabled":false,"version":0,"phase":"planning"}}'];
console.log(JSON.stringify({ parentPlanEnabledAfterResume: await run(parentLines), forkPlanEnabledAfterStart: await run(forkLines) }));
