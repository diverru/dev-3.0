# Keep terminal history position after copying

## Context

`MouseDragEnd1Pane` used `copy-pipe-and-cancel`, so selecting older output copied text and immediately returned to live output. PR #991 previously tried retaining copy-mode and was reverted in #1013 because subsequent input remained trapped in history; see `decisions/2026/07/20/revert-tmux-copy-mode-after-copy.md`.

## Investigation

A real tmux/Ghostty test reproduces the jump after a successful OSC 52 copy. Ghostty emits encoded keys and automatic terminal responses through the same `onData` callback, so cancelling on every outgoing message would also abandon history during mouse selection or terminal queries. Its custom key handler runs before key encoding and `onData`.

## Decision

Both tmux copy-mode tables use `copy-pipe` when `scroll_position` is positive and `copy-pipe-and-cancel` at the live tail, preserving OSC 52 and a scrolled viewport without leaving live-screen copies in a mode that holds agent input. In `TerminalView`, ordinary text/IME input, paste and attachment paths leave copy-mode before sending bytes; cancel keys, navigation, modifiers and copy shortcuts stay with tmux. Once a history command takes keyboard control, subsequent text and Enter also stay with tmux, including search prompts, until a new mouse gesture or explicit click/paste resumes input. A fresh tmux stream and returning window focus account for inherited mode after fullscreen remounts or another viewer, with at most one cancellation round trip and no per-key polling.

## Risks

Copy-mode exit is an asynchronous RPC: the first key waits for it, and overlapping keys share the existing pending promise to preserve order. Deliberately scrolled history still defers agent deliveries under the existing policy; live-screen copying exits immediately, and delivery code is unchanged. Real tmux tests cover OSC 52, live-copy exit, retained history position, cancel keys consumed without application input, and resumed typing/paste; renderer tests cover ordering and history search input.

## Alternatives considered

Retaining copy-mode without handling subsequent input repeats #1013's regression. Cancelling and reconstructing the viewport would race live output and other viewers. Replacing tmux selection with a separate renderer selection model is larger than retaining the existing clipboard path.
