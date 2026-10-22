import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	OmpImportIssue,
	OmpImportPlanItem,
	OmpImportResult,
} from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { useEscapeKey } from "../../lib/hooks";
import { providerImportOmpPlan } from "../../lib/ipc";
import { useProviders } from "./store";

const FIX_HINT: Record<OmpImportIssue, string> = {
	missingBaseUrl:
		"OMP 配置里没有这个供应商的接口地址。请在下方填写后再导入。手动填写的地址会按 OpenAI 兼容协议使用，所以只有该供应商兼容 OpenAI 时才需要填写；否则请继续直接在 OMP 中使用它。",
	unsupportedApi:
		"该供应商使用工作台暂不支持的接口协议，无法导入工作台；它仍可在 OMP 中直接使用。",
	noKey:
		"OMP 里还没有这个供应商的密钥。请先在 OMP 中登录或配置密钥，然后点「重新检查」；未配置时它仍可在 OMP 中按原方式使用。",
	envVarUnset:
		"密钥来自环境变量，但当前没有设置。请设置该环境变量后点「重新检查」；它仍可在 OMP 中直接使用。",
};

export function isValidHttpUrl(raw: string): boolean {
	try {
		const u = new URL(raw.trim());
		return (u.protocol === "http:" || u.protocol === "https:") && !!u.host;
	} catch {
		return false;
	}
}

const btnCls =
	"inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-40";
const primaryCls =
	"inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 active:scale-95 transition-all disabled:opacity-40";
/** Rows of the long "将更新" group shown before the user expands it. */
const COLLAPSED_ROWS = 3;

