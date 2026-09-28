import type { OmpProviderInfo, ProviderConfig } from "../../lib/contracts";

export interface ProviderListRow {
	key: string;
	/** OMP config (models.yml/config.yml/agent.db), when the provider exists there. */
	omp: OmpProviderInfo | null;
	workbench: ProviderConfig | null;
}

export function buildProviderRows(
	ompProviders: OmpProviderInfo[],
	providers: ProviderConfig[],
): ProviderListRow[] {
	const map = new Map<string, ProviderListRow>();
	for (const info of ompProviders) {
		map.set(info.id, { key: info.id, omp: info, workbench: null });
	}
	for (const cfg of providers) {
		const existing = map.get(cfg.slug);
		if (existing) {
			existing.workbench = cfg;
		} else {
			map.set(cfg.slug, { key: cfg.slug, omp: null, workbench: cfg });
		}
	}
	const list = [...map.values()];
	list.sort((a, b) => {
		// Managed rows first, then OMP-configured, then workbench-only;
		// within a tier sort by id/name.
		const ra = a.workbench ? (a.omp ? 0 : 2) : 1;
		const rb = b.workbench ? (b.omp ? 0 : 2) : 1;
		if (ra !== rb) return ra - rb;
		const an = a.omp?.id ?? a.workbench?.name ?? "";
		const bn = b.omp?.id ?? b.workbench?.name ?? "";
		return an.localeCompare(bn);
	});
	return list;
}

export function providerRowMatchesQuery(
	row: ProviderListRow,
	query: string,
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const modelTerms: string[] = [];
	if (row.omp?.modelIds) {
		modelTerms.push(...row.omp.modelIds);
	}
	if (row.workbench?.models) {
		for (const m of row.workbench.models) {
			if (typeof m === "string") {
				modelTerms.push(m);
			} else if (m && typeof m === "object") {
				if (m.id) modelTerms.push(m.id);
				if (m.name) modelTerms.push(m.name);
			}
		}
	}
	const haystack = [
		row.omp?.id,
		row.workbench?.name,
		row.workbench?.slug,
		row.omp?.baseUrl ?? row.workbench?.baseUrl,
		...modelTerms,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return haystack.includes(q);
}

export function providerRowName(row: ProviderListRow): string {
	return row.workbench?.name ?? row.omp?.id ?? row.key;
}

export function formatHostOnly(rawUrl: string | null | undefined): string | null {
	if (!rawUrl) return null;
	const trimmed = rawUrl.trim();
	if (!trimmed) return null;
	try {
		const candidate = trimmed.includes("://") ? trimmed : `http://${trimmed}`;
		const parsed = new URL(candidate);
		const host = parsed.host;
		if (host) return host;
	} catch {
		// ignore
	}
	return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}
