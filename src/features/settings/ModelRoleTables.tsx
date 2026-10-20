/**
 * [D] Settings ▸ 模型角色: the single 「角色分配」 table. One collapsed line per
 * role or sub-agent (final model + thinking level); expanding a row shows the two
 * ways to configure it — 1 专属模型, 2 复用角色模型 — and an ⓘ panel with the exact
 * config fields and the priority order.
 *
 * Only the scope in `ctx.scope` is written. Choosing a value saves at once to that
 * single scope; each control shows pending / saved / error beside it, and a failed
 * write leaves the stored value as it was. Complex stored values (candidate lists,
 * `@role:level`, unknown) are shown verbatim and never rewritten unless picked over.
 */
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ModelSelect } from "../../components/ModelSelect";
import { parseSelection } from "../../components/modelSelectLogic";
import { NativeSelect } from "../../components/NativeSelect";
import { errMsg } from "../../lib/dialogs";
import type { ModelOption } from "../../lib/models";
import { toast } from "../../lib/toast";
import {
	agentFallbackRole,
	type AssignmentRow,
	type AssignmentScope,
	type AssignmentTable,
	checkAssignmentValue,
	matchesQuery,
	type PriorityStep,
	resolveRoleValue,
} from "./agentModelAssignments";
import { splitRoleValue } from "./modelRoles";
import { Button, Chip, MODEL_PICKER_BUTTON_CLASS } from "./ui";

/** Shared state and actions for the table (owned by AgentModelAssignmentsPanel). */
export interface AssignmentContext {
	/** The one scope shown and written by every control. */
	scope: AssignmentScope;
	/** Model catalog for the pickers; null while it is still loading. */
	models: ModelOption[] | null;
	/** Display name of the configured project (empty when none). */
	projectName: string;
	/** A session is selected (its model is the last priority level). */
	sessionSelected: boolean;
	/** Config file paths shown in the ⓘ panel. */
	globalPath: string;
	projectPath: string | null;
	/** A backend write is queued or running; every control is locked. */
	busy: boolean;
	write: (scope: AssignmentScope, table: AssignmentTable, name: string, value: string | null) => Promise<void>;
	/** Role map for the shown scope (global, or project merged over global). */
	roles: Record<string, string>;
}

const THINKING_ZH: Record<string, string> = {
	off: "off",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
	auto: "auto",
};

const isLiteral = (v: string | null): boolean => v !== null && !v.startsWith("@");

function scopeLabelOf(ctx: AssignmentContext): string {
	return ctx.scope === "global" ? "全局" : ctx.projectName || "项目";
}

type SaveState = { status: "idle" } | { status: "pending" } | { status: "saved"; text: string } | { status: "error"; text: string };

function StatusLine({ state }: { state: SaveState }) {
	if (state.status === "pending") {
		return (
			<span role="status" className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
				<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
				保存中
			</span>
		);
	}
	if (state.status === "saved") {
		return (
			<span role="status" className="flex items-center gap-1 text-[11px] text-[var(--status-success)]">
				<Check className="h-3 w-3" aria-hidden />
				{state.text}
			</span>
		);
	}
	if (state.status === "error") {
		return (
			<span role="alert" className="break-all text-[11px] text-[var(--status-error)]">
				{state.text}
			</span>
		);
	}
	return null;
}

/** Pending / saved / error feedback for one control; `run` performs one write in ctx.scope. */
function useSave(ctx: AssignmentContext, table: AssignmentTable, name: string) {
	const [state, setState] = useState<SaveState>({ status: "idle" });
	const mounted = useRef(true);
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			window.clearTimeout(timer.current);
		};
	}, []);
	const locked = ctx.busy || state.status === "pending";
	const scopeLabel = scopeLabelOf(ctx);

	const run = async (value: string | null, doneText: string) => {
		setState({ status: "pending" });
		window.clearTimeout(timer.current);
		try {
			await ctx.write(ctx.scope, table, name, value);
			if (!mounted.current) return;
			setState({ status: "saved", text: doneText });
			timer.current = window.setTimeout(() => {
				if (mounted.current) setState({ status: "idle" });
			}, 2400);
		} catch (e) {
			const msg = errMsg(e);
			toast.error(`保存「${name}」失败：${msg}`);
			if (mounted.current) setState({ status: "error", text: `保存失败，已保留原值：${msg}` });
		}
	};
	return { state, locked, run, scopeLabel };
}

