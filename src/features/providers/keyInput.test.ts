import { describe, expect, it } from "vitest";
import type { ProviderRow } from "../../lib/contracts";
import { initialEnvName, initialKeyInputMode, isEnvName, keyInputProblem, keyToSend } from "./keyInput";

const envRow = { key: { kind: "envVar", envVar: "FOO_KEY", envSet: false } } as Pick<ProviderRow, "key">;
const plainRow = { key: { kind: "plaintext", envVar: null, envSet: null } } as Pick<ProviderRow, "key">;

describe("env variable name rules", () => {
	it.each(["OPENAI_API_KEY", "_X", "A1"])("accepts %s", (name) => expect(isEnvName(name)).toBe(true));
	it.each(["", "1ABC", "my-key", "sk-abc", "lower", "A B"])("rejects %j", (name) => expect(isEnvName(name)).toBe(false));
});

describe("mode and name preselection", () => {
	it("envVar rows open in env mode with their name; others in plain mode", () => {
		expect(initialKeyInputMode(envRow)).toBe("env");
		expect(initialKeyInputMode(plainRow)).toBe("plain");
		expect(initialKeyInputMode(null)).toBe("plain");
		expect(initialEnvName(envRow, "PRESET_KEY")).toBe("FOO_KEY");
		expect(initialEnvName(plainRow, "PRESET_KEY")).toBe("PRESET_KEY");
		expect(initialEnvName(null)).toBe("");
	});
});

describe("keyInputProblem / keyToSend", () => {
	it("env mode needs a valid name", () => {
		expect(keyInputProblem({ mode: "env", envName: "", plainKey: "" })).toBe("envEmpty");
		expect(keyInputProblem({ mode: "env", envName: "my-key", plainKey: "" })).toBe("envInvalid");
		expect(keyInputProblem({ mode: "env", envName: "MY_KEY", plainKey: "ignored" })).toBeNull();
		expect(keyToSend({ mode: "env", envName: " MY_KEY ", plainKey: "sk-x" })).toBe("MY_KEY");
	});
	it("plain mode blocks name-like keys, keeps a blank key unless one is required", () => {
		expect(keyInputProblem({ mode: "plain", envName: "", plainKey: "OPENAI_API_KEY" })).toBe("plainLooksLikeName");
		expect(keyInputProblem({ mode: "plain", envName: "", plainKey: "sk-abc123" })).toBeNull();
		expect(keyInputProblem({ mode: "plain", envName: "", plainKey: "" })).toBeNull();
		expect(keyInputProblem({ mode: "plain", envName: "", plainKey: " ", requirePlainKey: true })).toBe("plainRequired");
		expect(keyToSend({ mode: "plain", envName: "X", plainKey: "  " })).toBeNull();
		expect(keyToSend({ mode: "plain", envName: "X", plainKey: " sk-1 " })).toBe("sk-1");
	});
});
