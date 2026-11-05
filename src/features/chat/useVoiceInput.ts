import { useEffect, useRef, useState } from "react";
import { voiceTranscribe } from "../../lib/ipc";

const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
type VoiceError = "unavailable" | "permission" | "empty" | "failed";

/** A capture belongs to one composer session; leaving it releases the microphone. */
export function useVoiceInput(sessionId: string, onText: (text: string) => void, onError: (kind: VoiceError, detail?: string) => void) {
	const [state, setState] = useState<"idle" | "starting" | "recording" | "transcribing">("idle");
	const current = useRef({ onText, onError });
	current.current = { onText, onError };
	const generation = useRef(0);
	const stream = useRef<MediaStream | null>(null);
	const recorder = useRef<MediaRecorder | null>(null);
	const busy = useRef(false);

	useEffect(() => {
		setState("idle");
		busy.current = false;
		return () => {
			generation.current++;
			if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
			recorder.current = null;
			stream.current?.getTracks().forEach((track) => track.stop());
			stream.current = null;
		};
	}, [sessionId]);

	const toggle = async () => {
		if (recorder.current?.state === "recording") {
			setState("transcribing");
			recorder.current.stop();
			stream.current?.getTracks().forEach((track) => track.stop());
			stream.current = null;
			return;
		}
		if (busy.current) return;
		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
			current.current.onError("unavailable");
			return;
		}
		busy.current = true;
		setState("starting");
		const gen = generation.current;
		try {
			const captured = await navigator.mediaDevices.getUserMedia({ audio: true });
			if (gen !== generation.current) { captured.getTracks().forEach((track) => track.stop()); return; }
			stream.current = captured;
			const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported(type));
			const recording = mime ? new MediaRecorder(captured, { mimeType: mime }) : new MediaRecorder(captured);
			recorder.current = recording;
			const chunks: Blob[] = [];
			let size = 0;
			let failed = false;
			recording.ondataavailable = (event) => {
				size += event.data.size;
				if (size > MAX_AUDIO_SIZE) {
					failed = true;
					if (recording.state !== "inactive") recording.stop();
				} else if (event.data.size) chunks.push(event.data);
			};
			recording.onerror = () => {
				failed = true;
				if (recording.state !== "inactive") recording.stop();
			};
			recording.onstop = async () => {
				captured.getTracks().forEach((track) => track.stop());
				if (gen !== generation.current) return;
				stream.current = null;
				recorder.current = null;
				setState("transcribing");
				try {
					if (failed) throw new Error(size > MAX_AUDIO_SIZE ? "Audio exceeds the 25 MB limit" : "Recording failed");
					if (!size) { current.current.onError("empty"); return; }
					const text = (await voiceTranscribe(await new Blob(chunks, { type: recording.mimeType }).arrayBuffer())).trim();
					if (gen !== generation.current) return;
					if (text) current.current.onText(text);
					else current.current.onError("empty");
				} catch (error) {
					if (gen === generation.current) current.current.onError("failed", String(error));
				} finally {
					if (gen === generation.current) { busy.current = false; setState("idle"); }
				}
			};
			recording.start(1000);
			setState("recording");
		} catch (error) {
			if (gen !== generation.current) return;
			stream.current?.getTracks().forEach((track) => track.stop());
			stream.current = null;
			busy.current = false;
			setState("idle");
			current.current.onError(error instanceof DOMException && error.name === "NotAllowedError" ? "permission" : "failed", String(error));
		}
	};
	return { state, toggle };
}
