// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

afterEach(cleanup);

function Host({ onClose }: { onClose?: () => void }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				opener
			</button>
			{open && (
				<Modal
					title="标题"
					onClose={() => {
						onClose?.();
						setOpen(false);
					}}
				>
					<input aria-label="field" />
				</Modal>
			)}
		</>
	);
}

describe("Modal", () => {
	it("renders an aria-modal dialog labelled by its title", () => {
		render(
			<Modal title="设置密钥" onClose={() => {}}>
				<p>body</p>
			</Modal>,
		);
		const dialog = screen.getByRole("dialog", { name: "设置密钥" });
		expect(dialog.getAttribute("aria-modal")).toBe("true");
		expect(dialog.parentElement?.parentElement).toBe(document.body);
	});

	it("closes on backdrop mousedown but not on panel mousedown", () => {
		const onClose = vi.fn();
		render(
			<Modal title="t" onClose={onClose}>
				<p>body</p>
			</Modal>,
		);
		const dialog = screen.getByRole("dialog");
		fireEvent.mouseDown(dialog);
		expect(onClose).not.toHaveBeenCalled();
		fireEvent.mouseDown(dialog.parentElement as HTMLElement);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("ignores backdrop clicks when closeOnBackdrop is false", () => {
		const onClose = vi.fn();
		render(
			<Modal title="t" closeOnBackdrop={false} onClose={onClose}>
				<p>body</p>
			</Modal>,
		);
		fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("closes on Escape and via the header close button", () => {
		const onClose = vi.fn();
		render(
			<Modal title="t" onClose={onClose}>
				<p>body</p>
			</Modal>,
		);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByLabelText("关闭"));
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it("renders no header without a title and uses ariaLabel", () => {
		render(
			<Modal ariaLabel="图片" onClose={() => {}}>
				<p>body</p>
			</Modal>,
		);
		expect(screen.getByRole("dialog", { name: "图片" })).toBeTruthy();
		expect(screen.queryByLabelText("关闭")).toBeNull();
	});

	it("restores focus to the opener when closed", () => {
		render(<Host />);
		const opener = screen.getByText("opener");
		opener.focus();
		fireEvent.click(opener);
		expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(opener);
	});

	it("supports disabling backdrop blur and custom backdrop classes", () => {
		render(
			<Modal ariaLabel="无模糊" onClose={() => {}} backdropBlur={false} backdropClassName="bg-transparent">
				<p>content</p>
			</Modal>,
		);
		const dialog = screen.getByRole("dialog", { name: "无模糊" });
		const backdrop = dialog.parentElement!;
		expect(backdrop.className).not.toContain("backdrop-blur-md");
		expect(backdrop.className).toContain("bg-transparent");
	});
});
