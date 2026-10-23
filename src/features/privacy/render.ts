/** [P] Pure text → segment split for privacy chips (placeholders and, for
 * tool payloads, tracked real values). Unknown placeholders stay plain text. */
import type { SecretEntry } from "../../lib/contracts";
import { findValueMatches, splitPlaceholders } from "../../lib/privacy";

export type PrivacySegment =
	| { kind: "text"; text: string }
	| { kind: "chip"; entry: SecretEntry; raw: string };

/**
 * Split `text` into plain and chip segments. With `matchValues`, tracked real
 * values inside plain parts also become chips (tool args/outputs only).
 */
export function segmentPrivacyText(
	text: string,
	byPlaceholder: ReadonlyMap<string, SecretEntry>,
	trackedEntries: readonly SecretEntry[] | null,
): PrivacySegment[] {
	const out: PrivacySegment[] = [];
	const pushText = (t: string) => {
		if (!t) return;
		const prev = out[out.length - 1];
		if (prev?.kind === "text") prev.text += t;
		else out.push({ kind: "text", text: t });
	};
	for (const part of splitPlaceholders(text)) {
		if ("placeholder" in part) {
			const entry = byPlaceholder.get(part.placeholder);
			if (entry) out.push({ kind: "chip", entry, raw: part.placeholder });
			else pushText(part.placeholder);
			continue;
		}
		if (!trackedEntries || trackedEntries.length === 0) {
			pushText(part.text);
			continue;
		}
		let last = 0;
		for (const m of findValueMatches(part.text, [...trackedEntries])) {
			pushText(part.text.slice(last, m.start));
			out.push({ kind: "chip", entry: m.entry, raw: part.text.slice(m.start, m.end) });
			last = m.end;
		}
		pushText(part.text.slice(last));
	}
	return out;
}

/** Effective reveal state of a chip: a user click overrides the setting default (`null`/absent ⇒ revealed). */
export function resolveReveal(settingDefault: boolean | null | undefined, override: boolean | null): boolean {
	return override ?? settingDefault ?? true;
}

/** Tag emitted by `rehypeSecretChips`; markdown maps it to a chip component. */
export const SECRET_CHIP_TAG = "secret-chip";

interface HastText {
	type: "text";
	value: string;
}
interface HastParent {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}
type HastNode = HastText | HastParent;

function wrapPlaceholders(node: HastParent): void {
	if (!node.children) return;
	const next: HastNode[] = [];
	for (const child of node.children) {
		if (child.type !== "text" || !("value" in child)) {
			wrapPlaceholders(child as HastParent);
			next.push(child);
			continue;
		}
		for (const part of splitPlaceholders(child.value)) {
			if ("placeholder" in part) {
				next.push({
					type: "element",
					tagName: SECRET_CHIP_TAG,
					properties: {},
					children: [{ type: "text", value: part.placeholder }],
				});
			} else if (part.text) {
				next.push({ type: "text", value: part.text });
			}
		}
	}
	node.children = next;
}

/** Rehype plugin: wrap placeholders in every text node (incl. code/highlighted spans) as `<secret-chip>`. */
export function rehypeSecretChips() {
	return (tree: HastParent) => wrapPlaceholders(tree);
}
