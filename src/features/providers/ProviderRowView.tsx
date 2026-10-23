import clsx from "clsx";
import {
	Activity,
	CircleCheck,
	CircleX,
	KeyRound,
	Loader2,
	Lock,
	LogIn,
	Pencil,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import type { ProviderRow } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { ProviderBrandLogo } from "../settings/sections/ProviderBrandLogo";
import { Switch } from "../settings/Switch";
import {
	authBadge,
	type KeyTone,
	describeKey,
	hostOf,
	keyLocation,
	keyToneClass,
	LOGIN_STORED_NOTE,
	MODELS_YML_PATH,
} from "./keyState";
import { formatTokens, modelEntryId, modelEntrySpec } from "./modelEntry";
import { presetById } from "./presets";
import { type TestStatus, useProviders } from "./store";

const MODELS_COLLAPSED = 6;

const badgeToneClass: Record<KeyTone, string> = {
	success: "border-emerald-700/40 bg-emerald-950/40 text-emerald-300",
	warning: "border-amber-700/40 bg-amber-950/40 text-amber-300",
	error: "border-rose-700/40 bg-rose-950/40 text-rose-300",
	info: "border-indigo-700/40 bg-indigo-950/40 text-indigo-300",
	muted: "border-neutral-700/40 bg-neutral-800/60 text-neutral-400",
};

/** Grid shared by the list header and every row: name | key | enabled. */
export const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_minmax(140px,max-content)_44px] items-center gap-x-3";

interface Props {
	row: ProviderRow;
	expanded: boolean;
	onToggleExpand: () => void;
	onEdit: () => void;
	onSetKey: () => void;
	onOauth: () => void;
}

