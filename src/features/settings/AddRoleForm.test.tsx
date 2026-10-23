// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddRoleForm } from "./AddRoleForm";

afterEach(cleanup);

describe("AddRoleForm IME", () => {
	it("does not submit on the Enter that confirms an IME candidate", () => {
		const onCancel = vi.fn();
		const ctx = { scope: "global", busy: false, projectName: "" } as never;
		render(<AddRoleForm ctx={ctx} existing={new Set()} onAdded={vi.fn()} onCancel={onCancel} />);
		const input = screen.getByLabelText("新角色名称");
		fireEvent.change(input, { target: { value: "ni" } });
		fireEvent.compositionStart(input);
		fireEvent.keyDown(input, { key: "Enter", isComposing: true });
		// Submitting an unpicked model would surface a validation error.
		expect(screen.queryByRole("alert")).toBeNull();
		fireEvent.compositionEnd(input);
	});
});
