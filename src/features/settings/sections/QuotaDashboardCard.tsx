/**
 * Settings ▸ 订阅与 Quota (`quota`): subscriptions (OAuth accounts + API-key
 * providers), local token usage per quota window, reset countdowns and rate
 * limits. Limits are user-entered (providers expose no quota API); usage is
 * summed from real session transcripts via `session_usage`.
 */
import { Gauge, RefreshCw, Timer, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OauthLoginProvider } from "../../../lib/contracts";
import { oauthLoginProviders, sessionUsage } from "../../../lib/ipc";
import { useSessions } from "../../../stores/sessions";
import { formatTokens } from "../../providers/modelEntry";
import { useProviders } from "../../providers/store";
import type { ModelFamily } from "../modelContextTypes";
import { normalizeModelName, parseContextInput } from "../modelNormalization";
import { INPUT_CLASS, SETTINGS_BUTTON_CLASS, SectionHeader, SettingsCard } from "../ui";

type QuotaWindow = "5h" | "day" | "week" | "month";

interface QuotaConfig {
	limitTokens: number | null;
	window: QuotaWindow;
	rpm: number | null;
}

interface Subscription {
	key: string;
	name: string;
	kind: "账号订阅" | "API 密钥";
	/** Model family billed to this subscription; null = any model. */
	family: ModelFamily | null;
}

const QUOTA_STORAGE_KEY = "ompws:quota-config";
const WINDOW_LABELS: Record<QuotaWindow, string> = { "5h": "滚动 5 小时", day: "每日", week: "每周", month: "每月" };
const HOUR = 3_600_000;

