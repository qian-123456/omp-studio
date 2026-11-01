import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { ModelMenuContent } from "../../components/ModelSelect";
import { composeSelection, parseSelection } from "../../components/modelSelectLogic";
import { ThinkingLevelPicker } from "../../components/ThinkingLevelPicker";
import type { ModelOption } from "../../lib/models";
import { resolveThinkingLevels } from "../../lib/models";
import { useT } from "../../stores/language";
import { isLLMModelKind, modelRoleCompatibility, modelSupportsRole, type ServiceModelRole, useModelKindCatalog, useServiceModelConfiguration } from "../../stores/modelKinds";
import { useUi } from "../../stores/ui";
import { Button, MODEL_PICKER_BUTTON_CLASS } from "./ui";

/** Service roles use only real all-kind catalog entries, never the chat directory or guessed IDs. */
export function ServiceRoleModelSelect({
	role,
	scope,
	projectCwd,
	currentValue,
	effectiveValue,
	disabled,
	onSelect,
}: {
	role: ServiceModelRole;
	scope: "global" | "project";
	projectCwd: string | null;
	currentValue: string;
	effectiveValue?: string | null;
	disabled: boolean;
	onSelect: (value: string) => void;
}) {
	const { t } = useT();
	const entries = useModelKindCatalog((s) => s.entries);
	const loading = useModelKindCatalog((s) => s.loading);
	const error = useModelKindCatalog((s) => s.error);
	const load = useModelKindCatalog((s) => s.load);
	const [open, setOpen] = useState(false);
	const [levelOpen, setLevelOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const current = parseSelection(currentValue);
	const selected = entries?.find((entry) => entry.selector === current.selector);
	const effective = parseSelection(effectiveValue ?? currentValue);
	const effectiveEntry = entries?.find((entry) => entry.selector === effective.selector);
	const candidates = useMemo(() => (entries ?? []).filter((entry) => modelSupportsRole(entry, role)), [entries, role]);
	// The menu is presentation-only: selectors remain exactly those returned by the all-kind catalog.
	const models = useMemo<ModelOption[]>(() => candidates.map((entry) => ({
		provider: entry.provider,
		id: entry.selector.slice(entry.provider.length + 1),
		name: entry.name ?? entry.selector,
	})), [candidates]);
	const supportsThinking = selected !== undefined && modelSupportsRole(selected, role) && isLLMModelKind(selected.kind) && selected.thinking.length > 0;
	const levels = supportsThinking ? resolveThinkingLevels(undefined, selected.thinking, current.level) : [];
	const label = current.selector || t("settingsModels.selectModelBtn");

	useEffect(() => {
		if (open) void load();
	}, [open, load]);
	useEffect(() => {
		if (disabled) {
			setOpen(false);
			setLevelOpen(false);
		}
	}, [disabled]);

	const select = (selector: string) => {
		if (disabled || !candidates.some((entry) => entry.selector === selector)) return;
		const next = candidates.find((entry) => entry.selector === selector)!;
		const level = isLLMModelKind(next.kind) && current.level && next.thinking.includes(current.level) ? current.level : null;
		onSelect(composeSelection(selector, level));
		setOpen(false);
		buttonRef.current?.focus();
	};

	return (
		<div className="min-w-0 space-y-1.5">
			<div className="flex min-w-0 flex-wrap items-center gap-1.5">
				<button
					ref={buttonRef}
					type="button"
					disabled={disabled}
					aria-expanded={open && !disabled}
					onClick={() => setOpen((value) => !value)}
					title={label}
					className={`${MODEL_PICKER_BUTTON_CLASS} !h-auto min-h-8 py-1.5 ${current.selector ? "" : "italic text-[var(--text-muted)]"}`}
				>
					<span className="min-w-0 whitespace-normal break-words">{label}</span>
					<ChevronDown size={11} className="shrink-0 text-neutral-500" />
				</button>
				{supportsThinking && (
					<ThinkingLevelPicker
						variant="pill"
						levels={levels}
						value={current.level ?? "auto"}
						open={levelOpen && !disabled}
						onOpenChange={(value) => { if (!disabled) setLevelOpen(value); }}
						onSelect={(level) => {
							if (!disabled) onSelect(composeSelection(current.selector, level === "auto" ? null : level));
						}}
					/>
				)}
				<Button
					size="sm"
					onClick={() => {
						setOpen(false);
						useServiceModelConfiguration.getState().start({ role, scope, projectPath: projectCwd });
						useUi.getState().openSettings("providers", { focusKey: "otherModels" });
					}}
				>
					{t("settingsModels.servicePickerConfigure")}
				</Button>
			</div>
			{effective.selector && entries !== null && (
				modelRoleCompatibility(effectiveEntry, role) === "unverified" ? (
					<p className="max-w-md whitespace-normal break-words text-[11px] text-[var(--status-warning)]">{t("settingsModels.servicePickerUnverified")}</p>
				) : modelRoleCompatibility(effectiveEntry, role) === "incompatible" ? (
					<p className="max-w-md whitespace-normal break-words text-[11px] text-[var(--status-warning)]">{t("settingsModels.servicePickerIncompatible")}</p>
				) : null
			)}
			<FloatingLayer
				anchor={open && !disabled ? buttonRef.current : null}
				placement="bottom-start"
				layer="popover"
				ignoreRefs={[buttonRef]}
				onDismiss={() => { setOpen(false); buttonRef.current?.focus(); }}
				className="w-[380px] max-w-[calc(100vw-16px)] rounded-xl !bg-[var(--bg-panel)] py-1.5"
			>
				{loading && <div role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-muted)]"><Loader2 size={13} className="animate-spin" />{t("models.loadingModels")}</div>}
				{error && (
					<div role="alert" className="space-y-1 px-3 py-2 text-xs">
						<p className="whitespace-normal break-words text-[var(--status-error)]">{t("settingsModels.servicePickerLoadError", { error })}</p>
						<Button size="sm" loading={loading} onClick={() => void load(true)}>{t("settingsModels.reloadBtn")}</Button>
					</div>
				)}
				{candidates.length > 0 && <ModelMenuContent models={models} currentValue={currentValue} onSelect={select} closeOnSelect />}
				{entries !== null && candidates.length === 0 && !loading && !error && <p className="px-3 py-4 text-xs text-[var(--text-muted)]">{t("settingsModels.servicePickerEmpty")}</p>}
			</FloatingLayer>
		</div>
	);
}
