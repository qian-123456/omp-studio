import { isGlobalWorkspaceId } from "./modes";

export interface WorkspacePalette {
	folderColor: string;
}

export const WORKSPACE_PALETTES: WorkspacePalette[] = [
	{ folderColor: "text-sky-600 dark:text-sky-400" },
	{ folderColor: "text-emerald-600 dark:text-emerald-400" },
	{ folderColor: "text-amber-600 dark:text-amber-400" },
	{ folderColor: "text-purple-600 dark:text-purple-400" },
	{ folderColor: "text-rose-600 dark:text-rose-400" },
	{ folderColor: "text-teal-600 dark:text-teal-400" },
];

export function getWorkspacePalette(idOrName: string): WorkspacePalette {
	if (isGlobalWorkspaceId(idOrName)) {
		return { folderColor: "text-indigo-600 dark:text-indigo-400" };
	}
	let hash = 0;
	for (let i = 0; i < idOrName.length; i++) {
		hash = (hash << 5) - hash + idOrName.charCodeAt(i);
		hash |= 0;
	}
	const idx = Math.abs(hash) % WORKSPACE_PALETTES.length;
	return WORKSPACE_PALETTES[idx];
}
