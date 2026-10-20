// Whether input typed while tmux may sit in copy-mode is text for the pane or a history
// command tmux must consume (cancel, navigation, search).
// decisions/2026/10/20/keep-terminal-history-position-after-copy.md

/** Printable keys that cancel, search or page through history in tmux's default tables. */
const HISTORY_COMMAND_TEXT = new Set(["q", "/", " "]);

/** Would this key type text into the pane rather than drive tmux history? */
export function keyTypesText(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): boolean {
	if (event.metaKey || event.ctrlKey || event.altKey) return false;
	if (event.key.length === 1) return !HISTORY_COMMAND_TEXT.has(event.key);
	return event.key === "Enter" || event.key === "Backspace" || event.key === "Delete";
}

/** The same question for bytes that arrive without a key event (extra-key bar, IME, text input). */
export function inputTypesText(data: string): boolean {
	if (data === "\r" || data === "\x7f" || data === "\x1b[3~") return true;
	if (HISTORY_COMMAND_TEXT.has(data)) return false;
	// Esc, Ctrl-letters, arrows and Tab are control bytes: tmux's copy-mode keys, not text.
	return data.length > 0 && !/[\x00-\x1f\x7f]/.test(data);
}
