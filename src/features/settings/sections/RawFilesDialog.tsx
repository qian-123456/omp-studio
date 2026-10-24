/** Raw editor for the provider-related files under omp's agent dir (models.yml, config.yml, .env). */
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertTriangle, FolderOpen, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDocument } from "yaml";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { useEscapeKey } from "../../../lib/hooks";
import { useT } from "../../../stores/language";
import { useOmpConfigStore } from "../ompConfigStore";
import { useProviders } from "../../providers/store";
import { ompInfo, readTextFile, writeTextFile } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { Button } from "../ui";

type FileName = "models.yml" | "config.yml" | ".env";

interface FileMeta {
	name: FileName;
	label: string;
	kind: "yaml" | "env";
	hint: string;
}

const getFiles = (t: (k: string) => string): FileMeta[] => [
	{
		name: "models.yml",
		label: t("memoryRules.rawFiles.modelsLabel"),
		kind: "yaml",
		hint: t("memoryRules.rawFiles.modelsHint"),
	},
	{
		name: "config.yml",
		label: t("memoryRules.rawFiles.configLabel"),
		kind: "yaml",
		hint: t("memoryRules.rawFiles.configHint"),
	},
	{
		name: ".env",
		label: t("memoryRules.rawFiles.envLabel"),
		kind: "env",
		hint: t("memoryRules.rawFiles.envHint"),
	},
];

/** Full YAML parse error text, or null when the text parses. */
function yamlError(text: string): string | null {
	const doc = parseDocument(text);
	return doc.errors.length ? doc.errors.map((e) => e.message).join("\n") : null;
}

export function RawFilesDialog({ onClose }: { onClose: () => void }) {
	const { t } = useT();
	const files = useMemo(() => getFiles(t), [t]);
	const [agentDir, setAgentDir] = useState<string | null>(null);
	const [active, setActive] = useState<FileName>("models.yml");
	const [text, setText] = useState("");
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saved, setSaved] = useState("");

	useEffect(() => {
		ompInfo().then(
			(i) => setAgentDir(i.agentDir),
			(e) => {
				setLoadError(t("memoryRules.rawFiles.cannotDetermineAgentDir", { error: errMsg(e) }));
				setLoading(false);
			},
		);
	}, []);

	const path = agentDir ? `${agentDir}/${active}` : null;
	const meta = files.find((f) => f.name === active) ?? files[0];
	const dirty = text !== saved;
	const kind = meta.kind;

	useEffect(() => {
		if (!path) return;
		let alive = true;
		setLoading(true);
		setLoadError(null);
		setSaveError(null);
		readTextFile(path).then(
			(c) => {
				if (!alive) return;
				setSaved(c);
				setText(c);
				setLoading(false);
			},
			(e) => {
				if (!alive) return;
				setSaved("");
				setText("");
				if (!/No such file|os error 2|not found|不存在/i.test(errMsg(e))) setLoadError(errMsg(e));
				setLoading(false);
			},
		);
		return () => {
			alive = false;
		};
	}, [path]);

	const parseError = useMemo(() => (kind === "yaml" ? yamlError(text) : null), [kind, text]);

	const switchTo = async (name: FileName) => {
		if (name === active) return;
		if (dirty && !(await confirmDialog(t("memoryRules.rawFiles.confirmDiscardSwitch"), { danger: true }))) return;
		setActive(name);
	};

	const close = async () => {
		if (dirty && !(await confirmDialog(t("memoryRules.rawFiles.confirmDiscardClose"), { danger: true }))) return;
		onClose();
	};

	// Esc closes only this dialog (with the unsaved-changes confirm), never settings.
	useEscapeKey(() => {
		if (!saving) void close();
	});

	const save = useCallback(async () => {
		if (!path || parseError) return;
		setSaving(true);
		setSaveError(null);
		try {
			await writeTextFile(path, text);
			setSaved(text);
			// The page stores cache these files; reload so they show the new values.
			void useProviders.getState().load();
			void useOmpConfigStore.getState().load(true);
			toast.success(t("memoryRules.rawFiles.savedFile", { file: active }));
		} catch (e) {
			setSaveError(errMsg(e));
		} finally {
			setSaving(false);
		}
	}, [path, parseError, text, active, t]);

	const reveal = async () => {
		if (!path) return;
		try {
			await revealItemInDir(path);
		} catch (e) {
			toast.error(t("memoryRules.rawFiles.revealFailed", { error: errMsg(e) }));
		}
	};

	return (
		<div
			className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !saving) void close();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t("memoryRules.rawFiles.title")}
				className="flex h-[80vh] w-full max-w-3xl flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-elevated,var(--bg))] p-5 shadow-xl"
			>
				<div className="flex items-center justify-between">
					<h2 className="text-base font-semibold">{t("memoryRules.rawFiles.title")}</h2>
					<button type="button" aria-label={t("memoryRules.rawFiles.close")} onClick={() => void close()} className="rounded p-1 hover:bg-[var(--bg-hover,transparent)]">
						<X size={16} />
					</button>
				</div>
				<div className="flex flex-wrap gap-2">
					{files.map((f) => (
						<Button key={f.name} variant={f.name === active ? "primary" : "secondary"} onClick={() => void switchTo(f.name)}>
							{f.label}
						</Button>
					))}
				</div>
				{path ? <div className="break-all font-mono text-xs text-[var(--text-muted,inherit)]">{path}</div> : null}
				<div className="text-xs">{meta.hint}</div>
				{kind === "env" ? (
					<div className="flex items-start gap-2 rounded-md border border-[var(--status-warning,var(--line))] p-2 text-xs">
						<AlertTriangle size={14} className="mt-0.5 shrink-0" />
						<span>{t("memoryRules.rawFiles.envNotice")}</span>
					</div>
				) : (
					<div className="text-xs text-[var(--text-muted,inherit)]">{t("memoryRules.rawFiles.yamlNotice")}</div>
				)}
				{loadError ? (
					<pre className="whitespace-pre-wrap rounded-md border border-[var(--status-error)] p-2 text-xs text-[var(--status-error)]">{loadError}</pre>
				) : null}
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					disabled={loading || !!loadError}
					spellCheck={false}
					autoComplete="off"
					aria-label={t("memoryRules.rawFiles.contentAria", { file: active })}
					className="min-h-0 flex-1 resize-none rounded-md border border-[var(--line)] bg-transparent p-2 font-mono text-xs"
				/>
				{parseError || saveError ? (
					<pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--status-error)] p-2 text-xs text-[var(--status-error)]">
						{parseError ? t("memoryRules.rawFiles.yamlSyntaxError", { error: parseError }) : t("memoryRules.rawFiles.saveFailedMsg", { error: saveError ?? "" })}
					</pre>
				) : null}
				<div className="flex items-center justify-between gap-2">
					<Button icon={FolderOpen} disabled={!path} onClick={() => void reveal()}>{t("memoryRules.showInFinder")}</Button>
					<div className="flex gap-2">
						<Button onClick={() => void close()}>{t("memoryRules.rawFiles.close")}</Button>
						<Button variant="primary" loading={saving} disabled={!dirty || !!parseError || loading || !!loadError} onClick={() => void save()}>
							{t("memoryRules.rawFiles.save")}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
