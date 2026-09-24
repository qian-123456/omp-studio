/** [B] Inline pending-UI dialog cards (approval select/confirm/input/editor). */

import { useState } from "react";
import type { PendingUiRequest } from "../../lib/contracts";
import { rpcUiRespond } from "../../lib/ipc";
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

	const respond = async (response: Record<string, unknown>) => {
		setBusy(true);
		try {
			await rpcUiRespond(sessionId, { id, ...response });
			dismissUi(sessionId, id);
		} catch (err) {
			console.error("ui respond failed", err);
		} finally {
			setBusy(false);
		}
	};

	const isApproval = title.startsWith("Allow tool") || method === "select";
	const btn =
		"rounded px-2.5 py-1 text-xs disabled:opacity-50 transition-colors";

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

			{method === "select" && (
				<div className="mt-2 flex flex-col gap-1">
					{options.map((opt, i) => (
						<button
							key={opt}
							type="button"
							disabled={busy}
							onClick={() => respond({ value: opt })}
							className={`${btn} ${
								isApproval && /approve|允许|yes/i.test(opt)
									? "bg-emerald-700 text-white hover:bg-emerald-600"
									: isApproval
										? "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
										: "bg-neutral-800 text-left text-neutral-200 hover:bg-neutral-700"
							}`}
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

			{method === "confirm" && (
				<div className="mt-2 flex gap-2">
					<button
						type="button"
						disabled={busy}
						onClick={() => respond({ confirmed: true })}
						className={`${btn} bg-emerald-700 text-white hover:bg-emerald-600`}
					>
						确认
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => respond({ confirmed: false })}
						className={`${btn} bg-neutral-800 text-neutral-200 hover:bg-neutral-700`}
					>
						取消
					</button>
				</div>
			)}

			{(method === "input" || method === "editor") && (
				<div className="mt-2 flex flex-col gap-1.5">
					<textarea
						autoFocus={method === "editor"}
						value={text}
						onChange={(e) => setText(e.target.value)}
						rows={method === "editor" ? 8 : 2}
						className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-[12px] text-neutral-200 outline-none focus:border-indigo-500"
					/>
					<div className="flex gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => respond({ value: text })}
							className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}
						>
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
