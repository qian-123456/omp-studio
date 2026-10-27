import "../../../styles/tokens.css";
import "../../../styles/base.css";
import "../chat.css";
import { runChatBench } from "./harness";

const out = document.getElementById("out") as HTMLPreElement;
const stage = document.getElementById("stage") as HTMLDivElement;

async function run(streaming: boolean, ime: boolean): Promise<void> {
	out.textContent = "运行中\n";
	const host = document.createElement("div");
	host.style.height = "100%";
	stage.replaceChildren(host);
	const r = await runChatBench(host, { streaming, ime });
	out.textContent += `turns=${r.turns} streaming=${r.streaming} ime=${r.ime}\nmount=${r.mountMs.toFixed(1)}ms\np50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms max=${r.max.toFixed(1)}ms\n${r.p95 < 50 ? "PASS (<50ms)" : "FAIL (>=50ms)"}\n`;
}

for (const [id, s, i] of [["idle", false, false], ["stream", true, false], ["ime", true, true]] as const) {
	document.getElementById(id)?.addEventListener("click", () => void run(s, i));
}