/** One of the two ways to set a row; the one in use is tinted and tagged, the other stays muted. */
function Step({ win, label, children }: { win: boolean; label: string; children: ReactNode }) {
	return (
		<div
			data-in-use={win ? "true" : undefined}
			className={`flex flex-wrap items-center gap-2.5 rounded-lg px-3 py-2 ${
				win ? "bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)]" : "bg-[var(--well-bg)]/50"
			}`}
		>
			<span className={`w-24 shrink-0 text-xs font-medium ${win ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>{label}</span>
			{children}
			{win && <Chip tone="success">正在使用</Chip>}
		</div>
	);
}

interface RoleChoice {
	name: string;
	model: string | null;
}

function InfoPanel({ row, ctx }: { row: AssignmentRow; ctx: AssignmentContext }) {
	const code = (text: string) => <code className="rounded bg-[var(--well-bg)] px-1 font-mono text-[11px]">{text}</code>;
	const where = (path: string | null, layer: "global" | "project") =>
		`${layer === "global" ? "全局" : "项目"}配置${path ? `：${path}` : ""}`;

	if (row.kind === "role") {
		const roleField = `modelRoles.${row.name}`;
		const layers: { layer: "global" | "project"; value: string | null; path: string | null }[] = [
			{ layer: "global", value: row.globalValue, path: ctx.globalPath },
		];
		if (ctx.scope === "project") layers.push({ layer: "project", value: row.projectValue, path: ctx.projectPath });
		return (
			<div className="mt-2 space-y-1.5 rounded-lg hairline bg-[var(--well-bg)] p-3 text-xs text-[var(--text)]">
				<div className="font-medium">读写字段：{code(roleField)}</div>
				{layers.map((l) => (
					<div key={l.layer} className="text-[var(--text-muted)]">
						{where(l.path, l.layer)}　当前值：
						{l.value ? code(l.value) : <span className="text-[var(--text-dim)]">未设置</span>}
					</div>
				))}
				<div className="text-[var(--text-dim)]">
					「专属模型」和「复用角色模型」都写这个字段，二选一：选模型写入模型名，选角色写入 {code("@角色名")}。
					{row.name === "task" && "没有专属设置也没有定义里 model: 的子代理，会使用这里的模型（优先级第 3 层）。"}
				</div>
			</div>
		);
	}

	const stepWhere = (s: PriorityStep): string => {
		if (s.level === 1 || s.level === 3) {
			if (s.layer) return where(s.layer === "global" ? ctx.globalPath : ctx.projectPath, s.layer);
			return s.level === 1
				? `${where(ctx.globalPath, "global")}${ctx.scope === "project" ? ` / ${where(ctx.projectPath, "project")}` : ""}`
				: where(ctx.globalPath, "global");
		}
		if (s.level === 2) return row.agentSource === "builtin" ? "OMP 出厂定义，页面不修改" : "代理定义文件，页面不修改";
		return "不需要配置";
	};
	const stepValue = (s: PriorityStep): ReactNode => {
		if (s.error) {
			return (
				<span className="text-[var(--status-error)]">
					{s.value}（{s.error}）
				</span>
			);
		}
		if (s.value === null) return s.level === 4 && !ctx.sessionSelected ? "未选择会话" : "未设置";
		if (s.value.startsWith("@")) return s.model ? `${s.value} → ${s.model}` : s.value;
		return s.value;
	};
	return (
		<div className="mt-2 space-y-1.5 rounded-lg hairline bg-[var(--well-bg)] p-3 text-xs text-[var(--text)]">
			<div className="font-medium">{row.name} 用哪个模型：从上往下找，第一个有值的生效</div>
			<ol className="list-decimal space-y-1 pl-5 text-[var(--text-muted)]">
				{row.steps.map((s) => (
					<li key={s.level} className={row.effective.level === s.level ? "text-[var(--text)]" : ""}>
						{code(s.field)} = {stepValue(s)} <span className="text-[var(--text-dim)]">（{stepWhere(s)}）</span>
						{s.level === 1 && row.projectShadowed && (
							<div className="text-[var(--status-warning)]">
								项目值 {code(row.projectOverride ?? "")} 不生效：全局已设置，全局优先（{where(ctx.projectPath, "project")}）
							</div>
						)}
						{row.effective.level === s.level && <span className="ml-2 font-semibold text-[var(--status-success)]">✓ 正在使用</span>}
					</li>
				))}
			</ol>
			<div className="text-[var(--text-dim)]">
				本页只写第 1 层 {code(`task.agentModelOverrides.${row.name}`)}：「专属模型」写入模型名，「复用角色模型」写入{" "}
				{code("@角色名")}；选回默认项会删除这一项，交给下面几层。
			</div>
		</div>
	);
}

/** The two numbered steps of one expanded row plus the ⓘ toggle. */
function RowEditor({
	row,
	ctx,
	choices,
	infoOpen,
	onInfo,
}: {
	row: AssignmentRow;
	ctx: AssignmentContext;
	choices: RoleChoice[];
	infoOpen: boolean;
	onInfo: () => void;
}) {
	const isAgent = row.kind === "agent";
	const table: AssignmentTable = isAgent ? "agentModelOverrides" : "modelRoles";
	const project = ctx.scope === "project";
	const committed = isAgent ? (project ? row.projectOverride : row.globalOverride) : project ? row.projectValue : row.globalValue;
	const shown = isAgent ? (row.steps[0]?.value ?? null) : project ? (row.projectValue ?? row.globalValue) : row.globalValue;
	const pinned = isLiteral(shown);
	const fallback = isAgent ? agentFallbackRole(row) : "";
	// Neither way is "in use" while nothing is set: an unset row must not look like it picked a role.
	const mode: "pinned" | "reuse" | "none" = pinned
		? "pinned"
		: shown !== null
			? "reuse"
			: isAgent && row.effective.level !== 4 && row.effective.model
				? "reuse"
				: "none";

	const literal = useSave(ctx, table, row.name);
	const reuse = useSave(ctx, table, row.name);

	const pickModel = (raw: string) => {
		if (literal.locked || !raw.trim()) return;
		const check = checkAssignmentValue(raw);
		if (!check.ok) {
			toast.error(check.error);
			return;
		}
		if (check.value === committed) return;
		void literal.run(check.value, `已保存（${literal.scopeLabel}）`);
	};

	const pickRole = (v: string) => {
		if (reuse.locked) return;
		const next = v === fallback ? null : v;
		if (next === committed) return;
		void reuse.run(next, next === null ? "已恢复默认" : `已保存（${reuse.scopeLabel}）`);
	};

	const roleChoices = choices.filter((c) => c.name !== row.name || isAgent);
	const reuseValue = pinned ? "" : shown !== null && shown.startsWith("@") ? shown : fallback;
	const known = new Set(roleChoices.map((c) => `@${c.name}`));
	const verbatim = !pinned && shown !== null && shown.startsWith("@") && !known.has(shown);
	const tagOf = (v: string): string => {
		if (!isAgent || v !== fallback) return "";
		if (row.agentSource === "builtin" && row.declared === v) return "（出厂设置）";
		if (row.declared === v) return "（定义中设置）";
		return v === "@task" ? "（未设置时默认使用）" : "";
	};
	const noneLabel = ctx.scope === "project" && !isAgent ? "无（继承全局）" : "无";
	const scopeLabel = scopeLabelOf(ctx);
	const subject = isAgent ? `代理 ${row.name}` : `角色 ${row.name}`;

	return (
		<div className="space-y-1.5">
			<Step win={mode === "pinned"} label="专属模型">
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
					<ModelSelect
						roles={ctx.roles}
						disabled={literal.locked}
						closeOnSelect
						direction="down"
						align="start"
						widthClass="w-[360px]"
						label={pinned ? parseSelection(shown ?? "").selector : "选择模型"}
						buttonClass={`${MODEL_PICKER_BUTTON_CLASS} ${pinned ? "" : "italic text-[var(--text-muted)]"}`}
						models={ctx.models}
						currentValue={pinned ? (shown ?? "") : ""}
						thinking
						allowCustom
						onSelect={pickModel}
					/>
					{isLiteral(committed) && (
						<Button
							variant="ghost"
							size="sm"
							disabled={literal.locked}
							onClick={() => void literal.run(null, "已清除")}
							aria-label={`清除专属模型：${subject}（${scopeLabel}）`}
						>
							清除
						</Button>
					)}
					<StatusLine state={literal.state} />
				</div>
			</Step>
			<Step win={mode === "reuse"} label="复用角色模型">
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
					<NativeSelect
						aria-label={`复用角色模型：${subject}（${scopeLabel}）`}
						value={reuseValue}
						disabled={reuse.locked}
						onChange={(e) => pickRole(e.target.value)}
						className="text-[11px]"
						containerClassName="w-[340px] max-w-full"
					>
						{(!isAgent || pinned) && <option value="">{noneLabel}</option>}
						{roleChoices.map((c) => {
							const v = `@${c.name}`;
							return (
								<option key={c.name} value={v}>
									{v}
									{tagOf(v)} → {c.model ?? "未设置"}
								</option>
							);
						})}
						{verbatim && shown !== null && (
							<option value={shown}>
								{shown}
								{row.effective.model ? ` → ${row.effective.model}` : ""}
							</option>
						)}
					</NativeSelect>
					<StatusLine state={reuse.state} />
				</div>
				<button
					type="button"
					onClick={onInfo}
					aria-expanded={infoOpen}
					aria-label={`查看读写的字段和优先级：${subject}`}
					title="查看读写的字段和优先级"
					className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border font-serif text-[11px] font-semibold ${
						infoOpen
							? "border-[var(--text)] bg-[var(--text)] text-[var(--bg-panel)]"
							: "border-[var(--border-divider)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
					}`}
				>
					i
				</button>
			</Step>
			{infoOpen && <InfoPanel row={row} ctx={ctx} />}
		</div>
	);
}

