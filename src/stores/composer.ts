/**
 * Composer state: annotations (pills) per session + side-chat requests (§10). [LEAD]
 */

import { create } from "zustand";

export interface Annotation {
	id: string;
	source: "message" | "diff" | "doc" | "terminal";
	text: string;
	itemId?: string;
	file?: string;
	lines?: string;
	comment?: string;
}

export interface ComposerImage {
	id: string;
	path: string;
	name?: string;
	width?: number;
	height?: number;
}

export interface ComposerState {
	/** By sessionId. */
	annotations: Record<string, Annotation[]>;
	addAnnotation(sessionId: string, a: Omit<Annotation, "id">): void;
	updateAnnotation(
		sessionId: string,
		id: string,
		patch: Partial<Annotation> | string,
	): void;
	removeAnnotation(sessionId: string, id: string): void;
	clearAnnotations(sessionId: string): void;
	/** Image attachments per session with ordered index (1, 2, 3...). */
	images: Record<string, ComposerImage[]>;
	addImage(
		sessionId: string,
		path: string,
		name?: string,
		dimensions?: { width?: number; height?: number },
	): ComposerImage;
	setImages(sessionId: string, images: ComposerImage[]): void;
	removeImage(sessionId: string, idOrPath: string): void;
	clearImages(sessionId: string): void;
	/** Drafts per session so switching sessions does not lose typed input. */
	drafts: Record<string, string>;
	setDraft(sessionId: string, text: string): void;
	clearDraft(sessionId: string): void;
	/** Prompt history across inputs. */
	history: string[];
	pushHistory(entry: string): void;
	clearHistory(): void;
	/** Nonce to trigger composer textarea auto-focus by sessionId. */
	focusNonce: Record<string, number>;
	focusComposer(sessionId: string): void;
	/** Set by any feature, consumed by SideChatPanel. */
	sideChatRequest: {
		parentSessionId: string;
		selection?: string;
	} | null;
	requestSideChat(parentSessionId: string, selection?: string): void;
	clearSideChatRequest(): void;
}
const STORAGE_KEY_HISTORY = "ompws:composer-history";
const MAX_HISTORY = 20;

function loadHistory(): string[] {
	try {
		if (typeof localStorage === "undefined") return [];
		const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed
				.filter((x): x is string => typeof x === "string")
				.slice(-MAX_HISTORY);
		}
	} catch {
		/* storage unavailable */
	}
	return [];
}

function saveHistory(history: string[]): void {
	try {
		if (typeof localStorage === "undefined") return;
		localStorage.setItem(
			STORAGE_KEY_HISTORY,
			JSON.stringify(history.slice(-MAX_HISTORY)),
		);
	} catch {
		/* quota exceeded */
	}
}

let nextId = 1;

export const useComposer = create<ComposerState>((set) => ({
	annotations: {},
	addAnnotation: (sessionId, a) =>
		set((s) => ({
			annotations: {
				...s.annotations,
				[sessionId]: [
					...(s.annotations[sessionId] ?? []),
					{ ...a, id: `ann-${nextId++}` },
				],
			},
		})),
	updateAnnotation: (sessionId, id, patch) =>
		set((s) => {
			const updateObj = typeof patch === "string" ? { comment: patch } : patch;
			return {
				annotations: {
					...s.annotations,
					[sessionId]: (s.annotations[sessionId] ?? []).map((a) =>
						a.id === id ? { ...a, ...updateObj } : a,
					),
				},
			};
		}),
	removeAnnotation: (sessionId, id) =>
		set((s) => ({
			annotations: {
				...s.annotations,
				[sessionId]: (s.annotations[sessionId] ?? []).filter(
					(a) => a.id !== id,
				),
			},
		})),
	clearAnnotations: (sessionId) =>
		set((s) => ({
			annotations: { ...s.annotations, [sessionId]: [] },
		})),
	images: {},
	addImage: (sessionId, path, name, dimensions) => {
		const img: ComposerImage = {
			id: `cimg-${nextId++}`,
			path,
			name,
			width: dimensions?.width,
			height: dimensions?.height,
		};
		set((s) => ({
			images: {
				...s.images,
				[sessionId]: [...(s.images[sessionId] ?? []), img],
			},
		}));
		return img;
	},
	setImages: (sessionId, images) =>
		set((s) => ({
			images: { ...s.images, [sessionId]: images },
		})),
	removeImage: (sessionId, idOrPath) =>
		set((s) => ({
			images: {
				...s.images,
				[sessionId]: (s.images[sessionId] ?? []).filter(
					(img) => img.id !== idOrPath && img.path !== idOrPath,
				),
			},
		})),
	clearImages: (sessionId) =>
		set((s) => ({
			images: { ...s.images, [sessionId]: [] },
		})),
	drafts: {},
	setDraft: (sessionId, text) =>
		set((s) => ({
			drafts: { ...s.drafts, [sessionId]: text },
		})),
	clearDraft: (sessionId) =>
		set((s) => ({
			drafts: { ...s.drafts, [sessionId]: "" },
		})),
	history: loadHistory(),
	pushHistory: (entry) => {
		const trimmed = entry.trim();
		if (!trimmed) return;
		set((s) => {
			if (s.history[s.history.length - 1] === trimmed) return s;
			const next = [...s.history, trimmed].slice(-MAX_HISTORY);
			saveHistory(next);
			return { history: next };
		});
	},
	clearHistory: () => {
		saveHistory([]);
		set({ history: [] });
	},
	focusNonce: {},
	focusComposer: (sessionId) =>
		set((s) => ({
			focusNonce: {
				...s.focusNonce,
				[sessionId]: (s.focusNonce[sessionId] ?? 0) + 1,
			},
		})),
	sideChatRequest: null,
	requestSideChat: (parentSessionId, selection) =>
		set({ sideChatRequest: { parentSessionId, selection } }),
	clearSideChatRequest: () => set({ sideChatRequest: null }),
}));

/**
 * Render the composer text plus annotation pills as markdown quote blocks,
 * numbered [1]..[n]. Diff comments render as "文件 path 第 lines 行：comment".
 */
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

function isImageAnnotation(a: Annotation): boolean {
	return (
		(!!a.file && IMAGE_FILE_RE.test(a.file)) ||
		!!a.text?.startsWith("[图片:") ||
		!!a.text?.startsWith("[Image #")
	);
}

export function formatWithAnnotations(
	text: string,
	anns: Annotation[],
): string {
	const nonImageAnns = anns.filter((a) => !isImageAnnotation(a));
	if (nonImageAnns.length === 0) return text;
	const blocks = nonImageAnns.map((a, i) => {
		const n = i + 1;
		const lines: string[] = [];
		if (a.source === "diff" && a.file) {
			const where = a.lines ? ` 第 ${a.lines} 行` : "";
			lines.push(`[${n}] 文件 ${a.file}${where}：${a.comment ?? ""}`.trimEnd());
		} else {
			const where = a.file
				? ` (${a.file}${a.lines ? ` ${a.lines}` : ""})`
				: "";
			lines.push(`[${n}]${where}`.trimEnd());
		}
		if (a.text) {
			for (const line of a.text.split("\n")) {
				lines.push(`> ${line}`);
			}
		}
		if (a.comment && !(a.source === "diff" && a.file)) {
			lines.push(`批注：${a.comment}`);
		}
		return lines.join("\n");
	});
	const body = text.trimEnd();
	return body ? `${body}\n\n${blocks.join("\n\n")}` : blocks.join("\n\n");
}
