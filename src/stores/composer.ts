/**
 * Composer state: annotations (pills) per session and per side-chat target
 * (`sidechat:<parentId>` key), drafts, focus and prompt history (§10). [LEAD]
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

/** Non-image attachment (📎#N token): real path is serialized into the
 * outgoing prompt so omp can read the file itself. */
export interface ComposerFile {
	id: string;
	path: string;
	name?: string;
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
	/**
	 * Move one annotation between lists (e.g. main composer ⇄ side-chat
	 * composer via `sideChatAnnKey`); preserves fields, assigns a fresh id.
	 */
	moveAnnotation(fromKey: string, toKey: string, id: string): void;
	/** Last-picked destination for new stream annotations (persisted). */
	annotationTarget: AnnotationTarget;
	setAnnotationTarget(target: AnnotationTarget): void;
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
	/** Non-image file attachments per session (📎#N tokens). */
	files: Record<string, ComposerFile[]>;
	addFile(sessionId: string, path: string, name?: string): ComposerFile;
	setFiles(sessionId: string, files: ComposerFile[]): void;
	removeFile(sessionId: string, idOrPath: string): void;
	clearFiles(sessionId: string): void;
	/** Drafts per session so switching sessions does not lose typed input. */
	drafts: Record<string, string>;
	setDraft(sessionId: string, text: string): void;
	clearDraft(sessionId: string): void;
	/** Plan mode toggle per session. */
	planModes: Record<string, boolean>;
	setPlanMode: (sessionId: string, enabled: boolean) => void;
	togglePlanMode: (sessionId: string) => void;
	/** Side-chat input drafts keyed by parent sessionId. */
	sideChatDrafts: Record<string, string>;
	setSideChatDraft: (parentId: string, text: string) => void;
	clearSideChatDraft: (parentId: string) => void;
	/** Prompt history across inputs. */
	history: string[];
	pushHistory(entry: string): void;
	clearHistory(): void;
	/** Nonce to trigger composer textarea auto-focus by sessionId. */
	focusNonce: Record<string, number>;
	focusComposer(sessionId: string): void;
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

const STORAGE_KEY_DRAFTS = "omp_composer_drafts";
const STORAGE_KEY_SIDECHAT_DRAFTS = "omp_sidechat_drafts";
const STORAGE_KEY_ANNOTATION_TARGET = "ompws:annotation-target";

/** Destination segmented control in the selection comment box. */
export type AnnotationTarget = "main" | "sidechat";

function loadAnnotationTarget(): AnnotationTarget {
	try {
		if (typeof localStorage === "undefined") return "main";
		return localStorage.getItem(STORAGE_KEY_ANNOTATION_TARGET) === "sidechat"
			? "sidechat"
			: "main";
	} catch {
		return "main";
	}
}

/** Store key holding staged side-chat annotations of a parent session. */
export const sideChatAnnKey = (parentId: string): string =>
	`sidechat:${parentId}`;

/** Load a string->string map; empty values are dropped. */
function loadMap(key: string): Record<string, string> {
	try {
		if (typeof localStorage === "undefined") return {};
		const raw = localStorage.getItem(key);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === "string" && v) out[k] = v;
		}
		return out;
	} catch {
		return {};
	}
}

function saveMap(key: string, map: Record<string, string>): void {
	try {
		if (typeof localStorage === "undefined") return;
		const compact: Record<string, string> = {};
		for (const [k, v] of Object.entries(map)) if (v) compact[k] = v;
		localStorage.setItem(key, JSON.stringify(compact));
	} catch {
		/* storage unavailable */
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
	moveAnnotation: (fromKey, toKey, id) =>
		set((s) => {
			if (fromKey === toKey) return s;
			const from = s.annotations[fromKey] ?? [];
			const moved = from.find((a) => a.id === id);
			if (!moved) return s;
			return {
				annotations: {
					...s.annotations,
					[fromKey]: from.filter((a) => a.id !== id),
					[toKey]: [
						...(s.annotations[toKey] ?? []),
						{ ...moved, id: `ann-${nextId++}` },
					],
				},
			};
		}),
	annotationTarget: loadAnnotationTarget(),
	setAnnotationTarget: (target) =>
		set(() => {
			try {
				localStorage.setItem(STORAGE_KEY_ANNOTATION_TARGET, target);
			} catch {
				/* storage unavailable */
			}
			return { annotationTarget: target };
		}),
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
	files: {},
	addFile: (sessionId, path, name) => {
		const file: ComposerFile = {
			id: `cfile-${nextId++}`,
			path,
			name,
		};
		set((s) => ({
			files: {
				...s.files,
				[sessionId]: [...(s.files[sessionId] ?? []), file],
			},
		}));
		return file;
	},
	setFiles: (sessionId, files) =>
		set((s) => ({
			files: { ...s.files, [sessionId]: files },
		})),
	removeFile: (sessionId, idOrPath) =>
		set((s) => ({
			files: {
				...s.files,
				[sessionId]: (s.files[sessionId] ?? []).filter(
					(f) => f.id !== idOrPath && f.path !== idOrPath,
				),
			},
		})),
	clearFiles: (sessionId) =>
		set((s) => ({
			files: { ...s.files, [sessionId]: [] },
		})),
	drafts: loadMap(STORAGE_KEY_DRAFTS),
	setDraft: (sessionId, text) =>
		set((s) => {
			const drafts = { ...s.drafts, [sessionId]: text };
			saveMap(STORAGE_KEY_DRAFTS, drafts);
			return { drafts };
		}),
	clearDraft: (sessionId) =>
		set((s) => {
			const drafts = { ...s.drafts, [sessionId]: "" };
			saveMap(STORAGE_KEY_DRAFTS, drafts);
			return { drafts };
		}),
	planModes: {},
	setPlanMode: (sessionId, enabled) =>
		set((s) => ({ planModes: { ...s.planModes, [sessionId]: enabled } })),
	togglePlanMode: (sessionId) =>
		set((s) => ({
			planModes: { ...s.planModes, [sessionId]: !s.planModes[sessionId] },
		})),
	sideChatDrafts: loadMap(STORAGE_KEY_SIDECHAT_DRAFTS),
	setSideChatDraft: (parentId, text) =>
		set((s) => {
			const sideChatDrafts = { ...s.sideChatDrafts, [parentId]: text };
			saveMap(STORAGE_KEY_SIDECHAT_DRAFTS, sideChatDrafts);
			return { sideChatDrafts };
		}),
	clearSideChatDraft: (parentId) =>
		set((s) => {
			const sideChatDrafts = { ...s.sideChatDrafts, [parentId]: "" };
			saveMap(STORAGE_KEY_SIDECHAT_DRAFTS, sideChatDrafts);
			return { sideChatDrafts };
		}),
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
