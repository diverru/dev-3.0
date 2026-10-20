import { describe, expect, it } from "vitest";
import { inputTypesText, keyTypesText } from "../terminal-history-input";

const key = (init: Partial<Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">>) =>
	({ key: "", metaKey: false, ctrlKey: false, altKey: false, ...init });

describe("keyTypesText", () => {
	it.each(["a", "Z", "1", "й", "Enter", "Backspace", "Delete"])("treats %j as text", (name) => {
		expect(keyTypesText(key({ key: name }))).toBe(true);
	});

	it.each(["Escape", "ArrowUp", "PageUp", "Tab", "q", "/", " "])("leaves %j to tmux history", (name) => {
		expect(keyTypesText(key({ key: name }))).toBe(false);
	});

	it("leaves modified keys to tmux history", () => {
		expect(keyTypesText(key({ key: "c", ctrlKey: true }))).toBe(false);
		expect(keyTypesText(key({ key: "f", altKey: true }))).toBe(false);
		expect(keyTypesText(key({ key: "v", metaKey: true }))).toBe(false);
	});
});

describe("inputTypesText", () => {
	it.each(["x", "hello", "привет", "\r", "\x7f", "\x1b[3~"])("treats %j as text", (data) => {
		expect(inputTypesText(data)).toBe(true);
	});

	it.each(["\x1b", "\x03", "\x1b[A", "\x1b[Z", "\t", "q", "/", " ", ""])("leaves %j to tmux history", (data) => {
		expect(inputTypesText(data)).toBe(false);
	});
});
