/** [B] Inline pending-UI dialog cards (approval select/confirm/input/editor). */

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { PendingUiRequest } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { allowedToolsList, rpcUiRespond } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

export function PendingUiCard({
	sessionId,
	req,
}: {
	sessionId: string;
	req: PendingUiRequest;
}) {
	const request = asObj(req.request);
	const id = typeof request.id === "string" ? request.id : "";
	const method = typeof request.method === "string" ? request.method : "";
	const title = typeof request.title === "string" ? request.title : "";
	const message =
		typeof request.message === "string" ? request.message : "";
	const options = Array.isArray(request.options)
		? (request.options as string[])
		: [];
	const optionDetails = Array.isArray(request.optionDetails)
		? (request.optionDetails as { description?: string }[])
		: [];
	const dismissUi = useLive((s) => s.dismissUi);
	const [text, setText] = useState(
		typeof request.value === "string" ? request.value : "",
	);
	const [busy, setBusy] = useState(false);
	const [hasPermanent, setHasPermanent] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;
		allowedToolsList()
			.then((list) => {
				if (mounted && Array.isArray(list) && list.length > 0) {
					setHasPermanent(true);
				}
			})
			.catch(() => {
				if (mounted) setHasPermanent(false);
			});
		return () => {
			mounted = false;
		};
	}, []);
	const respond = async (response: Record<string, unknown>) => {
		setBusy(true);
		try {
			const payload: Record<string, unknown> = { id, ...response };
			await rpcUiRespond(sessionId, payload);
			dismissUi(sessionId, id);
		} catch (err) {
			toast.error(`响应失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const isApproval = /allow|approve|权限|允许/i.test(title);
	const btn =
		"inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs disabled:opacity-50 transition-colors font-medium";
	return (
		<div className="my-2 rounded-md border border-amber-800/60 bg-amber-950/20 p-2.5">
			{title && (
				<div className="whitespace-pre-wrap text-[12px] font-medium text-amber-200">
					{title}
				</div>
			)}
			{message && (
				<div className="mt-1 whitespace-pre-wrap text-[12px] text-neutral-300">
					{message}
				</div>
			)}

			{isApproval && (
				<div className="mt-2.5 flex flex-wrap items-center gap-2">
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							if (method === "select") {
								const approveOpt =
									options.find((o) => /approve|允许|yes|allow/i.test(o)) ??
									options[0] ??
									"allow";
								void respond({ value: approveOpt, confirmed: true });
							} else {
								void respond({ confirmed: true });
							}
						}}
						className={`${btn} bg-emerald-700 text-white hover:bg-emerald-600 focus:opacity-100`}
						title="仅允许本次执行"
					>
						{busy && <Loader2 size={12} className="animate-spin" />}
						仅本次
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							if (method === "select") {
								const approveOpt =
									options.find((o) => /approve|允许|yes|allow/i.test(o)) ??
									options[0] ??
									"allow";
								void respond({
									value: approveOpt,
									confirmed: true,
									always: true,
								});
							} else {
								void respond({ confirmed: true, always: true });
							}
						}}
						className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500 focus:opacity-100`}
						title="本会话内不再询问此工具"
					>
						{busy && <Loader2 size={12} className="animate-spin" />}
						本会话始终
					</button>
					{hasPermanent && (
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								if (method === "select") {
									const approveOpt =
										options.find((o) => /approve|允许|yes|allow/i.test(o)) ??
										options[0] ??
										"allow";
									void respond({
										value: approveOpt,
										confirmed: true,
										always: true,
										persist: true,
									});
								} else {
									void respond({
										confirmed: true,
										always: true,
										persist: true,
									});
								}
							}}
							className={`${btn} bg-purple-700 text-white hover:bg-purple-600 focus:opacity-100`}
							title="永久加入全局允许名单"
						>
							{busy && <Loader2 size={12} className="animate-spin" />}
							永久允许
						</button>
					)}
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							if (method === "select") {
								const rejectOpt =
									options.find((o) => /deny|reject|拒绝|no|cancel/i.test(o)) ??
									options[options.length - 1] ??
									"deny";
								void respond({
									value: rejectOpt,
									confirmed: false,
									cancelled: true,
								});
							} else {
								void respond({ confirmed: false });
							}
						}}
						className={`${btn} bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white focus:opacity-100`}
						title="拒绝本次执行"
					>
						拒绝
					</button>
				</div>
			)}

			{!isApproval && method === "select" && (
				<div className="mt-2 flex flex-col gap-1">
					{options.map((opt, i) => (
						<button
							key={opt}
							type="button"
							disabled={busy}
							onClick={() => respond({ value: opt })}
							className={`${btn} bg-neutral-800 text-left text-neutral-200 hover:bg-neutral-700 focus:opacity-100`}
						>
							{opt}
							{optionDetails[i]?.description && (
								<span className="ml-2 text-neutral-400">
									{optionDetails[i].description}
								</span>
							)}
						</button>
					))}
				</div>
			)}

			{!isApproval && method === "confirm" && (
				<div className="mt-2 flex flex-col gap-2">
					<div className="flex gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => respond({ confirmed: true })}
							className={`${btn} bg-emerald-700 text-white hover:bg-emerald-600 focus:opacity-100`}
						>
							{busy && <Loader2 size={12} className="animate-spin" />}
							确认
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => respond({ confirmed: false })}
							className={`${btn} bg-neutral-800 text-neutral-200 hover:bg-neutral-700 focus:opacity-100`}
						>
							取消
						</button>
					</div>
				</div>
			)}

			{(method === "input" || method === "editor") && (
				<div className="mt-2 flex flex-col gap-1.5">
					<textarea
						autoFocus
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							if (validationError) setValidationError(null);
						}}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Escape") {
								e.preventDefault();
								void respond({ cancelled: true });
							} else if (
								(method === "input" && e.key === "Enter" && !e.shiftKey) ||
								((e.metaKey || e.ctrlKey) && e.key === "Enter")
							) {
								e.preventDefault();
								if (!text.trim()) {
									setValidationError("输入内容不能为空");
									return;
								}
								void respond({ value: text });
							}
						}}
						placeholder={method === "editor" ? "请输入内容 (⌘+Enter 提交，Esc 取消)…" : "请输入内容 (Enter 提交，Esc 取消)…"}
						rows={method === "editor" ? 8 : 2}
						className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[12px] text-neutral-200 outline-none focus:border-indigo-500"
					/>
					{validationError && (
						<div className="text-[11px] text-red-400">
							{validationError}
						</div>
					)}
					<div className="flex gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								if (!text.trim()) {
									setValidationError("输入内容不能为空");
									return;
								}
								void respond({ value: text });
							}}
							className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}
						>
							{busy && <Loader2 size={12} className="animate-spin" />}
							提交
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => respond({ cancelled: true })}
							className={`${btn} bg-neutral-800 text-neutral-300 hover:bg-neutral-700`}
						>
							取消
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
