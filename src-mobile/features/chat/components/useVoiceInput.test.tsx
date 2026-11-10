// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useVoiceInput } from "./useVoiceInput";
import { toast } from "../../../ui";

vi.mock("../../../ui", () => ({ toast: vi.fn() }));

function deferred<T>() {
	// Keep the test seam compatible with the mobile runtime's ES2022 target.
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => { resolve = yes; });
	return { promise, resolve };
}
class Recorder {
	static instances: Recorder[] = [];
	static isTypeSupported = () => true;
	state: MediaRecorder["state"] = "inactive";
	mimeType = "audio/webm";
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void | Promise<void>) | null = null;
	stop = vi.fn(() => {
		this.state = "inactive";
		this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
		void this.onstop?.();
	});
	constructor() { Recorder.instances.push(this); }
	start() { this.state = "recording"; }
}
let getUserMedia: Mock;
let stopTrack: Mock;
let stream: MediaStream;
beforeEach(() => {
	stopTrack = vi.fn();
	stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
	getUserMedia = vi.fn().mockResolvedValue(stream);
	vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
	vi.stubGlobal("MediaRecorder", Recorder);
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "转写内容" }) }));
	Recorder.instances = [];
	vi.mocked(toast).mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("mobile voice lifecycle", () => {
	it("requests permission once while a start is pending", async () => {
		const permission = deferred<MediaStream>();
		getUserMedia.mockReturnValue(permission.promise);
		const { result, unmount } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
		act(() => { void result.current.toggleRecording(); void result.current.toggleRecording(); });
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		await act(async () => permission.resolve(stream));
		expect(result.current.recording).toBe(true);
		expect(Recorder.instances).toHaveLength(1);
		unmount();
		expect(stopTrack).toHaveBeenCalledTimes(1);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("releases a microphone granted after the composer unmounts", async () => {
		const permission = deferred<MediaStream>();
		getUserMedia.mockReturnValue(permission.promise);
		const { result, unmount } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
		act(() => { void result.current.toggleRecording(); });
		unmount();
		await act(async () => permission.resolve(stream));
		expect(stopTrack).toHaveBeenCalledTimes(1);
		expect(Recorder.instances).toHaveLength(0);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("stops capture on unmount without uploading an abandoned recording", async () => {
		const onTranscribed = vi.fn();
		const { result, unmount } = renderHook(() => useVoiceInput({ onTranscribed }));
		await act(async () => result.current.toggleRecording());
		const recorder = Recorder.instances[0];
		unmount();
		expect(recorder.stop).toHaveBeenCalledTimes(1);
		expect(stopTrack).toHaveBeenCalledTimes(1);
		expect(fetch).not.toHaveBeenCalled();
		expect(onTranscribed).not.toHaveBeenCalled();
	});

	it("aborts transcription and ignores its late result after a session switch", async () => {
		const response = deferred<Response>();
		vi.mocked(fetch).mockReturnValue(response.promise);
		const onTranscribed = vi.fn();
		const { result, unmount } = renderHook(() => useVoiceInput({ onTranscribed }));
		await act(async () => result.current.toggleRecording());
		await act(async () => result.current.toggleRecording());
		expect(result.current.transcribing).toBe(true);
		const options = vi.mocked(fetch).mock.calls[0][1];
		const signal = options?.signal as AbortSignal;
		unmount();
		expect(signal.aborted).toBe(true);
		await act(async () => response.resolve({ ok: true, json: async () => ({ text: "旧会话语音" }) } as Response));
		expect(onTranscribed).not.toHaveBeenCalled();
		expect(stopTrack).toHaveBeenCalledTimes(1);
	});

	it("keeps one capture/transcription lifecycle and delivers to the current callback", async () => {
		const response = deferred<Response>();
		vi.mocked(fetch).mockReturnValue(response.promise);
		const oldCallback = vi.fn();
		const nextCallback = vi.fn();
		const { result, rerender } = renderHook(({ callback }) => useVoiceInput({ onTranscribed: callback }), { initialProps: { callback: oldCallback } });
		await act(async () => result.current.toggleRecording());
		await act(async () => result.current.toggleRecording());
		await act(async () => result.current.toggleRecording());
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		rerender({ callback: nextCallback });
		await act(async () => response.resolve({ ok: true, json: async () => ({ text: "转写内容" }) } as Response));
		expect(oldCallback).not.toHaveBeenCalled();
		expect(nextCallback).toHaveBeenCalledExactlyOnceWith("转写内容");
		expect(result.current.transcribing).toBe(false);
	});

	it.each([
		[{ error: { code: "transcription_failed", message: "供应商认证失败，请检查语音配置" } }, "供应商认证失败，请检查语音配置"],
		[{ error: "旧版转写错误" }, "旧版转写错误"],
		[{ message: "服务暂时不可用" }, "服务暂时不可用"],
		[{ error: { code: "unknown" } }, "语音识别服务响应异常 (502)"],
	])("renders readable backend errors without object coercion: %j", async (body, message) => {
		vi.mocked(fetch).mockResolvedValue({ ok: false, status: 502, json: async () => body } as Response);
		const onTranscribed = vi.fn();
		const { result } = renderHook(() => useVoiceInput({ onTranscribed }));
		await act(async () => result.current.toggleRecording());
		await act(async () => result.current.toggleRecording());
		expect(toast).toHaveBeenCalledExactlyOnceWith(`语音识别失败：${message}`, { kind: "error" });
		expect(onTranscribed).not.toHaveBeenCalled();
		expect(result.current.transcribing).toBe(false);
	});

	it("releases the acquired stream when MediaRecorder cannot start", async () => {
		vi.stubGlobal("MediaRecorder", class { constructor() { throw new Error("unsupported format"); } });
		const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
		await act(async () => result.current.toggleRecording());
		expect(stopTrack).toHaveBeenCalledTimes(1);
		expect(result.current.recording).toBe(false);
	});
});
