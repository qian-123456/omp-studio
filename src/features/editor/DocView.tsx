/** [C] Center "文档" view: md preview/annotate/edit. Placeholder. */
export function DocView({ path }: { path: string }) {
	return (
		<div className="flex h-full items-center justify-center text-neutral-500">
			文档 {path} — TODO(module C)
		</div>
	);
}
