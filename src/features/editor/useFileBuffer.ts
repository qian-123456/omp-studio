/**
 * Text-file buffer shared by the center DocView and the right-panel preview:
 * load, dirty tracking, atomic save, reload-on-focus (dirty buffers keep their
 * edits and show the external-change banner instead).
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { readTextFile, writeTextFile } from "../../lib/ipc";
import { tNow } from "../../stores/language";

export interface FileBuffer {
	saved: string | null;
	draft: string;
	setDraft: (value: string) => void;
	error: string | null;
	setError: (value: string | null) => void;
	external: boolean;
	dismissExternal: () => void;
	saving: boolean;
	dirty: boolean;
	reload: () => Promise<void>;
	/** Persist the draft; resolves false when there was nothing to save or it failed. */
	save: () => Promise<boolean>;
}

interface BufferState {
	saved: string | null;
	draft: string;
	error: string | null;
	external: boolean;
	saving: boolean;
}

/** One live buffer per path, shared by both consumers. Dirty entries deliberately
 * survive unmount/closing a tab; closing a view is not a discard operation. */
const buffers = new Map<string, BufferEntry>();

class BufferEntry {
	state: BufferState = { saved: null, draft: "", error: null, external: false, saving: false };
	private listeners = new Set<() => void>();
	private revision = 0;
	private request = 0;
	private reading = false;
	private confirming = false;

	constructor(private path: string) {}

	private publish(patch: Partial<BufferState>) {
		this.state = { ...this.state, ...patch };
		for (const notify of this.listeners) notify();
		this.releaseClean();
	}

	private releaseClean() {
		queueMicrotask(() => {
			if (!this.listeners.size && !this.state.saving && !this.reading &&
				this.state.draft === (this.state.saved ?? "") && buffers.get(this.path) === this) {
				buffers.delete(this.path);
			}
		});
	}

	subscribe = (notify: () => void) => {
		this.listeners.add(notify);
		return () => {
			this.listeners.delete(notify);
			this.releaseClean();
		};
	};
	getSnapshot = () => this.state;
	setDraft = (draft: string) => {
		if (draft === this.state.draft) return;
		this.revision++;
		this.publish({ draft });
	};
	setError = (error: string | null) => this.publish({ error });
	dismissExternal = () => this.publish({ external: false });

	/** Check the state at read completion, never the state captured on focus. */
	refresh = async () => {
		if (this.reading || this.state.saving) return;
		this.reading = true;
		const request = ++this.request;
		const revision = this.revision;
		try {
			const text = await readTextFile(this.path);
			if (request !== this.request) return;
			const { saved, draft } = this.state;
			if (this.revision !== revision || (saved !== null && draft !== saved)) {
				// Establish an initial baseline without overwriting any early typing.
				this.publish({ ...(saved === null ? { saved: text } : {}), external: saved !== null && text !== saved });
			} else {
				this.publish({ saved: text, draft: text, error: null, external: false });
			}
		} catch (e) {
			if (request === this.request && this.state.saved === null) this.publish({ error: errMsg(e) });
		} finally {
			this.reading = false;
			this.releaseClean();
		}
	};

	save = async () => {
		const { saved, draft, saving } = this.state;
		if (saved === null || draft === saved || saving || this.confirming) return false;
		// Invalidate older focus reads and capture exactly what this write saves.
		this.request++;
		this.publish({ saving: true });
		try {
			await writeTextFile(this.path, draft, saved);
			this.publish({ saved: draft, external: false, error: null });
			return true;
		} catch (e) {
			const error = errMsg(e);
			this.publish({ error, ...(error.startsWith("CONFLICT:") ? { external: true } : {}) });
			return false;
		} finally {
			this.request++;
			this.publish({ saving: false });
		}
	};

	reload = async () => {
		if (this.state.saving || this.confirming) return;
		const revision = this.revision;
		if (this.state.saved !== null && this.state.draft !== this.state.saved) {
			this.confirming = true;
			try {
				if (!(await confirmDialog(tNow("editor.discardAndReloadConfirm"), { danger: true }))) return;
			} finally {
				this.confirming = false;
			}
		}
		// The confirmation did not authorize discarding edits typed after it opened.
		if (revision !== this.revision) return;
		const request = ++this.request;
		try {
			const text = await readTextFile(this.path);
			if (request !== this.request) return;
			if (revision !== this.revision) {
				this.publish({ external: text !== this.state.saved });
				return;
			}
			this.publish({ saved: text, draft: text, external: false, error: null });
		} catch (e) {
			if (request === this.request) this.publish({ error: errMsg(e) });
		}
	};
}

export function useFileBuffer(path: string): FileBuffer {
	const entry = useMemo(() => {
		let buffer = buffers.get(path);
		if (!buffer) {
			buffer = new BufferEntry(path);
			buffers.set(path, buffer);
		}
		return buffer;
	}, [path]);
	const state = useSyncExternalStore(entry.subscribe, entry.getSnapshot);
	useEffect(() => {
		void entry.refresh();
		const onFocus = () => void entry.refresh();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [entry]);
	return {
		...state,
		dirty: state.saved !== null && state.draft !== state.saved,
		setDraft: entry.setDraft,
		setError: entry.setError,
		dismissExternal: entry.dismissExternal,
		reload: entry.reload,
		save: entry.save,
	};
}
