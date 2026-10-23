/** Pure skill-enablement helpers (OMP config filter pipeline). */

import { parse as parseYaml } from "yaml";
import type { OmpConfigListResult, SkillItem, SkillProvider } from "./contracts";

/** The OMP config slice that decides whether a skill reaches new sessions. */
export interface SkillEnableConfig {
	/** `skills.enabled` master switch (default true). */
	skillsEnabled: boolean;
	/** `skills.enable*` source toggles, keyed by full config key. */
	sourceToggles: Record<string, boolean>;
	/** `skills.ignoredSkills` glob list. */
	ignored: string[];
	/** `skills.includeSkills` allowlist (empty = include everything). */
	include: string[];
	/** `disabledExtensions` entries (`skill:<name>` marks a disabled skill). */
	disabledExtensions: string[];
}

export const DEFAULT_SKILL_CONFIG: SkillEnableConfig = {
	skillsEnabled: true,
	sourceToggles: {},
	ignored: [],
	include: [],
	disabledExtensions: [],
};

/** Why a skill won't reach a new session. Order matches the filter pipeline. */
export type SkillDisabledReason =
	| { kind: "disabled" } // disabledExtensions contains skill:<name>
	| { kind: "source"; key: string } // its source toggle is off
	| { kind: "ignored"; pattern: string; exact: boolean } // ignoredSkills match
	| { kind: "not_included" } // includeSkills non-empty and no match
	| { kind: "all_off" }; // skills.enabled = false

export interface SkillEnablement {
	enabled: boolean;
	reason: SkillDisabledReason | null;
}

/** `(provider, source)` → the OMP `skills.enable*` key gating that root. */
const PROVIDER_SOURCE_TOGGLE: Record<SkillProvider, Record<string, string>> = {
	native: { user: "skills.enablePiUser", project: "skills.enablePiProject" },
	claude: {
		user: "skills.enableClaudeUser",
		project: "skills.enableClaudeProject",
	},
	agents: {
		user: "skills.enableAgentsUser",
		project: "skills.enableAgentsProject",
	},
	codex: { user: "skills.enableCodexUser" },
	github: {},
	managed: {},
};

/** Anchored single-segment glob (`*`, `?`; `**` ≡ `*`), case-sensitive. */
export function skillGlobMatch(pattern: string, name: string): boolean {
	const re = new RegExp(
		`^${pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*+/g, ".*")
			.replace(/\?/g, ".")}$`,
	);
	return re.test(name);
}

/** Reads `omp config list` output into the slice needed for enablement. */
export function parseSkillConfig(list: OmpConfigListResult): SkillEnableConfig {
	const cfg: SkillEnableConfig = { ...DEFAULT_SKILL_CONFIG, sourceToggles: {} };
	for (const entry of list.entries) {
		const strList = () =>
			Array.isArray(entry.value)
				? entry.value.filter((v): v is string => typeof v === "string")
				: [];
		switch (entry.key) {
			case "skills.enabled":
				if (typeof entry.value === "boolean") cfg.skillsEnabled = entry.value;
				break;
			case "skills.ignoredSkills":
				cfg.ignored = strList();
				break;
			case "skills.includeSkills":
				cfg.include = strList();
				break;
			case "disabledExtensions":
				cfg.disabledExtensions = strList();
				break;
			default:
				if (
					entry.key.startsWith("skills.enable") &&
					typeof entry.value === "boolean"
				) {
					cfg.sourceToggles[entry.key] = entry.value;
				}
		}
	}
	return cfg;
}

/**
 * Keys of the project `.omp/config.yml` layer that the skills page cares about.
 * Only keys actually present in the file are set — absent keys inherit global.
 */
export interface ProjectSkillLayer {
	skillsEnabled?: boolean;
	sourceToggles: Record<string, boolean>;
	ignored?: string[];
	include?: string[];
	disabledExtensions?: string[];
}

export const EMPTY_PROJECT_LAYER: ProjectSkillLayer = { sourceToggles: {} };