export function ImportOmpDialog({
	ids,
	onClose,
}: {
	ids: string[];
	onClose: () => void;
}) {
	const importOmp = useProviders((s) => s.importOmp);
	const dialogRef = useRef<HTMLDivElement>(null);
	const [plan, setPlan] = useState<OmpImportPlanItem[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [overrides, setOverrides] = useState<Record<string, string>>({});
	const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
	const [importing, setImporting] = useState(false);
	const [results, setResults] = useState<OmpImportResult[] | null>(null);
	const [retrying, setRetrying] = useState<string | null>(null);
	const [updatesExpanded, setUpdatesExpanded] = useState(false);

	const check = useCallback(async () => {
		setLoading(true);
		setLoadError(null);
		try {
			setPlan(await providerImportOmpPlan(ids));
		} catch (err) {
			setLoadError(errMsg(err));
		} finally {
			setLoading(false);
		}
	}, [ids]);

	useEffect(() => {
		void check();
	}, [check]);
	useEscapeKey(onClose);

	const effective = useMemo(
		() =>
			(plan ?? []).map((item) => {
				const ov = overrides[item.id]?.trim() ?? "";
				const fixed =
					!item.ok && item.issue === "missingBaseUrl" && isValidHttpUrl(ov);
				return {
					item,
					ok: item.ok || fixed,
					baseUrl: fixed ? ov : item.baseUrl,
				};
			}),
		[plan, overrides],
	);
	const creates = effective.filter((e) => e.ok && e.item.action === "create");
	const updates = effective.filter((e) => e.ok && e.item.action === "update");
	const problems = effective.filter((e) => !e.ok);
	const selectedIds = effective
		.filter((e) => e.ok && !unchecked.has(e.item.id))
		.map((e) => e.item.id);

	const overridesFor = (list: string[]) => {
		const out: Record<string, string> = {};
		for (const id of list) {
			const v = overrides[id]?.trim();
			if (v && isValidHttpUrl(v)) out[id] = v;
		}
		return out;
	};

	const runImport = async (list: string[]) => {
		setImporting(true);
		try {
			return await importOmp(list, overridesFor(list));
		} catch (err) {
			const msg = errMsg(err);
			return list.map<OmpImportResult>((id) => ({
				id,
				ok: false,
				error: msg,
			}));
		} finally {
			setImporting(false);
		}
	};

	const handleImport = async () => {
		if (selectedIds.length === 0 || importing) return;
		setResults(await runImport(selectedIds));
	};

	const handleRetry = async (id: string) => {
		setRetrying(id);
		const [res] = await runImport([id]);
		setRetrying(null);
		if (res) {
			setResults((prev) =>
				(prev ?? []).map((r) => (r.id === id ? res : r)),
			);
		}
	};

	const toggle = (id: string) =>
		setUnchecked((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const renderOkRow = (e: (typeof effective)[number]) => (
		<label
			key={e.item.id}
			className="flex cursor-pointer items-start gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs"
		>
			<input
				type="checkbox"
				checked={!unchecked.has(e.item.id)}
				onChange={() => toggle(e.item.id)}
				className="mt-0.5"
			/>
			<div className="min-w-0 flex-1 select-text">
				<div className="break-all font-medium text-neutral-200">{e.item.id}</div>
				{e.item.slug !== e.item.id && (
					<div className="text-[11px] text-amber-400">
						标识符将改为 <span className="font-mono">{e.item.slug}</span>
					</div>
				)}
				{e.baseUrl && (
					<div className="break-all font-mono text-[11px] text-neutral-400">
						{e.baseUrl}
					</div>
				)}
				{e.item.error && (
					<div className="whitespace-pre-wrap break-words text-[11px] text-amber-400">
						{e.item.error}
					</div>
				)}
				{e.item.issue && e.item.ok && (
					<div className="text-[11px] text-amber-400">
						{FIX_HINT[e.item.issue]}
					</div>
				)}
			</div>
		</label>
	);

	const renderProblemRow = (e: (typeof effective)[number]) => {
		const { item } = e;
		const issue = item.issue;
		return (
			<div
				key={item.id}
				className="space-y-1.5 rounded-lg bg-neutral-950 px-3 py-2 text-xs"
			>
				<div className="break-all font-medium text-neutral-200">{item.id}</div>
				{item.slug !== item.id && (
					<div className="text-[11px] text-amber-400">
						标识符将改为 <span className="font-mono">{item.slug}</span>
					</div>
				)}
				{item.error && (
					<div className="select-text whitespace-pre-wrap break-words text-[11px] text-red-400">
						{item.error}
					</div>
				)}
				{issue && (
					<div className="select-text text-[11px] text-neutral-400">
						{FIX_HINT[issue]}
					</div>
				)}
				{issue === "missingBaseUrl" && (
					<div>
						<input
							type="text"
							value={overrides[item.id] ?? ""}
							onChange={(ev) =>
								setOverrides((p) => ({ ...p, [item.id]: ev.target.value }))
							}
							placeholder="https://api.example.com/v1"
							aria-label={`${item.id} 接口地址`}
							spellCheck={false}
							className="w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none"
						/>
						{(overrides[item.id] ?? "").trim() !== "" &&
							!isValidHttpUrl(overrides[item.id] ?? "") && (
								<div className="mt-1 text-[11px] text-red-400">
									地址必须以 http:// 或 https:// 开头
								</div>
							)}
					</div>
				)}
			</div>
		);
	};

	const group = (
		title: string,
		list: typeof effective,
		render: (e: (typeof effective)[number]) => React.ReactNode,
		collapse?: { expanded: boolean; toggle: () => void },
	) => {
		if (list.length === 0) return null;
		const collapsible = collapse !== undefined && list.length > COLLAPSED_ROWS + 1;
		const shown =
			collapsible && !collapse.expanded ? list.slice(0, COLLAPSED_ROWS) : list;
		return (
			<div className="space-y-1.5">
				<div className="text-xs font-medium text-neutral-300">
					{title}（{list.length}）
				</div>
				{shown.map(render)}
				{collapsible && (
					<button
						type="button"
						onClick={collapse.toggle}
						aria-expanded={collapse.expanded}
						className="inline-flex items-center gap-1 whitespace-nowrap rounded-full hairline px-3 py-1 text-[11px] text-neutral-300 hover:bg-[var(--bg-hover)]"
					>
						{collapse.expanded ? (
							<ChevronUp className="h-3 w-3" />
						) : (
							<ChevronDown className="h-3 w-3" />
						)}
						{collapse.expanded ? "收起" : `展开其余 ${list.length - COLLAPSED_ROWS} 个`}
					</button>
				)}
			</div>
		);
	};

	const planById = new Map((plan ?? []).map((p) => [p.id, p]));

	return (
		<div
			className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-md"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="import-omp-title"
				className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-[var(--bg-panel)] shadow-apple-modal hairline"
			>
				<div className="flex items-center justify-between border-b border-[var(--border-divider)] px-4 py-3">
					<div
						id="import-omp-title"
						className="text-xs font-semibold text-neutral-100"
					>
						{results ? "导入结果" : "导入 OMP 供应商"}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="关闭"
						className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				<div className="flex-1 space-y-3 overflow-y-auto p-4">
					{loading && !plan && (
						<div className="flex items-center gap-2 text-xs text-neutral-400">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							<span>正在检查</span>
						</div>
					)}
					{loadError && (
						<div className="select-text whitespace-pre-wrap break-words text-xs text-red-400">
							检查失败: {loadError}
						</div>
					)}
					{!results && plan && (
						<>
							<div className="text-[11px] text-neutral-400">
								将把 OMP 中的供应商和密钥复制到工作台（密钥加密保存），OMP 自身配置不会被修改。
							</div>
							{group("将新增", creates, renderOkRow)}
							{group("将更新", updates, renderOkRow, {
								expanded: updatesExpanded,
								toggle: () => setUpdatesExpanded((v) => !v),
							})}
							{group("需要处理", problems, renderProblemRow)}
						</>
					)}
					{results && (
						<div className="space-y-1.5">
							{results.map((r) => {
								const p = planById.get(r.id);
								const issue = r.issue ?? p?.issue ?? null;
								return (
									<div
										key={r.id}
										className="space-y-1 rounded-lg bg-neutral-950 px-3 py-2 text-xs"
									>
										<div className="flex items-center justify-between gap-2">
											<span className="break-all font-medium text-neutral-200">
												{r.id}
											</span>
											<span
												className={
													r.ok
														? "whitespace-nowrap text-emerald-400"
														: "whitespace-nowrap text-red-400"
												}
											>
												{r.ok ? (r.error || r.issue ? "已导入（有警告）" : "已导入") : "失败"}
											</span>
										</div>
										{r.ok && (r.error || r.issue) && (
											<div className="select-text space-y-0.5 text-[11px] text-amber-400">
												{r.error && (
													<div className="whitespace-pre-wrap break-words">
														{r.error}
													</div>
												)}
												{r.issue && <div>{FIX_HINT[r.issue]}</div>}
											</div>
										)}
										{!r.ok && (
											<>
												<div className="select-text whitespace-pre-wrap break-words text-[11px] text-red-400">
													{r.error || "导入失败"}
												</div>
												{issue && (
													<div className="select-text text-[11px] text-neutral-400">
														{FIX_HINT[issue]}
													</div>
												)}
												{issue === "missingBaseUrl" && (
													<input
														type="text"
														value={overrides[r.id] ?? ""}
														onChange={(ev) =>
															setOverrides((o) => ({
																...o,
																[r.id]: ev.target.value,
															}))
														}
														placeholder="https://api.example.com/v1"
														aria-label={`${r.id} 接口地址`}
														spellCheck={false}
														className="w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none"
													/>
												)}
												<button
													type="button"
													disabled={importing}
													onClick={() => void handleRetry(r.id)}
													className={btnCls}
												>
													{retrying === r.id && (
														<Loader2 className="h-3 w-3 animate-spin" />
													)}
													<span>重试</span>
												</button>
											</>
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-3">
					{!results && (
						<button
							type="button"
							onClick={() => void check()}
							disabled={loading || importing}
							className={btnCls}
						>
							重新检查
						</button>
					)}
					<button type="button" onClick={onClose} className={btnCls}>
						{results ? "完成" : "取消"}
					</button>
					{!results && (
						<button
							type="button"
							onClick={() => void handleImport()}
							disabled={selectedIds.length === 0 || importing || loading}
							className={primaryCls}
						>
							{importing && <Loader2 className="h-3 w-3 animate-spin" />}
							<span>导入 {selectedIds.length} 个</span>
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
