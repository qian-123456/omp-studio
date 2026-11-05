// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerCapsule } from "./ComposerCapsule";

vi.mock("./useVoiceInput", () => ({
	useVoiceInput: ({ onTranscribed }: { onTranscribed: (text: string) => void }) => ({ recording: false, transcribing: false, toggleRecording: async () => onTranscribed("转写") }),
}));

beforeEach(() => {
 vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// The phone runtime includes iOS 15, which does not expose Promise.withResolvers.
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("ComposerCapsule", () => {
	it("uses a solid composer and unadorned toolbar controls while preserving touch targets", () => {
		const onModel = vi.fn();
		const onThinking = vi.fn();
		const onContext = vi.fn();
		const { container } = render(
			<ComposerCapsule placeholder="消息" onPlus={() => {}} onSend={() => {}} model="openai/gpt-5" thinking="high" contextText="15%" contextPercent={15} onModel={onModel} onThinking={onThinking} onContext={onContext} />,
		);
		expect(container.querySelector(".m-glass-panel, .m-glass-btn")).toBeNull();
		expect(screen.getByRole("textbox").parentElement?.className).toContain("bg-m-composer-bg");
		for (const name of [/当前模型/, /当前思考强度/, /上下文用量/]) {
			const button = screen.getByRole("button", { name });
			expect(button.className).toContain("min-h-11");
			expect(button.className).not.toContain("rounded-m-pill");
			fireEvent.click(button);
		}
		expect(onModel).toHaveBeenCalledTimes(1);
		expect(onThinking).toHaveBeenCalledTimes(1);
		expect(onContext).toHaveBeenCalledTimes(1);
		const context = screen.getByRole("button", { name: "上下文用量：15%" });
		expect(context.textContent).toBe("15%");
		const circles = context.querySelectorAll("circle");
		expect(circles).toHaveLength(2);
		expect(Number(circles[1].getAttribute("stroke-dashoffset"))).toBeCloseTo(2 * Math.PI * 7 * 0.85);
		const mic = screen.getByRole("button", { name: "语音输入" });
		expect(mic.className).toContain("h-11 w-11");
		expect(mic.className).not.toContain("bg-");
		fireEvent.focus(screen.getByRole("textbox"));
		expect(screen.queryByRole("button", { name: /当前模型/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /当前思考强度/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /上下文用量/ })).toBeNull();
		expect(screen.getByRole("button", { name: "语音输入" })).toBeTruthy();
	});

	it("keeps input uncontrolled and emits nothing during IME composition", async () => {
		const onInput = vi.fn();
		const onSync = vi.fn();
		render(<ComposerCapsule placeholder="消息" onPlus={() => {}} onSend={() => {}} onInput={onInput} onSync={onSync} />);
		onInput.mockClear();
		onSync.mockClear();
		const field = screen.getByRole("textbox") as HTMLTextAreaElement;
		fireEvent.compositionStart(field);
		await act(async () => { fireEvent.input(field, { target: { value: "ni" } }); await frame(); });
		expect(onInput).not.toHaveBeenCalled();
		expect(onSync).not.toHaveBeenCalled();
		expect(field.value).toBe("ni");
		await act(async () => { fireEvent.compositionEnd(field, { target: { value: "你" } }); await frame(); });
		expect(onInput).toHaveBeenCalledTimes(1);
		expect(onSync).toHaveBeenLastCalledWith("你");
		expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(false);
	});

	it("inserts voice text at the caret and does not send", async () => {
		const onSend = vi.fn();
		render(<ComposerCapsule initialText="前后" placeholder="消息" onPlus={() => {}} onSend={onSend} />);
		const field = screen.getByRole("textbox") as HTMLTextAreaElement;
		field.setSelectionRange(1, 1);
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "语音输入" })); });
		expect(field.value).toBe("前 转写后");
		expect(onSend).not.toHaveBeenCalled();
	});

	it("sends typed content and keeps stop available during a run", async () => {
		const onSend = vi.fn();
		const onStop = vi.fn();
		const { rerender } = render(<ComposerCapsule placeholder="消息" onPlus={() => {}} onSend={onSend} onStop={onStop} />);
		await act(async () => { fireEvent.input(screen.getByRole("textbox"), { target: { value: "发送内容" } }); await frame(); });
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		expect(onSend).toHaveBeenCalledWith("发送内容");
		await act(async () => { fireEvent.input(screen.getByRole("textbox"), { target: { value: "" } }); await frame(); });
		rerender(<ComposerCapsule placeholder="消息" working onPlus={() => {}} onSend={onSend} onStop={onStop} />);
		fireEvent.click(screen.getByRole("button", { name: "停止" }));
		expect(onStop).toHaveBeenCalledTimes(1);
	});
 it("keeps mobile Enter and IME commits as text while explicit hardware submission sends once", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const onSend = vi.fn();
  render(<ComposerCapsule initialText="保留这段输入" placeholder="消息" onPlus={() => {}} onSend={onSend} />);
  const field = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.compositionStart(field);
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  fireEvent.compositionEnd(field);
  fireEvent.keyDown(field, { key: "Enter", keyCode: 229, ctrlKey: true });
  expect(onSend).not.toHaveBeenCalled();
  expect(field.value).toBe("保留这段输入");
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true, repeat: true });
  expect(onSend).toHaveBeenCalledExactlyOnceWith("保留这段输入");
 });

 it("does not reinterpret a retained Send control as Stop when a run begins", () => {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const props = { placeholder: "消息", onPlus: () => {}, onSend, onStop };
  const view = render(<ComposerCapsule {...props} />);
  const send = screen.getByRole("button", { name: "发送" });
  view.rerender(<ComposerCapsule {...props} working />);
  fireEvent.click(send);
  expect(onStop).not.toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  expect(onStop).toHaveBeenCalledTimes(1);
 });
});
