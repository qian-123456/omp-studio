/** Shared helpers for composer annotations (quotes with optional comments). */

import type { Annotation } from "../../stores/composer";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** Image attachments travel as annotations too; they are not text quotes. */
export const isImageAnnotation = (a: { file?: string; text?: string }): boolean =>
	(!!a.file && IMAGE_EXT_RE.test(a.file)) || !!a.text?.includes("[图片:");

/**
 * The annotations that become numbered `[n]` quote blocks in the outgoing
 * message (see `formatWithAnnotations`). The 1-based index in this list is the
 * number shown on message markers and in the composer annotation list.
 */
export const textAnnotationsOf = (list: readonly Annotation[]): Annotation[] =>
	list.filter((a) => !isImageAnnotation(a));
