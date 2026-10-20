# Keep terminal history position after copying

## Context

`MouseDragEnd1Pane` used `copy-pipe-and-cancel`, so selecting older output copied text and immediately returned to live output. PR #991 previously tried retaining copy-mode and was reverted in #1013 because subsequent input remained trapped in history; see `decisions/2026/07/20/revert-tmux-copy-mode-after-copy.md`.

## Investigation

A real tmux/Ghostty test reproduces the jump after a successful OSC 52 copy. Ghostty emits encoded keys and automatic terminal responses through the same `onData` callback, so cancelling on every outgoing message would also abandon history during mouse selection or terminal queries. Its custom key handler runs before key encoding and `onData`.

## Decision

Use `copy-pipe` in both tmux copy-mode tables, preserving OSC 52 copying and the history viewport. In `TerminalView`, keyboard input initiates the existing copy-mode exit, and encoded keys wait for that request before reaching the pane. Direct text/IME input, paste and attachment paths use the same ordering; mouse reports, terminal replies, copy shortcuts and modifier keys do not initiate an exit. A fresh tmux stream and returning window focus conservatively arm the existing mode suspicion, covering inherited state after fullscreen remounts or another viewer. This adds at most one cancellation round trip before resumed input, without polling every key. The existing plain-click-to-resume behavior remains.

## Risks

Copy-mode exit is an asynchronous RPC: the first key waits for it, and overlapping keys share the existing pending promise to preserve order. An active copy-mode still defers agent deliveries under the existing policy; no delivery logic changes. A real tmux test covers OSC 52 contents, retained position, repeated selection and resumed pane input, alongside renderer ordering tests.

## Alternatives considered

Retaining copy-mode without handling subsequent input repeats #1013's regression. Cancelling and reconstructing the viewport would race live output and other viewers. Replacing tmux selection with a separate renderer selection model is larger than retaining the existing clipboard path.
