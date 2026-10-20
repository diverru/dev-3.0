import { init, Terminal } from "ghostty-web";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordingCtx } from "../terminal-bidi/__tests__/fixtures";

beforeAll(() => init());

beforeEach(() => {
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(recordingCtx().ctx as never);
	vi.stubGlobal("requestAnimationFrame", () => 1);
	vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

describe("real ghostty terminal disposal", () => {
	it("keeps word selection, clipboard copy and outside-click clearing after reopening", () => {
		const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
		for (let cycle = 0; cycle < 2; cycle++) {
			const terminal = new Terminal();
			const container = document.body.appendChild(document.createElement("div"));
			terminal.open(container);
			terminal.write("hello world");
			container.querySelector("canvas")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
			expect(terminal.getSelection()).toBe("hello");
			expect(copy).toHaveBeenLastCalledWith("hello");
			document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			expect(terminal.hasSelection()).toBe(false);
			terminal.dispose();
			container.remove();
		}
	});

	it("cleans up document mouse and click listeners registered during open", () => {
		const add = vi.spyOn(document, "addEventListener");
		const remove = vi.spyOn(document, "removeEventListener");
		for (let cycle = 0; cycle < 3; cycle++) {
			const terminal = new Terminal();
			const container = document.body.appendChild(document.createElement("div"));
			terminal.open(container);
			terminal.dispose();
			container.remove();
		}
		const registrations = add.mock.calls.filter(([type]) => type.startsWith("mouse") || type === "click");
		expect(registrations.length).toBeGreaterThan(0);
		for (const [type, listener] of registrations) {
			expect(remove.mock.calls.some(([removedType, removedListener]) =>
				removedType === type && removedListener === listener,
			), `dispose must remove document.${type}`).toBe(true);
		}
	});

	it("releases the main canvas backing store even after its container was detached", () => {
		const terminal = new Terminal();
		const container = document.body.appendChild(document.createElement("div"));
		terminal.open(container);
		const canvas = container.querySelector("canvas")!;
		expect(canvas.width * canvas.height).toBeGreaterThan(0);
		container.remove();
		terminal.dispose();
		terminal.dispose();
		expect([canvas.width, canvas.height, canvas.parentNode]).toEqual([0, 0, null]);
	});
});