function loadQuotaConfig(): Record<string, QuotaConfig> {
	try {
		const raw = globalThis.localStorage?.getItem(QUOTA_STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : {};
		return typeof parsed === "object" && parsed ? parsed : {};
	} catch {
		return {};
	}
}

function familyOfSubscription(idAndName: string): ModelFamily | null {
	const s = idAndName.toLowerCase();
	if (/copilot|openrouter/.test(s)) return null;
	if (/anthropic|claude/.test(s)) return "Claude";
	if (/openai|codex|chatgpt|gpt/.test(s)) return "GPT";
	if (/google|gemini|antigravity/.test(s)) return "Gemini";
	if (/deepseek/.test(s)) return "DeepSeek";
	if (/qwen|dashscope|aliyun/.test(s)) return "Qwen";
	return null;
}

/** Start of the current quota window and the moment it resets. */
function windowBounds(window: QuotaWindow, now: Date, oldestInWindow: number | null): { start: number; reset: number } {
	if (window === "5h") {
		const start = now.getTime() - 5 * HOUR;
		return { start, reset: (oldestInWindow ?? now.getTime()) + 5 * HOUR };
	}
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const reset = new Date(start);
	if (window === "day") reset.setDate(reset.getDate() + 1);
	if (window === "week") {
		start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
		reset.setTime(start.getTime());
		reset.setDate(reset.getDate() + 7);
	}
	if (window === "month") {
		start.setDate(1);
		reset.setTime(start.getTime());
		reset.setMonth(reset.getMonth() + 1);
	}
	return { start: start.getTime(), reset: reset.getTime() };
}

function formatCountdown(ms: number): string {
	if (ms <= 0) return "即将重置";
	const h = Math.floor(ms / HOUR);
	const m = Math.floor((ms % HOUR) / 60_000);
	return h >= 24 ? `${Math.floor(h / 24)} 天 ${h % 24} 小时后重置` : `${h} 小时 ${m} 分后重置`;
}

export function QuotaDashboardCard() {
	const providers = useProviders((s) => s.providers);
	const loaded = useProviders((s) => s.loaded);
	const load = useProviders((s) => s.load);
	const sessions = useSessions((s) => s.sessions);
	const [oauth, setOauth] = useState<OauthLoginProvider[] | null>(null);
	const [config, setConfig] = useState<Record<string, QuotaConfig>>(loadQuotaConfig);
	const [usage, setUsage] = useState<Record<string, number>>({});
	const [editing, setEditing] = useState<string | null>(null);
	const [now, setNow] = useState(() => new Date());

	useEffect(() => {
		if (!loaded) void load();
	}, [loaded, load]);

	const refresh = useCallback(async () => {
		setNow(new Date());
		try {
			setOauth(await oauthLoginProviders());
		} catch {
			setOauth([]);
		}
	}, []);

	useEffect(() => {
		void refresh();
		const t = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(t);
	}, [refresh]);

	// Sessions touched in the last 31 days cover every window.
	const recent = useMemo(() => {
		const cutoff = now.getTime() - 31 * 24 * HOUR;
		return Object.values(sessions)
			.filter((s) => Date.parse(s.updatedAt) >= cutoff)
			.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
			.slice(0, 200);
	}, [sessions, now]);

	useEffect(() => {
		let cancelled = false;
		void Promise.all(
			recent.map(async (s) => {
				try {
					const u = await sessionUsage(s.id);
					return [s.id, u.available ? u.tokens : 0] as const;
				} catch {
					return [s.id, 0] as const;
				}
			}),
		).then((pairs) => {
			if (!cancelled) setUsage(Object.fromEntries(pairs));
		});
		return () => {
			cancelled = true;
		};
	}, [recent]);

	const subscriptions = useMemo<Subscription[]>(() => {
		const subs: Subscription[] = (oauth ?? [])
			.filter((p) => p.authenticated)
			.map((p) => ({
				key: `oauth:${p.id}`,
				name: p.name,
				kind: "账号订阅",
				family: familyOfSubscription(`${p.id} ${p.name}`),
			}));
		for (const p of providers) {
			if (!p.enabled || !p.hasKey) continue;
			subs.push({
				key: `provider:${p.id}`,
				name: p.name,
				kind: "API 密钥",
				family: familyOfSubscription(`${p.presetId ?? ""} ${p.slug} ${p.name}`),
			});
		}
		return subs;
	}, [oauth, providers]);

	const updateConfig = (key: string, next: QuotaConfig) => {
		const merged = { ...config, [key]: next };
		setConfig(merged);
		globalThis.localStorage?.setItem(QUOTA_STORAGE_KEY, JSON.stringify(merged));
	};

	return (
		<SettingsCard fieldId="quotaDashboard">
			<div className="space-y-3 p-4">
				<SectionHeader
					title={
						<span className="flex items-center gap-1.5">
							<Gauge className="h-4 w-4 text-[var(--accent)]" /> 订阅与 Quota
						</span>
					}
					description="已登录的账号订阅与已配置密钥的供应商。用量按本机会话记录统计；额度、周期与速率限制按套餐自行填写。"
					actions={
						<button type="button" className={SETTINGS_BUTTON_CLASS} onClick={() => void refresh()}>
							<RefreshCw className="h-3.5 w-3.5" /> 刷新
						</button>
					}
				/>
				{oauth === null ? (
					<div className="py-4 text-center text-xs text-neutral-500">加载订阅中…</div>
				) : subscriptions.length === 0 ? (
					<div className="py-4 text-center text-xs text-neutral-500">
						暂无已登录的订阅或已配置密钥的供应商，可在「API 供应商」中登录账号或添加密钥。
					</div>
				) : (
					<div className="grid gap-3 sm:grid-cols-2">
						{subscriptions.map((sub) => {
							const cfg = config[sub.key] ?? { limitTokens: null, window: "5h", rpm: null };
							const counted = recent.filter(
								(s) => sub.family == null || (s.model != null && normalizeModelName(s.model).family === sub.family),
							);
							const fiveHourStart = now.getTime() - 5 * HOUR;
							const oldest =
								cfg.window === "5h"
									? Math.min(...counted.map((s) => Date.parse(s.updatedAt)).filter((t) => t >= fiveHourStart))
									: null;
							const { start, reset } = windowBounds(cfg.window, now, Number.isFinite(oldest) ? oldest : null);
							const used = counted
								.filter((s) => Date.parse(s.updatedAt) >= start)
								.reduce((sum, s) => sum + (usage[s.id] ?? 0), 0);
							const pct = cfg.limitTokens ? Math.min(100, (used / cfg.limitTokens) * 100) : null;
							return (
								<div key={sub.key} className="rounded-lg hairline bg-neutral-900/50 p-3 text-xs">
									<div className="flex items-center gap-2">
										<span className="truncate font-medium text-neutral-100">{sub.name}</span>
										<span className="rounded bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-400">
											{sub.kind}
										</span>
										<span className="ml-auto text-[10px] text-neutral-500">{sub.family ?? "全部模型"}</span>
									</div>
									<div className="mt-2 flex items-baseline justify-between font-mono">
										<span className="text-neutral-200">{formatTokens(used)}</span>
										<span className="text-neutral-500">
											/ {cfg.limitTokens ? formatTokens(cfg.limitTokens) : "未设额度"} · {WINDOW_LABELS[cfg.window]}
										</span>
									</div>
									<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-800">
										<div
											className={
												pct == null
													? "h-full bg-neutral-600"
													: pct >= 90
														? "h-full bg-red-500"
														: pct >= 70
															? "h-full bg-amber-400"
															: "h-full bg-emerald-500"
											}
											style={{ width: `${pct ?? 0}%` }}
										/>
									</div>
									<div className="mt-2 flex items-center gap-3 text-[11px] text-neutral-400">
										<span className="flex items-center gap-1">
											<Timer className="h-3 w-3" />
											{formatCountdown(reset - now.getTime())}
										</span>
										<span className="flex items-center gap-1">
											<Zap className="h-3 w-3" />
											{cfg.rpm ? `${cfg.rpm} 次/分钟` : "速率未设置"}
										</span>
										<button
											type="button"
											className="ml-auto text-[var(--accent)] hover:underline"
											onClick={() => setEditing(editing === sub.key ? null : sub.key)}
										>
											{editing === sub.key ? "收起" : "设置额度"}
										</button>
									</div>
									{editing === sub.key && (
										<QuotaEditor value={cfg} onChange={(next) => updateConfig(sub.key, next)} />
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</SettingsCard>
	);
}

function QuotaEditor({ value, onChange }: { value: QuotaConfig; onChange(next: QuotaConfig): void }) {
	const [limit, setLimit] = useState(value.limitTokens ? formatTokens(value.limitTokens) : "");
	const [rpm, setRpm] = useState(value.rpm ? String(value.rpm) : "");
	return (
		<div className="mt-2 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-2">
			<input
				className={`${INPUT_CLASS} w-24`}
				placeholder="额度 如 200k"
				aria-label="Token 额度"
				value={limit}
				onChange={(e) => setLimit(e.target.value)}
				onBlur={() => {
					const parsed = limit.trim() ? parseContextInput(limit) : null;
					onChange({ ...value, limitTokens: parsed });
					setLimit(parsed ? formatTokens(parsed) : "");
				}}
			/>
			<select
				className={`${INPUT_CLASS} w-28`}
				aria-label="重置周期"
				value={value.window}
				onChange={(e) => onChange({ ...value, window: e.target.value as QuotaWindow })}
			>
				{(Object.keys(WINDOW_LABELS) as QuotaWindow[]).map((w) => (
					<option key={w} value={w}>
						{WINDOW_LABELS[w]}
					</option>
				))}
			</select>
			<input
				className={`${INPUT_CLASS} w-24`}
				placeholder="次/分钟"
				aria-label="速率限制"
				inputMode="numeric"
				value={rpm}
				onChange={(e) => setRpm(e.target.value)}
				onBlur={() => {
					const n = Number.parseInt(rpm, 10);
					const next = Number.isFinite(n) && n > 0 ? n : null;
					onChange({ ...value, rpm: next });
					setRpm(next ? String(next) : "");
				}}
			/>
		</div>
	);
}
