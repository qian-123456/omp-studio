/** Settings ▸ 模型与供应商 (`providers`, legacy deep-link `quota`). */
import { useEffect, useState } from "react";
import { Segmented } from "../../../components/Segmented";
import { useUi } from "../../../stores/ui";
import { ProviderPanel } from "../../providers/ProviderPanel";
import { QuotaDashboardCard } from "./QuotaDashboardCard";

type Tab = "config" | "quota";

const TAB_STORAGE_KEY = "ompws:providers-tab";

export function ProvidersSection() {
	const requested = useUi((s) => (s.settingsPending ? s.settingsSection : null));
	const [tab, setTab] = useState<Tab>(() => {
		const s = useUi.getState();
		if (s.settingsPending && s.settingsSection === "quota") return "quota";
		try {
			return localStorage.getItem(TAB_STORAGE_KEY) === "quota" ? "quota" : "config";
		} catch {
			return "config";
		}
	});

	useEffect(() => {
		if (requested === "quota") {
			setTab("quota");
			try {
				localStorage.setItem(TAB_STORAGE_KEY, "quota");
			} catch {
				/* storage unavailable */
			}
		}
	}, [requested]);

	const handleTab = (v: Tab) => {
		setTab(v);
		try {
			localStorage.setItem(TAB_STORAGE_KEY, v);
		} catch {
			/* storage unavailable */
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between pb-3 border-b border-[var(--border-divider)]">
				<Segmented
					options={[
						{ value: "config", label: "接口与密钥" },
						{ value: "quota", label: "订阅与配额" },
					]}
					value={tab}
					onChange={handleTab}
					size="md"
				/>
			</div>
			{tab === "config" ? (
				<div data-field-id="providerList">
					<ProviderPanel />
				</div>
			) : (
				<QuotaDashboardCard />
			)}
		</div>
	);
}
