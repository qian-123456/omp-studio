/**
 * Text-file buffer shared by the center DocView and the right-panel preview:
 * load, dirty tracking, atomic save, reload-on-focus (dirty buffers keep their
 * edits and show the external-change banner instead).
 */

import { useCallback, useEffect, useState } from "react";
import { errMsg } from "../../lib/dialogs";
import { readTextFile, writeTextFile } from "../../lib/ipc";

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

export function useFileBuffer(path: string): FileBuffer {
	const [saved, setSaved] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [external, setExternal] = useState(false);
	const [saving, setSaving] = useState(false);

	const dirty = saved !== null && draft !== saved;

	const load = useCallback(async () => {
		try {
			const text = await readTextFile(path);
			setSaved(text);
			setDraft(text);
			setError(null);
			setExternal(false);
		} catch (e) {
			setError(errMsg(e));
			setSaved(null);
		}
	}, [path]);

	useEffect(() => {
		setSaved(null);
		setDraft("");
		setExternal(false);
		void load();
	}, [load]);

	// Re-read on window focus. A clean buffer updates silently; a dirty buffer
	// keeps the user's edits and surfaces the conflict instead.
	useEffect(() => {
		const onFocus = async () => {
			if (saved === null) return;
			try {
				const text = await readTextFile(path);
				if (text === saved) return;
				if (dirty) {
					setExternal(true);
				} else {
					setSaved(text);
					setDraft(text);
				}
			} catch {
				// File may be gone; leave the buffer alone.
			}
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [path, saved, dirty]);

	const save = useCallback(async () => {
		if (saved === null || !dirty || saving) return false;
		setSaving(true);
		try {
			await writeTextFile(path, draft);
			setSaved(draft);
			setExternal(false);
			setError(null);
			return true;
		} catch (e) {
			setError(errMsg(e));
			return false;
		} finally {
			setSaving(false);
		}
	}, [path, draft, saved, dirty, saving]);

	const reload = useCallback(async () => {
		await load();
	}, [load]);

	return {
		saved,
		draft,
		setDraft,
		error,
		setError,
		external,
		dismissExternal: () => setExternal(false),
		saving,
		dirty,
		reload,
		save,
	};
}