/** Collapsed line: final model (or follow-session hint), `@via`, inherited badge, thinking level. */
function Summary({ row, ctx }: { row: AssignmentRow; ctx: AssignmentContext }) {
	const e = row.effective;
	let final: ReactNode;
	if (e.error) {
		final = <span className="text-[var(--status-error)]">{e.error}</span>;
	} else if (e.level === 4) {
		final = (
			<span className="text-[var(--text-dim)]">
				{e.model ? `跟随当前会话 → ${e.model}` : ctx.sessionSelected ? "跟随当前会话（会话未设置模型）" : "跟随当前会话（未选择会话）"}
			</span>
		);
	} else if (e.model) {
		final = (
			<>
				{row.thinking ? splitRoleValue(e.model).selector : e.model}
				{e.via && <small className="ml-1.5 text-[var(--text-dim)]">{e.via}</small>}
			</>
		);
	} else {
		final = <span className="text-[var(--text-dim)]">未设置</span>;
	}
	return (
		<>
			<span className="min-w-0 w-72 max-w-full shrink break-all font-mono text-[12px] text-[var(--text)]">{final}</span>
			<span className="w-12 shrink-0 text-[11px] text-[var(--text-dim)]" title={row.thinking ?? undefined}>
				{row.thinking ? (THINKING_ZH[row.thinking] ?? row.thinking) : ""}
			</span>
			{row.kind === "agent" && row.projectShadowed && (
				<span className="shrink-0 text-[11px] text-[var(--status-warning)]" title="全局点名优先于项目点名">
					全局点名覆盖了项目点名
				</span>
			)}
			{ctx.scope === "project" && e.inherited && (
				<Chip>继承全局</Chip>
			)}
		</>
	);
}

