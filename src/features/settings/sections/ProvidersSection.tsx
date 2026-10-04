/** Settings ▸ API 供应商 (`providers`). */
import { ProviderPanel } from "../../providers/ProviderPanel";
import { QuotaDashboardCard } from "./QuotaDashboardCard";

export function ProvidersSection() {
	return (
		<div className="space-y-4">
			<QuotaDashboardCard />
			<div data-field-id="providerList">
				<ProviderPanel />
			</div>
		</div>
	);
}
