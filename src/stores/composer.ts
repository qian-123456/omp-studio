/**
 * Composer state: annotations (pills) per session and per side-chat target
 * (`sidechat:<parentId>` key), drafts, focus and prompt history (§10). [LEAD]
 */

import { create } from "zustand";
import type { ImageAttachment } from "../lib/contracts";

export interface Annotation {
	id: string;
	source: "message" | "diff" | "doc" | "terminal";
	text: string;
	itemId?: string;
	/** Answer slice index; when present, occurrence is local to this slice. */
	answerPart?: number;
	file?: string;
	lines?: string;
	comment?: string;
	/** Local image paths attached to this annotation's comment. */
	images?: string[];
	/** Free-form origin shown instead of the source kind (e.g. 「来自辅助对话：标题」). */
	label?: string;
	/** 0-based identical-match index within answerPart, or the whole message when absent. */
	occurrence?: number;
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
	 * Move one annotation between lists (main composer ⇄ side-chat composer);
	 * preserves fields, assigns a fresh id.
	 */
	moveAnnotation(fromKey: string, toKey: string, id: string): void;
	/** Last-picked destination for new annotations selected in the main chat (persisted). */
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
	/**
	 * Attach several image paths in one step, reusing images already attached with the
	 * same path. Returns each path's 1-based index into the session's image list (the N of
	 * its `🖼️#N` token), in input order.
	 */
	attachImages(sessionId: string, paths: readonly string[]): number[];
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
	/** Drop every draft / annotation / attachment of sessions that were deleted. */
	pruneSessions(ids: readonly string[]): void;
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

/** Destination of an annotation selected in the main chat. */
export type AnnotationTarget = "main" | "sidechat";

function loadAnnotationTarget(): AnnotationTarget {
	try {
		if (typeof localStorage === "undefined") return "main";
		return localStorage.getItem(STORAGE_KEY_ANNOTATION_TARGET) === "sidechat" ? "sidechat" : "main";
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

const STORAGE_KEY_IMAGES = "omp_composer_images";

function loadImages(): Record<string, ComposerImage[]> {
	try {
		if (typeof localStorage === "undefined") return {};
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY_IMAGES) ?? "{}");
		if (!parsed || typeof parsed !== "object") return {};
		const out: Record<string, ComposerImage[]> = {};
		for (const [sid, list] of Object.entries(parsed as Record<string, unknown>)) {
			if (!Array.isArray(list)) continue;
			const imgs = list.filter(
				(i): i is ComposerImage =>
					!!i && typeof i.id === "string" && typeof i.path === "string",
			);
			if (imgs.length > 0) out[sid] = imgs;
		}
		return out;
	} catch {
		return {};
	}
}

function saveImages(images: Record<string, ComposerImage[]>): void {
	try {
		if (typeof localStorage === "undefined") return;
		const compact: Record<string, ComposerImage[]> = {};
		for (const [sid, list] of Object.entries(images)) if (list.length > 0) compact[sid] = list;
		localStorage.setItem(STORAGE_KEY_IMAGES, JSON.stringify(compact));
	} catch {
		// quota / private mode: attachments stay in memory only
	}
}

const initialImages = loadImages();

const STORAGE_KEY_FILES = "omp_composer_files";

function loadFiles(): Record<string, ComposerFile[]> {
	try {
		if (typeof localStorage === "undefined") return {};
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY_FILES) ?? "{}");
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const out: Record<string, ComposerFile[]> = {};
		for (const [sid, list] of Object.entries(parsed as Record<string, unknown>)) {
			if (!Array.isArray(list)) continue;
			const files = list.filter(
				(f): f is ComposerFile =>
					!!f && typeof f.id === "string" && typeof f.path === "string",
			);
			if (files.length > 0) out[sid] = files;
		}
		return out;
	} catch {
		return {};
	}
}

function saveFiles(files: Record<string, ComposerFile[]>): void {
	try {
		if (typeof localStorage === "undefined") return;
		const compact: Record<string, ComposerFile[]> = {};
		for (const [sid, list] of Object.entries(files)) if (list.length > 0) compact[sid] = list;
		localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(compact));
	} catch {
		// quota / private mode: attachments stay in memory only
	}
}

const initialFiles = loadFiles();
// Restored ids are `cimg-N` / `cfile-N`: continue numbering past them.
let nextId =
	1 +
	Math.max(
		0,
		...Object.values(initialImages).flatMap((l) =>
			l.map((i) => Number(/^cimg-(\d+)$/.exec(i.id)?.[1] ?? 0)),
		),
		...Object.values(initialFiles).flatMap((l) =>
			l.map((f) => Number(/^cfile-(\d+)$/.exec(f.id)?.[1] ?? 0)),
		),
	);

