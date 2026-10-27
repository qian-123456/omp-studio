import { describe, expect, it } from "vitest";
import {
	InputQueue,
	TERMINAL_KEYS,
	applyCtrl,
	ctrlSequence,
	decodeChunk,
	isTerminalGone,
	isTerminalLimit,
	parseExit,
	reconnectDelay,
} from "./terminalPure";

describe("key sequences", () => {
	it("maps the key bar to the right byte sequences", () => {
		const seq = Object.fromEntries(TERMINAL_KEYS.map((k) => [k.id, k.seq]));
		expect(seq.esc).toBe("\x1b");
		expect(seq.up).toBe("\x1b[A");
		expect(seq.left).toBe("\x1b[D");
		expect(seq["ctrl-c"]).toBe("\x03");
		expect(seq.enter).toBe("\r");
		expect(seq.tab).toBe("\t");
	});
	it("builds control codes", () => {
		expect(ctrlSequence("c")).toBe("\x03");
		expect(ctrlSequence("C")).toBe("\x03");
		expect(ctrlSequence("z")).toBe("\x1a");
		expect(ctrlSequence("[")).toBe("\x1b");
		expect(ctrlSequence("1")).toBeNull();
		expect(ctrlSequence("ab")).toBeNull();
	});
	it("applies sticky Ctrl only to a single typed character", () => {
		expect(applyCtrl("l", true)).toEqual({ data: "\x0c", consumed: true });
		expect(applyCtrl("你好", true)).toEqual({ data: "你好", consumed: false });
		expect(applyCtrl("1", true)).toEqual({ data: "1", consumed: false });
		expect(applyCtrl("l", false)).toEqual({ data: "l", consumed: false });
	});
});

describe("stream chunks", () => {
	it("decodes base64 including UTF-8 bytes without mangling", () => {
		const bytes = decodeChunk(btoa("hi\x1b[0m"));
		expect(Array.from(bytes)).toEqual([104, 105, 27, 91, 48, 109]);
		const utf8 = new TextEncoder().encode("你好");
		const b64 = btoa(String.fromCharCode(...utf8));
		expect(new TextDecoder().decode(decodeChunk(b64))).toBe("你好");
	});
	it("parses exit payloads", () => {
		expect(parseExit('{"code":2}')).toBe(2);
		expect(parseExit('{"code":null}')).toBeNull();
		expect(parseExit("garbage")).toBeNull();
	});
});

describe("reconnect policy", () => {
	it("backs off linearly then gives up after 5 attempts", () => {
		expect([1, 2, 5].map(reconnectDelay)).toEqual([1500, 3000, 7500]);
		expect(reconnectDelay(6)).toBeNull();
	});
	it("classifies server errors", () => {
		expect(isTerminalGone(404)).toBe(true);
		expect(isTerminalGone(410)).toBe(true);
		expect(isTerminalGone(500)).toBe(false);
		expect(isTerminalLimit("最多同时打开 4 个终端")).toBe(true);
	});
});

describe("InputQueue", () => {
	it("coalesces data pushed during an in-flight request and keeps order", async () => {
		const sent: string[] = [];
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let first = true;
		const q = new InputQueue(
			async (d) => {
				sent.push(d);
				if (first) {
					first = false;
					await gate;
				}
			},
			() => {},
		);
		q.push("a");
		q.push("b");
		q.push("c");
		release();
		await new Promise((r) => setTimeout(r, 0));
		expect(sent).toEqual(["a", "bc"]);
	});
	it("reports errors and continues with later input", async () => {
		const errors: unknown[] = [];
		const sent: string[] = [];
		let fail = true;
		const q = new InputQueue(
			async (d) => {
				if (fail) {
					fail = false;
					throw new Error("x");
				}
				sent.push(d);
			},
			(e) => errors.push(e),
		);
		q.push("1");
		await new Promise((r) => setTimeout(r, 0));
		q.push("2");
		await new Promise((r) => setTimeout(r, 0));
		expect(errors).toHaveLength(1);
		expect(sent).toEqual(["2"]);
	});
});
