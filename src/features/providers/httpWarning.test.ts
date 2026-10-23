import { describe, expect, it } from "vitest";
import { insecureHttpWarning } from "./httpWarning";

describe("insecureHttpWarning", () => {
	it("warns for plain http on public hosts", () => {
		expect(insecureHttpWarning("http://api.example.com/v1")).not.toBeNull();
		expect(insecureHttpWarning("http://8.8.8.8:8000")).not.toBeNull();
	});
	it("stays quiet for https, local/private hosts and junk", () => {
		expect(insecureHttpWarning("https://api.example.com")).toBeNull();
		expect(insecureHttpWarning("http://localhost:11434")).toBeNull();
		expect(insecureHttpWarning("http://192.168.1.5/v1")).toBeNull();
		expect(insecureHttpWarning("http://172.20.0.1")).toBeNull();
		expect(insecureHttpWarning("http://[::1]:8000")).toBeNull();
		expect(insecureHttpWarning("nonsense")).toBeNull();
	});
});
