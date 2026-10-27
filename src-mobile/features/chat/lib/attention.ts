/** In-page attention fallback (LAN http cannot register web push): beep + title flash while the page is hidden. */
import { usePrefs } from "../../../core/stores/prefs";

export interface TitleFlasher {
	start(text: string): void;
	stop(): void;
	active(): boolean;
}

/** Alternates `document.title` between the original and `text` until `stop()` (called when the page becomes visible). */
export function createTitleFlasher(doc: { title: string }, timers: { set: typeof setInterval; clear: typeof clearInterval } = { set: setInterval, clear: clearInterval }): TitleFlasher {
	let timer: ReturnType<typeof setInterval> | null = null;
	let original = "";
	let on = false;
	return {
		start(text) {
			if (timer !== null) return;
			original = doc.title;
			on = false;
			timer = timers.set(() => {
				on = !on;
				doc.title = on ? text : original;
			}, 900);
		},
		stop() {
			if (timer === null) return;
			timers.clear(timer);
			timer = null;
			doc.title = original;
		},
		active: () => timer !== null,
	};
}

let flasher: TitleFlasher | null = null;
let audio: AudioContext | null = null;

function beep(): void {
	try {
		const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return;
		audio ??= new Ctor();
		if (audio.state === "suspended") void audio.resume();
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		osc.type = "sine";
		osc.frequency.value = 880;
		gain.gain.setValueAtTime(0.0001, audio.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
		osc.connect(gain).connect(audio.destination);
		osc.start();
		osc.stop(audio.currentTime + 0.4);
	} catch {
		/* autoplay policy: silently skip */
	}
}

export type AttentionKind = "done" | "approval";

/** Only fires while the page is hidden; honours the `notifySound` / `titleFlash` prefs. */
export function attention(kind: AttentionKind): void {
	if (typeof document === "undefined" || !document.hidden) return;
	const { notifySound, titleFlash } = usePrefs.getState();
	if (notifySound) beep();
	if (titleFlash) {
		flasher ??= createTitleFlasher(document);
		flasher.start(kind === "approval" ? "【待批准】" : "【已完成】");
		const stop = () => {
			if (!document.hidden) {
				flasher?.stop();
				document.removeEventListener("visibilitychange", stop);
			}
		};
		document.addEventListener("visibilitychange", stop);
	}
}