export const useComposer = create<ComposerState>((set, get) => ({
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
					[toKey]: [...(s.annotations[toKey] ?? []), { ...moved, id: `ann-${nextId++}` }],
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
	images: initialImages,
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
	attachImages: (sessionId, paths) => {
		const list = [...(get().images[sessionId] ?? [])];
		const numbers = paths.map((path) => {
			let at = list.findIndex((i) => i.path === path);
			if (at < 0) {
				list.push({ id: `cimg-${nextId++}`, path });
				at = list.length - 1;
			}
			return at + 1;
		});
		set((s) => ({ images: { ...s.images, [sessionId]: list } }));
		return numbers;
	},
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
	files: initialFiles,
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
	pruneSessions: (ids) =>
		set((s) => {
			// A removed session's own keys plus its staged side-chat annotations.
			const gone = new Set(ids.flatMap((id) => [id, sideChatAnnKey(id)]));
			const strip = <T>(m: Record<string, T>): Record<string, T> => {
				if (!Object.keys(m).some((k) => gone.has(k))) return m;
				return Object.fromEntries(Object.entries(m).filter(([k]) => !gone.has(k)));
			};
			const drafts = strip(s.drafts);
			const sideChatDrafts = strip(s.sideChatDrafts);
			if (drafts !== s.drafts) saveMap(STORAGE_KEY_DRAFTS, drafts);
			if (sideChatDrafts !== s.sideChatDrafts) {
				saveMap(STORAGE_KEY_SIDECHAT_DRAFTS, sideChatDrafts);
			}
			return {
				annotations: strip(s.annotations),
				images: strip(s.images),
				files: strip(s.files),
				drafts,
				sideChatDrafts,
				focusNonce: strip(s.focusNonce),
			};
		}),
}));

/** Persist attachments with the drafts: a restored `🖼️#N` draft must still know its paths. */
let lastSavedImages = useComposer.getState().images;
useComposer.subscribe((s) => {
	if (s.images === lastSavedImages) return;
	lastSavedImages = s.images;
	saveImages(s.images);
});

let lastSavedFiles = useComposer.getState().files;
useComposer.subscribe((s) => {
	if (s.files === lastSavedFiles) return;
	lastSavedFiles = s.files;
	saveFiles(s.files);
});

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

/** `[图片: path]` references appended to an annotation's comment so the agent can open the files. */
function withImageRefs(comment: string | undefined, images: readonly string[] | undefined): string {
	const refs = (images ?? []).map((p) => `[图片: ${p}]`).join(" ");
	return [comment ?? "", refs].filter(Boolean).join(" ");
}

/**
 * Outgoing attachments for the images owned by `anns` (deduped by path, also
 * against `existing` composer attachments). Each marker equals the
 * `[图片: path]` reference `formatWithAnnotations` writes into the message, so
 * the payload and the text point at the same image. Senders MUST append this to
 * their own `ImageAttachment[]` and pass the same annotation list to
 * `formatWithAnnotations`; the images stay on the annotation (never copied into
 * the composer's image list), so deleting the annotation releases them.
 */
export function annotationImageAttachments(
	anns: readonly Annotation[],
	existing: ReadonlyArray<{ path?: string | null }> = [],
): ImageAttachment[] {
	const seen = new Set(existing.map((i) => i.path).filter((p): p is string => !!p));
	const out: ImageAttachment[] = [];
	for (const a of anns) {
		if (isImageAnnotation(a)) continue;
		for (const path of a.images ?? []) {
			if (seen.has(path)) continue;
			seen.add(path);
			out.push({ id: `annimg-${out.length + 1}-${path}`, path, marker: `[图片: ${path}]` });
		}
	}
	return out;
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
		const comment = withImageRefs(a.comment, a.images);
		if (a.source === "diff" && a.file) {
			const where = a.lines ? ` 第 ${a.lines} 行` : "";
			lines.push(`[${n}] 文件 ${a.file}${where}：${comment}`.trimEnd());
		} else {
			const loc = a.file
				? ` (${a.file}${a.lines ? ` ${a.lines}` : ""})`
				: a.label
					? ` (${a.label})`
					: "";
			lines.push(`[${n}]${loc}`.trimEnd());
		}
		if (a.text) {
			for (const line of a.text.split("\n")) {
				lines.push(`> ${line}`);
			}
		}
		if (comment && !(a.source === "diff" && a.file)) {
			lines.push(`批注：${comment}`);
		}
		return lines.join("\n");
	});
	const body = text.trimEnd();
	return body ? `${blocks.join("\n\n")}\n\n${body}` : blocks.join("\n\n");
}