export function ProviderRowView({ row, expanded, onToggleExpand, onEdit, onSetKey, onOauth }: Props) {
	const encrypt = useProviders((s) => s.encrypt);
	const decrypt = useProviders((s) => s.decrypt);
	const setEnabled = useProviders((s) => s.setEnabled);
	const remove = useProviders((s) => s.remove);
	const runTest = useProviders((s) => s.runTest);
	const runModelTest = useProviders((s) => s.runModelTest);
	const modelTests = useProviders((s) => s.modelTests);
	const test = useProviders((s) => s.tests[row.id]);

	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState(false);
	const [showAllModels, setShowAllModels] = useState(false);

	const key = describeKey(row);
	const badge = authBadge(row);
	const preset = presetById(row.id);
	const host = hostOf(row.baseUrl);
	const title = row.displayName ?? row.id;

	const onKeyClick = async () => {
		switch (key.action) {
			case "encrypt":
				setBusy(true);
				try {
					await encrypt(row.id);
					toast.success(`已加密「${title}」的密钥`);
				} catch (err) {
					toast.error(`加密失败: ${errMsg(err)}`);
				} finally {
					setBusy(false);
				}
				return;
			case "decrypt": {
				const ok = await confirmDialog(`改回明文？密钥会以明文保存在 ${MODELS_YML_PATH}`, {
					title: "改回明文",
					danger: true,
					okLabel: "改回明文",
				});
				if (!ok) return;
				setBusy(true);
				try {
					await decrypt(row.id);
					toast.success(`「${title}」的密钥已改回明文`);
				} catch (err) {
					toast.error(`操作失败: ${errMsg(err)}`);
				} finally {
					setBusy(false);
				}
				return;
			}
			case "setKey":
				onSetKey();
				return;
			case "oauth":
				onOauth();
				return;
			case "explainLogin":
				setNote((v) => !v);
				return;
			case "none":
				return;
		}
	};

	const handleToggle = (next: boolean) => {
		void setEnabled(row.id, next).catch((err) => toast.error(`更新失败: ${errMsg(err)}`));
	};

	const handleDelete = async () => {
		const ok = await confirmDialog(
			row.origin === "custom"
				? `删除供应商「${title}」？它会从 ${MODELS_YML_PATH} 移除，已加密的密钥也会一并删除。`
				: `删除「${title}」在 ${MODELS_YML_PATH} 里的配置？OMP 内置的默认设置不受影响。`,
			{ title: "删除供应商", danger: true, okLabel: "删除" },
		);
		if (!ok) return;
		try {
			await remove(row.id);
			toast.success("已删除");
		} catch (err) {
			toast.error(`删除失败: ${errMsg(err)}`);
		}
	};

	const KeyIcon =
		key.action === "oauth"
			? LogIn
			: key.tone === "success"
				? Lock
				: key.tone === "warning" || key.tone === "error"
					? TriangleAlert
					: KeyRound;

	const keyContent = (
		<>
			<KeyIcon className="h-3 w-3 shrink-0" />
			<span>{key.label}</span>
		</>
	);

	const sourceModels = row.models;
	const visibleModels = showAllModels ? sourceModels : sourceModels.slice(0, MODELS_COLLAPSED);
	const canDelete = row.origin === "custom" || row.origin === "override";
	const testReason = row.testable ? null : "暂不能测试：需要已知的地址、受支持的协议和可用的密钥";

	return (
		<div
			id={`provider-row-${row.id}`}
			className={clsx(
				"rounded-lg transition-colors",
				expanded && "hairline border-l-[3px] border-l-[var(--accent)] bg-[var(--well-bg)]",
			)}
		>
			<div className={clsx(ROW_GRID, "min-h-[44px] px-2.5 py-1.5", !expanded && "hover:bg-[var(--bg-hover)]")}>
				<button
					type="button"
					onClick={onToggleExpand}
					aria-expanded={expanded}
					title="点击展开查看模型与详情"
					className="flex min-w-0 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--accent)_60%,transparent)]"
				>
					<ProviderBrandLogo providerId={row.id} color={preset?.color} className="h-5 w-5 shrink-0" />
					<span className="min-w-0">
						<span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							<span className="break-all font-mono text-xs font-semibold text-neutral-100">{row.id}</span>
							{row.displayName && row.displayName !== row.id && (
								<span className="text-[11px] text-neutral-400">{row.displayName}</span>
							)}
							<span
								className={clsx(
									"inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
									badgeToneClass[badge.tone],
								)}
							>
								{badge.label}
							</span>
							{test?.state === "done" && (
								<span
									title={`${test.result.detail}（${test.result.latencyMs}ms）`}
									className={clsx(
										"inline-flex shrink-0 items-center gap-1 text-[10px]",
										test.result.ok ? "text-emerald-400" : "text-rose-400",
									)}
								>
									{test.result.ok ? <CircleCheck className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}
									{test.result.ok ? "连接正常" : "连接失败"}
								</span>
							)}
						</span>
						<span className="block break-all font-mono text-[10px] text-neutral-500">
							{host ? `${host} · ` : ""}
							{row.models.length} 个模型
						</span>
					</span>
				</button>

				<div className="justify-self-start">
					{key.action === "none" ? (
						<span
							title={key.title}
							className={clsx(
								"inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-0.5 text-xs",
								keyToneClass[key.tone],
							)}
						>
							{keyContent}
						</span>
					) : (
						<button
							type="button"
							onClick={() => void onKeyClick()}
							disabled={busy}
							title={key.title}
							aria-label={`${title}：${key.label}。${key.title}`}
							className={clsx(
								"inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-1.5 py-0.5 text-xs underline decoration-dashed decoration-1 underline-offset-4 transition-colors",
								"hover:border-[var(--border-divider)] hover:bg-[var(--bg-active-fill)] focus-visible:border-[var(--border-divider)] focus-visible:bg-[var(--bg-active-fill)] focus-visible:outline-none",
								"disabled:opacity-50",
								keyToneClass[key.tone],
							)}
						>
							{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyIcon className="h-3 w-3 shrink-0" />}
							<span>{key.label}</span>
						</button>
					)}
				</div>

				<div className="justify-self-end">
					<Switch
						checked={row.enabled}
						onChange={handleToggle}
						ariaLabel={`启用 ${row.id}`}
						title={row.enabled ? "已启用：新会话可以使用它的模型" : "已停用：新会话看不到它的模型"}
					/>
				</div>
			</div>

			{note && (
				<div role="note" className="mx-2.5 mb-2 rounded-md bg-[var(--well-bg)] px-2.5 py-1.5 text-[11px] leading-relaxed text-neutral-400">
					{LOGIN_STORED_NOTE}
				</div>
			)}

			{expanded && (
				<div className="space-y-2.5 px-3 pb-3 pt-1">
					<div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
						<span>来源:</span>
						{row.sources.map((src) => (
							<span key={src} className="rounded bg-neutral-800/80 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
								{src}
							</span>
						))}
					</div>

					<dl className="space-y-1 text-[11px]">
						<div className="flex gap-2">
							<dt className="w-10 shrink-0 text-neutral-500">地址</dt>
							<dd className="min-w-0 select-text break-all font-mono text-neutral-300">{row.baseUrl ?? "未知"}</dd>
						</div>
						<div className="flex gap-2">
							<dt className="w-10 shrink-0 text-neutral-500">协议</dt>
							<dd className="min-w-0 select-text break-all font-mono text-neutral-300">{row.api ?? "未知"}</dd>
						</div>
						<div className="flex gap-2">
							<dt className="w-10 shrink-0 text-neutral-500">密钥</dt>
							<dd className="min-w-0 select-text break-all text-neutral-300">{keyLocation(row)}</dd>
						</div>
					</dl>

					<div className="flex flex-wrap items-center gap-1.5">
						<button
							type="button"
							onClick={() => void runTest(row.id)}
							disabled={!row.testable || test?.state === "testing"}
							title={testReason ?? "测试连接"}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95 disabled:opacity-40"
						>
							{test?.state === "testing" ? (
								<Loader2 size={12} className="animate-spin" />
							) : (
								<Activity size={12} />
							)}
							<span>测试连接</span>
						</button>
						<button
							type="button"
							onClick={onEdit}
							title={row.origin === "custom" ? "编辑这个供应商" : "修改这个供应商的密钥"}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95"
						>
							<Pencil className="h-3 w-3" />
							<span>编辑</span>
						</button>
						{canDelete && (
							<button
								type="button"
								onClick={() => void handleDelete()}
								className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs text-neutral-300 transition-all hover:bg-rose-950/40 hover:text-rose-300 active:scale-95"
							>
								<Trash2 className="h-3 w-3" />
								<span>删除</span>
							</button>
						)}
					</div>
					<TestResultLine test={test} />

					<div className="border-t border-[var(--border-divider)] pt-2.5">
						<div className="mb-2 flex items-center justify-between text-xs">
							<span className="font-medium text-neutral-300">模型列表（{sourceModels.length}）</span>
							{sourceModels.length > MODELS_COLLAPSED && (
								<button
									type="button"
									onClick={() => setShowAllModels((v) => !v)}
									className="whitespace-nowrap text-[11px] text-[var(--accent)] hover:underline"
								>
									{showAllModels ? "收起" : `全部 ${sourceModels.length} 个`}
								</button>
							)}
						</div>
						{sourceModels.length === 0 ? (
							<div className="rounded-lg bg-neutral-900/40 p-2.5 text-center text-xs text-neutral-500">未配置模型</div>
						) : (
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{visibleModels.map((entry) => {
									const mid = modelEntryId(entry);
									const spec = modelEntrySpec(entry);
									const modelTest = modelTests[`${row.id}::${mid}`];
									return (
										<div
											key={mid}
											className="flex flex-col justify-between gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)]/60 p-2.5 text-xs"
										>
											<div className="flex min-w-0 items-start justify-between gap-1.5">
												<span className="min-w-0 break-all font-mono font-medium text-neutral-200">{mid}</span>
												<button
													type="button"
													onClick={() => void runModelTest(row.id, mid)}
													disabled={!row.testable || modelTest?.state === "testing"}
													title={testReason ?? `测试模型 ${mid}`}
													aria-label={`测试模型 ${mid}`}
													className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-[var(--well-bg)] px-2 py-0.5 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95 disabled:opacity-40"
												>
													{modelTest?.state === "testing" ? (
														<Loader2 size={11} className="animate-spin" />
													) : (
														<Activity size={11} />
													)}
													<span>测试</span>
												</button>
											</div>
											{(spec.contextWindow != null || spec.maxTokens != null) && (
												<div className="flex flex-wrap items-center gap-1 text-[10px]">
													{spec.contextWindow != null && (
														<span
															className="rounded border border-sky-800/40 bg-sky-950/60 px-1.5 py-0.5 font-mono text-sky-300"
															title={`上下文窗口: ${spec.contextWindow} tokens`}
														>
															ctx:{formatTokens(spec.contextWindow)}
														</span>
													)}
													{spec.maxTokens != null && (
														<span
															className="rounded border border-indigo-800/40 bg-indigo-950/60 px-1.5 py-0.5 font-mono text-indigo-300"
															title={`输出上限: ${spec.maxTokens} tokens`}
														>
															max:{formatTokens(spec.maxTokens)}
														</span>
													)}
												</div>
											)}
											{modelTest && <ModelTestLine test={modelTest} />}
										</div>
									);
								})}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function ModelTestLine({ test }: { test: TestStatus }) {
	if (test.state === "testing") {
		return (
			<div className="flex items-center gap-1 text-[11px] text-neutral-400">
				<Loader2 size={11} className="animate-spin" />
				<span>正在测试</span>
			</div>
		);
	}
	const { ok, detail, latencyMs } = test.result;
	return (
		<div className={clsx("flex items-start gap-1 break-words text-[11px]", ok ? "text-emerald-400" : "text-rose-400")}>
			{ok ? <CircleCheck className="h-3 w-3 shrink-0" /> : <CircleX className="h-3 w-3 shrink-0" />}
			<span className="min-w-0 select-text whitespace-pre-wrap break-words">{detail}</span>
			<span className="shrink-0 font-mono text-[10px] opacity-80">({latencyMs}ms)</span>
		</div>
	);
}

function TestResultLine({ test }: { test: TestStatus | undefined }) {
	if (!test) return null;
	if (test.state === "testing") {
		return (
			<div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
				<Loader2 className="h-3 w-3 animate-spin" />
				正在连接
			</div>
		);
	}
	const { ok, latencyMs, detail } = test.result;
	return (
		<div className={clsx("flex items-start gap-1.5 text-[11px]", ok ? "text-emerald-400" : "text-rose-400")}>
			{ok ? <CircleCheck className="h-3 w-3 shrink-0" /> : <CircleX className="h-3 w-3 shrink-0" />}
			<span className="min-w-0 select-text whitespace-pre-wrap break-words">
				{detail}（<span className="font-mono tabular-nums">{latencyMs}ms</span>）
			</span>
		</div>
	);
}
