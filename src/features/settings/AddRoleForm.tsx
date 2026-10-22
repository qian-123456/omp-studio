/**
 * [D] Settings ▸ 模型角色: inline 「添加角色」 form. Creates one custom `modelRoles` entry
 * (name → model) in the scope the page is showing; built-in and already listed roles are
 * edited in the table instead, so their names are refused here.
 */
import { useState } from "react";
import { ModelSelect } from "../../components/ModelSelect";
import { parseSelection } from "../../components/modelSelectLogic";
import { errMsg } from "../../lib/dialogs";
import { checkAssignmentValue, checkName } from "./agentModelAssignments";
import type { AssignmentContext } from "./ModelRoleTables";
import { Button, MODEL_PICKER_BUTTON_CLASS } from "./ui";

export function AddRoleForm({
	ctx,
	existing,
	onAdded,
	onCancel,
}: {
	ctx: AssignmentContext;
	/** Role names already shown in the table (built-in and custom, either layer). */
	existing: ReadonlySet<string>;
	onAdded: (name: string) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState("");
	const [value, setValue] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const locked = pending || ctx.busy;
	const target = ctx.scope === "global" ? "全局配置" : `项目「${ctx.projectName || "项目"}」的配置`;

	const pickModel = (raw: string) => {
		const check = checkAssignmentValue(raw);
		if (!check.ok) {
			setError(check.error);
			return;
		}
		setError(null);
		setValue(check.value);
	};

	const submit = async () => {
		if (locked) return;
		const checked = checkName(name);
		if (!checked.ok) {
			setError(checked.error);
			return;
		}
		if (existing.has(checked.name)) {
			setError(`已有角色「${checked.name}」，请在下方列表里直接修改它`);
			return;
		}
		if (value === null) {
			setError("请先为新角色选择一个模型");
			return;
		}
		setPending(true);
		setError(null);
		try {
			await ctx.write(ctx.scope, "modelRoles", checked.name, value);
			onAdded(checked.name);
		} catch (e) {
			setError(`添加失败：${errMsg(e)}`);
		} finally {
			setPending(false);
		}
	};

	return (
		<div data-testid="add-role-form" className="space-y-2 border-b border-[var(--border-divider)] bg-[var(--well-bg)]/40 px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<input
					aria-label="新角色名称"
					value={name}
					autoFocus
					spellCheck={false}
					disabled={locked}
					placeholder="角色名，如 reviewer"
					onChange={(e) => {
						setName(e.target.value);
						setError(null);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							void submit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							e.stopPropagation();
							onCancel();
						}
					}}
					className="w-48 rounded-lg hairline bg-[var(--bg-panel)] px-2.5 py-1.5 font-mono text-xs text-[var(--text)] placeholder:text-[var(--text-dim)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)] focus:outline-none transition-all"
				/>
				<ModelSelect
					roles={ctx.roles}
					disabled={locked}
					closeOnSelect
					direction="down"
					align="start"
					widthClass="w-[360px]"
					label={value === null ? "选择模型" : parseSelection(value).selector}
					buttonClass={`${MODEL_PICKER_BUTTON_CLASS} ${value === null ? "italic text-[var(--text-muted)]" : ""}`}
					models={ctx.models}
					currentValue={value ?? ""}
					thinking
					allowCustom
					onSelect={pickModel}
				/>
				<Button variant="primary" size="sm" loading={pending} disabled={locked} onClick={() => void submit()}>
					添加
				</Button>
				<Button size="sm" disabled={pending} onClick={onCancel}>
					取消
				</Button>
			</div>
			<p className="text-[11px] text-[var(--text-muted)]">
				新角色不会自己被调用，只有被 <code className="font-mono">@角色名</code> 引用时才会用到：比如在下方子代理的「复用角色模型」里选它、让别的角色复用它、在子代理定义文件里写{" "}
				<code className="font-mono">model: "@角色名"</code>，或在「备用模型与重试」页把它加入模型切换轮换。添加后，列表里这一行会显示有没有被引用。
			</p>
			<p className="text-[11px] text-[var(--text-dim)]">
				将写入{target}。名称只允许字母、数字与 - _ .，添加后可在下方列表里继续修改或清除。
			</p>
			{error && (
				<p role="alert" className="select-text break-all text-[11px] text-[var(--status-error)]">
					{error}
				</p>
			)}
		</div>
	);
}
