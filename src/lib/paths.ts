/** Pure path/file utilities shared by all features (moved out of features/git). */

/** Whether `child` equals or is inside directory `parent`. */
export function isInside(child: string, parent: string): boolean {
	const p = parent.replace(/\/+$/, "");
	return child === p || child.startsWith(`${p}/`);
}

export function joinPath(dir: string, rel: string): string {
	return `${dir.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

export function isMarkdown(path: string): boolean {
	return /\.(md|markdown|mdx)$/i.test(path);
}

/** Replace the home directory prefix with `~`. */
export function shortPath(path: string, home?: string | null): string {
	if (home && isInside(path, home)) return `~${path.slice(home.replace(/\/+$/, "").length)}`;
	return path;
}

/** Path without trailing slashes, for equality checks between path strings. */
export function trimTrailingSlash(path: string): string {
	return path.replace(/\/+$/, "");
}

export function basename(path: string): string {
	const parts = path.replace(/\/+$/, "").split("/");
	return parts[parts.length - 1] || path;
}
