import { useCallback, useRef, useState } from "react";
import { apiUrl, errorMessage } from "../../../core/api";
import { toast } from "../../../ui";

export function useVoiceInput({
	onTranscribed,
}: {
	onTranscribed: (text: string) => void;
}) {
	const [recording, setRecording] = useState(false);
	const [transcribing, setTranscribing] = useState(false);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);

	const stopRecording = useCallback(() => {
		if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
			mediaRecorderRef.current.stop();
		}
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
		}
		setRecording(false);
	}, []);

	const startRecording = useCallback(async () => {
		if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
			toast("当前环境不支持录音（需安全上下文 HTTPS 或 localhost）", { kind: "error" });
			return;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			streamRef.current = stream;
			chunksRef.current = [];

			const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg", "audio/wav"];
			const mimeType =
				typeof MediaRecorder !== "undefined"
					? mimeTypes.find((t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t)) || ""
					: "";

			const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
			mediaRecorderRef.current = recorder;

			recorder.ondataavailable = (e) => {
				if (e.data && e.data.size > 0) {
					chunksRef.current.push(e.data);
				}
			};

			recorder.onstop = async () => {
				const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
				chunksRef.current = [];
				if (blob.size === 0) return;

				setTranscribing(true);
				try {
					const res = await fetch(apiUrl("/voice/transcribe"), {
						method: "POST",
						headers: {
							"content-type": blob.type || "audio/webm",
						},
						body: blob,
					});

					if (!res.ok) {
						const errData = await res.json().catch(() => null);
						throw new Error(errData?.error || errData?.message || `语音识别服务响应异常 (${res.status})`);
					}

					const data = await res.json();
					const text = typeof data.text === "string" ? data.text.trim() : "";
					if (text) {
						onTranscribed(text);
						toast("语音识别成功", { kind: "success" });
					} else {
						toast("未识别到清晰语音，请重试");
					}
				} catch (err) {
					toast(`语音识别失败：${errorMessage(err)}`, { kind: "error" });
				} finally {
					setTranscribing(false);
				}
			};

			recorder.start();
			setRecording(true);
		} catch (err: unknown) {
			const e = err as { name?: string; message?: string };
			if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
				toast("麦克风权限被拒绝，请在系统或浏览器设置中允许", { kind: "error" });
			} else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
				toast("未检测到可用的麦克风设备", { kind: "error" });
			} else {
				toast(`无法启动麦克风录音：${errorMessage(err)}`, { kind: "error" });
			}
		}
	}, [onTranscribed]);

	const toggleRecording = useCallback(async () => {
		if (recording) {
			stopRecording();
		} else {
			await startRecording();
		}
	}, [recording, startRecording, stopRecording]);

	return {
		recording,
		transcribing,
		toggleRecording,
		stopRecording,
	};
}
