// Drives the real bundled extension through its registered handlers (omp runtime boundary is faked).
process.env.TMPDIR = new URL('./tmp', import.meta.url).pathname;
process.argv.push("--mode=rpc");
const mod = await import("<repo>/extension/omp-workspace-plan.ts");
function setup() {
	const handlers = {}, commands = {}, sent = [], statuses = [];
	const pi = {
		on: (e, h) => (handlers[e] = h), registerCommand: (n, d) => (commands[n] = d.handler), getActiveTools: () => ["read"],
		getAllTools: () => [{ name: "read" }], setActiveTools: async () => {}, getThinkingLevel: () => undefined, appendEntry() {},
		sendMessage: (m, o) => sent.push([m.customType, o]), sendUserMessage() {},
		pi: { Settings: { instance: { get: () => undefined, getModelRole: () => undefined } } },
	};
	mod.default(pi);
	const ctx = { cwd: "/w", ui: { setStatus: (_k, t) => statuses.push(JSON.parse(t)), notify() {} }, sessionManager: { getEntries: () => [], getSessionId: () => "stop-replay-" + Math.random() }, waitForIdle: async () => {}, getContextUsage: () => undefined };
	return { handlers, commands, sent, statuses, ctx };
}
const out = {};
for (const reason of ["aborted", "stop", "toolUse"]) {
	const t = setup();
	await t.commands["plan-action"]("enable", t.ctx);
	await t.handlers.agent_end({ messages: [{ role: "assistant", stopReason: reason }] }, t.ctx);
	out["agent_end stopReason=" + reason + " -> reminder turns triggered"] = t.sent.length;
}
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
mkdirSync(tmpdir() + "/omp-local/approve-replay", { recursive: true });
writeFileSync(tmpdir() + "/omp-local/approve-replay/x-plan.md", "# Plan\n\n## Steps\n- one\n");
const t = setup();
t.ctx.sessionManager.getSessionId = () => "approve-replay";
await t.commands["plan-action"]("enable", t.ctx);
await t.commands["plan-action"]("status", t.ctx);
out["status before approve: enabled/hasContent"] = [t.statuses.at(-1).enabled, !!t.statuses.at(-1).content];
await t.commands["plan-action"]("approve execute", t.ctx);
out["status after approve execute"] = t.statuses.at(-1);
console.log(JSON.stringify(out, null, 1));
