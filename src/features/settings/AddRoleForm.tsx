/**
 * [D] Settings ▸ 模型角色: inline 「添加角色」 form. Creates one custom `modelRoles` entry
 * (name → model) in the scope the page is showing; built-in and already listed roles are
 * edited in the table instead, so their names are refused here.
 */
import { useState } from "react";
import { useT } from "../../stores/language";
import { richT } from "./modelRoleScope";
import { isComposing } from "../../lib/hooks";
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
	const { t } = useT();
	const [name, setName] = useState("");
	const [value, setValue] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const locked = pending || ctx.busy;
	const target = ctx.scope === "global" ? t("settingsModels.targetGlobalConfig") : t("settingsModels.targetProjectConfig", { name: ctx.projectName || t("settingsModels.scopeProject") });

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
			setError(t("settingsModels.roleAlreadyExistsError", { name: checked.name }));
			return;
		}
		if (value === null) {
			setError(t("settingsModels.selectModelFirstError"));
			return;
		}
		setPending(true);
		setError(null);
		try {
			await ctx.write(ctx.scope, "modelRoles", checked.name, value);
			onAdded(checked.name);
		} catch (e) {
			setError(t("settingsModels.addRoleFailedError", { error: errMsg(e) }));
		} finally {
			setPending(false);
		}
	};

	return (
		<div data-testid="add-role-form" className="space-y-2 border-b border-[var(--border-divider)] bg-[var(--well-bg)]/40 px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<input
					aria-label={t("settingsModels.roleNameAria")}
					value={name}
					autoFocus
					spellCheck={false}
					disabled={locked}
					placeholder={t("settingsModels.roleNamePlaceholder")}
					onChange={(e) => {
						setName(e.target.value);
						setError(null);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !isComposing(e)) {
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
					label={value === null ? t("settingsModels.selectModelBtn") : parseSelection(value).selector}
					buttonClass={`${MODEL_PICKER_BUTTON_CLASS} ${value === null ? "italic text-[var(--text-muted)]" : ""}`}
					models={ctx.models}
					currentValue={value ?? ""}
					thinking
					allowCustom
					onSelect={pickModel}
				/>
				<Button variant="primary" size="sm" loading={pending} disabled={locked} onClick={() => void submit()}>
					{t("settingsModels.addRoleSubmitBtn")}
				</Button>
				<Button size="sm" disabled={pending} onClick={onCancel}>
					{t("common.cancel")}
				</Button>
			</div>
			<p className="text-[11px] text-[var(--text-muted)]">
				{richT(t, "settingsModels.addRoleExplainer1", {
					role: <code className="font-mono">{t("settingsModels.roleRefExample")}</code>,
					model: <code className="font-mono">model: "{t("settingsModels.roleRefExample")}"</code>,
				})}
			</p>
			<p className="text-[11px] text-[var(--text-dim)]">
				{t("settingsModels.addRoleExplainer2", { target })}
			</p>
			{error && (
				<p role="alert" className="select-text break-all text-[11px] text-[var(--status-error)]">
					{error}
				</p>
			)}
		</div>
	);
}
