/** Raw editor for the provider-related files under omp's agent dir (models.yml, config.yml, .env). */
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertTriangle, FolderOpen, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDocument } from "yaml";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { useEscapeKey } from "../../../lib/hooks";
import { useOmpConfigStore } from "../ompConfigStore";
import { useProviders } from "../../providers/store";
import { ompInfo, readTextFile, writeTextFile } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { Button } from "../ui";

const FILES = [
	{
		name: "models.yml",
		label: "models.yml（供应商与模型）",
		kind: "yaml",
		hint: "记录有哪些供应商（接口地址、密钥变量名、接口类型）和每个模型的单独设置（如压缩用的模型）。「供应商」页管理的就是这个文件。",
	},
	{
		name: "config.yml",
		label: "config.yml（omp 配置）",
		kind: "yaml",
		hint: "omp 自身的全局设置：各角色默认用哪个模型和思考等级（modelRoles）、禁用的供应商、主题、压缩策略、编辑模式等。",
	},
	{
		name: ".env",
		label: ".env（环境变量）",
		kind: "env",
		hint: "存放各供应商的 API 密钥，格式为 变量名=密钥；models.yml 里的 apiKey 写的是这里的变量名。",
	},
] as const;

type FileName = (typeof FILES)[number]["name"];

/** Full YAML parse error text, or null when the text parses. */
function yamlError(text: string): string | null {
	const doc = parseDocument(text);
	return doc.errors.length ? doc.errors.map((e) => e.message).join("\n") : null;
}

export function RawFilesDialog({ onClose }: { onClose: () => void }) {
	const [agentDir, setAgentDir] = useState<string | null>(null);
	const [active, setActive] = useState<FileName>("models.yml");
	const [saved, setSaved] = useState("");
	const [text, setText] = useState("");
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	useEffect(() => {
		ompInfo().then(
			(i) => setAgentDir(i.agentDir),
			(e) => {
				setLoadError(`无法确定 omp 数据目录：${errMsg(e)}`);
				setLoading(false);
			},
		);
	}, []);

	const path = agentDir ? `${agentDir}/${active}` : null;
	const meta = FILES.find((f) => f.name === active)!;
	const kind = meta.kind;
	const dirty = text !== saved;

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
		if (dirty && !(await confirmDialog("当前文件有未保存的修改，切换后将丢失。继续吗？", { danger: true }))) return;
		setActive(name);
	};

	const close = async () => {
		if (dirty && !(await confirmDialog("有未保存的修改，关闭后将丢失。继续吗？", { danger: true }))) return;
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
			toast.success(`已保存 ${active}`);
		} catch (e) {
			setSaveError(errMsg(e));
		} finally {
			setSaving(false);
		}
	}, [path, parseError, text, active]);

	const reveal = async () => {
		if (!path) return;
		try {
			await revealItemInDir(path);
		} catch (e) {
			toast.error(`在访达中显示失败：${errMsg(e)}`);
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
				aria-label="编辑原始配置文件"
				className="flex h-[80vh] w-full max-w-3xl flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-elevated,var(--bg))] p-5 shadow-xl"
			>
				<div className="flex items-center justify-between">
					<h2 className="text-base font-semibold">编辑原始配置文件</h2>
					<button type="button" aria-label="关闭" onClick={() => void close()} className="rounded p-1 hover:bg-[var(--bg-hover,transparent)]">
						<X size={16} />
					</button>
				</div>
				<div className="flex flex-wrap gap-2">
					{FILES.map((f) => (
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
						<span>.env 可能包含 API 密钥等机密信息，请勿截图或分享此处内容。保存后需重启会话才会生效。</span>
					</div>
				) : (
					<div className="text-xs text-[var(--text-muted,inherit)]">直接修改文件内容；保存前会校验 YAML 语法。文件不存在时保存会新建。</div>
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
					aria-label={`${active} 内容`}
					className="min-h-0 flex-1 resize-none rounded-md border border-[var(--line)] bg-transparent p-2 font-mono text-xs"
				/>
				{parseError || saveError ? (
					<pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--status-error)] p-2 text-xs text-[var(--status-error)]">
						{parseError ? `YAML 语法错误：\n${parseError}` : `保存失败：${saveError}`}
					</pre>
				) : null}
				<div className="flex items-center justify-between gap-2">
					<Button icon={FolderOpen} disabled={!path} onClick={() => void reveal()}>在访达中显示</Button>
					<div className="flex gap-2">
						<Button onClick={() => void close()}>关闭</Button>
						<Button variant="primary" loading={saving} disabled={!dirty || !!parseError || loading || !!loadError} onClick={() => void save()}>
							保存
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
