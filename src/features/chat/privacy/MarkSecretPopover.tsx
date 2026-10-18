/** [P] "标记为隐私" popover: optional label, risk warning, reject reason. */

import { useEffect, useRef, useState } from "react";
import { type Anchor, FloatingLayer } from "../../../components/FloatingLayer";
import type { PrivacyMarkScope, SecretClassification, SecretEntry } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { isComposing } from "../../../lib/hooks";
import { privacyClassify, privacyMark } from "../../../lib/ipc";
import { defaultMarkScope, needsScopeChoice } from "./composerPrivacy";
import { claimEscape } from "../../../lib/escapeClaim";

const REASON_TEXT: Record<string, string> = {
	TOO_SHORT: "内容太短（至少 3 个字符），无法标记",
	INVALID_VALUE: "内容不能包含换行，且不能超过 4096 个字符",
	SHORT: "比较短",
	COMMON: "比较常见",
	LABEL_CONTAINS_VALUE: "名称里不能包含隐私内容本身",
};

export function MarkSecretPopover({
	sessionId,
	value,
	anchor,
	onMarked,
	onClose,
}: {
	sessionId: string;
	value: string;
	anchor: Anchor;
	onMarked: (entry: SecretEntry, scope: PrivacyMarkScope) => void;
	onClose: () => void;
}) {
	const [cls, setCls] = useState<SecretClassification | null>(null);
	const [label, setLabel] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [track, setTrack] = useState(true);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let cancelled = false;
		privacyClassify(sessionId, value)
			.then((c) => {
				if (!cancelled) setCls(c);
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(errMsg(err));
			});
		return () => {
			cancelled = true;
		};
	}, [sessionId, value]);

	useEffect(() => {
		if (cls && cls.level !== "reject") inputRef.current?.focus();
	}, [cls]);

	const confirm = async (scope: PrivacyMarkScope) => {
		if (saving || !cls || cls.level === "reject") return;
		setSaving(true);
		setError(null);
		try {
			const trimmed = label.trim();
			const entry = await privacyMark(sessionId, value, trimmed ? trimmed : null, track, scope);
			onMarked(entry, scope);
		} catch (err) {
			const msg = errMsg(err);
			setError(REASON_TEXT[msg] ?? msg);
		} finally {
			setSaving(false);
		}
	};

	const sent = cls !== null && needsScopeChoice(cls.sessionOccurrences);
	const shown = value.length > 24 ? `${value.slice(0, 24)}…` : value;
	const btn =
		"rounded-md px-2.5 py-1 text-[12px] transition-colors disabled:opacity-50 hover:bg-[var(--ghost-hover,var(--bg-hover))]";

	return (
		<FloatingLayer
			anchor={anchor}
			placement="top-start"
			offset={6}
			onDismiss={onClose}
			className="w-[300px] rounded-xl border border-[var(--line,var(--border))] bg-[var(--bg-panel)] p-3 text-[12px] text-[var(--text)] shadow-lg"
		>
			<div className="mb-2 font-medium">标记为隐私</div>
			{!cls && !error && <div className="text-[var(--text-40,var(--text-dim))]">检查中…</div>}
			{cls?.level === "reject" && (
				<>
					<div className="mb-2 text-red-500">
						{REASON_TEXT[cls.reason ?? ""] ?? "无法标记这段内容"}
					</div>
					<div className="flex justify-end">
						<button type="button" className={btn} onClick={onClose}>
							关闭
						</button>
					</div>
				</>
			)}
			{cls && cls.level !== "reject" && (
				<>
					<input
						ref={inputRef}
						value={label}
						placeholder="名称（选填），如 数据库密码"
						onChange={(e) => setLabel(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter") {
								e.preventDefault();
								void confirm(defaultMarkScope(cls.sessionOccurrences));
							} else if (e.key === "Escape") {
								claimEscape(e);
								onClose();
							}
						}}
						className="w-full rounded-md border border-[var(--line,var(--border))] bg-transparent px-2 py-1 outline-none"
					/>
					<div className="mt-1 text-[11px] text-[var(--text-40,var(--text-dim))]">
						名称会被 AI 看到，不要填敏感内容
					</div>
					{cls.level === "risky" && (
						<>
							<div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-600">
								⚠ “{shown}” {REASON_TEXT[cls.reason ?? ""] ?? "比较短/常见"}，可能误伤普通文字
							</div>
							<label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-40,var(--text-dim))]">
								<input type="checkbox" checked={!track} onChange={(e) => setTrack(!e.target.checked)} />
								只替换这一处，不追踪
							</label>
						</>
					)}
					{sent && (
						<div className="mt-2 rounded-md bg-red-500/10 px-2 py-1.5 leading-relaxed text-red-500">
							⚠ “{shown}” 已在本会话中出现 {cls.sessionOccurrences} 次，这些内容已经发给上游，标记无法撤回。
							替换旧历史会改变请求前缀，可能使缓存失效、增加费用。如果无法接受，请更换这个密钥，并在新会话中继续。
						</div>
					)}
					{error && <div className="mt-2 text-red-500">{error}</div>}
					<div className="mt-2 flex flex-wrap justify-end gap-1">
						<button type="button" className={btn} onClick={onClose}>
							取消
						</button>
						{sent && (
							<button type="button" className={btn} disabled={saving} onClick={() => void confirm("all")}>
								同时替换旧历史
							</button>
						)}
						<button
							type="button"
							disabled={saving}
							onClick={() => void confirm(sent ? "future" : "all")}
							className="rounded-md bg-[var(--text)] px-2.5 py-1 text-[12px] text-[var(--bg-panel)] disabled:opacity-50"
						>
							{sent ? "仅保护后续内容" : cls.level === "risky" ? "仍然标记" : "标记"}
						</button>
					</div>
				</>
			)}
			{!cls && error && <div className="text-red-500">{error}</div>}
		</FloatingLayer>
	);
}
