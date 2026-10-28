// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerCapsule } from "./ComposerCapsule";

vi.mock("./useVoiceInput", () => ({
	useVoiceInput: ({ onTranscribed }: { onTranscribed: (text: string) => void }) => ({ recording: false, transcribing: false, toggleRecording: async () => onTranscribed("转写") }),
}));

afterEach(cleanup);

// The phone runtime includes iOS 15, which does not expose Promise.withResolvers.
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("ComposerCapsule", () => {
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
});