const strArray = (v: unknown): string[] | undefined =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

/**
 * Reads the skills-related keys out of project `config.yml` text.
 * Blank text → empty layer. Throws when the YAML is invalid.
 */
export function parseProjectSkillLayer(text: string): ProjectSkillLayer {
	const layer: ProjectSkillLayer = { sourceToggles: {} };
	if (text.trim() === "") return layer;
	const root = parseYaml(text) as Record<string, unknown> | null | undefined;
	if (typeof root !== "object" || root === null || Array.isArray(root)) return layer;
	const disabled = strArray(root.disabledExtensions);
	if (disabled) layer.disabledExtensions = disabled;
	const skills = root.skills as Record<string, unknown> | null | undefined;
	if (typeof skills === "object" && skills !== null && !Array.isArray(skills)) {
		if (typeof skills.enabled === "boolean") layer.skillsEnabled = skills.enabled;
		const ignored = strArray(skills.ignoredSkills);
		if (ignored) layer.ignored = ignored;
		const include = strArray(skills.includeSkills);
		if (include) layer.include = include;
		for (const [k, v] of Object.entries(skills)) {
			if (k.startsWith("enable") && k !== "enabled" && typeof v === "boolean") {
				layer.sourceToggles[`skills.${k}`] = v;
			}
		}
	}
	return layer;
}

/** Config keys the project layer overrides (what a global write can't reach). */
export type SkillOverrideKey = string;

/**
 * global → project merge: project arrays REPLACE global ones, project scalars
 * win, source-toggle maps merge key-wise, absent project keys inherit.
 */
export function mergeSkillConfig(
	global: SkillEnableConfig,
	layer: ProjectSkillLayer,
): { config: SkillEnableConfig; overrides: SkillOverrideKey[] } {
	const overrides: SkillOverrideKey[] = [];
	const config: SkillEnableConfig = {
		...global,
		sourceToggles: { ...global.sourceToggles },
	};
	if (layer.skillsEnabled !== undefined) {
		config.skillsEnabled = layer.skillsEnabled;
		overrides.push("skills.enabled");
	}
	if (layer.ignored) {
		config.ignored = layer.ignored;
		overrides.push("skills.ignoredSkills");
	}
	if (layer.include) {
		config.include = layer.include;
		overrides.push("skills.includeSkills");
	}
	if (layer.disabledExtensions) {
		config.disabledExtensions = layer.disabledExtensions;
		overrides.push("disabledExtensions");
	}
	for (const [k, v] of Object.entries(layer.sourceToggles)) {
		config.sourceToggles[k] = v;
		overrides.push(k);
	}
	return { config, overrides };
}

/**
 * Applies OMP's session-start filter pipeline to one skill:
 * skills.enabled → disabledExtensions `skill:<name>` → source toggle →
 * ignoredSkills globs → includeSkills allowlist. Exported for tests.
 */
export function resolveSkillEnablement(
	skill: SkillItem,
	cfg: SkillEnableConfig,
): SkillEnablement {
	const deny = (reason: SkillDisabledReason): SkillEnablement => ({
		enabled: false,
		reason,
	});
	if (!cfg.skillsEnabled) return deny({ kind: "all_off" });
	if (cfg.disabledExtensions.includes(`skill:${skill.name}`))
		return deny({ kind: "disabled" });
	const key = PROVIDER_SOURCE_TOGGLE[skill.provider]?.[skill.source];
	if (key && cfg.sourceToggles[key] === false)
		return deny({ kind: "source", key });
	const exact = cfg.ignored.some((p) => p === skill.name);
	const globbed = cfg.ignored.find((p) => skillGlobMatch(p, skill.name));
	if (exact) return deny({ kind: "ignored", pattern: skill.name, exact: true });
	if (globbed) return deny({ kind: "ignored", pattern: globbed, exact: false });
	if (cfg.include.length > 0 && !cfg.include.some((p) => skillGlobMatch(p, skill.name)))
		return deny({ kind: "not_included" });
	return { enabled: true, reason: null };
}
