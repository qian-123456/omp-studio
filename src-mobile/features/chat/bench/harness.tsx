/**
 * Chat performance harness (NOT imported by the shipped chat page, so it never reaches the bundle).
 *
 * `runChatBench()` mounts the real MessageList + Composer against a seeded in-memory controller (no network),
 * optionally streams tokens into the live row at ~60 Hz, then types into the composer and measures
 * keystroke -> next paint (input dispatch -> requestAnimationFrame -> macrotask after it).
 *
 * Run it:
 *  - jsdom smoke (timings are NOT representative, only proves the harness works):
 *      node_modules/.bin/vitest run src-mobile/features/chat/bench
 *  - real browser (the number that matters):
 *      node_modules/.bin/vite --config vite.mobile.config.ts --port 5199
 *      open http://localhost:5199/static/features/chat/bench/bench.html   (base is /static/)
 *      DevTools > Performance > CPU 4x slowdown, press 「运行」; budget: p95 < 50 ms (idle and streaming).
 *      Remote iPhone: same URL via the dev server's LAN address + Safari Web Inspector.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { normalizeTranscript } from "../../../core/normalize";
import type { Item, TranscriptItem } from "../../../core/types";
import { ChatCtx } from "../ChatContext";
import { ChatController } from "../chatStore";
import { Composer } from "../components/Composer";
import { MessageList } from "../components/MessageList";
import { buildBlocks } from "../lib/turns";

export interface BenchOptions {
	turns?: number;
	keystrokes?: number;
	/** Stream tokens into the live row while typing. */
	streaming?: boolean;
	/** Simulate pinyin IME: compositionstart, one input per keystroke, compositionend at the end. */
	ime?: boolean;
}

export interface BenchResult {
	turns: number;
	keystrokes: number;
	streaming: boolean;
	ime: boolean;
	p50: number;
	p95: number;
	max: number;
	/** Total render time of the initial 150-turn mount in ms. */
	mountMs: number;
	samples: number[];
}

export function makeTranscript(turns: number): TranscriptItem[] {
	const raw: TranscriptItem[] = [];
	for (let i = 0; i < turns; i++) {
		raw.push({ id: `u${i}`, kind: "user", text: `请帮我处理第 ${i} 个任务，并说明原因。`, ts: new Date(1_760_000_000_000 + i * 60_000).toISOString() });
		raw.push({
			id: `a${i}`,
			kind: "assistant",
			text: `## 结果 ${i}\n\n这是一段包含 **加粗**、\`行内代码\` 和列表的回答：\n\n- 第一项\n- 第二项\n\n\`\`\`ts\nconst n = ${i};\nconsole.log(n);\n\`\`\`\n`,
			thinking: i % 3 === 0 ? "先看一下代码结构，再决定修改点。" : "",
			ts: new Date(1_760_000_030_000 + i * 60_000).toISOString(),
			toolCalls: i % 2 === 0 ? [{ id: `c${i}`, name: "bash", args: { command: "ls -la" } }] : [],
		});
		if (i % 2 === 0) raw.push({ id: `r${i}`, kind: "tool_result", toolResult: { toolCallId: `c${i}`, text: "total 0\nfile-a\nfile-b" } });
	}
	return raw;
}

const frame = (): Promise<void> =>
	new Promise((resolve) => {
		requestAnimationFrame(() => setTimeout(resolve, 0));
	});

function percentile(sorted: number[], p: number): number {
	if (!sorted.length) return 0;
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export async function runChatBench(host: HTMLElement, opts: BenchOptions = {}): Promise<BenchResult> {
	const turns = opts.turns ?? 150;
	const keystrokes = opts.keystrokes ?? 60;
	const controller = new ChatController("bench-session");
	const items = normalizeTranscript(makeTranscript(turns));
	controller.store.setState({ loaded: true, blocks: buildBlocks(items, {}), transcript: { items, offset: 0, tailId: null, stats: {} } });

	const root = createRoot(host);
	const t0 = performance.now();
	flushSync(() =>
		root.render(
			<ChatCtx.Provider value={{ controller, openActions: () => {}, openStat: () => {} }}>
				<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
					<MessageList sessionId="bench-session" />
					<Composer sessionId="bench-session" />
				</div>
			</ChatCtx.Provider>,
		),
	);
	const mountMs = performance.now() - t0;
	await frame();

	let stream: ReturnType<typeof setInterval> | undefined;
	if (opts.streaming) {
		let text = "";
		controller.store.setState({ working: true });
		stream = setInterval(() => {
			text += "流式输出的一小段文字，";
			const live: Item = { id: "__live", role: "assistant", kind: "assistant", text, thinking: "", tools: [], images: [], ts: null, streaming: true };
			controller.store.setState({ live });
		}, 16);
	}

	const input = host.querySelector<HTMLTextAreaElement>("textarea");
	if (!input) throw new Error("composer textarea not found");
	const samples: number[] = [];
	if (opts.ime) input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
	for (let i = 0; i < keystrokes; i++) {
		const start = performance.now();
		input.value += i % 9 === 0 ? "字" : "a";
		input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
		await frame();
		samples.push(performance.now() - start);
		await new Promise((r) => setTimeout(r, 30));
	}
	if (opts.ime) input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
	clearInterval(stream);
	root.unmount();
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		turns,
		keystrokes,
		streaming: !!opts.streaming,
		ime: !!opts.ime,
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		max: sorted[sorted.length - 1] ?? 0,
		mountMs,
		samples,
	};
}
