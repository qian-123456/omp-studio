// Baseline acceptance gate for the perf-poller replay suite (audit evidence).
// Exit 0 = the TWO expected baseline defects reproduced as named AssertionError
// failures and the two witnesses passed — the product is NOT fixed at this
// baseline. Anything else (import/runtime errors, mock failures, different
// assertion shapes, unhandled errors) exits 1.
//
// Usage: node check-baseline.mjs [path-to-vitest-report.json]
import { readFileSync } from "node:fs";

const reportPath = process.argv[2] ?? new URL("./vitest-report.json", import.meta.url).pathname;
let report;
try {
	report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (e) {
	console.error(`FAIL: cannot read vitest JSON report at ${reportPath}: ${e?.message ?? e}`);
	process.exit(1);
}

const results = report.testResults?.flatMap((f) => f.assertionResults ?? []) ?? [];
const byName = (needle) => results.filter((t) => (t.fullName ?? t.title ?? "").includes(needle));
const lines = [];
let ok = true;
const check = (cond, label, detail = "") => {
	lines.push(`${cond ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
	ok = ok && cond;
	return cond;
};

// Exactly the four named scenarios; anything else (import/runtime/unhandled
// errors surface as extra or differently-named entries) fails the gate.
check(results.length === 4, "exactly 4 named results", `got ${results.length}`);
check(report.numRuntimeErrors === undefined || report.numRuntimeErrors === 0, "no runtime errors reported");

const gates = [
	{
		name: "RefreshOverlap.tla",
		// Bug signature: a SECOND app_memory_usage fired while the first was
		// still pending → expected 2 to be 1. A mock/harness failure would not
		// produce this assertion shape.
		assertion: "expected 2 to be 1",
	},
	{
		name: "PartialFailure.tla",
		// Bug signature: BOTH independent display consequences are absent at
		// baseline (fresh bar label AND fresh popover app value discarded with
		// the Promise.all rejection) → combined signal "false|false".
		assertion: "expected 'false|false' to be 'true|true'",
	},
];
for (const g of gates) {
	const [t] = byName(g.name);
	check(t !== undefined, `${g.name} scenario present`);
	if (!t) continue;
	check(t.status === "failed", `${g.name} fails at baseline`, t.status);
	const msg = (t.failureMessages ?? []).join("\n");
	check(msg.includes("AssertionError"), `${g.name} failure is an AssertionError (not an import/mock error)`, msg.slice(0, 120));
	check(msg.includes(g.assertion), `${g.name} matches bug signature ${JSON.stringify(g.assertion)}`, msg.slice(0, 200));
}

for (const w of ["SnapshotAgreement.tla", "MemoryPartition.tla"]) {
	const [t] = byName(w);
	check(t !== undefined, `${w} scenario present`);
	if (t) check(t.status === "passed", `${w} witness passes`, t.status);
}

console.log(lines.join("\n"));
console.log(ok
	? `\nBASELINE REPRODUCED: 2 expected defect gates failed as named AssertionErrors, 2 witnesses passed (product not fixed).`
	: `\nGATE REJECTED: report does not match the expected baseline reproduction.`);
process.exit(ok ? 0 : 1);
