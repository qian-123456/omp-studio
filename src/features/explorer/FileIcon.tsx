import clsx from "clsx";
import {
	Braces,
	Code2,
	File,
	FileCode,
	FileSpreadsheet,
	FileText,
	Folder,
	FolderOpen,
	GitBranch,
	Hash,
	Image,
	Lock,
	Settings2,
	Terminal,
} from "lucide-react";

export type FileKind =
	| "folder"
	| "git"
	| "json"
	| "markdown"
	| "typescript"
	| "javascript"
	| "rust"
	| "python"
	| "style"
	| "html"
	| "image"
	| "shell"
	| "config"
	| "lock"
	| "spreadsheet"
	| "database"
	| "file";

export function getFileKind(name: string, isDir = false): FileKind {
	if (isDir) return "folder";

	const lower = name.toLowerCase();

	if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".gitmodules") {
		return "git";
	}
	if (
		lower === "package.json" ||
		lower === "project.config.json" ||
		lower === "project.private.config.json" ||
		lower.endsWith(".json") ||
		lower.endsWith(".json5") ||
		lower.endsWith(".jsonl")
	) {
		return "json";
	}
	if (lower === "readme.md" || lower.endsWith(".md") || lower.endsWith(".markdown")) {
		return "markdown";
	}
	if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
		return "typescript";
	}
	if (
		lower.endsWith(".js") ||
		lower.endsWith(".jsx") ||
		lower.endsWith(".mjs") ||
		lower.endsWith(".cjs")
	) {
		return "javascript";
	}
	if (lower.endsWith(".rs")) {
		return "rust";
	}
	if (lower.endsWith(".py")) {
		return "python";
	}
	if (
		lower.endsWith(".css") ||
		lower.endsWith(".scss") ||
		lower.endsWith(".sass") ||
		lower.endsWith(".less")
	) {
		return "style";
	}
	if (lower.endsWith(".html") || lower.endsWith(".htm")) {
		return "html";
	}
	if (
		lower.endsWith(".png") ||
		lower.endsWith(".jpg") ||
		lower.endsWith(".jpeg") ||
		lower.endsWith(".svg") ||
		lower.endsWith(".gif") ||
		lower.endsWith(".webp") ||
		lower.endsWith(".ico")
	) {
		return "image";
	}
	if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) {
		return "shell";
	}
	if (
		lower.endsWith(".yml") ||
		lower.endsWith(".yaml") ||
		lower.endsWith(".toml") ||
		lower.startsWith(".env")
	) {
		return "config";
	}
	if (lower.endsWith(".lock")) {
		return "lock";
	}
	if (lower.endsWith(".csv") || lower.endsWith(".xlsx")) {
		return "spreadsheet";
	}
	if (lower.endsWith(".sql") || lower.endsWith(".sqlite") || lower.endsWith(".db")) {
		return "database";
	}

	return "file";
}

interface FileIconProps {
	name: string;
	isDir?: boolean;
	isOpen?: boolean;
	className?: string;
	size?: number;
}

export function FileIcon({
	name,
	isDir = false,
	isOpen = false,
	className,
	size = 14,
}: FileIconProps) {
	const kind = getFileKind(name, isDir);

	if (kind === "folder") {
		const isSpecial =
			name === ".git" ||
			name === ".omp" ||
			name === ".omp-workspace" ||
			name === "node_modules" ||
			name === ".vscode";

		if (isOpen) {
			return (
				<FolderOpen
					size={size}
					className={clsx(
						isSpecial ? "text-amber-500/80" : "text-amber-400/90",
						className,
					)}
				/>
			);
		}
		return (
			<Folder
				size={size}
				className={clsx(
					isSpecial ? "text-amber-500/80" : "text-amber-400/90",
					className,
				)}
			/>
		);
	}

	switch (kind) {
		case "git":
			return <GitBranch size={size} className={clsx("text-orange-400", className)} />;
		case "json":
			return <Braces size={size} className={clsx("text-amber-300", className)} />;
		case "markdown":
			return <FileText size={size} className={clsx("text-sky-400", className)} />;
		case "typescript":
			return (
				<span
					className={clsx(
						"inline-flex items-center justify-center font-bold text-[9px] leading-none rounded-[2px] bg-sky-600/90 text-white w-3.5 h-3.5 select-none",
						className,
					)}
					title="TypeScript"
				>
					TS
				</span>
			);
		case "javascript":
			return (
				<span
					className={clsx(
						"inline-flex items-center justify-center font-bold text-[9px] leading-none rounded-[2px] bg-amber-400 text-neutral-900 w-3.5 h-3.5 select-none",
						className,
					)}
					title="JavaScript"
				>
					JS
				</span>
			);
		case "rust":
			return (
				<span
					className={clsx(
						"inline-flex items-center justify-center font-bold text-[9px] leading-none rounded-[2px] bg-orange-600/90 text-white w-3.5 h-3.5 select-none",
						className,
					)}
					title="Rust"
				>
					RS
				</span>
			);
		case "python":
			return (
				<span
					className={clsx(
						"inline-flex items-center justify-center font-bold text-[9px] leading-none rounded-[2px] bg-blue-500/90 text-yellow-300 w-3.5 h-3.5 select-none",
						className,
					)}
					title="Python"
				>
					PY
				</span>
			);
		case "style":
			return <Hash size={size} className={clsx("text-pink-400", className)} />;
		case "html":
			return <Code2 size={size} className={clsx("text-orange-500", className)} />;
		case "image":
			return <Image size={size} className={clsx("text-purple-400", className)} />;
		case "shell":
			return <Terminal size={size} className={clsx("text-emerald-400", className)} />;
		case "config":
			return <Settings2 size={size} className={clsx("text-teal-400", className)} />;
		case "lock":
			return <Lock size={size} className={clsx("text-neutral-500", className)} />;
		case "spreadsheet":
			return <FileSpreadsheet size={size} className={clsx("text-emerald-500", className)} />;
		case "database":
			return <FileCode size={size} className={clsx("text-cyan-400", className)} />;
		default:
			return <File size={size} className={clsx("text-neutral-400", className)} />;
	}
}
