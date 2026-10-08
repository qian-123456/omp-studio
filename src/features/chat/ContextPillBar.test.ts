import { describe, expect, it } from "vitest";

// Testing branch name validation logic aligned with Codex rules
function validateBranchName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	if (trimmed.endsWith("/")) return 'Branch name cannot end with "/".';
	if (trimmed.startsWith("/")) return 'Branch name cannot start with "/".';
	if (/\s/.test(trimmed)) return "Branch name cannot contain spaces.";
	if (/[\^~:?*\[\\]/.test(trimmed)) return "Branch name contains invalid characters.";
	if (trimmed.includes("..")) return 'Branch name cannot contain "..".';
	return null;
}

describe("validateBranchName", () => {
	it("accepts valid git branch names", () => {
		expect(validateBranchName("main")).toBeNull();
		expect(validateBranchName("omp/new-feature")).toBeNull();
		expect(validateBranchName("codex/task-123")).toBeNull();
	});

	it("rejects branch names ending or starting with slash", () => {
		expect(validateBranchName("codex/")).toBe('Branch name cannot end with "/".');
		expect(validateBranchName("/feature")).toBe('Branch name cannot start with "/".');
	});

	it("rejects branch names with spaces", () => {
		expect(validateBranchName("my feature")).toBe("Branch name cannot contain spaces.");
	});

	it("rejects invalid characters and double dots", () => {
		expect(validateBranchName("feat~1")).toBe("Branch name contains invalid characters.");
		expect(validateBranchName("feat..branch")).toBe('Branch name cannot contain "..".');
	});
});