/** One 「角色分配」 table: roles and sub-agents in one list, filtered by `query`. */
export function RoleAssignmentTable({ rows, query, ctx }: { rows: AssignmentRow[]; query: string; ctx: AssignmentContext }) {
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const [infoOpen, setInfoOpen] = useState<ReadonlySet<string>>(new Set());
	const toggle = (set: ReadonlySet<string>, key: string): Set<string> => {
		const next = new Set(set);
		if (!next.delete(key)) next.add(key);
		return next;
	};

	const choices = useMemo<RoleChoice[]>(
		() =>
			rows
				.filter((r) => r.kind === "role")
				.map((r) => {
					const res = resolveRoleValue(r.name, [ctx.roles]);
					return { name: r.name, model: res.status === "model" ? res.selector : null };
				}),
		[rows, ctx.roles],
	);

	const visible = rows.filter((r) =>
		matchesQuery(query, [
			r.name,
			r.label,
			r.globalValue,
			r.projectValue,
			r.declared,
			r.globalOverride,
			r.projectOverride,
			r.effective.model,
		]),
	);
	if (visible.length === 0) {
		return <p className="px-4 py-6 text-center text-xs text-[var(--text-dim)]">没有与「{query}」匹配的角色或代理。</p>;
	}

	return (
		// Rows only: the card, its divider and its clipping belong to the panel.
		<div data-testid="role-table" data-scope={ctx.scope}>
			{visible.map((r, i) => {
				const key = `${r.kind}:${r.name}`;
				const isOpen = open.has(key);
				const gap = i > 0 && visible[i - 1].group !== r.group;
				return (
					<div key={key} data-row-kind={r.kind} data-row-name={r.name}>
						<div
							role="button"
							tabIndex={0}
							aria-expanded={isOpen}
							onClick={() => setOpen((s) => toggle(s, key))}
							onKeyDown={(e) => {
								if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
									e.preventDefault();
									setOpen((s) => toggle(s, key));
								}
							}}
							className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] ${
								i === 0 ? "" : gap ? "border-t-[6px] border-[var(--well-bg)]" : "border-t border-[var(--border-divider)]"
							}`}
						>
							{isOpen ? (
								<ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-dim)]" />
							) : (
								<ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-dim)]" />
							)}
							<span className="w-40 shrink-0">
								<span className="block truncate font-mono text-[12px] font-semibold text-[var(--text)]">{r.name}</span>
								{r.label && isOpen && <span className="block truncate text-[11px] text-[var(--text-dim)]">{r.label}</span>}
							</span>
							<Summary row={r} ctx={ctx} />
						</div>
						{isOpen && (
							<div className="bg-[var(--well-bg)]/40 py-1 pl-10 pr-4 pb-3.5">
								<RowEditor
									row={r}
									ctx={ctx}
									choices={choices}
									infoOpen={infoOpen.has(key)}
									onInfo={() => setInfoOpen((s) => toggle(s, key))}
								/>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
